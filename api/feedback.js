// Bambú: recibe las opiniones de la beta y las escribe en la planilla de Google (vía Apps Script).
// La dirección del script va en SHEET_URL o en la variable de entorno BAMBU_SHEET_URL.
const SHEET_URL = process.env.BAMBU_SHEET_URL || "https://script.google.com/macros/s/AKfycbxm8sGaoWrWsQibtCrBuzA2ZYd6vR8JXJ_GPZzWdDA_xSl1dq_2XnXoZ5bw0cABFRoCGQ/exec";
const KEYS = ["rating", "like", "improve", "bug", "recommend", "context"];
const hits = new Map();

module.exports = async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ok: !!SHEET_URL, planilla: SHEET_URL ? "conectada" : "falta conectar"});
  if (req.method !== "POST") return res.status(405).json({error: "method"});
  if (!SHEET_URL) return res.status(503).json({error: "falta conectar la planilla"});
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 10) return res.status(429).json({error: "demasiados envíos, probá en un rato"});
  h.push(now); hits.set(ip, h);
  const d = req.body || {}, row = {};
  KEYS.forEach(k => row[k] = String(d[k] || "").slice(0, 1000));
  try {
    const r = await fetch(SHEET_URL, {method: "POST", headers: {"content-type": "text/plain;charset=utf-8"}, body: JSON.stringify(row), redirect: "follow"});
    const t = await r.text();
    if (!r.ok || !/"ok"\s*:\s*true/.test(t)) { console.error("Sheet", r.status, t.slice(0, 300)); return res.status(502).json({error: "planilla " + r.status}); }
    return res.status(200).json({ok: true});
  } catch (e) { console.error(e); return res.status(502).json({error: String(e && e.message || e)}); }
};
