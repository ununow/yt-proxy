const API_KEY = process.env.YOUTUBE_API_KEY;

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const parts = u.pathname.split("/");
    const idx = parts.indexOf("shorts");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return null;
  } catch {
    return null;
  }
}

async function fetchVideoSnippet(videoId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("videos.list failed");
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) throw new Error("Video not found");
  const s = item.snippet;
  const thumbs = s.thumbnails || {};
  const t = thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default || {};
  return { title: s.title || "", thumbnailUrl: t.url || "", thumbnailAlt: "" };
}

async function fetchCommentsPage(videoId, order = "relevance", pageToken = "") {
  const url =
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}` +
    `&maxResults=100&order=${order}&textFormat=plainText&key=${API_KEY}` +
    (pageToken ? `&pageToken=${pageToken}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error("commentThreads.list failed");
  return res.json();
}

export default async function handler(req, res) {
  try {
    const { videoUrl, sortBy = "likes", maxComments = "200" } = req.query || {};
    if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

    const N = Math.max(100, Math.min(300, parseInt(maxComments, 10) || 200));
    const videoId = extractVideoId(videoUrl);
    if (!videoId) return res.status(400).json({ error: "Invalid videoUrl" });

    // 메타 수집
    const meta = await fetchVideoSnippet(videoId);

    // 댓글 수집
    const collected = new Map();
    const pull = async (order, pages = 2) => {
      let token = "";
      for (let i = 0; i < pages; i++) {
        const json = await fetchCommentsPage(videoId, order, token);
        (json.items || []).forEach((it) => {
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
        });
        token = json.nextPageToken || "";
        if (!token) break;
      }
    };

    await pull("relevance", 2);
    await pull("time", 2);

    let arr = Array.from(collected.values());
    if (sortBy === "likes") {
      arr.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    } else if (sortBy === "time") {
      arr.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }
    arr = arr.slice(0, N);

    return res.status(200).json({
      videoId,
      title: meta.title,
      thumbnailUrl: meta.thumbnailUrl,
      thumbnailAlt: meta.thumbnailAlt,
      comments: arr,
    });
  } catch (e) {
    const msg = e?.message || "Server error";
    const status = msg.includes("quota") ? 429 : 500;
    return res.status(status).json({ error: msg });
  }
}
