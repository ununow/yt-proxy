// /api/web/search.js
// Env vars (필요한 것만 설정하세요):
// - YOUTUBE_API_KEY
// - GOOGLE_API_KEY, GOOGLE_CX           (Google Custom Search)
// - NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (Naver Search API)
//
// 요청 예:
//   /api/web/search?query=가성비%20노트북&source=all&maxResults=5
//
// 응답 스키마:
// {
//   "results": [
//     { "title":"...", "url":"https://...", "snippet":"...", "source":"youtube|google|naver", "score":0.87 }
//   ]
// }

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const safeText = (s) => (s || "").toString().replace(/\s+/g, " ").trim();

// 간단 스코어링: 질의어 포함/최근성(유튜브)/스니펫 일치 등
function scoreItem({ title, snippet, source, publishedAt }) {
  const t = (title || "").toLowerCase();
  const sn = (snippet || "").toLowerCase();

  // 기본 가중(소스 신뢰/적합)
  let base =
    source === "youtube" ? 0.5 :
    source === "google"  ? 0.45 :
    source === "naver"   ? 0.4 : 0.3;

  // 질의어 매칭은 실행 시점에 query가 없으므로 타 함수에서 가산
  let timeBoost = 0;
  if (source === "youtube" && publishedAt) {
    const d = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / (1000 * 3600 * 24)); // days
    // 14일 이내: 0.2 → 90일 이상: 0
    timeBoost = clamp(Math.exp(-d / 14) * 0.2, 0, 0.2);
  }

  return clamp(base + timeBoost, 0, 1);
}

function addQueryBoost(score, query, title, snippet) {
  const q = (query || "").toLowerCase();
  const t = (title || "").toLowerCase();
  const sn = (snippet || "").toLowerCase();
  let boost = 0;
  if (q && t.includes(q)) boost += 0.25;
  if (q && sn.includes(q)) boost += 0.15;
  return clamp(score + boost, 0, 1);
}

async function searchYouTube(query, maxResults = 5, apiKey) {
  if (!apiKey) return [];
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(Number(maxResults) || 5, 10)));
  url.searchParams.set("key", apiKey);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  const j = await r.json();
  const items = (j.items || []).map((i) => {
    const title = safeText(i?.snippet?.title);
    const snippet = safeText(i?.snippet?.description);
    const url = `https://www.youtube.com/watch?v=${i?.id?.videoId}`;
    const publishedAt = i?.snippet?.publishedAt;
    let score = scoreItem({ title, snippet, source: "youtube", publishedAt });
    score = addQueryBoost(score, query, title, snippet);
    return { title, url, snippet, source: "youtube", score };
  });
  return items;
}

async function searchGoogle(query, maxResults = 5, apiKey, cx) {
  if (!apiKey || !cx) return [];
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Google CSE ${r.status}`);
  const j = await r.json();
  const items = (j.items || []).slice(0, Math.min(Number(maxResults) || 5, 10)).map((i) => {
    const title = safeText(i?.title);
    const snippet = safeText(i?.snippet);
    const url = i?.link || "";
    let score = scoreItem({ title, snippet, source: "google" });
    score = addQueryBoost(score, query, title, snippet);
    return { title, url, snippet, source: "google", score };
  });
  return items;
}

async function searchNaver(query, maxResults = 5, clientId, clientSecret) {
  if (!clientId || !clientSecret) return [];
  const url = new URL("https://openapi.naver.com/v1/search/blog.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(Number(maxResults) || 5, 10)));

  const r = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
  });
  if (!r.ok) throw new Error(`Naver API ${r.status}`);
  const j = await r.json();
  const items = (j.items || []).map((i) => {
    const title = safeText(i?.title?.replace(/<[^>]+>/g, ""));
    const snippet = safeText(i?.description?.replace(/<[^>]+>/g, ""));
    const url = i?.link || "";
    let score = scoreItem({ title, snippet, source: "naver" });
    score = addQueryBoost(score, query, title, snippet);
    return { title, url, snippet, source: "naver", score };
  });
  return items.slice(0, Math.min(Number(maxResults) || 5, 10));
}

export default async function handler(req, res) {
  try {
    const { query, source = "youtube", maxResults = 5 } = req.query || {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: "query required" });
    }
    const n = clamp(parseInt(maxResults, 10) || 5, 1, 10);

    const YT = process.env.YOUTUBE_API_KEY;
    const GKEY = process.env.GOOGLE_API_KEY;
    const GCX = process.env.GOOGLE_CX;
    const NID = process.env.NAVER_CLIENT_ID;
    const NSECRET = process.env.NAVER_CLIENT_SECRET;

    let results = [];

    const wants = (s) => source === s || source === "all";

    const tasks = [];
    if (wants("youtube")) tasks.push(searchYouTube(query, n, YT));
    if (wants("google")) tasks.push(searchGoogle(query, n, GKEY, GCX));
    if (wants("naver")) tasks.push(searchNaver(query, n, NID, NSECRET));

    const settled = await Promise.allSettled(tasks);
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        results.push(...s.value);
      }
    }

    // 소스 키가 전부 없으면 빈 결과
    if (!results.length) {
      return res.status(200).json({ results: [] });
    }

    // 점수 내림차순 → 상위 n개
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    results = results.slice(0, n);

    // CORS/캐시(짧게) – 원하면 조정
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}

