// Bambú: puente entre la app y la API de Claude (Anthropic).
// La clave va en Vercel como variable de entorno ANTHROPIC_API_KEY. Nunca en el código.
const MODEL = process.env.BAMBU_MODEL || "claude-haiku-5-5";
const hits = new Map(); // límite simple por IP (se reinicia cuando Vercel recicla la función)
const LIMIT = 20, WINDOW = 60 * 60 * 1000;

const SAFETY = "Sos el asistente de Bambú, una app sobre psicología del dinero. Respondé solo sobre plata personal, hábitos y el uso de la app. " +
  "No des asesoramiento financiero personalizado ni recomiendes inversiones o productos puntuales. Si te piden algo fuera de tema, redirigí con amabilidad. " +
  "Respondé siempre con un único objeto JSON como pide el mensaje del usuario.";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error: "method"});
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "anon";
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (h.length >= LIMIT) return res.status(429).json({error: "rate_limited"});
  h.push(now); hits.set(ip, h);

  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({error: "no_key"});
  let msgs = (req.body && req.body.messages) || [];
  if (!Array.isArray(msgs) || !msgs.length) return res.status(400).json({error: "empty"});
  // Limpia, recorta y junta turnos seguidos del mismo rol
  const clean = [];
  for (const m of msgs.slice(-14)) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String((m && m.content) || "").slice(0, 8000);
    if (!content) continue;
    if (clean.length && clean[clean.length - 1].role === role) clean[clean.length - 1].content += "\n\n" + content;
    else clean.push({role, content});
  }
  while (clean.length && clean[0].role !== "user") clean.shift();
  if (!clean.length || clean[clean.length - 1].role !== "user") return res.status(400).json({error: "format"});

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01"},
      body: JSON.stringify({model: MODEL, max_tokens: 700, system: SAFETY, messages: clean})
    });
    if (r.status === 429) return res.status(429).json({error: "rate_limited"});
    if (!r.ok) {
      const t = await r.text(); console.error("Anthropic", r.status, t);
      // Clave vencida o borrada, o sin crédito: la app muestra "el asistente llega pronto"
      if (r.status === 401 || r.status === 403 || (r.status === 400 && /credit/i.test(t))) return res.status(503).json({error: "no_key"});
      return res.status(502).json({error: "upstream"});
    }
    const d = await r.json();
    const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return res.status(200).json({text});
  } catch (e) {
    console.error(e); return res.status(502).json({error: "upstream"});
  }
};
