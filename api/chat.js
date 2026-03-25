// api/chat.js — Vercel serverless proxy for OpenAI API
// Keeps the API key server-side; never exposed to the browser.

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      fix: "Add OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.",
    });
  }

  const { messages, system, tools, model, max_tokens } = req.body || {};

  if (!messages) {
    return res.status(400).json({ error: "Invalid request body — messages required." });
  }

  // ── Convert Anthropic-style request → OpenAI format ──────────────────────

  // Prepend system prompt as first message
  const oaiMessages = [];
  if (system) {
    oaiMessages.push({ role: "system", content: system });
  }
  // Map messages (assistant tool_result blocks → tool role)
  for (const msg of messages) {
    if (msg.role === "user") {
      // User messages may contain tool_result blocks from Anthropic format
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter(function(b) {
          return b.type === "tool_result";
        });
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            oaiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string"
                ? tr.content
                : JSON.stringify(tr.content),
            });
          }
        } else {
          oaiMessages.push({ role: "user", content: msg.content });
        }
      } else {
        oaiMessages.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        // Check for Anthropic tool_use blocks
        const textBlocks = msg.content.filter(function(b) {
          return b.type === "text";
        });
        const toolUseBlocks = msg.content.filter(function(b) {
          return b.type === "tool_use";
        });
        const oaiMsg = { role: "assistant" };
        if (textBlocks.length > 0) {
          oaiMsg.content = textBlocks.map(function(b) { return b.text; }).join("\n");
        } else {
          oaiMsg.content = null;
        }
        if (toolUseBlocks.length > 0) {
          oaiMsg.tool_calls = toolUseBlocks.map(function(b) {
            return {
              id:       b.id,
              type:     "function",
              function: {
                name:      b.name,
                arguments: JSON.stringify(b.input || {}),
              },
            };
          });
        }
        oaiMessages.push(oaiMsg);
      } else {
        oaiMessages.push({ role: "assistant", content: msg.content });
      }
    }
  }

  // ── Convert Anthropic tools → OpenAI tools format ─────────────────────────
  let oaiTools;
  if (tools && tools.length > 0) {
    oaiTools = tools.map(function(t) {
      return {
        type: "function",
        function: {
          name:        t.name,
          description: t.description,
          parameters:  t.input_schema || { type: "object", properties: {} },
        },
      };
    });
  }

  // ── Call OpenAI ───────────────────────────────────────────────────────────
  const oaiBody = {
    model:      model === "claude-sonnet-4-20250514" ? "gpt-4o" : (model || "gpt-4o"),
    max_tokens: max_tokens || 2000,
    messages:   oaiMessages,
  };
  if (oaiTools) {
    oaiBody.tools      = oaiTools;
    oaiBody.tool_choice = "auto";
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify(oaiBody),
    });

    let oaiData;
    try {
      oaiData = await upstream.json();
    } catch (_) {
      return res.status(502).json({ error: "OpenAI returned non-JSON response." });
    }

    if (!upstream.ok) {
      console.error("OpenAI error:", upstream.status, JSON.stringify(oaiData));
      return res.status(upstream.status).json({
        error:  "OpenAI API error",
        status: upstream.status,
        detail: oaiData,
      });
    }

    // ── Convert OpenAI response → Anthropic format (so App.jsx needs no change)
    const choice   = oaiData.choices && oaiData.choices[0];
    const oaiMsg   = choice && choice.message;
    const content  = [];
    const stopReason = choice && choice.finish_reason;

    // Text content
    if (oaiMsg && oaiMsg.content) {
      content.push({ type: "text", text: oaiMsg.content });
    }

    // Tool calls → Anthropic tool_use blocks
    if (oaiMsg && oaiMsg.tool_calls && oaiMsg.tool_calls.length > 0) {
      for (const tc of oaiMsg.tool_calls) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(tc.function.arguments || "{}"); } catch (_) {}
        content.push({
          type:  "tool_use",
          id:    tc.id,
          name:  tc.function.name,
          input: parsedInput,
        });
      }
    }

    // Map finish_reason → Anthropic stop_reason
    const anthropicStopReason =
      stopReason === "tool_calls" ? "tool_use" :
      stopReason === "stop"       ? "end_turn"  : stopReason;

    return res.status(200).json({
      id:          oaiData.id,
      type:        "message",
      role:        "assistant",
      content,
      stop_reason: anthropicStopReason,
      usage:       oaiData.usage,
    });

  } catch (err) {
    console.error("Proxy fetch error:", err.message);
    return res.status(500).json({
      error:  "Proxy failed to reach OpenAI",
      detail: err.message,
    });
  }
}
