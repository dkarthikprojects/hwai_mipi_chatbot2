// scripts/ingest.js
// ─────────────────────────────────────────────────────────────────────────────
// MIPI POWER HOUSE — Supabase Data Ingestion
// Reads your ETL CSV files and bulk-loads them into Supabase.
//
// USAGE:
//   node scripts/ingest.js landscape    → loads landscape.csv
//   node scripts/ingest.js stars        → loads star_ratings.csv
//   node scripts/ingest.js benefits     → loads benefits.csv
//   node scripts/ingest.js formulary    → loads formulary.csv
//   node scripts/ingest.js snp          → loads snp_details.csv
//   node scripts/ingest.js crosswalk    → loads crosswalk.csv
//   node scripts/ingest.js benchmark    → loads benchmark_rates.csv
//   node scripts/ingest.js enrollment   → loads enrollment.csv
//   node scripts/ingest.js all          → loads all files in order
//
// PREREQUISITES:
//   npm install @supabase/supabase-js csv-parse dotenv
//   Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local
//
// PLACE YOUR CSV FILES IN: scripts/data/
//   scripts/data/landscape.csv
//   scripts/data/star_ratings.csv
//   etc.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient }   from "@supabase/supabase-js";
import { parse }          from "csv-parse/sync";
import { readFileSync }   from "fs";
import { join, dirname }  from "path";
import { fileURLToPath }  from "url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = join(__dirname, "data");
const BATCH     = 500; // rows per Supabase upsert batch

// ── Supabase client (uses service role key — bypasses RLS) ───────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// ── Column mapping: CSV header → DB column name ───────────────────────────────
// Update these maps to match your actual ETL CSV column names.
// Left side  = your CSV header (case-insensitive match)
// Right side = Supabase table column name
const MAPS = {
  landscape: {
    "contract_id":          "contract_id",
    "plan_id":              "plan_id",
    "segment_id":           "segment_id",
    "organization_name":    "org_name",
    "parent_organization":  "parent_org",
    "plan_name":            "plan_name",
    "plan_type":            "plan_type",
    "contract_category":    "contract_category",
    "state_code":           "state_code",
    "county":               "county_name",
    "fips_code":            "fips_code",
    "monthly_premium":      "monthly_premium",
    "drug_deductible":      "drug_deductible",
    "in_network_moop":      "in_network_moop",
    "out_network_moop":     "out_network_moop",
    "is_snp":               "is_snp",
    "snp_type":             "snp_type",
    "part_d":               "part_d_benefit",
    "star_rating":          "star_rating",
    "plan_year":            "plan_year",
  },
  star_ratings: {
    "contract_id":                "contract_id",
    "organization_name":          "org_name",
    "parent_organization":        "parent_org",
    "contract_type":              "contract_type",
    "state":                      "state_code",
    "overall_star_rating":        "overall_star_rating",
    "part_c_summary_rating":      "part_c_summary_rating",
    "part_d_summary_rating":      "part_d_summary_rating",
    "breast_cancer_screening":    "breast_cancer_screening",
    "colorectal_screening":       "colorectal_screening",
    "diabetes_care_eye_exam":     "diabetes_care_eye_exam",
    "statin_use_cvd":             "statin_use_cvd",
    "controlling_bp":             "controlling_bp",
    "member_experience_overall":  "member_experience_overall",
    "is_qbp_eligible":            "is_qbp_eligible",
    "qbp_bonus_pct":              "qbp_bonus_pct",
    "plan_year":                  "plan_year",
  },
  benefits: {
    "contract_id":                "contract_id",
    "plan_id":                    "plan_id",
    "segment_id":                 "segment_id",
    "state":                      "state_code",
    "has_dental":                 "has_dental",
    "dental_type":                "dental_type",
    "dental_annual_max":          "dental_annual_max",
    "has_vision":                 "has_vision",
    "vision_annual_max":          "vision_annual_max",
    "has_hearing":                "has_hearing",
    "hearing_annual_max":         "hearing_annual_max",
    "has_otc":                    "has_otc",
    "otc_quarterly_allowance":    "otc_quarterly_allowance",
    "otc_annual_allowance":       "otc_annual_allowance",
    "has_fitness":                "has_fitness",
    "has_transportation":         "has_transportation",
    "has_meals":                  "has_meals",
    "has_telehealth":             "has_telehealth",
    "part_b_premium_reduction":   "part_b_premium_reduction",
    "plan_year":                  "plan_year",
  },
  formulary: {
    "contract_id":          "contract_id",
    "plan_id":              "plan_id",
    "formulary_id":         "formulary_id",
    "drug_name":            "drug_name",
    "generic_name":         "generic_name",
    "drug_class":           "drug_class",
    "tier":                 "tier",
    "tier_label":           "tier_label",
    "requires_prior_auth":  "requires_prior_auth",
    "requires_step_therapy":"requires_step_therapy",
    "quantity_limit":       "quantity_limit",
    "cost_share_30day":     "cost_share_30day",
    "cost_share_90day":     "cost_share_90day",
    "plan_year":            "plan_year",
  },
  snp: {
    "contract_id":            "contract_id",
    "plan_id":                "plan_id",
    "organization_name":      "org_name",
    "parent_organization":    "parent_org",
    "state_code":             "state_code",
    "county":                 "county_name",
    "snp_type":               "snp_type",
    "snp_subtype":            "snp_subtype",
    "is_aip":                 "is_aip",
    "mmp_integrated":         "mmp_integrated",
    "dsnp_level":             "dsnp_level",
    "chronic_condition":      "chronic_condition",
    "monthly_premium":        "monthly_premium",
    "star_rating":            "star_rating",
    "enrollment_count":       "enrollment_count",
    "plan_year":              "plan_year",
  },
  crosswalk: {
    "current_contract_id":  "current_contract_id",
    "current_plan_id":      "current_plan_id",
    "prior_contract_id":    "prior_contract_id",
    "prior_plan_id":        "prior_plan_id",
    "organization_name":    "org_name",
    "parent_organization":  "parent_org",
    "state_code":           "state_code",
    "crosswalk_type":       "crosswalk_type",
    "crosswalk_reason":     "crosswalk_reason",
    "effective_date":       "effective_date",
    "plan_year":            "plan_year",
  },
  benchmark: {
    "state_code":                   "state_code",
    "county_name":                  "county_name",
    "fips_code":                    "fips_code",
    "ssa_code":                     "ssa_code",
    "aged_non_esrd_benchmark":      "aged_non_esrd_benchmark",
    "esrd_benchmark":               "esrd_benchmark",
    "aged_ffs_rate":                "aged_ffs_rate",
    "qbp_4star_bonus_pct":          "qbp_4star_bonus_pct",
    "qbp_5star_bonus_pct":          "qbp_5star_bonus_pct",
    "ma_penetration_rate":          "ma_penetration_rate",
    "total_medicare_beneficiaries": "total_medicare_beneficiaries",
    "total_ma_enrollees":           "total_ma_enrollees",
    "plan_year":                    "plan_year",
  },
  enrollment: {
    "contract_id":    "contract_id",
    "plan_id":        "plan_id",
    "organization_name": "org_name",
    "parent_organization": "parent_org",
    "state_code":     "state_code",
    "county_name":    "county_name",
    "plan_type":      "plan_type",
    "snp_type":       "snp_type",
    "enrollment":     "enrollment_count",
    "report_month":   "report_month",
    "plan_year":      "plan_year",
  },
};

const TABLE_NAMES = {
  landscape:   "landscape",
  star_ratings:"star_ratings",
  benefits:    "benefits",
  formulary:   "formulary",
  snp:         "snp_details",
  crosswalk:   "crosswalk",
  benchmark:   "benchmark_rates",
  enrollment:  "enrollment",
};

const FILE_NAMES = {
  landscape:    "landscape.csv",
  star_ratings: "star_ratings.csv",
  benefits:     "benefits.csv",
  formulary:    "formulary.csv",
  snp:          "snp_details.csv",
  crosswalk:    "crosswalk.csv",
  benchmark:    "benchmark_rates.csv",
  enrollment:   "enrollment.csv",
};

// ── Type coercions ────────────────────────────────────────────────────────────
function coerce(key, value) {
  if (value === "" || value === null || value === undefined) return null;
  const v = String(value).trim();
  // Boolean fields
  const boolKeys = ["is_snp","part_d_benefit","is_qbp_eligible","has_dental",
    "has_vision","has_hearing","has_otc","has_fitness","has_transportation",
    "has_meals","has_telehealth","is_aip","mmp_integrated","requires_prior_auth",
    "requires_step_therapy","quantity_limit","mail_order_available",
    "is_low_enrollment","is_new_contract"];
  if (boolKeys.includes(key)) {
    return ["true","1","yes","y","x"].includes(v.toLowerCase());
  }
  // Integer fields
  const intKeys = ["plan_id","segment_id","in_network_moop","out_network_moop",
    "combined_moop","tier","transport_trips_yr","meals_annual_count",
    "enrollment_count","total_medicare_beneficiaries","total_ma_enrollees","plan_year"];
  if (intKeys.includes(key)) {
    const n = parseInt(v.replace(/[$,]/g, ""), 10);
    return isNaN(n) ? null : n;
  }
  // Numeric/decimal fields
  const numKeys = ["monthly_premium","drug_deductible","star_rating",
    "overall_star_rating","part_c_summary_rating","part_d_summary_rating",
    "breast_cancer_screening","colorectal_screening","annual_flu_vaccine",
    "diabetes_care_eye_exam","diabetes_care_kidney","statin_use_cvd",
    "controlling_bp","member_experience_overall","qbp_bonus_pct",
    "dental_annual_max","vision_annual_max","hearing_annual_max",
    "otc_quarterly_allowance","otc_annual_allowance","part_b_premium_reduction",
    "cost_share_30day","cost_share_90day","aged_non_esrd_benchmark",
    "esrd_benchmark","aged_ffs_rate","qbp_4star_bonus_pct","qbp_5star_bonus_pct",
    "ma_penetration_rate","monthly_premium","appeals_auto_forward",
    "market_share_pct"];
  if (numKeys.includes(key)) {
    const n = parseFloat(v.replace(/[$,%]/g, ""));
    return isNaN(n) ? null : n;
  }
  return v;
}

// ── Map CSV row to DB row using column map ────────────────────────────────────
function mapRow(csvRow, colMap) {
  const dbRow = {};
  for (const [csvCol, dbCol] of Object.entries(colMap)) {
    // Case-insensitive CSV header lookup
    const csvKey = Object.keys(csvRow).find(
      k => k.trim().toLowerCase() === csvCol.toLowerCase()
    );
    if (csvKey !== undefined) {
      dbRow[dbCol] = coerce(dbCol, csvRow[csvKey]);
    }
  }
  return dbRow;
}

// ── Load one dataset ──────────────────────────────────────────────────────────
async function loadDataset(key) {
  const filePath = join(DATA_DIR, FILE_NAMES[key]);
  const tableName = TABLE_NAMES[key];
  const colMap = MAPS[key];

  console.log(`\n[${ key.toUpperCase() }] Loading ${filePath} → ${tableName}`);

  let rawCSV;
  try {
    rawCSV = readFileSync(filePath, "utf8");
  } catch (_) {
    console.error(`  ✗ File not found: ${filePath}`);
    return;
  }

  const records = parse(rawCSV, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`  Parsed ${records.length} rows`);

  let inserted = 0, errors = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH).map(r => mapRow(r, colMap));
    const { error } = await supabase
      .from(tableName)
      .upsert(batch, { onConflict: "id", ignoreDuplicates: false });
    if (error) {
      console.error(`  ✗ Batch ${Math.floor(i/BATCH)+1} error:`, error.message);
      errors++;
    } else {
      inserted += batch.length;
      process.stdout.write(`  ✓ ${inserted}/${records.length} rows loaded\r`);
    }
  }
  console.log(`\n  Done: ${inserted} inserted, ${errors} batch errors`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const target = process.argv[2];
if (!target) {
  console.log("Usage: node scripts/ingest.js <dataset|all>");
  console.log("Datasets:", Object.keys(MAPS).join(", "));
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local");
  process.exit(1);
}

if (target === "all") {
  const order = ["landscape","enrollment","star_ratings","benefits",
                 "formulary","snp","crosswalk","benchmark"];
  for (const key of order) {
    await loadDataset(key);
  }
} else if (MAPS[target]) {
  await loadDataset(target);
} else {
  console.error(`Unknown dataset: ${target}`);
  console.log("Valid options:", Object.keys(MAPS).join(", "), "all");
  process.exit(1);
}

console.log("\n✅ Ingestion complete");
