// api/chat.js — Vercel serverless proxy for OpenAI API
// Translates Anthropic-format requests → OpenAI → back to Anthropic format.
// Tool calls are resolved via api/query.js (real Supabase data).

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      fix: "Add OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables.",
    });
  }

  const { messages, system, tools, model, max_tokens } = req.body || {};
  if (!messages) return res.status(400).json({ error: "messages required" });

  // ── Convert Anthropic messages → OpenAI format ────────────────────────────
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: "system", content: system });

  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter(b => b.type === "tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            oaiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string"
                ? tr.content : JSON.stringify(tr.content),
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
        const textBlocks   = msg.content.filter(b => b.type === "text");
        const toolUseBlocks = msg.content.filter(b => b.type === "tool_use");
        const oaiMsg = { role: "assistant",
          content: textBlocks.length ? textBlocks.map(b => b.text).join("\n") : null };
        if (toolUseBlocks.length > 0) {
          oaiMsg.tool_calls = toolUseBlocks.map(b => ({
            id: b.id, type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
          }));
        }
        oaiMessages.push(oaiMsg);
      } else {
        oaiMessages.push({ role: "assistant", content: msg.content });
      }
    }
  }

  // ── Convert Anthropic tools → OpenAI tools ────────────────────────────────
  const oaiTools = tools && tools.length > 0
    ? tools.map(t => ({
        type: "function",
        function: {
          name:        t.name,
          description: t.description,
          parameters:  t.input_schema || { type: "object", properties: {} },
        },
      }))
    : undefined;

  const oaiBody = {
    model: model === "claude-sonnet-4-20250514" ? "gpt-4o" : (model || "gpt-4o"),
    max_tokens: max_tokens || 2000,
    messages: oaiMessages,
  };
  if (oaiTools) { oaiBody.tools = oaiTools; oaiBody.tool_choice = "auto"; }

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify(oaiBody),
    });

    let oaiData;
    try { oaiData = await upstream.json(); }
    catch (_) { return res.status(502).json({ error: "OpenAI returned non-JSON response" }); }

    if (!upstream.ok) {
      console.error("OpenAI error:", upstream.status, JSON.stringify(oaiData));
      return res.status(upstream.status).json({
        error: "OpenAI API error", status: upstream.status, detail: oaiData,
      });
    }

    const choice  = oaiData.choices && oaiData.choices[0];
    const oaiMsg  = choice && choice.message;
    const content = [];
    const stopReason = choice && choice.finish_reason;

    if (oaiMsg && oaiMsg.content) {
      content.push({ type: "text", text: oaiMsg.content });
    }

    // ── Resolve tool calls using real data from api/query.js ─────────────────
    if (oaiMsg && oaiMsg.tool_calls && oaiMsg.tool_calls.length > 0) {
      for (const tc of oaiMsg.tool_calls) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(tc.function.arguments || "{}"); } catch (_) {}

        // Call api/query.js internally
        let toolResult;
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

        if (supabaseUrl && supabaseKey) {
          // Real data path — call query handler directly
          try {
            const baseUrl = process.env.VERCEL_URL
              ? "https://" + process.env.VERCEL_URL
              : "http://localhost:3000";
            const qRes = await fetch(baseUrl + "/api/query", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tool_name: tc.function.name, params: parsedInput }),
            });
            toolResult = await qRes.json();
          } catch (e) {
            toolResult = { error: "Query failed: " + e.message };
          }
        } else {
          // Fallback mock (used if Supabase not yet configured)
          toolResult = getMock(tc.function.name, parsedInput);
        }

        content.push({
          type: "tool_use",
          id:    tc.id,
          name:  tc.function.name,
          input: parsedInput,
        });

        // Immediately add tool result to messages for next turn
        oaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }

      // If tools were called, get the final AI response with the data
      if (oaiMsg.tool_calls.length > 0) {
        const followUp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
          body: JSON.stringify({ ...oaiBody, messages: [...oaiMessages,
            { role: "assistant", content: null,
              tool_calls: oaiMsg.tool_calls }] }),
        });
        const fuData = await followUp.json();
        const fuMsg  = fuData.choices && fuData.choices[0] && fuData.choices[0].message;
        if (fuMsg && fuMsg.content) {
          content.unshift({ type: "text", text: fuMsg.content });
        }
      }
    }

    const anthropicStopReason =
      stopReason === "tool_calls" ? "tool_use" :
      stopReason === "stop"       ? "end_turn"  : stopReason;

    return res.status(200).json({
      id: oaiData.id, type: "message", role: "assistant",
      content,
      stop_reason: anthropicStopReason,
    });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: "Proxy failed", detail: err.message });
  }
}

// ── Fallback mock (only used if Supabase env vars are not set) ────────────────
function getMock(name, inp) {
  const markets = {
    FL:{tp:4243,zp:"75.8%",snp:"44.6%",ap:8.17,as_:3.78},
    TX:{tp:7947,zp:"70.6%",snp:"43.1%",ap:14.3, as_:3.79},
    CA:{tp:3765,zp:"72.8%",snp:"40.9%",ap:11.8, as_:3.85},
  };
  if (name === "query_landscape_data") {
    const m = String(inp.market||inp.state||"").toUpperCase().trim();
    const d = markets[m] || {tp:15955,zp:"72.5%",snp:"42.9%",ap:12.21,as_:3.81};
    return {
      summary:{
        total_plans:d.tp,          // unique bid-ids (contract+plan)
        total_service_areas:null,  // county rows — available once Supabase connected
        zero_premium_pct:d.zp,
        avg_premium:d.ap,
        avg_star_rating:d.as_,
        snp_pct:d.snp,
        note:"total_plans = unique plans (bid-ids); not service area rows",
      },
      plans:[],
      source:"Mock data — connect Supabase for real data",
    };
  }
  if (name === "query_stars_data")
    return { avg_star_rating:3.81, four_plus_pct:"44.6%",
             source:"Mock — connect Supabase" };
  if (name === "query_benefit_data")
    return { summary:{dental_pct:"94%",otc_pct:"82%",vision_pct:"97%"},
             source:"Mock — connect Supabase" };
  return { note:"Connect Supabase for real data", tool: name };
}
