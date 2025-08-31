// GET /api/thumbnail/ocr?imageUrl=...
export default async function handler(req, res) {
  try {
    const { imageUrl } = req.query || {};
    const key = process.env.OCRSPACE_API_KEY;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    if (!key) return res.status(500).json({ error: "OCR API key missing" });

    const form = new URLSearchParams();
    form.append("apikey", key);
    form.append("url", imageUrl);
    form.append("language", "kor");
    form.append("OCREngine", "2");
    form.append("scale", "true");
    form.append("isOverlayRequired", "false");

    const r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!r.ok) throw new Error("OCR API failed");
    const data = await r.json();
    const text = (data?.ParsedResults?.[0]?.ParsedText || "").replace(/\s+/g, " ").trim();
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
