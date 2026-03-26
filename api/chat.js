// api/chat.js — MIPI POWER HOUSE — Vercel Serverless Proxy
// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMED FROM HEALTHCHECK:
//   - Stars_Landscape has 56,484 rows
//   - State column stores FULL names: "California", "Florida", "Texas"
//   - All tables reachable via Supabase service role key
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

// ── Supabase client ───────────────────────────────────────────────────────────
function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── State normaliser ──────────────────────────────────────────────────────────
// DB stores full names: "Florida" not "FL"
// GPT-4o may pass "FL", "fl", "florida", or "Florida" — all convert to "Florida"
const ABBR_TO_FULL = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas",
  CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware",
  FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho",
  IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas",
  KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi",
  MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada",
  NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
  NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma",
  OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah",
  VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia",
  WI:"Wisconsin", WY:"Wyoming", PR:"Puerto Rico", DC:"District of Columbia",
};

function toFullName(s) {
  if (!s) return null;
  const t = s.trim();
  // 2-letter abbreviation → full name
  if (t.length <= 2) return ABBR_TO_FULL[t.toUpperCase()] || t;
  // Already a full name — capitalise first letter only
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Dedup by Bid_id ───────────────────────────────────────────────────────────
// Stars_Landscape: one row per plan-county. Bid_id = unique plan identifier.
function dedupByBid(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const k = r.Bid_id || r.bid_id;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── QUERY HANDLERS ────────────────────────────────────────────────────────────
// All return compact summaries — NOT full row arrays.
// Keeping tool results small is critical for GPT-4o to respond correctly.

async function queryLandscape(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toFullName).filter(Boolean) : null;

  let q = db.from("Stars_Landscape").select("*");
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.bid_id)     q = q.eq("Bid_id",                  p.bid_id);  // exact plan lookup
  if (p.county)     q = q.ilike("County",              `%${p.county}%`);
  if (p.parent_org) q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.min_stars)  q = q.gte("Star_Rating",            String(p.min_stars));

  const { data: raw, error } = await q.limit(10000);
  if (error) throw new Error("Stars_Landscape: " + error.message);

  console.log("[Landscape] stateList:", JSON.stringify(stateList),
    "| raw rows:", raw ? raw.length : 0);

  if (!raw || raw.length === 0) {
    // Unfiltered sample to diagnose state value mismatch
    const { data: sample } = await db.from("Stars_Landscape")
      .select("State").limit(5);
    const sampleStates = [...new Set((sample || []).map(r => r.State))];
    console.log("[Landscape] sample State values in DB:", sampleStates);
    return {
      unique_plan_count:       0,
      raw_row_count:           0,
      state_filter_used:       stateList,
      sample_states_in_db:     sampleStates,
      message: "0 rows returned. State filter: " + JSON.stringify(stateList)
        + " | Sample DB states: " + JSON.stringify(sampleStates),
      source: "Stars_Landscape",
    };
  }

  const plans    = dedupByBid(raw);
  const stars    = plans.map(r => parseFloat(r.Star_Rating)).filter(n => !isNaN(n));
  const avgStar  = stars.length
    ? (stars.reduce((a, b) => a + b, 0) / stars.length).toFixed(2) : null;
  const fourPlus = stars.filter(s => s >= 4).length;

  const byState = {}, byOrg = {};
  plans.forEach(r => {
    byState[r.State] = (byState[r.State] || 0) + 1;
    byOrg[r.parent_organization] = (byOrg[r.parent_organization] || 0) + 1;
  });
  const topPayors = Object.entries(byOrg)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([org, cnt]) => ({ org, plans: cnt }));

  console.log("[Landscape] deduped plans:", plans.length,
    "| by_state:", JSON.stringify(byState));

  return {
    unique_plan_count: plans.length,
    raw_row_count:     raw.length,
    unique_payors:     Object.keys(byOrg).length,
    avg_star_rating:   avgStar,
    four_plus_count:   fourPlus,
    four_plus_pct:     plans.length
      ? ((fourPlus / plans.length) * 100).toFixed(1) + "%" : "0%",
    by_state:          byState,
    top_10_payors:     topPayors,
    filters_applied:   { states: stateList },
    source:            "Stars_Landscape table",
  };
}

async function queryEnrollment(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toFullName).filter(Boolean) : null;

  let q = db.from("HWAI_Enrollment").select("*");
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.county)     q = q.ilike("County",                  `%${p.county}%`);
  if (p.parent_org) q = q.ilike("Parent_Organization",     `%${p.parent_org}%`);
  if (p.plan_type)  q = q.ilike("Plan_Type",               `%${p.plan_type}%`);
  if (p.snp_type)   q = q.ilike("Special_Needs_Plan_Type", `%${p.snp_type}%`);
  if (p.month)      q = q.eq("Month", p.month);
  if (p.year)       q = q.eq("Year",  p.year);

  const { data, error } = await q.limit(10000);
  if (error) throw new Error("HWAI_Enrollment: " + error.message);

  console.log("[Enrollment] rows:", data ? data.length : 0,
    "| stateList:", JSON.stringify(stateList));

  const total     = (data || []).reduce((s, r) => s + (Number(r.Enrollment)    || 0), 0);
  const totalMA   = (data || []).reduce((s, r) => s + (Number(r.MA_Eligible)   || 0), 0);
  const totalDSNP = (data || []).reduce((s, r) => s + (Number(r.DSNP_Eligible) || 0), 0);

  const byOrg = {};
  (data || []).forEach(r => {
    byOrg[r.Parent_Organization] =
      (byOrg[r.Parent_Organization] || 0) + (Number(r.Enrollment) || 0);
  });
  const topPayors = Object.entries(byOrg)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([payor, cnt]) => ({
      payor,
      enrollment: cnt.toLocaleString(),
      share:      total ? ((cnt / total) * 100).toFixed(1) + "%" : "0%",
    }));

  return {
    total_enrollment:    total.toLocaleString(),
    total_ma_eligible:   totalMA.toLocaleString(),
    total_dsnp_eligible: totalDSNP.toLocaleString(),
    top_10_payors:       topPayors,
    filters_applied:     { states: stateList, month: p.month || null },
    source:              "HWAI_Enrollment table",
  };
}

async function queryStars(db, p) {
  let q = db.from("Stars_Cutpoint").select("*");
  if (p.contract_id) q = q.eq("CONTRACT_ID", p.contract_id);
  if (p.year)        q = q.eq("Year", p.year);
  const { data, error } = await q.limit(2000);
  if (error) throw new Error("Stars_Cutpoint: " + error.message);
  console.log("[Stars] rows:", data ? data.length : 0);
  return {
    total_records:    data ? data.length : 0,
    unique_contracts: new Set((data || []).map(r => r.CONTRACT_ID)).size,
    sample:           (data || []).slice(0, 5),
    source:           "Stars_Cutpoint table",
  };
}

async function queryFormulary(db, p) {
  let q = db.from("PartD_MRx").select("*");
  if (p.bid_id)  q = q.eq("bid_id", p.bid_id);
  if (p.tier)    q = q.eq("Tier", String(p.tier));
  if (p.benefit) q = q.ilike("Benefit", `%${p.benefit}%`);
  const { data, error } = await q.order("Tier").limit(200);
  if (error) throw new Error("PartD_MRx: " + error.message);
  const tierDist = {};
  (data || []).forEach(r => { tierDist[r.Tier] = (tierDist[r.Tier] || 0) + 1; });
  return {
    total:             data ? data.length : 0,
    tier_distribution: tierDist,
    sample:            (data || []).slice(0, 15),
    source:            "PartD_MRx table",
  };
}

async function queryDrugRankings(db, p) {
  let q = db.from("PartD_Ranking").select("*");
  if (p.disease)   q = q.ilike("prime_disease",      `%${p.disease}%`);
  if (p.brand_yn)  q = q.eq("Brand_YN",              p.brand_yn);
  if (p.drug_name) q = q.ilike("rxnorm_description", `%${p.drug_name}%`);
  const { data, error } = await q
    .order("total_beneficiaries", { ascending: false }).limit(20);
  if (error) throw new Error("PartD_Ranking: " + error.message);
  return {
    top_drugs: data || [],
    total:     data ? data.length : 0,
    source:    "PartD_Ranking table",
  };
}

async function queryTPV(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toFullName).filter(Boolean) : null;

  let q = db.from("TPV_Crosswalk").select("*");
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (p.county)     q = q.ilike("County",              `%${p.county}%`);
  if (p.parent_org) q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.plan_type)  q = q.ilike("plan_type",           `%${p.plan_type}%`);

  const { data: raw, error } = await q.limit(10000);
  if (error) throw new Error("TPV_Crosswalk: " + error.message);

  console.log("[TPV] rows:", raw ? raw.length : 0);

  const seen = new Set(), plans = [];
  (raw || []).forEach(r => {
    if (!seen.has(r.bid_id)) { seen.add(r.bid_id); plans.push(r); }
  });

  const byOrg = {};
  plans.forEach(r => {
    byOrg[r.parent_organization] = (byOrg[r.parent_organization] || 0) + 1;
  });

  return {
    unique_plan_count: plans.length,
    top_10_payors:     Object.entries(byOrg)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([org, cnt]) => ({ org, plans: cnt })),
    sample_plans:      plans.slice(0, 5),
    source:            "TPV_Crosswalk table",
  };
}

async function queryPlanComparison(db, p) {
  let q = db.from("plans").select("*");
  if (p.state)      q = q.ilike("State",             `%${p.state}%`);
  if (p.parent_org) q = q.ilike("parent_organization",`%${p.parent_org}%`);
  if (p.plan_type)  q = q.ilike("plan_type",          `%${p.plan_type}%`);
  if (p.bid_id)     q = q.eq("bid_id",                 p.bid_id);
  const { data, error } = await q.limit(p.limit || 50);
  if (error) throw new Error("plans: " + error.message);
  console.log("[PlanComparison] rows:", data ? data.length : 0,
    "| cols:", data && data.length > 0 ? Object.keys(data[0]).join(",") : "none");
  return {
    plans:   data || [],
    total:   data ? data.length : 0,
    columns: data && data.length > 0 ? Object.keys(data[0]) : [],
    source:  "plans table",
  };
}

async function queryDentalComparison(db, p) {
  let q = db.from("PC_Dental").select("*");
  if (p.state)      q = q.ilike("State",              `%${p.state}%`);
  if (p.parent_org) q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.bid_id)     q = q.eq("bid_id",                  p.bid_id);
  const { data, error } = await q.limit(p.limit || 50);
  if (error) throw new Error("PC_Dental: " + error.message);
  console.log("[DentalComparison] rows:", data ? data.length : 0);
  return {
    plans:   data || [],
    total:   data ? data.length : 0,
    columns: data && data.length > 0 ? Object.keys(data[0]) : [],
    source:  "PC_Dental table",
  };
}

// ── Tool router ───────────────────────────────────────────────────────────────
const HANDLERS = {
  query_landscape_data:    queryLandscape,
  query_enrollment_data:   queryEnrollment,
  query_stars_data:        queryStars,
  query_formulary_data:    queryFormulary,
  query_drug_rankings:     queryDrugRankings,
  query_tpv_data:          queryTPV,
  query_plan_comparison:   queryPlanComparison,
  query_dental_comparison: queryDentalComparison,
};

async function resolveToolCall(name, input) {
  const db = getDB();
  if (!db) return {
    error: "Supabase not configured — check SUPABASE_URL and SUPABASE_SERVICE_KEY",
  };
  const fn = HANDLERS[name];
  if (!fn) return { error: "Unknown tool: " + name };
  try {
    return await fn(db, input || {});
  } catch (e) {
    console.error("[tool/" + name + "] ERROR:", e.message);
    return { error: e.message, tool: name };
  }
}

// ── OpenAI helper ─────────────────────────────────────────────────────────────
async function openaiCall(apiKey, body) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      "OpenAI " + res.status + ": " +
      (data && data.error && data.error.message
        ? data.error.message
        : JSON.stringify(data))
    );
  }
  return data;
}

// ── Anthropic → OpenAI message format ────────────────────────────────────────
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
  if (!apiKey)
    return res.status(500).json({ error: "OPENAI_API_KEY not set in Vercel env vars" });

  const { messages, system, tools, model, max_tokens } = req.body || {};
  if (!messages) return res.status(400).json({ error: "messages required" });

  const oaiMessages = [];
  if (system) oaiMessages.push({ role: "system", content: system });
  oaiMessages.push(...convertMessages(messages));

  const oaiTools = tools && tools.length > 0
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
    // ── Call 1: GPT-4o decides what to do ─────────────────────────────────
    const first     = await openaiCall(apiKey, { ...baseBody, messages: oaiMessages });
    const firstMsg  = first.choices && first.choices[0] && first.choices[0].message;
    const stopReason = first.choices && first.choices[0] && first.choices[0].finish_reason;
    const content   = [];

    if (firstMsg && firstMsg.content)
      content.push({ type: "text", text: firstMsg.content });

    // ── Tool call path ─────────────────────────────────────────────────────
    if (firstMsg && firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {

      const toolResultMsgs = [];
      for (const tc of firstMsg.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); } catch (_) {}

        const result = await resolveToolCall(tc.function.name, input);
        console.log("[tool]", tc.function.name, "→",
          JSON.stringify(result).slice(0, 300));

        content.push({
          type: "tool_use", id: tc.id,
          name: tc.function.name, input,
        });

        toolResultMsgs.push({
          role:         "tool",
          tool_call_id: tc.id,
          content:      JSON.stringify(result),
        });
      }

      // ── Call 2: GPT-4o answers using real data ─────────────────────────
      // Correct order: history → assistant(tool_calls) → tool results
      // tools removed so GPT-4o returns text, not another tool call
      let finalText = null;
      try {
        const second = await openaiCall(apiKey, {
          ...baseBody,
          tools:       undefined,
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
        finalText = second.choices &&
          second.choices[0] &&
          second.choices[0].message &&
          second.choices[0].message.content || null;
      } catch (e2) {
        console.error("[call2]", e2.message);
      }

      // ── Fallback: plain summary if second call fails ───────────────────
      if (!finalText) {
        try {
          const fb = await openaiCall(apiKey, {
            model:      baseBody.model,
            max_tokens: 800,
            messages: [{
              role:    "user",
              content: "Summarise this Medicare Advantage database result "
                + "clearly and concisely:\n\n"
                + toolResultMsgs.map(t => t.content).join("\n\n"),
            }],
          });
          finalText = fb.choices &&
            fb.choices[0] &&
            fb.choices[0].message &&
            fb.choices[0].message.content || null;
        } catch (e3) {
          console.error("[fallback]", e3.message);
        }
      }

      if (finalText) {
        content.unshift({ type: "text", text: finalText });
      } else {
        content.unshift({
          type: "text",
          text: "Data retrieved from Supabase successfully. "
            + "Please try asking the question again.",
        });
      }
    }

    if (!content.some(c => c.type === "text")) {
      content.unshift({
        type: "text",
        text: "No response generated. Please try again.",
      });
    }

    return res.status(200).json({
      id:          first.id,
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
