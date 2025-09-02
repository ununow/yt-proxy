// api/web/ping.js
export default async function handler(req, res) {
  res.status(200).json({ ok: true, route: "api/web/ping" });
}
