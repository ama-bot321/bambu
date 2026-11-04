// Bambú: recibe las opiniones de la beta y las manda al Google Form.
// Busca solo los códigos (entry) de cada pregunta leyendo el formulario por su título.
const FORM_ID = process.env.BAMBU_FORM_ID || "1FAIpQLSchmQM68nSk73DoHrysUpsEuaGsqEduCS6kIp70ijkGAuSmBQ";
const BASE = "https://docs.google.com/forms/d/e/" + FORM_ID;
const KEYS = [["rating", "utilidad"], ["like", "que le gusto"], ["improve", "que mejoraria"], ["bug", "error"], ["recommend", "recomendaria"], ["context", "contexto"]];
const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim();
let cache = null, cachedAt = 0;
const hits = new Map();

async function entries() {
  if (cache && Date.now() - cachedAt < 6 * 3600e3) return cache;
  const r = await fetch(BASE + "/viewform", {headers: {"user-agent": "Mozilla/5.0", "accept-language": "es-AR,es;q=0.9"}});
  const html = await r.text();
  if (!r.ok) throw new Error("viewform " + r.status);
  const m = html.match(/FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!m) throw new Error("No encontré los datos del formulario");
  const items = (JSON.parse(m[1])[1] || [])[1] || [];
  const qs = items.filter(it => Array.isArray(it[4]) && it[4][0]).map(it => ({title: norm(it[1]), id: it[4][0][0]}));
  const map = {};
  KEYS.forEach(([k, t], i) => { const q = qs.find(x => x.title === t) || qs.find(x => x.title.includes(t)) || qs[i]; if (q) map[k] = "entry." + q.id; });
  cache = map; cachedAt = Date.now();
  return map;
}

module.exports = async function handler(req, res) {
  // Para revisar: abrí /api/feedback en el navegador y muestra qué preguntas encontró
  if (req.method === "GET") {
    try { cache = null; const map = await entries(); res.setHeader("cache-control", "s-maxage=3600"); return res.status(200).json({ok: true, action: BASE + "/formResponse", preguntas: map}); }
    catch (e) { return res.status(200).json({ok: false, error: String(e && e.message || e)}); }
  }
  if (req.method !== "POST") return res.status(405).json({error: "method"});
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 10) return res.status(429).json({error: "rate_limited"});
  h.push(now); hits.set(ip, h);
  const d = req.body || {};
  try {
    const map = await entries();
    const body = new URLSearchParams({fvv: "1", pageHistory: "0"});
    KEYS.forEach(([k]) => { const v = String(d[k] || "").slice(0, 1000); if (map[k] && v) body.append(map[k], v); });
    const r = await fetch(BASE + "/formResponse", {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0"}, body});
    if (!r.ok) { console.error("Form", r.status); return res.status(502).json({error: "form " + r.status}); }
    return res.status(200).json({ok: true});
  } catch (e) { console.error(e); cache = null; return res.status(502).json({error: String(e && e.message || e)}); }
};
