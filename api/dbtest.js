// api/dbtest.js
// Direct Supabase table test — bypasses GPT-4o entirely.
// Visit /api/dbtest to confirm tables are reachable and have data.
// Visit /api/dbtest?table=Stars_Landscape&state=FL to test a specific query.
// Remove this file after confirming connectivity.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  // ── Env check ─────────────────────────────────────────────────────────────
  if (!url || !key) {
    return res.status(200).json({
      status: "❌ FAILED",
      reason: "Missing env vars",
      SUPABASE_URL:         url  ? "SET" : "MISSING ❌",
      SUPABASE_SERVICE_KEY: key  ? "SET" : "MISSING ❌",
    });
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const params = new URL(req.url, "http://localhost").searchParams;
  const targetTable = params.get("table");
  const stateFilter = params.get("state");

  // ── Single table test with optional filter ────────────────────────────────
  if (targetTable) {
    try {
      let q = db.from(targetTable).select("*");
      if (stateFilter && ["Stars_Landscape","HWAI_Enrollment","TPV_Crosswalk"]
          .includes(targetTable)) {
        q = q.eq("State", stateFilter.toUpperCase());
      }
      const { data, error } = await q.limit(3);
      if (error) {
        return res.status(200).json({
          table:  targetTable,
          status: "❌ QUERY ERROR",
          error:  error.message,
          hint:   "Check table name casing — Supabase is case-sensitive",
        });
      }
      return res.status(200).json({
        table:        targetTable,
        status:       "✅ REACHABLE",
        rows_returned: data.length,
        state_filter:  stateFilter || "none",
        columns:       data.length > 0 ? Object.keys(data[0]) : [],
        sample_rows:   data,
      });
    } catch(e) {
      return res.status(200).json({
        table: targetTable, status: "❌ EXCEPTION", error: e.message,
      });
    }
  }

  // ── Full scan — test all 6 tables ─────────────────────────────────────────
  const TABLES = [
    { name: "Stars_Landscape",  stateCol: "State" },
    { name: "HWAI_Enrollment",  stateCol: "State" },
    { name: "Stars_Cutpoint",   stateCol: null     },
    { name: "PartD_MRx",        stateCol: null     },
    { name: "PartD_Ranking",    stateCol: null     },
    { name: "TPV_Crosswalk",    stateCol: "State"  },
  ];

  const results = {};

  for (const t of TABLES) {
    try {
      // Total row count
      const { count, error: ce } = await db
        .from(t.name)
        .select("*", { count: "exact", head: true });

      // Sample row
      const { data: sample, error: se } = await db
        .from(t.name).select("*").limit(1);

      // FL-filtered count for state tables
      let flCount = null;
      if (t.stateCol) {
        const { count: fc } = await db
          .from(t.name)
          .select("*", { count: "exact", head: true })
          .eq(t.stateCol, "FL");
        flCount = fc;
      }

      results[t.name] = {
        status:     ce || se ? "❌ ERROR" : "✅ OK",
        total_rows: ce ? ("ERROR: " + ce.message) : count,
        fl_rows:    flCount !== null ? flCount : "n/a",
        columns:    sample && sample.length > 0
          ? Object.keys(sample[0]).length + " cols: "
            + Object.keys(sample[0]).join(", ")
          : "no rows",
        error:      ce?.message || se?.message || null,
      };
    } catch(e) {
      results[t.name] = { status: "❌ EXCEPTION", error: e.message };
    }
  }

  // Summary
  const allOk   = Object.values(results).every(r => r.status === "✅ OK");
  const anyData = Object.values(results).some(r => typeof r.total_rows === "number" && r.total_rows > 0);

  return res.status(200).json({
    overall: allOk && anyData ? "✅ ALL TABLES CONNECTED WITH DATA"
           : allOk           ? "⚠️ CONNECTED BUT SOME TABLES EMPTY"
           :                   "❌ SOME TABLES HAVE ERRORS",
    supabase_url: url,
    tables: results,
    quick_tests: {
      fl_landscape:  "GET /api/dbtest?table=Stars_Landscape&state=FL",
      fl_enrollment: "GET /api/dbtest?table=HWAI_Enrollment&state=FL",
      tpv:           "GET /api/dbtest?table=TPV_Crosswalk",
      formulary:     "GET /api/dbtest?table=PartD_MRx",
    },
  });
}
