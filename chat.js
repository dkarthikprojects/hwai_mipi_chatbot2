// api/query.js — MIPI POWER HOUSE Real Data Query Endpoint
//
// Wired to actual Supabase schema:
//   Stars_Landscape   — main plan landscape (bid, stars, benchmark)
//   HWAI_Enrollment   — enrollment by state/county/month
//   PartD_MRx         — Part D formulary tiers and benefits
//   PartD_Ranking     — drug rankings (spend, claims, beneficiaries)
//   Stars_Cutpoint    — star rating cutpoints and domain measures
//   TPV_Crosswalk     — TPV YoY 2024/2025/2026 with benefit detail
//
// PLAN COUNTING RULE:
//   Stars_Landscape has one row per plan-county combination.
//   A unique plan = Bid_id. Always deduplicate by Bid_id for plan counts.
//   County-level row counts are valid for geographic availability queries.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const pct = (arr, fn) =>
  arr.length
    ? ((arr.filter(fn).length / arr.length) * 100).toFixed(1) + "%"
    : "0%";
const avg = (arr, fn) =>
  arr.length
    ? parseFloat(
        (arr.reduce((s, r) => s + (fn(r) || 0), 0) / arr.length).toFixed(2)
      )
    : null;

// Deduplicate rows by Bid_id (one row per unique plan)
function dedupByBid(rows, limit) {
  const seen = new Set();
  const out  = [];
  for (const r of rows) {
    const k = r.Bid_id || r.bid_id || (r.CONTRACT_ID + "|" + r.Plan_ID);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ── QUERY HANDLERS ────────────────────────────────────────────────────────────

// 1. Stars_Landscape — main plan landscape
async function queryLandscape(db, params) {
  const {
    state, states, county, plan_type, snp_type,
    parent_org, min_stars, limit = 50,
  } = params;

  // Fetch raw rows with filters
  let q = db.from("Stars_Landscape").select(
    "Bid_id, CONTRACT_ID, Plan_ID, Plan_Name, parent_organization," +
    "State, County, Star_Rating, Bench_mark," +
    '"0% Bonus County Rate", "3.5% Bonus County Rate", "5% Bonus County Rate",' +
    "Crosswalk, year, January, December"
  );

  const stateList = states || (state ? [state] : null);
  if (stateList && stateList.length)
    q = q.in("State", stateList);
  if (county)     q = q.ilike("County", `%${county}%`);
  if (parent_org) q = q.ilike("parent_organization", `%${parent_org}%`);
  if (min_stars)  q = q.gte("Star_Rating", String(min_stars));

  const { data: raw, error } = await q
    .order("Bid_id").limit(limit * 20);
  if (error) throw error;

  // Deduplicate by Bid_id for unique plan count
  const plans = dedupByBid(raw, limit);

  // Summary stats on unique plans
  const uniquePayors = new Set(plans.map(r => r.parent_organization)).size;
  const starNums     = plans
    .map(r => parseFloat(r.Star_Rating))
    .filter(n => !isNaN(n));
  const avgStar      = starNums.length
    ? (starNums.reduce((a, b) => a + b, 0) / starNums.length).toFixed(2)
    : null;
  const fourPlus     = starNums.filter(s => s >= 4).length;

  return {
    summary: {
      unique_plan_count: plans.length,
      unique_payors:     uniquePayors,
      avg_star_rating:   avgStar,
      four_plus_stars:   fourPlus,
      four_plus_pct:     plans.length
        ? ((fourPlus / plans.length) * 100).toFixed(1) + "%"
        : "0%",
    },
    plans,
    note: "unique_plan_count = distinct Bid_id. Each plan may serve multiple counties.",
    source: "HealthWorksAI Supabase — Stars_Landscape PY2026",
  };
}

// 2. HWAI_Enrollment — enrollment by state/county/month
async function queryEnrollment(db, params) {
  const {
    state, states, county, parent_org,
    plan_type, snp_type, month, year = 2026,
    limit = 200,
  } = params;

  let q = db.from("HWAI_Enrollment").select(
    "State, County, CPID, Month, Year," +
    "Parent_Organization, Plan_Type, Plan_Name," +
    "Special_Needs_Plan_Type, DSNP_Eligible, MA_Eligible, Enrollment"
  );

  const stateList = states || (state ? [state] : null);
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (county)     q = q.ilike("County", `%${county}%`);
  if (parent_org) q = q.ilike("Parent_Organization", `%${parent_org}%`);
  if (plan_type)  q = q.ilike("Plan_Type", `%${plan_type}%`);
  if (snp_type)   q = q.ilike("Special_Needs_Plan_Type", `%${snp_type}%`);
  if (month)      q = q.eq("Month", month);
  if (year)       q = q.eq("Year", year);

  q = q.order("Enrollment", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;

  const total = data.reduce((s, r) => s + (r.Enrollment || 0), 0);
  const totalMA = data.reduce((s, r) => s + (r.MA_Eligible || 0), 0);
  const totalDSNP = data.reduce((s, r) => s + (r.DSNP_Eligible || 0), 0);

  // Aggregate by parent org
  const byOrg = {};
  data.forEach(r => {
    byOrg[r.Parent_Organization] =
      (byOrg[r.Parent_Organization] || 0) + (r.Enrollment || 0);
  });
  const topPayors = Object.entries(byOrg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([payor, count]) => ({
      payor,
      enrollment: count.toLocaleString(),
      share_pct: total
        ? ((count / total) * 100).toFixed(1) + "%"
        : "0%",
    }));

  return {
    records:          data,
    total_enrollment: total.toLocaleString(),
    total_ma_eligible: totalMA.toLocaleString(),
    total_dsnp_eligible: totalDSNP.toLocaleString(),
    top_payors:       topPayors,
    source: "HealthWorksAI Supabase — HWAI_Enrollment",
  };
}

// 3. PartD_MRx — Part D formulary tiers and benefits
async function queryFormulary(db, params) {
  const { bid_id, tier, benefit, tier_type, limit = 100 } = params;

  let q = db.from("PartD_MRx").select(
    "bid_id, Tier, Benefit, \"Tier Type\", BenefitValue"
  );

  if (bid_id)    q = q.eq("bid_id", bid_id);
  if (tier)      q = q.eq("Tier", String(tier));
  if (tier_type) q = q.ilike('"Tier Type"', `%${tier_type}%`);
  if (benefit)   q = q.ilike("Benefit", `%${benefit}%`);

  q = q.order("Tier").limit(limit);
  const { data, error } = await q;
  if (error) throw error;

  const tierDist = {};
  data.forEach(r => {
    const k = r["Tier Type"] || ("Tier " + r.Tier);
    tierDist[k] = (tierDist[k] || 0) + 1;
  });

  return {
    formulary:         data,
    total:             data.length,
    tier_distribution: tierDist,
    source: "HealthWorksAI Supabase — PartD_MRx",
  };
}

// 4. PartD_Ranking — drug market rankings
async function queryDrugRankings(db, params) {
  const { disease, brand_yn, drug_name, limit = 50 } = params;

  let q = db.from("PartD_Ranking").select(
    "rxcui, rxnorm_description, prime_disease," +
    "total_spending, total_claims, total_beneficiaries," +
    "Brand_Name, Brand_YN"
  );

  if (disease)   q = q.ilike("prime_disease", `%${disease}%`);
  if (brand_yn)  q = q.eq("Brand_YN", brand_yn);
  if (drug_name) q = q.ilike("rxnorm_description", `%${drug_name}%`);

  q = q.order("total_beneficiaries", { ascending: false }).limit(limit);
  const { data, error } = await q;
  if (error) throw error;

  return {
    drugs:  data,
    total:  data.length,
    source: "HealthWorksAI Supabase — PartD_Ranking",
  };
}

// 5. Stars_Cutpoint — star rating cutpoints and domain measures
async function queryStars(db, params) {
  const { contract_id, domain, year = 2026, min_star, limit = 200 } = params;

  let q = db.from("Stars_Cutpoint").select(
    'CONTRACT_ID, "Contract Name", Year,' +
    '"Domain Names", "Domain/CD Measure", "Measure Weightage",' +
    '"Measure/Domain Star Rating", "Measure/Domain Star Score",' +
    "A, B, C, D"
  );

  if (contract_id) q = q.eq("CONTRACT_ID", contract_id);
  if (domain)      q = q.ilike('"Domain Names"', `%${domain}%`);
  if (year)        q = q.eq("Year", year);
  if (min_star)    q = q.gte('"Measure/Domain Star Rating"', String(min_star));

  q = q.order("CONTRACT_ID").limit(limit);
  const { data, error } = await q;
  if (error) throw error;

  // Summarise unique contracts and avg domain ratings
  const contracts = new Set(data.map(r => r.CONTRACT_ID)).size;
  const ratings   = data
    .map(r => parseFloat(r["Measure/Domain Star Rating"]))
    .filter(n => !isNaN(n));
  const avgRating = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
    : null;

  return {
    measures:          data,
    total_records:     data.length,
    unique_contracts:  contracts,
    avg_domain_rating: avgRating,
    source: "HealthWorksAI Supabase — Stars_Cutpoint",
  };
}

// 6. TPV_Crosswalk — Total Plan Value YoY + benefit detail
async function queryTPV(db, params) {
  const {
    state, states, county, parent_org,
    plan_type, snp_type, crosswalk_status,
    limit = 100,
  } = params;

  let q = db.from("TPV_Crosswalk").select(
    "State, County, bid_id, Plan_Name, plan_type," +
    "parent_organization, SNP, Special_Needs_Plan_Type," +
    "CPID_2026, flag," +
    '"Supplemental Benefit Value_2026",' +
    '"TPV Part C_2026", "TPV Part D_2026", "Total TPV_2026",' +
    '"Total TPV_2025", "Total TPV_2024",' +
    "DVH, OTC, Inpatient, Transport, SSBCI," +
    "Feb_enrollments, Dec_enrollments," +
    '"CROSSWALK STATUS"'
  );

  const stateList = states || (state ? [state] : null);
  if (stateList && stateList.length) q = q.in("State", stateList);
  if (county)          q = q.ilike("County", `%${county}%`);
  if (parent_org)      q = q.ilike("parent_organization", `%${parent_org}%`);
  if (plan_type)       q = q.ilike("plan_type", `%${plan_type}%`);
  if (snp_type)        q = q.ilike("Special_Needs_Plan_Type", `%${snp_type}%`);
  if (crosswalk_status)q = q.ilike('"CROSSWALK STATUS"', `%${crosswalk_status}%`);

  q = q.order("bid_id").limit(limit * 10);
  const { data: raw, error } = await q;
  if (error) throw error;

  // Deduplicate by bid_id
  const seen  = new Set();
  const plans = [];
  for (const r of raw) {
    if (!seen.has(r.bid_id)) {
      seen.add(r.bid_id);
      plans.push(r);
    }
    if (plans.length >= limit) break;
  }

  // YoY summary
  const tpv26 = plans
    .map(r => parseFloat(r["Total TPV_2026"]))
    .filter(n => !isNaN(n));
  const tpv25 = plans
    .map(r => parseFloat(r["Total TPV_2025"]))
    .filter(n => !isNaN(n));
  const avgTPV26 = tpv26.length
    ? (tpv26.reduce((a, b) => a + b, 0) / tpv26.length).toFixed(2)
    : null;
  const avgTPV25 = tpv25.length
    ? (tpv25.reduce((a, b) => a + b, 0) / tpv25.length).toFixed(2)
    : null;

  return {
    plans,
    unique_plan_count: plans.length,
    avg_tpv_2026:      avgTPV26,
    avg_tpv_2025:      avgTPV25,
    yoy_change:        avgTPV26 && avgTPV25
      ? (((avgTPV26 - avgTPV25) / avgTPV25) * 100).toFixed(1) + "%"
      : null,
    source: "HealthWorksAI Supabase — TPV_Crosswalk",
  };
}

// ── Route table ───────────────────────────────────────────────────────────────
const HANDLERS = {
  query_landscape_data:  queryLandscape,
  query_enrollment_data: queryEnrollment,
  query_formulary_data:  queryFormulary,
  query_drug_rankings:   queryDrugRankings,
  query_stars_data:      queryStars,
  query_tpv_data:        queryTPV,
};

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { tool_name, params } = req.body || {};
  if (!tool_name)
    return res.status(400).json({ error: "tool_name required" });

  const fn = HANDLERS[tool_name];
  if (!fn) {
    return res.status(400).json({
      error:     "Unknown tool: " + tool_name,
      available: Object.keys(HANDLERS),
    });
  }

  try {
    const db     = getSupabase();
    const result = await fn(db, params || {});
    return res.status(200).json(result);
  } catch (err) {
    console.error("[query/" + tool_name + "]", err.message);
    return res.status(500).json({ error: err.message });
  }
}
