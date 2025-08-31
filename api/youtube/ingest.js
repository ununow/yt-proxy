// api/youtube/ingest.js
const API_KEY = process.env.YOUTUBE_API_KEY;

// URL에서 videoId 추출
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/");
    const idx = parts.indexOf("shorts");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}

// 타임아웃 (8초)
function withTimeout(ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort("timeout"), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t) };
}

// 영상 제목 + 썸네일
async function fetchVideoSnippet(videoId) {
  const url =
    `https://www.googleapis.com/youtube/v3/videos?` +
    `part=snippet&id=${videoId}&key=${API_KEY}` +
    `&fields=items(id,snippet(title,thumbnails))`;

  const { signal, clear } = withTimeout();
  const res = await fetch(url, { signal }).catch(e => ({ ok: false, statusText: e?.message || "fetch error" }));
  clear();

  if (!res.ok) throw new Error("videos.list failed");
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error("Video not found");

  const s = item.snippet || {};
  const thumbs = s.thumbnails || {};
  const pick = thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {};
  return { title: s.title || "", thumbnailUrl: pick.url || "", thumbnailAlt: "" };
}

// 댓글 페이지
async function fetchCommentsPage(videoId, order = "relevance", pageToken = "") {
  const base =
    `https://www.googleapis.com/youtube/v3/commentThreads?` +
    `part=snippet&videoId=${videoId}&maxResults=100&order=${order}&textFormat=plainText&key=${API_KEY}` +
    `&fields=items(id,snippet/topLevelComment/snippet(authorDisplayName,likeCount,publishedAt,textDisplay,textOriginal)),nextPageToken`;
  const url = pageToken ? `${base}&pageToken=${pageToken}` : base;

  const { signal, clear } = withTimeout();
  const res = await fetch(url, { signal }).catch(e => ({ ok: false, status: 0, statusText: e?.message || "fetch error" }));
  clear();

  if (!res.ok) {
    if (res.status === 403 || res.status === 404) {
      return { items: [], nextPageToken: "" };
    }
    throw new Error("commentThreads.list failed");
  }
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (!API_KEY) return res.status(500).json({ error: "YOUTUBE_API_KEY missing" });

    const { videoUrl, sortBy = "likes", maxComments = "300" } = req.query || {};
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

    const videoId = extractVideoId(videoUrl);
    if (!videoId) return res.status(400).json({ error: "Invalid videoUrl" });

    // 댓글 수 상한: 100~300
    const N = Math.max(100, Math.min(300, parseInt(maxComments, 10) || 300));

    // 메타 (제목/썸네일)
    const meta = await fetchVideoSnippet(videoId);

    // 댓글 (relevance 3p + time 3p)
    const collected = new Map();
    const pull = async (order, pages = 3) => {
      let token = "";
      for (let i = 0; i < pages; i++) {
        const json = await fetchCommentsPage(videoId, order, token);
        for (const it of json.items || []) {
          const com = it.snippet?.topLevelComment?.snippet;
          const id = it.id;
          if (com && id) {
            collected.set(id, {
              text: com.textDisplay || com.textOriginal || "",
              likeCount: com.likeCount || 0,
              publishedAt: com.publishedAt || "",
              author: com.authorDisplayName || "",
            });
          }
        }
        token = json.nextPageToken || "";
        if (!token) break;
      }
    };

    await pull("relevance", 3);
    await pull("time", 3);

    // 정렬: 기본 좋아요순
    let comments = Array.from(collected.values());
    if (sortBy === "likes") {
      comments.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    } else if (sortBy === "time") {
      comments.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    } else {
      comments.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    }

    comments = comments.slice(0, N);

    return res.status(200).json({
      videoId,
      title: meta.title,
      thumbnailUrl: meta.thumbnailUrl,
      thumbnailAlt: meta.thumbnailAlt,
      comments,
    });
  } catch (e) {
    const msg = e?.message || "Server error";
    const status = /quota|Rate Limit/i.test(msg) ? 429 : 500;
    return res.status(status).json({ error: msg });
  }
}

