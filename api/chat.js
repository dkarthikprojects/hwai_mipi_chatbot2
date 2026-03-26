// api/chat.js — Vercel serverless proxy for OpenAI API
// Translates Anthropic-format requests → OpenAI → back to Anthropic format.
// Tool calls resolved directly via Supabase (no HTTP self-call).

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function dedupByBid(rows, limit) {
  const seen = new Set();
  const out  = [];
  for (const r of rows) {
    const k = r.Bid_id || r.bid_id || (r.CONTRACT_ID + "|" + r.Plan_ID);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
    if (out.length >= limit) break;
  }
  return out;
}

// ── Query handlers ────────────────────────────────────────────────────────────

async function queryLandscape(db, p) {
  const stateList = p.states || (p.state ? [p.state] : null);
  // Avoid columns with % in name — they break the Supabase JS select parser
  let q = db.from("Stars_Landscape").select(
    "Bid_id,CONTRACT_ID,Plan_ID,Plan_Name,parent_organization," +
    "State,County,Star_Rating,Bench_mark,Crosswalk,year"
  );
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.county)     q = q.ilike("County",               `%${p.county}%`);
  if (p.parent_org) q = q.ilike("parent_organization",  `%${p.parent_org}%`);
  if (p.min_stars)  q = q.gte("Star_Rating",             String(p.min_stars));
  const { data: raw, error } = await q
    .order("Bid_id").limit((p.limit || 50) * 20);
  if (error) throw new Error("Stars_Landscape: " + error.message);
  const plans    = dedupByBid(raw, p.limit || 50);
  const starNums = plans.map(r => parseFloat(r.Star_Rating)).filter(n => !isNaN(n));
  const avgStar  = starNums.length
    ? (starNums.reduce((a, b) => a + b, 0) / starNums.length).toFixed(2)
    : null;
  const fourPlus = starNums.filter(s => s >= 4).length;
  return {
    summary: {
      unique_plan_count: plans.length,
      unique_payors:     new Set(plans.map(r => r.parent_organization)).size,
      avg_star_rating:   avgStar,
      four_plus_stars:   fourPlus,
      four_plus_pct:     plans.length
        ? ((fourPlus / plans.length) * 100).toFixed(1) + "%" : "0%",
    },
    plans,
    source: "HealthWorksAI Supabase — Stars_Landscape",
  };
}

async function queryEnrollment(db, p) {
  const stateList = p.states || (p.state ? [p.state] : null);
  let q = db.from("HWAI_Enrollment").select(
    "State,County,CPID,Month,Year,Parent_Organization," +
    "Plan_Type,Plan_Name,Special_Needs_Plan_Type," +
    "DSNP_Eligible,MA_Eligible,Enrollment"
  );
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.county)     q = q.ilike("County",                  `%${p.county}%`);
  if (p.parent_org) q = q.ilike("Parent_Organization",     `%${p.parent_org}%`);
  if (p.plan_type)  q = q.ilike("Plan_Type",               `%${p.plan_type}%`);
  if (p.snp_type)   q = q.ilike("Special_Needs_Plan_Type", `%${p.snp_type}%`);
  if (p.month)      q = q.eq("Month", p.month);
  if (p.year)       q = q.eq("Year",  p.year);
  const { data, error } = await q
    .order("Enrollment", { ascending: false }).limit(p.limit || 200);
  if (error) throw new Error("HWAI_Enrollment: " + error.message);
  const total = data.reduce((s, r) => s + (r.Enrollment || 0), 0);
  const byOrg = {};
  data.forEach(r => {
    byOrg[r.Parent_Organization] =
      (byOrg[r.Parent_Organization] || 0) + (r.Enrollment || 0);
  });
  const topPayors = Object.entries(byOrg)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([payor, count]) => ({
      payor,
      enrollment: count.toLocaleString(),
      share_pct:  total ? ((count / total) * 100).toFixed(1) + "%" : "0%",
    }));
  return {
    records:          data,
    total_enrollment: total.toLocaleString(),
    top_payors:       topPayors,
    source: "HealthWorksAI Supabase — HWAI_Enrollment",
  };
}

async function queryStars(db, p) {
  // Use safe column aliases to avoid spaces in names
  let q = db.from("Stars_Cutpoint").select(
    "CONTRACT_ID,Year"
  );
  if (p.contract_id) q = q.eq("CONTRACT_ID", p.contract_id);
  if (p.year)        q = q.eq("Year", p.year);
  const { data, error } = await q
    .order("CONTRACT_ID").limit(p.limit || 200);
  if (error) throw new Error("Stars_Cutpoint: " + error.message);
  return {
    measures:          data,
    total_records:     data.length,
    unique_contracts:  new Set(data.map(r => r.CONTRACT_ID)).size,
    source: "HealthWorksAI Supabase — Stars_Cutpoint",
  };
}

async function queryFormulary(db, p) {
  let q = db.from("PartD_MRx").select(
    "bid_id,Tier,Benefit,BenefitValue"
  );
  if (p.bid_id)  q = q.eq("bid_id",  p.bid_id);
  if (p.tier)    q = q.eq("Tier",    String(p.tier));
  if (p.benefit) q = q.ilike("Benefit", `%${p.benefit}%`);
  const { data, error } = await q.order("Tier").limit(p.limit || 100);
  if (error) throw new Error("PartD_MRx: " + error.message);
  const tierDist = {};
  data.forEach(r => { tierDist[r.Tier] = (tierDist[r.Tier] || 0) + 1; });
  return {
    formulary:         data,
    total:             data.length,
    tier_distribution: tierDist,
    source: "HealthWorksAI Supabase — PartD_MRx",
  };
}

async function queryDrugRankings(db, p) {
  let q = db.from("PartD_Ranking").select(
    "rxcui,rxnorm_description,prime_disease," +
    "total_spending,total_claims,total_beneficiaries,Brand_Name,Brand_YN"
  );
  if (p.disease)   q = q.ilike("prime_disease",       `%${p.disease}%`);
  if (p.brand_yn)  q = q.eq("Brand_YN",               p.brand_yn);
  if (p.drug_name) q = q.ilike("rxnorm_description",  `%${p.drug_name}%`);
  const { data, error } = await q
    .order("total_beneficiaries", { ascending: false }).limit(p.limit || 50);
  if (error) throw new Error("PartD_Ranking: " + error.message);
  return {
    drugs:  data,
    total:  data.length,
    source: "HealthWorksAI Supabase — PartD_Ranking",
  };
}

async function queryTPV(db, p) {
  const stateList = p.states || (p.state ? [p.state] : null);
  let q = db.from("TPV_Crosswalk").select(
    "State,County,bid_id,Plan_Name,plan_type,parent_organization," +
    "SNP,Special_Needs_Plan_Type,CPID_2026,flag," +
    "DVH,OTC,Inpatient,Transport,SSBCI," +
    "Feb_enrollments,Dec_enrollments"
  );
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.county)     q = q.ilike("County",               `%${p.county}%`);
  if (p.parent_org) q = q.ilike("parent_organization",  `%${p.parent_org}%`);
  if (p.plan_type)  q = q.ilike("plan_type",            `%${p.plan_type}%`);
  if (p.snp_type)   q = q.ilike("Special_Needs_Plan_Type", `%${p.snp_type}%`);
  const { data: raw, error } = await q
    .order("bid_id").limit((p.limit || 100) * 10);
  if (error) throw new Error("TPV_Crosswalk: " + error.message);
  const seen = new Set(), plans = [];
  for (const r of raw) {
    if (!seen.has(r.bid_id)) { seen.add(r.bid_id); plans.push(r); }
    if (plans.length >= (p.limit || 100)) break;
  }
  return {
    plans,
    unique_plan_count: plans.length,
    source: "HealthWorksAI Supabase — TPV_Crosswalk",
  };
}

// ── Tool router ───────────────────────────────────────────────────────────────
const HANDLERS = {
  query_landscape_data:  queryLandscape,
  query_enrollment_data: queryEnrollment,
  query_stars_data:      queryStars,
  query_formulary_data:  queryFormulary,
  query_drug_rankings:   queryDrugRankings,
  query_tpv_data:        queryTPV,
};

async function resolveToolCall(name, input) {
  const db = getDB();
  if (!db) return { note: "Supabase not configured", tool: name };
  const fn = HANDLERS[name];
  if (!fn) return { note: "Unknown tool: " + name };
  try {
    return await fn(db, input || {});
  } catch (e) {
    console.error("[tool/" + name + "]", e.message);
    // Return error as data so GPT-4o can report it gracefully
    return { error: e.message, tool: name };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function openaiCall(apiKey, body) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      "OpenAI " + res.status + ": " +
      (data.error && data.error.message ? data.error.message : JSON.stringify(data))
    );
  }
  return data;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not set.",
      fix:   "Add it in Vercel → Project → Settings → Environment Variables.",
    });
  }

  const { messages, system, tools, model, max_tokens } = req.body || {};
  if (!messages) return res.status(400).json({ error: "messages required" });

  // ── Convert Anthropic → OpenAI message format ─────────────────────────────
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
        const textBlocks    = msg.content.filter(b => b.type === "text");
        const toolUseBlocks = msg.content.filter(b => b.type === "tool_use");
        const oaiMsg = {
          role:    "assistant",
          content: textBlocks.length
            ? textBlocks.map(b => b.text).join("\n") : null,
        };
        if (toolUseBlocks.length > 0) {
          oaiMsg.tool_calls = toolUseBlocks.map(b => ({
            id:       b.id,
            type:     "function",
            function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
          }));
        }
        oaiMessages.push(oaiMsg);
      } else {
        oaiMessages.push({ role: "assistant", content: msg.content });
      }
    }
  }

  // ── Convert Anthropic tools → OpenAI tools ───────────────────────────────
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

  const baseBody = {
    model:      model === "claude-sonnet-4-20250514" ? "gpt-4o" : (model || "gpt-4o"),
    max_tokens: max_tokens || 2000,
  };
  if (oaiTools) { baseBody.tools = oaiTools; baseBody.tool_choice = "auto"; }

  try {
    // ── First OpenAI call ─────────────────────────────────────────────────
    const firstData = await openaiCall(apiKey, {
      ...baseBody,
      messages: oaiMessages,
    });

    const choice     = firstData.choices && firstData.choices[0];
    const firstMsg   = choice && choice.message;
    const stopReason = choice && choice.finish_reason;
    const content    = [];

    if (firstMsg && firstMsg.content) {
      content.push({ type: "text", text: firstMsg.content });
    }

    // ── Resolve tool calls and make second OpenAI call ────────────────────
    if (firstMsg && firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {

      // Step 1: run all tool calls and collect results
      const toolResultMsgs = [];
      for (const tc of firstMsg.tool_calls) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(tc.function.arguments || "{}"); } catch (_) {}

        const toolResult = await resolveToolCall(tc.function.name, parsedInput);

        // Expose to frontend as a chip in the chat bubble
        content.push({
          type:  "tool_use",
          id:    tc.id,
          name:  tc.function.name,
          input: parsedInput,
        });

        toolResultMsgs.push({
          role:         "tool",
          tool_call_id: tc.id,
          content:      JSON.stringify(toolResult),
        });
      }

      // Step 2: second call with CORRECT message order:
      //   [...original messages] → [assistant + tool_calls] → [tool results]
      const secondData = await openaiCall(apiKey, {
        ...baseBody,
        messages: [
          ...oaiMessages,
          // assistant message that triggered the tool calls
          {
            role:         "assistant",
            content:      firstMsg.content || null,
            tool_calls:   firstMsg.tool_calls,
          },
          // tool results immediately after
          ...toolResultMsgs,
        ],
      });

      const secondMsg = secondData.choices &&
        secondData.choices[0] &&
        secondData.choices[0].message;

      if (secondMsg && secondMsg.content) {
        // Prepend so the final answer appears first in the response
        content.unshift({ type: "text", text: secondMsg.content });
      }
    }

    const anthropicStop =
      stopReason === "tool_calls" ? "tool_use"  :
      stopReason === "stop"       ? "end_turn"   : stopReason;

    return res.status(200).json({
      id:          firstData.id,
      type:        "message",
      role:        "assistant",
      content,
      stop_reason: anthropicStop,
    });

  } catch (err) {
    console.error("[chat] error:", err.message);
    return res.status(500).json({
      error:  err.message,   // surface the real error, not just "Proxy failed"
      detail: err.stack,
    });
  }
}
