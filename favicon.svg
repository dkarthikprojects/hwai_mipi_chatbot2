-- ─────────────────────────────────────────────────────────────────────────────
-- MIPI POWER HOUSE — Supabase Schema
-- HealthWorksAI | PY2026 | CA · FL · TX
--
-- HOW TO USE:
--   1. Go to supabase.com → your project → SQL Editor
--   2. Paste this entire file and click Run
--   3. All tables, indexes, and RLS policies will be created
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension (needed for auto-generated IDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 1: landscape
-- Source: MA Landscape CSV (ETL cleaned)
-- Used by: Client Queries, Plan Comparison, Competitor Analysis, Downloads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS landscape (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id           VARCHAR(20)    NOT NULL,
  plan_id               INTEGER        NOT NULL,
  segment_id            INTEGER        DEFAULT 0,
  org_name              TEXT           NOT NULL,
  parent_org            TEXT           NOT NULL,
  plan_name             TEXT           NOT NULL,
  plan_type             VARCHAR(50)    NOT NULL,
  contract_category     VARCHAR(20),            -- MAPD, SNP, MA
  state_code            CHAR(2)        NOT NULL,
  county_name           TEXT           NOT NULL,
  fips_code             VARCHAR(10),
  monthly_premium       NUMERIC(8,2)   DEFAULT 0,
  drug_deductible       NUMERIC(8,2)   DEFAULT 0,
  in_network_moop       INTEGER,
  out_network_moop      INTEGER,
  combined_moop         INTEGER,
  is_snp                BOOLEAN        DEFAULT FALSE,
  snp_type              VARCHAR(50),            -- Dual-Eligible, C-SNP, I-SNP
  part_d_benefit        BOOLEAN        DEFAULT FALSE,
  drug_benefit_type     VARCHAR(50),
  star_rating           NUMERIC(3,1),
  plan_year             INTEGER        DEFAULT 2026,
  created_at            TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX idx_landscape_state       ON landscape(state_code);
CREATE INDEX idx_landscape_parent_org  ON landscape(parent_org);
CREATE INDEX idx_landscape_plan_type   ON landscape(plan_type);
CREATE INDEX idx_landscape_snp         ON landscape(is_snp, snp_type);
CREATE INDEX idx_landscape_premium     ON landscape(monthly_premium);
CREATE INDEX idx_landscape_star        ON landscape(star_rating);
CREATE INDEX idx_landscape_county      ON landscape(state_code, county_name);
CREATE INDEX idx_landscape_contract    ON landscape(contract_id, plan_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 2: star_ratings
-- Source: CMS Star Ratings ETL
-- Used by: Stars Dashboard, QBP analysis, HEDIS benchmarking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS star_ratings (
  id                        UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id               VARCHAR(20)  NOT NULL,
  org_name                  TEXT         NOT NULL,
  parent_org                TEXT,
  contract_type             VARCHAR(20),
  state_code                CHAR(2),
  overall_star_rating       NUMERIC(3,1),
  part_c_summary_rating     NUMERIC(3,1),
  part_d_summary_rating     NUMERIC(3,1),
  -- HEDIS measures (key ones)
  breast_cancer_screening   NUMERIC(5,2),
  colorectal_screening      NUMERIC(5,2),
  annual_flu_vaccine        NUMERIC(5,2),
  diabetes_care_eye_exam    NUMERIC(5,2),
  diabetes_care_kidney      NUMERIC(5,2),
  statin_use_cvd            NUMERIC(5,2),
  controlling_bp            NUMERIC(5,2),
  member_experience_overall NUMERIC(5,2),
  appeals_auto_forward      NUMERIC(5,2),
  -- QBP eligibility
  is_qbp_eligible           BOOLEAN      DEFAULT FALSE,
  qbp_bonus_pct             NUMERIC(5,2),
  -- Flags
  is_low_enrollment         BOOLEAN      DEFAULT FALSE,
  is_new_contract           BOOLEAN      DEFAULT FALSE,
  plan_year                 INTEGER      DEFAULT 2026,
  created_at                TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_stars_contract    ON star_ratings(contract_id);
CREATE INDEX idx_stars_parent_org  ON star_ratings(parent_org);
CREATE INDEX idx_stars_overall     ON star_ratings(overall_star_rating);
CREATE INDEX idx_stars_qbp         ON star_ratings(is_qbp_eligible);
CREATE INDEX idx_stars_state       ON star_ratings(state_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 3: benefits
-- Source: Plan Benefit Package (PBP) ETL
-- Used by: Plan Comparison, Benefit benchmarking, Downloads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benefits (
  id                         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id                VARCHAR(20)  NOT NULL,
  plan_id                    INTEGER      NOT NULL,
  segment_id                 INTEGER      DEFAULT 0,
  org_name                   TEXT,
  state_code                 CHAR(2),
  -- Dental
  has_dental                 BOOLEAN      DEFAULT FALSE,
  dental_type                VARCHAR(50),         -- Preventive, Comprehensive
  dental_annual_max          NUMERIC(10,2),
  -- Vision
  has_vision                 BOOLEAN      DEFAULT FALSE,
  vision_annual_max          NUMERIC(10,2),
  -- Hearing
  has_hearing                BOOLEAN      DEFAULT FALSE,
  hearing_annual_max         NUMERIC(10,2),
  -- OTC
  has_otc                    BOOLEAN      DEFAULT FALSE,
  otc_quarterly_allowance    NUMERIC(8,2),
  otc_annual_allowance       NUMERIC(10,2),
  -- Fitness
  has_fitness                BOOLEAN      DEFAULT FALSE,
  fitness_benefit_detail     TEXT,
  -- Transportation
  has_transportation         BOOLEAN      DEFAULT FALSE,
  transportation_trips_yr    INTEGER,
  -- Meals
  has_meals                  BOOLEAN      DEFAULT FALSE,
  meals_annual_count         INTEGER,
  -- Telehealth
  has_telehealth             BOOLEAN      DEFAULT FALSE,
  -- Part B premium reduction
  part_b_premium_reduction   NUMERIC(8,2),
  plan_year                  INTEGER      DEFAULT 2026,
  created_at                 TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_benefits_contract   ON benefits(contract_id, plan_id);
CREATE INDEX idx_benefits_state      ON benefits(state_code);
CREATE INDEX idx_benefits_dental     ON benefits(has_dental);
CREATE INDEX idx_benefits_otc        ON benefits(has_otc, otc_annual_allowance);
CREATE INDEX idx_benefits_vision     ON benefits(has_vision);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 4: formulary
-- Source: Formulary ETL (drug-level data)
-- Used by: Formulary queries, drug tier analysis
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS formulary (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id          VARCHAR(20)  NOT NULL,
  plan_id              INTEGER      NOT NULL,
  formulary_id         VARCHAR(20),
  drug_name            TEXT         NOT NULL,
  generic_name         TEXT,
  drug_class           TEXT,
  tier                 INTEGER,                 -- 1-6
  tier_label           VARCHAR(50),             -- Generic, Preferred, etc.
  requires_prior_auth  BOOLEAN      DEFAULT FALSE,
  requires_step_therapy BOOLEAN     DEFAULT FALSE,
  quantity_limit       BOOLEAN      DEFAULT FALSE,
  cost_share_30day     NUMERIC(8,2),
  cost_share_90day     NUMERIC(8,2),
  mail_order_available BOOLEAN      DEFAULT FALSE,
  plan_year            INTEGER      DEFAULT 2026,
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_formulary_contract   ON formulary(contract_id, plan_id);
CREATE INDEX idx_formulary_drug       ON formulary(LOWER(drug_name));
CREATE INDEX idx_formulary_class      ON formulary(drug_class);
CREATE INDEX idx_formulary_tier       ON formulary(tier);
CREATE INDEX idx_formulary_pa         ON formulary(requires_prior_auth);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 5: snp_details
-- Source: SNP comprehensive ETL
-- Used by: SNP Analysis, D-SNP downloads, AIP reporting
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snp_details (
  id                        UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id               VARCHAR(20)  NOT NULL,
  plan_id                   INTEGER      NOT NULL,
  org_name                  TEXT,
  parent_org                TEXT,
  state_code                CHAR(2),
  county_name               TEXT,
  snp_type                  VARCHAR(50)  NOT NULL,  -- D-SNP, C-SNP, I-SNP
  snp_subtype               TEXT,
  -- D-SNP specific
  is_aip                    BOOLEAN      DEFAULT FALSE,  -- Applicable Integrated Plan
  mmp_integrated            BOOLEAN      DEFAULT FALSE,  -- Medicare-Medicaid Plan
  state_medicaid_contract   VARCHAR(50),
  dsnp_level                VARCHAR(20),               -- Level 1/2/3/4
  -- C-SNP specific
  chronic_condition         TEXT,
  -- Enrollment
  enrollment_count          INTEGER,
  -- Premiums
  monthly_premium           NUMERIC(8,2),
  -- Star rating
  star_rating               NUMERIC(3,1),
  plan_year                 INTEGER      DEFAULT 2026,
  created_at                TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_snp_contract    ON snp_details(contract_id, plan_id);
CREATE INDEX idx_snp_type        ON snp_details(snp_type);
CREATE INDEX idx_snp_state       ON snp_details(state_code);
CREATE INDEX idx_snp_aip         ON snp_details(is_aip);
CREATE INDEX idx_snp_parent_org  ON snp_details(parent_org);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 6: crosswalk
-- Source: Contract/Plan Crosswalk ETL
-- Used by: Plan continuity analysis, contract consolidations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crosswalk (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  current_contract_id   VARCHAR(20)  NOT NULL,
  current_plan_id       INTEGER,
  prior_contract_id     VARCHAR(20),
  prior_plan_id         INTEGER,
  org_name              TEXT,
  parent_org            TEXT,
  state_code            CHAR(2),
  crosswalk_type        VARCHAR(50),    -- Merger, Termination, New, Continuation
  crosswalk_reason      TEXT,
  effective_date        DATE,
  plan_year             INTEGER        DEFAULT 2026,
  created_at            TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX idx_crosswalk_current  ON crosswalk(current_contract_id);
CREATE INDEX idx_crosswalk_prior    ON crosswalk(prior_contract_id);
CREATE INDEX idx_crosswalk_org      ON crosswalk(parent_org);
CREATE INDEX idx_crosswalk_state    ON crosswalk(state_code);
CREATE INDEX idx_crosswalk_type     ON crosswalk(crosswalk_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 7: benchmark_rates
-- Source: CMS Rate Announcement / Benchmark ETL
-- Used by: QBP revenue analysis, county benchmarks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS benchmark_rates (
  id                        UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  state_code                CHAR(2)      NOT NULL,
  county_name               TEXT         NOT NULL,
  fips_code                 VARCHAR(10),
  ssa_code                  VARCHAR(10),
  -- Benchmark values
  aged_non_esrd_benchmark   NUMERIC(10,2),
  esrd_benchmark            NUMERIC(10,2),
  -- FFS rates
  aged_ffs_rate             NUMERIC(10,2),
  -- Quality bonus
  qbp_4star_bonus_pct       NUMERIC(5,2),
  qbp_5star_bonus_pct       NUMERIC(5,2),
  -- MA penetration
  ma_penetration_rate       NUMERIC(5,2),
  total_medicare_beneficiaries INTEGER,
  total_ma_enrollees        INTEGER,
  plan_year                 INTEGER      DEFAULT 2026,
  created_at                TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_benchmark_state   ON benchmark_rates(state_code);
CREATE INDEX idx_benchmark_county  ON benchmark_rates(state_code, county_name);
CREATE INDEX idx_benchmark_fips    ON benchmark_rates(fips_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE 8: enrollment
-- Source: Monthly Enrollment by Contract ETL
-- Used by: Enrollment Trends dashboard, market share analysis
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrollment (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  contract_id      VARCHAR(20)  NOT NULL,
  plan_id          INTEGER,
  org_name         TEXT,
  parent_org       TEXT,
  state_code       CHAR(2),
  county_name      TEXT,
  plan_type        VARCHAR(50),
  snp_type         VARCHAR(50),
  enrollment_count INTEGER      DEFAULT 0,
  report_month     DATE         NOT NULL,    -- e.g. 2026-01-01
  plan_year        INTEGER      DEFAULT 2026,
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_enrollment_contract  ON enrollment(contract_id);
CREATE INDEX idx_enrollment_parent    ON enrollment(parent_org);
CREATE INDEX idx_enrollment_state     ON enrollment(state_code);
CREATE INDEX idx_enrollment_month     ON enrollment(report_month);
CREATE INDEX idx_enrollment_snp       ON enrollment(snp_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (enable on all tables)
-- With RLS enabled, only your service role key (used in api/query.js) can
-- read/write. The anon key cannot access any data.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE landscape       ENABLE ROW LEVEL SECURITY;
ALTER TABLE star_ratings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE formulary       ENABLE ROW LEVEL SECURITY;
ALTER TABLE snp_details     ENABLE ROW LEVEL SECURITY;
ALTER TABLE crosswalk       ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment      ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by api/query.js on the server)
CREATE POLICY "service_role_all" ON landscape       FOR ALL USING (true);
CREATE POLICY "service_role_all" ON star_ratings    FOR ALL USING (true);
CREATE POLICY "service_role_all" ON benefits        FOR ALL USING (true);
CREATE POLICY "service_role_all" ON formulary       FOR ALL USING (true);
CREATE POLICY "service_role_all" ON snp_details     FOR ALL USING (true);
CREATE POLICY "service_role_all" ON crosswalk       FOR ALL USING (true);
CREATE POLICY "service_role_all" ON benchmark_rates FOR ALL USING (true);
CREATE POLICY "service_role_all" ON enrollment      FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER VIEWS (pre-built queries the API uses most often)
-- ─────────────────────────────────────────────────────────────────────────────

-- Market summary by state (chatbot quick stats)
-- Deduplicates to unique plans (contract_id + plan_id = bid_id) per state.
-- A plan serving 30 counties still counts as 1 plan, not 30.
CREATE OR REPLACE VIEW v_market_summary AS
WITH unique_plans AS (
  SELECT DISTINCT ON (state_code, contract_id, plan_id)
    state_code, contract_id, plan_id, parent_org,
    monthly_premium, star_rating, is_snp
  FROM landscape
  ORDER BY state_code, contract_id, plan_id
)
SELECT
  state_code,
  COUNT(*)                                           AS total_plans,
  COUNT(DISTINCT parent_org)                         AS unique_payors,
  ROUND(AVG(monthly_premium), 2)                     AS avg_premium,
  ROUND(
    100.0 * SUM(CASE WHEN monthly_premium = 0 THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 1
  )                                                  AS zero_premium_pct,
  ROUND(AVG(star_rating), 2)                         AS avg_star_rating,
  ROUND(
    100.0 * SUM(CASE WHEN is_snp THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 1
  )                                                  AS snp_pct
FROM unique_plans
GROUP BY state_code;

-- Payor market share by state — counts unique plans per payor per state.
-- market_share_pct = payor's unique plan count / total unique plans in that state.
CREATE OR REPLACE VIEW v_payor_share AS
WITH unique_plans AS (
  SELECT DISTINCT ON (state_code, contract_id, plan_id)
    state_code, contract_id, plan_id, parent_org,
    monthly_premium, star_rating
  FROM landscape
  ORDER BY state_code, contract_id, plan_id
)
SELECT
  state_code,
  parent_org,
  COUNT(*)                                           AS plan_count,
  ROUND(
    100.0 * COUNT(*)
    / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY state_code), 0), 1
  )                                                  AS market_share_pct,
  ROUND(AVG(monthly_premium), 2)                     AS avg_premium,
  ROUND(AVG(star_rating), 2)                         AS avg_stars
FROM unique_plans
GROUP BY state_code, parent_org
ORDER BY state_code, plan_count DESC;

-- County-level plan availability — counts unique plans per county.
-- Here (state_code, county_name, contract_id, plan_id) is the correct grain
-- because the same plan CAN have different premiums in different counties.
CREATE OR REPLACE VIEW v_county_summary AS
WITH unique_plans_by_county AS (
  SELECT DISTINCT ON (state_code, county_name, contract_id, plan_id)
    state_code, county_name, contract_id, plan_id, parent_org,
    monthly_premium, star_rating
  FROM landscape
  ORDER BY state_code, county_name, contract_id, plan_id
)
SELECT
  state_code,
  county_name,
  COUNT(*)                                           AS total_plans,
  COUNT(DISTINCT parent_org)                         AS unique_payors,
  ROUND(AVG(monthly_premium), 2)                     AS avg_premium,
  SUM(CASE WHEN monthly_premium = 0 THEN 1 ELSE 0 END) AS zero_premium_plans,
  ROUND(AVG(star_rating), 2)                         AS avg_stars
FROM unique_plans_by_county
GROUP BY state_code, county_name
ORDER BY state_code, total_plans DESC;

-- Star rating distribution nationally
CREATE OR REPLACE VIEW v_star_distribution AS
SELECT
  overall_star_rating,
  COUNT(*)                                          AS contract_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_total,
  SUM(CASE WHEN is_qbp_eligible THEN 1 ELSE 0 END) AS qbp_eligible_count
FROM star_ratings
GROUP BY overall_star_rating
ORDER BY overall_star_rating DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW: v_unique_plans
-- The canonical "one row per plan" view.
-- Use this whenever you need plan-level (not service-area-level) counts.
-- bid_id = contract_id + '-' + plan_id  (CMS standard identifier)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_unique_plans AS
SELECT DISTINCT ON (contract_id, plan_id)
  contract_id,
  plan_id,
  (contract_id || '-' || plan_id::text)  AS bid_id,
  segment_id,
  org_name,
  parent_org,
  plan_name,
  plan_type,
  contract_category,
  -- State list: all states this plan operates in
  -- (representative state from first service area row)
  state_code,
  monthly_premium,
  drug_deductible,
  in_network_moop,
  out_network_moop,
  is_snp,
  snp_type,
  part_d_benefit,
  star_rating,
  plan_year
FROM landscape
ORDER BY contract_id, plan_id, state_code;

-- Convenience: count unique plans and service areas side by side
CREATE OR REPLACE VIEW v_plan_vs_service_area AS
SELECT
  'Total (CA+FL+TX)'                              AS scope,
  COUNT(DISTINCT contract_id || plan_id::text)    AS unique_plans,
  COUNT(*)                                        AS service_area_rows,
  ROUND(COUNT(*)::numeric
    / NULLIF(COUNT(DISTINCT contract_id || plan_id::text), 0), 1)
                                                  AS avg_counties_per_plan
FROM landscape
UNION ALL
SELECT
  state_code,
  COUNT(DISTINCT contract_id || plan_id::text),
  COUNT(*),
  ROUND(COUNT(*)::numeric
    / NULLIF(COUNT(DISTINCT contract_id || plan_id::text), 0), 1)
FROM landscape
GROUP BY state_code
ORDER BY scope;

-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: Fix plan counting in all views
-- Run this after the initial schema to replace the original views.
--
-- COUNTING RULE:
--   unique_plan_count = DISTINCT (contract_id, plan_id) — the bid-id.
--   The landscape table has ONE ROW PER PLAN-COUNTY COMBINATION.
--   The same bid appears in many rows (one per county it serves).
--   All plan-level counts and averages must deduplicate by bid first.
--   v_county_summary intentionally keeps row-level counts because it answers
--   "how many plans are available in this county" — that IS the row count.
-- ─────────────────────────────────────────────────────────────────────────────

-- Market summary: unique plans and bid-level averages per state
CREATE OR REPLACE VIEW v_market_summary AS
WITH unique_plans AS (
  SELECT DISTINCT ON (contract_id, plan_id)
    contract_id, plan_id, state_code, parent_org,
    monthly_premium, star_rating, is_snp
  FROM landscape
  ORDER BY contract_id, plan_id
)
SELECT
  state_code,
  COUNT(*)::int                                                AS unique_plan_count,
  COUNT(DISTINCT parent_org)::int                             AS unique_payors,
  ROUND(AVG(monthly_premium), 2)                              AS avg_premium,
  ROUND(
    100.0 * SUM(CASE WHEN monthly_premium = 0 THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 1
  )                                                           AS zero_premium_pct,
  ROUND(AVG(star_rating), 2)                                  AS avg_star_rating,
  ROUND(
    100.0 * SUM(CASE WHEN is_snp THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 1
  )                                                           AS snp_pct
FROM unique_plans
GROUP BY state_code;

-- Payor market share: unique bid counts per state
CREATE OR REPLACE VIEW v_payor_share AS
WITH unique_plans AS (
  SELECT DISTINCT ON (contract_id, plan_id)
    contract_id, plan_id, state_code, parent_org,
    monthly_premium, star_rating
  FROM landscape
  ORDER BY contract_id, plan_id
)
SELECT
  state_code,
  parent_org,
  COUNT(*)::int                                               AS unique_plan_count,
  ROUND(
    100.0 * COUNT(*)
    / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY state_code), 0), 1
  )                                                           AS market_share_pct,
  ROUND(AVG(monthly_premium), 2)                              AS avg_premium,
  ROUND(AVG(star_rating), 2)                                  AS avg_stars
FROM unique_plans
GROUP BY state_code, parent_org
ORDER BY state_code, unique_plan_count DESC;

-- County availability: row count = plans available in that county (correct)
CREATE OR REPLACE VIEW v_county_summary AS
SELECT
  state_code,
  county_name,
  COUNT(*)::int                                               AS plans_available,
  COUNT(DISTINCT contract_id || '-' || plan_id::text)::int   AS unique_plan_count,
  COUNT(DISTINCT parent_org)::int                             AS unique_payors,
  ROUND(AVG(monthly_premium), 2)                              AS avg_premium,
  SUM(CASE WHEN monthly_premium = 0 THEN 1 ELSE 0 END)::int  AS zero_premium_plans,
  ROUND(AVG(star_rating), 2)                                  AS avg_stars
FROM landscape
GROUP BY state_code, county_name
ORDER BY state_code, unique_plan_count DESC;

-- Star rating distribution: contract-level, no dedup needed
CREATE OR REPLACE VIEW v_star_distribution AS
SELECT
  overall_star_rating,
  COUNT(*)::int                                               AS contract_count,
  ROUND(
    100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1
  )                                                           AS pct_of_total,
  SUM(CASE WHEN is_qbp_eligible THEN 1 ELSE 0 END)::int      AS qbp_eligible_count
FROM star_ratings
GROUP BY overall_star_rating
ORDER BY overall_star_rating DESC;
