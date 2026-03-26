// api/chat.js — MIPI POWER HOUSE — Vercel Serverless Proxy
//
// Flow:
//   Browser → /api/chat (this file)
//     → OpenAI GPT-4o (decides which tool to call)
//     → Supabase query (direct, no HTTP hop)
//     → OpenAI GPT-4o again (generates answer from real data)
//     → Browser (final text response with data source chips)
//
// All tool calls are resolved server-side with real Supabase data.
// The browser NEVER calls mock() for Vercel deployments.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

// ── Supabase connection ───────────────────────────────────────────────────────
function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Deduplicate plan rows by Bid_id ───────────────────────────────────────────
// Stars_Landscape has one row per plan-county. Bid_id is the unique plan ID.
function dedupByBid(rows) {
  if (!rows || rows.length === 0) return [];
  // Find the bid column name dynamically from the first row
  // Handles Bid_id, bid_id, BID_ID, BIDID etc.
  const firstRow = rows[0];
  const bidCol = Object.keys(firstRow).find(k =>
    k.toLowerCase().replace("_","") === "bidid"
  );
  console.log("[dedupByBid] rows:", rows.length,
    "| bid col found:", bidCol || "NONE",
    "| sample keys:", Object.keys(firstRow).join(","));
  if (!bidCol) {
    // No bid column — return all rows deduplicated by JSON
    console.warn("[dedupByBid] WARNING: no Bid_id column found, returning all rows");
    return rows;
  }
  const seen = new Set();
  return rows.filter(r => {
    const k = r[bidCol];
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── QUERY HANDLERS ────────────────────────────────────────────────────────────
// Each returns a compact SUMMARY object — not full row arrays.
// Keeping tool results small is critical: large JSON payloads cause
// GPT-4o to time out or return empty responses on the second call.

// Map full state names → abbreviations to handle GPT-4o passing "Florida" vs "FL"
const STATE_MAP = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
  "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA",
  "kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD",
  "massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
  "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
  "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC",
  "south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT",
  "virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI",
  "wyoming":"WY","puerto rico":"PR","district of columbia":"DC",
};

function normaliseState(s) {
  if (!s) return null;
  const lower = s.toLowerCase().trim();
  return STATE_MAP[lower] || s.toUpperCase().trim();
}

async function queryLandscape(db, p) {
  // Normalise state filters — GPT-4o may pass "Florida" or "FL" or "florida"
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(normaliseState).filter(Boolean) : null;
  let q = db.from("Stars_Landscape")
    .select("Bid_id,parent_organization,State,County,Star_Rating,Bench_mark");
  if (stateList?.length)  q = q.in("State", stateList);
  if (p.county)           q = q.ilike("County", `%${p.county}%`);
  if (p.parent_org)       q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.min_stars)        q = q.gte("Star_Rating", String(p.min_stars));
  const { data: raw, error, count } = await q.limit(10000);
  if (error) throw new Error("Stars_Landscape: " + error.message);

  // Safety check — if no rows at all, return a clear diagnostic
  if (!raw || raw.length === 0) {
    return {
      unique_plan_count: 0,
      raw_row_count:     0,
      filters_applied:   { states: stateList, county: p.county||null },
      diagnostic:        "No rows returned from Stars_Landscape. " +
        "Check that State column values match filter (e.g. 'FL' not 'Florida').",
      source: "Stars_Landscape table",
    };
  }

  const plans    = dedupByBid(raw);
  const stars    = plans.map(r => parseFloat(r.Star_Rating)).filter(n => !isNaN(n));
  const avgStar  = stars.length
    ? (stars.reduce((a,b) => a+b, 0) / stars.length).toFixed(2) : null;
  const fourPlus = stars.filter(s => s >= 4).length;

  const byState = {}, byOrg = {};
  plans.forEach(r => {
    byState[r.State] = (byState[r.State] || 0) + 1;
    byOrg[r.parent_organization] = (byOrg[r.parent_organization] || 0) + 1;
  });
  const topPayors = Object.entries(byOrg)
    .sort((a,b) => b[1]-a[1]).slice(0,10)
    .map(([org, cnt]) => ({ org, plans: cnt }));

  console.log("[queryLandscape] raw:", raw.length,
    "deduped:", plans.length, "states:", stateList);

  return {
    unique_plan_count: plans.length,
    raw_row_count:     raw.length,
    unique_payors:     Object.keys(byOrg).length,
    avg_star_rating:   avgStar,
    four_plus_count:   fourPlus,
    four_plus_pct:     plans.length
      ? ((fourPlus/plans.length)*100).toFixed(1)+"%" : "0%",
    by_state:          byState,
    top_10_payors:     topPayors,
    filters_applied:   { states: stateList, county: p.county||null, org: p.parent_org||null },
    note: plans.length === 0 && raw.length > 0
      ? "Rows found but dedup returned 0 — check Bid_id column name in DB"
      : null,
    source: "Stars_Landscape table — unique plans by Bid_id",
  };
}

async function queryEnrollment(db, p) {
  const rawStates2 = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates2 ? rawStates2.map(normaliseState).filter(Boolean) : null;
  let q = db.from("HWAI_Enrollment")
    .select("State,Parent_Organization,Plan_Type,Special_Needs_Plan_Type,DSNP_Eligible,MA_Eligible,Enrollment,Month,Year");
  if (stateList?.length)  q = q.in("State", stateList);
  if (p.county)           q = q.ilike("County", `%${p.county}%`);
  if (p.parent_org)       q = q.ilike("Parent_Organization", `%${p.parent_org}%`);
  if (p.plan_type)        q = q.ilike("Plan_Type", `%${p.plan_type}%`);
  if (p.snp_type)         q = q.ilike("Special_Needs_Plan_Type", `%${p.snp_type}%`);
  if (p.month)            q = q.eq("Month", p.month);
  if (p.year)             q = q.eq("Year", p.year);
  const { data, error } = await q.limit(10000);
  if (error) throw new Error("HWAI_Enrollment: " + error.message);

  const total     = data.reduce((s,r) => s + (Number(r.Enrollment)||0),    0);
  const totalMA   = data.reduce((s,r) => s + (Number(r.MA_Eligible)||0),   0);
  const totalDSNP = data.reduce((s,r) => s + (Number(r.DSNP_Eligible)||0), 0);
  const byOrg = {};
  data.forEach(r => {
    byOrg[r.Parent_Organization] =
      (byOrg[r.Parent_Organization]||0) + (Number(r.Enrollment)||0);
  });
  const topPayors = Object.entries(byOrg)
    .sort((a,b) => b[1]-a[1]).slice(0,10)
    .map(([payor, cnt]) => ({
      payor, enrollment: cnt.toLocaleString(),
      share: total ? ((cnt/total)*100).toFixed(1)+"%" : "0%",
    }));

  return {
    total_enrollment:    total.toLocaleString(),
    total_ma_eligible:   totalMA.toLocaleString(),
    total_dsnp_eligible: totalDSNP.toLocaleString(),
    top_10_payors:       topPayors,
    filters:             { states: stateList, month: p.month||null, year: p.year||null },
    source:              "HWAI_Enrollment table",
  };
}

async function queryStars(db, p) {
  let q = db.from("Stars_Cutpoint").select("CONTRACT_ID,Year");
  if (p.contract_id) q = q.eq("CONTRACT_ID", p.contract_id);
  if (p.year)        q = q.eq("Year", p.year);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error("Stars_Cutpoint: " + error.message);
  return {
    total_records:    data.length,
    unique_contracts: new Set(data.map(r => r.CONTRACT_ID)).size,
    source:           "Stars_Cutpoint table",
  };
}

async function queryFormulary(db, p) {
  let q = db.from("PartD_MRx").select("bid_id,Tier,Benefit,BenefitValue");
  if (p.bid_id)  q = q.eq("bid_id",  p.bid_id);
  if (p.tier)    q = q.eq("Tier",    String(p.tier));
  if (p.benefit) q = q.ilike("Benefit", `%${p.benefit}%`);
  const { data, error } = await q.order("Tier").limit(500);
  if (error) throw new Error("PartD_MRx: " + error.message);
  const tierDist = {};
  data.forEach(r => { tierDist[r.Tier] = (tierDist[r.Tier]||0)+1; });
  return {
    total:             data.length,
    tier_distribution: tierDist,
    sample:            data.slice(0, 15),
    source:            "PartD_MRx table",
  };
}

async function queryDrugRankings(db, p) {
  let q = db.from("PartD_Ranking")
    .select("rxnorm_description,prime_disease,total_spending,total_claims,total_beneficiaries,Brand_Name,Brand_YN");
  if (p.disease)   q = q.ilike("prime_disease",      `%${p.disease}%`);
  if (p.brand_yn)  q = q.eq("Brand_YN",              p.brand_yn);
  if (p.drug_name) q = q.ilike("rxnorm_description", `%${p.drug_name}%`);
  const { data, error } = await q
    .order("total_beneficiaries", { ascending: false }).limit(20);
  if (error) throw new Error("PartD_Ranking: " + error.message);
  return { top_drugs: data, total: data.length, source: "PartD_Ranking table" };
}

async function queryTPV(db, p) {
  const rawStates3 = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates3 ? rawStates3.map(normaliseState).filter(Boolean) : null;
  let q = db.from("TPV_Crosswalk")
    .select("bid_id,State,Plan_Name,plan_type,parent_organization,SNP,Special_Needs_Plan_Type,DVH,OTC,Inpatient,Transport,SSBCI,Feb_enrollments,Dec_enrollments");
  if (stateList?.length)  q = q.in("State", stateList);
  if (p.county)           q = q.ilike("County",               `%${p.county}%`);
  if (p.parent_org)       q = q.ilike("parent_organization",  `%${p.parent_org}%`);
  if (p.plan_type)        q = q.ilike("plan_type",            `%${p.plan_type}%`);
  const { data: raw, error } = await q.limit(10000);
  if (error) throw new Error("TPV_Crosswalk: " + error.message);

  const plans    = dedupByBid(raw);
  const byOrg    = {};
  plans.forEach(r => { byOrg[r.parent_organization] = (byOrg[r.parent_organization]||0)+1; });
  const topPayors = Object.entries(byOrg)
    .sort((a,b) => b[1]-a[1]).slice(0,10)
    .map(([org, cnt]) => ({ org, plans: cnt }));

  return {
    unique_plan_count: plans.length,
    top_10_payors:     topPayors,
    sample_plans:      plans.slice(0, 10),
    source:            "TPV_Crosswalk table",
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
  if (!db) return {
    error:  "Supabase not configured — check SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel env vars",
    tool:   name,
  };
  const fn = HANDLERS[name];
  if (!fn) return { error: "Unknown tool: " + name, available: Object.keys(HANDLERS) };
  try {
    return await fn(db, input || {});
  } catch (e) {
    console.error("[tool/" + name + "] ERROR:", e.message);
    return { error: e.message, tool: name };
  }
}

// ── OpenAI helper ─────────────────────────────────────────────────────────────
async function openaiCall(apiKey, body) {
  const res  = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body:    JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      "OpenAI " + res.status + ": " +
      (data?.error?.message || JSON.stringify(data))
    );
  }
  return data;
}

// ── Anthropic → OpenAI message format conversion ──────────────────────────────
function convertMessages(messages) {
  const out = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter(b => b.type === "tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            out.push({
              role:         "tool",
              tool_call_id: tr.tool_use_id,
              content:      typeof tr.content === "string"
                ? tr.content : JSON.stringify(tr.content),
            });
          }
        } else {
          out.push({ role: "user", content: msg.content });
        }
      } else {
        out.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        const textBlocks    = msg.content.filter(b => b.type === "text");
        const toolUseBlocks = msg.content.filter(b => b.type === "tool_use");
        const m = {
          role:    "assistant",
          content: textBlocks.length
            ? textBlocks.map(b => b.text).join("\n") : null,
        };
        if (toolUseBlocks.length > 0) {
          m.tool_calls = toolUseBlocks.map(b => ({
            id:       b.id,
            type:     "function",
            function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
          }));
        }
        out.push(m);
      } else {
        out.push({ role: "assistant", content: msg.content });
      }
    }
  }
  return out;
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
      error: "OPENAI_API_KEY is not set in Vercel environment variables.",
    });
  }

  const { messages, system, tools, model, max_tokens } = req.body || {};
  if (!messages) return res.status(400).json({ error: "messages required" });

  // Build OpenAI message array
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: "system", content: system });
  oaiMessages.push(...convertMessages(messages));

  // Convert Anthropic tool format → OpenAI tool format
  const oaiTools = tools?.length > 0
    ? tools.map(t => ({
        type:     "function",
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
    // ── Call 1: GPT-4o decides what to do ────────────────────────────────────
    const firstData = await openaiCall(apiKey, { ...baseBody, messages: oaiMessages });
    const firstMsg  = firstData.choices?.[0]?.message;
    const stopReason = firstData.choices?.[0]?.finish_reason;
    const content   = [];

    if (firstMsg?.content) {
      content.push({ type: "text", text: firstMsg.content });
    }

    // ── Tool call path: resolve with real Supabase data ───────────────────────
    if (firstMsg?.tool_calls?.length > 0) {

      // Resolve each tool call directly against Supabase
      const toolResultMsgs = [];
      for (const tc of firstMsg.tool_calls) {
        let parsedInput = {};
        try { parsedInput = JSON.parse(tc.function.arguments || "{}"); } catch(_) {}

        const toolResult = await resolveToolCall(tc.function.name, parsedInput);
        console.log("[tool]", tc.function.name,
          "rows/keys:", JSON.stringify(Object.keys(toolResult)));

        // Expose as chip on the frontend
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

      // ── Call 2: GPT-4o generates answer from real data ───────────────────
      // Message order MUST be: history → assistant(+tool_calls) → tool results
      // Tools are REMOVED so GPT-4o returns text, not another tool call.
      let finalText = null;
      try {
        const secondData = await openaiCall(apiKey, {
          ...baseBody,
          tools:       undefined,   // force text response
          tool_choice: undefined,
          messages: [
            ...oaiMessages,
            {
              role:       "assistant",
              content:    firstMsg.content || null,
              tool_calls: firstMsg.tool_calls,
            },
            ...toolResultMsgs,
          ],
        });
        finalText = secondData.choices?.[0]?.message?.content || null;
      } catch (e2) {
        console.error("[call2]", e2.message);
      }

      // ── Fallback: ask GPT-4o to summarise the raw data in plain English ───
      if (!finalText) {
        try {
          const fallbackData = await openaiCall(apiKey, {
            model:      baseBody.model,
            max_tokens: 600,
            messages: [{
              role:    "user",
              content: "Here is data from a Medicare Advantage database. "
                + "Give a clear, concise plain-English answer based on it:\n\n"
                + toolResultMsgs.map(t => t.content).join("\n\n"),
            }],
          });
          finalText = fallbackData.choices?.[0]?.message?.content || null;
        } catch (e3) {
          console.error("[fallback]", e3.message);
        }
      }

      if (finalText) {
        content.unshift({ type: "text", text: finalText });
      } else {
        content.unshift({
          type: "text",
          text: "Data retrieved from Supabase but GPT-4o did not generate a response. "
            + "Please try rephrasing your question.",
        });
      }
    }

    // Ensure there is always at least one text block
    if (!content.some(c => c.type === "text")) {
      content.unshift({
        type: "text",
        text: "No response generated. Please try again.",
      });
    }

    return res.status(200).json({
      id:          firstData.id,
      type:        "message",
      role:        "assistant",
      content,
      stop_reason: stopReason === "tool_calls" ? "tool_use"
                 : stopReason === "stop"       ? "end_turn"
                 : stopReason,
    });

  } catch (err) {
    console.error("[chat] FATAL:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
