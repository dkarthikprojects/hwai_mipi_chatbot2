// api/chat.js — Vercel serverless proxy for Anthropic API
// Keeps the API key server-side; never exposed to the browser.

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set.",
      fix: "Add ANTHROPIC_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }

  // req.body is auto-parsed by Vercel when bodyParser: true
  const body = req.body;
  if (!body || !body.messages) {
    return res.status(400).json({ error: "Invalid request body — messages array required." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    let data;
    try {
      data = await upstream.json();
    } catch (_) {
      return res.status(502).json({ error: "Anthropic returned non-JSON response." });
    }

    // Surface Anthropic errors clearly
    if (!upstream.ok) {
      console.error("Anthropic error:", upstream.status, JSON.stringify(data));
      return res.status(upstream.status).json({
        error: "Anthropic API error",
        status: upstream.status,
        detail: data,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return res.status(500).json({
      error: "Proxy failed to reach Anthropic",
      detail: err.message,
    });
  }
}
