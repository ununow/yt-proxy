export default async function handler(req, res) {
  const { query, source = "youtube", maxResults = 5 } = req.query;

  if (!query) {
    return res.status(400).json({ error: "query required" });
  }

  const results = [];
  const limit = Math.min(Number(maxResults) || 5, 20);

  try {
    // 유튜브 검색
    if ((source === "youtube" || source === "all") && process.env.YOUTUBE_API_KEY) {
      const yt = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${limit}&key=${process.env.YOUTUBE_API_KEY}`
      );
      const data = await yt.json();
      for (const i of data.items || []) {
        results.push({
          title: i.snippet.title,
          url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
          snippet: i.snippet.description,
          source: "youtube",
        });
      }
    }

    // 구글 검색
    if ((source === "google" || source === "all") && process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) {
      const g = await fetch(
        `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}`
      );
      const data = await g.json();
      for (const i of data.items || []) {
        results.push({
          title: i.title,
          url: i.link,
          snippet: i.snippet,
          source: "google",
        });
      }
    }

    // 네이버 블로그 검색
    if ((source === "naver" || source === "all") && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
      const n = await fetch(
        `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(query)}&display=${limit}`,
        {
          headers: {
            "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET,
          },
        }
      );
      const data = await n.json();
      for (const i of data.items || []) {
        results.push({
          title: i.title.replace(/<[^>]+>/g, ""),
          url: i.link,
          snippet: i.description.replace(/<[^>]+>/g, ""),
          source: "naver",
        });
      }
    }

    if (results.length === 0) {
      return res.status(200).json({
        note: "fallback to mock",
        results: [
          { title: `[MOCK] ${query} 유튜브`, url: "https://youtu.be/mock1", snippet: "샘플 설명 1", source: "youtube" },
          { title: `[MOCK] ${query} 구글`, url: "https://example.com/mock2", snippet: "샘플 설명 2", source: "google" },
          { title: `[MOCK] ${query} 네이버`, url: "https://blog.naver.com/mock3", snippet: "샘플 설명 3", source: "naver" },
        ],
      });
    }

    res.status(200).json({ results: results.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
