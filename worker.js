const DEFAULT_MODEL = "gemini-3.8-flash";
const ALLOWED_ORIGINS = ["https://etidoz1.github.io"];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = (env.ALLOWED_ORIGIN || ALLOWED_ORIGINS.join(","))
      .split(",").map(value => value.trim()).filter(Boolean);
    const originAllowed = !origin || allowedOrigins.includes(origin);
    const corsHeaders = origin && originAllowed ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    } : {};

    if (request.method === "OPTIONS") {
      if (!originAllowed) return json({ error: "Origin not allowed." }, 403);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        status: "ok",
        service: "AgentCopilot AI backend",
        configured: Boolean(env.GEMINI_API_KEY)
      }, 200, corsHeaders);
    }

    if (url.pathname !== "/api/generate" || request.method !== "POST") {
      return json({ error: "Not found." }, 404, corsHeaders);
    }

    if (!originAllowed) return json({ error: "Origin not allowed." }, 403);

    if (!env.GEMINI_API_KEY) {
      return json({ error: "The backend is missing its GEMINI_API_KEY secret." }, 503, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400, corsHeaders);
    }

    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "Please provide a prompt." }, 400, corsHeaders);
    if (prompt.length > 12000) {
      return json({ error: "Prompt is too long. Please shorten it." }, 413, corsHeaders);
    }

    try {
      const model = env.GEMINI_MODEL || DEFAULT_MODEL;
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        console.error("Gemini API returned an error:", response.status, payload?.error?.message);
        return json({
          error: payload?.error?.message || `Gemini API request failed (${response.status}).`
        }, 502, corsHeaders);
      }

      const result = (payload?.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || "")
        .join("")
        .trim();

      if (!result) return json({ error: "Gemini returned an empty response. Please try again." }, 502, corsHeaders);
      return json({ result }, 200, corsHeaders);
    } catch (error) {
      console.error("AgentCopilot generation error:", error);
      return json({ error: "The AI request could not be completed. Please try again." }, 500, corsHeaders);
    }
  }
};
