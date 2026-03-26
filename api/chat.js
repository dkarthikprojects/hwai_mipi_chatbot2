// api/chat.js — MIPI POWER HOUSE — Vercel Serverless Proxy
// Schema-accurate version — column names match Supabase exactly.
// Uses Supabase REST API directly for case-sensitive column names.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// State name → abbreviation map
const STATE_MAP = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR",
  "california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE",
  "florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID",
  "illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
  "kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD",
  "massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS",
  "missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
  "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC",
  "south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT",
  "vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV",
  "wisconsin":"WI","wyoming":"WY","puerto rico":"PR","dc":"DC",
};
function toAbbr(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length === 2) return t.toUpperCase();
  return STATE_MAP[t.toLowerCase()] || t.toUpperCase();
}

// ── Stars_Landscape ──────────────────────────────────────────────────────────
// Exact columns from schema:
// Bid_id, CONTRACT_ID, County, State, Plan_ID, Segment_ID, Plan_Name,
// parent_organization, Star_Rating, December, January, year,
// Crosswalk, Bench_mark, Qualifying County, Jan_base_Benchmark,
// Jan_adjusted_Benchmark, Benchmark_Impact*Rebate%
// (avoid columns with %, *, spaces — they break select parser)

async function queryLandscape(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toAbbr).filter(Boolean) : null;

  // Use select('*') to avoid PostgREST column parsing issues
  // then filter fields in JS
  let q = db.from("Stars_Landscape").select("*");

  if (stateList?.length) q = q.in("State", stateList);
  if (p.county)          q = q.ilike("County", `%${p.county}%`);
  if (p.parent_org)      q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.min_stars)       q = q.gte("Star_Rating", String(p.min_stars));

  const { data: raw, error } = await q.limit(10000);
  if (error) throw new Error("Stars_Landscape: " + error.message);

  console.log("[Landscape] stateList:", JSON.stringify(stateList),
    "raw rows:", raw?.length);

  // If still 0 rows — sample unfiltered to diagnose
  if (!raw || raw.length === 0) {
    const { data: s } = await db.from("Stars_Landscape")
      .select("*").limit(5);
    console.log("[Landscape] unfiltered sample:", JSON.stringify(s));
    return {
      unique_plan_count: 0,
      raw_row_count: 0,
      state_filter_used: stateList,
      actual_state_values_in_db: [...new Set((s||[]).map(r => r.State))],
      message: "Query returned 0 rows. Check state values above.",
      source: "Stars_Landscape",
    };
  }

  // Deduplicate by Bid_id
  // Find bid column dynamically - handles Bid_id, bid_id, BID_ID etc
  const bidKey = raw.length > 0
    ? Object.keys(raw[0]).find(k => k.toLowerCase().replace('_','') === 'bidid')
    : 'Bid_id';
  console.log("[Landscape] bid column found:", bidKey,
    "| sample keys:", raw.length>0 ? Object.keys(raw[0]).join(',') : 'no rows');
  const seen = new Set();
  const plans = raw.filter(r => {
    const bid = r[bidKey];
    if (!bid || seen.has(bid)) return false;
    seen.add(bid); return true;
  });

  console.log("[Landscape] deduped plans:", plans.length);

  const stars    = plans.map(r => parseFloat(r.Star_Rating)).filter(n => !isNaN(n));
  const avgStar  = stars.length
    ? (stars.reduce((a,b)=>a+b,0)/stars.length).toFixed(2) : null;
  const fourPlus = stars.filter(s => s>=4).length;
  const byState  = {}, byOrg = {};
  plans.forEach(r => {
    byState[r.State] = (byState[r.State]||0)+1;
    byOrg[r.parent_organization] = (byOrg[r.parent_organization]||0)+1;
  });
  const topPayors = Object.entries(byOrg)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([org,cnt])=>({org,plans:cnt}));

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
    filters_applied:   { states: stateList },
    source:            "Stars_Landscape table",
  };
}

// ── HWAI_Enrollment ──────────────────────────────────────────────────────────
// Exact columns: State, County, CPID, Month, Year, Parent_Organization,
// Plan_Type, Plan_Name, Special_Needs_Plan_Type, DSNP_Eligible,
// MA_Eligible, Enrollment

async function queryEnrollment(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toAbbr).filter(Boolean) : null;
  let q = db.from("HWAI_Enrollment").select("*");
  if (stateList?.length) q = q.in("State", stateList);
  if (p.county)          q = q.ilike("County", `%${p.county}%`);
  if (p.parent_org)      q = q.ilike("Parent_Organization", `%${p.parent_org}%`);
  if (p.plan_type)       q = q.ilike("Plan_Type", `%${p.plan_type}%`);
  if (p.snp_type)        q = q.ilike("Special_Needs_Plan_Type", `%${p.snp_type}%`);
  if (p.month)           q = q.eq("Month", p.month);
  if (p.year)            q = q.eq("Year", p.year);
  const { data, error } = await q.limit(10000);
  if (error) throw new Error("HWAI_Enrollment: " + error.message);
  console.log("[Enrollment] rows:", data?.length, "stateList:", stateList);
  const total = data.reduce((s,r)=>s+(Number(r.Enrollment)||0),0);
  const byOrg = {};
  data.forEach(r=>{
    byOrg[r.Parent_Organization]=(byOrg[r.Parent_Organization]||0)+(Number(r.Enrollment)||0);
  });
  const topPayors = Object.entries(byOrg)
    .sort((a,b)=>b[1]-a[1]).slice(0,10)
    .map(([payor,cnt])=>({
      payor, enrollment:cnt.toLocaleString(),
      share: total?((cnt/total)*100).toFixed(1)+"%":"0%",
    }));
  return {
    total_enrollment:    total.toLocaleString(),
    total_ma_eligible:   data.reduce((s,r)=>s+(Number(r.MA_Eligible)||0),0).toLocaleString(),
    total_dsnp_eligible: data.reduce((s,r)=>s+(Number(r.DSNP_Eligible)||0),0).toLocaleString(),
    top_10_payors:       topPayors,
    source: "HWAI_Enrollment table",
  };
}

// ── Stars_Cutpoint ───────────────────────────────────────────────────────────
// Columns with spaces need .select() with proper quoting via Supabase
// Safe columns only: CONTRACT_ID, Year

async function queryStars(db, p) {
  let q = db.from("Stars_Cutpoint").select("*");
  if (p.contract_id) q = q.eq("CONTRACT_ID", p.contract_id);
  if (p.year)        q = q.eq("Year", p.year);
  const { data, error } = await q.limit(2000);
  if (error) throw new Error("Stars_Cutpoint: " + error.message);
  return {
    total_records:    data.length,
    unique_contracts: new Set(data.map(r=>r.CONTRACT_ID)).size,
    source: "Stars_Cutpoint table",
  };
}

// ── PartD_MRx ────────────────────────────────────────────────────────────────
// Exact columns: Tier, bid_id, Benefit, "Tier Type" (has space!), BenefitValue
// "Tier Type" must be accessed carefully

async function queryFormulary(db, p) {
  let q = db.from("PartD_MRx").select("*");
  if (p.bid_id)  q = q.eq("bid_id", p.bid_id);
  if (p.tier)    q = q.eq("Tier", String(p.tier));
  if (p.benefit) q = q.ilike("Benefit", `%${p.benefit}%`);
  const { data, error } = await q.order("Tier").limit(200);
  if (error) throw new Error("PartD_MRx: " + error.message);
  const tierDist = {};
  data.forEach(r=>{tierDist[r.Tier]=(tierDist[r.Tier]||0)+1;});
  return {
    total: data.length, tier_distribution: tierDist,
    sample: data.slice(0,15),
    source: "PartD_MRx table",
  };
}

// ── PartD_Ranking ────────────────────────────────────────────────────────────
// Exact columns: rxcui, rxnorm_description, prime_disease, total_spending,
// total_dosage_units, total_claims, total_beneficiaries, Brand_Name, Brand_YN

async function queryDrugRankings(db, p) {
  let q = db.from("PartD_Ranking").select("*");
  if (p.disease)   q = q.ilike("prime_disease",      `%${p.disease}%`);
  if (p.brand_yn)  q = q.eq("Brand_YN",              p.brand_yn);
  if (p.drug_name) q = q.ilike("rxnorm_description", `%${p.drug_name}%`);
  const { data, error } = await q
    .order("total_beneficiaries",{ascending:false}).limit(20);
  if (error) throw new Error("PartD_Ranking: " + error.message);
  return { top_drugs: data, total: data.length, source: "PartD_Ranking table" };
}

// ── TPV_Crosswalk ────────────────────────────────────────────────────────────
// Exact columns: State, County, bid_id, Plan_Name, plan_type,
// parent_organization, SNP, Special_Needs_Plan_Type, CPID_2026, flag,
// "Supplemental Benefit Value_2026", "TPV Part C_2026", "TPV Part D_2026",
// "Total TPV_2026", "TPV Part C_2025" etc.
// "CROSSWALK STATUS" has space — avoid in select, use safe cols only

async function queryTPV(db, p) {
  const rawStates = p.states || (p.state ? [p.state] : null);
  const stateList = rawStates ? rawStates.map(toAbbr).filter(Boolean) : null;
  let q = db.from("TPV_Crosswalk").select("*");
  if (stateList?.length) q = q.in("State", stateList);
  if (p.county)          q = q.ilike("County",              `%${p.county}%`);
  if (p.parent_org)      q = q.ilike("parent_organization", `%${p.parent_org}%`);
  if (p.plan_type)       q = q.ilike("plan_type",           `%${p.plan_type}%`);
  const { data: raw, error } = await q.limit(10000);
  if (error) throw new Error("TPV_Crosswalk: " + error.message);
  const seen=new Set(), plans=[];
  raw.forEach(r=>{if(!seen.has(r.bid_id)){seen.add(r.bid_id);plans.push(r);}});
  const byOrg={};
  plans.forEach(r=>{byOrg[r.parent_organization]=(byOrg[r.parent_organization]||0)+1;});
  return {
    unique_plan_count: plans.length,
    top_10_payors: Object.entries(byOrg).sort((a,b)=>b[1]-a[1]).slice(0,10)
      .map(([org,cnt])=>({org,plans:cnt})),
    source: "TPV_Crosswalk table",
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
    error: "Supabase not configured — SUPABASE_URL or SUPABASE_SERVICE_KEY missing",
  };
  const fn = HANDLERS[name];
  if (!fn) return { error: "Unknown tool: " + name };
  try {
    return await fn(db, input || {});
  } catch(e) {
    console.error("[tool/"+name+"]", e.message);
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
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(
    "OpenAI "+res.status+": "+(data?.error?.message||JSON.stringify(data))
  );
  return data;
}

// ── Message format conversion ─────────────────────────────────────────────────
function convertMessages(messages) {
  const out = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter(b=>b.type==="tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            out.push({
              role:"tool", tool_call_id:tr.tool_use_id,
              content:typeof tr.content==="string"?tr.content:JSON.stringify(tr.content),
            });
          }
        } else {
          out.push({role:"user",content:msg.content});
        }
      } else {
        out.push({role:"user",content:msg.content});
      }
    } else if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        const textBlocks    = msg.content.filter(b=>b.type==="text");
        const toolUseBlocks = msg.content.filter(b=>b.type==="tool_use");
        const m = {
          role:"assistant",
          content:textBlocks.length?textBlocks.map(b=>b.text).join("\n"):null,
        };
        if (toolUseBlocks.length>0) {
          m.tool_calls = toolUseBlocks.map(b=>({
            id:b.id, type:"function",
            function:{name:b.name, arguments:JSON.stringify(b.input||{})},
          }));
        }
        out.push(m);
      } else {
        out.push({role:"assistant",content:msg.content});
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
  if (req.method==="OPTIONS") return res.status(200).end();
  if (req.method!=="POST")
    return res.status(405).json({error:"Method not allowed"});

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({error:"OPENAI_API_KEY not set"});

  const {messages,system,tools,model,max_tokens} = req.body||{};
  if (!messages) return res.status(400).json({error:"messages required"});

  const oaiMessages = [];
  if (system) oaiMessages.push({role:"system",content:system});
  oaiMessages.push(...convertMessages(messages));

  const oaiTools = tools?.length>0
    ? tools.map(t=>({
        type:"function",
        function:{
          name:t.name, description:t.description,
          parameters:t.input_schema||{type:"object",properties:{}},
        },
      }))
    : undefined;

  const baseBody = {
    model: model==="claude-sonnet-4-20250514"?"gpt-4o":(model||"gpt-4o"),
    max_tokens: max_tokens||2000,
  };
  if (oaiTools) {baseBody.tools=oaiTools; baseBody.tool_choice="auto";}

  try {
    // ── First call ────────────────────────────────────────────────────────
    const first    = await openaiCall(apiKey, {...baseBody,messages:oaiMessages});
    const firstMsg = first.choices?.[0]?.message;
    const stopReason = first.choices?.[0]?.finish_reason;
    const content  = [];

    if (firstMsg?.content) content.push({type:"text",text:firstMsg.content});

    // ── Tool calls ────────────────────────────────────────────────────────
    if (firstMsg?.tool_calls?.length>0) {
      const toolResultMsgs = [];
      for (const tc of firstMsg.tool_calls) {
        let input = {};
        try {input=JSON.parse(tc.function.arguments||"{}");} catch(_){}
        const result = await resolveToolCall(tc.function.name, input);
        console.log("[tool]",tc.function.name,"→",JSON.stringify(result).slice(0,200));
        content.push({type:"tool_use",id:tc.id,name:tc.function.name,input});
        toolResultMsgs.push({
          role:"tool", tool_call_id:tc.id,
          content:JSON.stringify(result),
        });
      }

      // ── Second call — tools removed, force text answer ────────────────
      let finalText = null;
      try {
        const second = await openaiCall(apiKey, {
          ...baseBody,
          tools:undefined, tool_choice:undefined,
          messages:[
            ...oaiMessages,
            {role:"assistant",content:firstMsg.content||null,tool_calls:firstMsg.tool_calls},
            ...toolResultMsgs,
          ],
        });
        finalText = second.choices?.[0]?.message?.content||null;
      } catch(e2) {
        console.error("[call2]",e2.message);
      }

      // ── Fallback plain-English summary ───────────────────────────────
      if (!finalText) {
        try {
          const fb = await openaiCall(apiKey, {
            model:baseBody.model, max_tokens:600,
            messages:[{
              role:"user",
              content:"Summarise this Medicare Advantage data clearly:\n\n"
                +toolResultMsgs.map(t=>t.content).join("\n\n"),
            }],
          });
          finalText = fb.choices?.[0]?.message?.content||null;
        } catch(e3){console.error("[fallback]",e3.message);}
      }

      if (finalText) content.unshift({type:"text",text:finalText});
      else content.unshift({type:"text",text:"Data retrieved but response generation failed. Please try again."});
    }

    if (!content.some(c=>c.type==="text"))
      content.unshift({type:"text",text:"No response generated. Please try again."});

    return res.status(200).json({
      id:first.id, type:"message", role:"assistant", content,
      stop_reason: stopReason==="tool_calls"?"tool_use"
        : stopReason==="stop"?"end_turn":stopReason,
    });

  } catch(err) {
    console.error("[chat]",err.message);
    return res.status(500).json({error:err.message});
  }
}
