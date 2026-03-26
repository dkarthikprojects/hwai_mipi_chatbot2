// api/healthcheck.js — Full diagnostic endpoint
// Visit /api/healthcheck to see exact DB state

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const report = {
    timestamp: new Date().toISOString(),
    env: {
      OPENAI_API_KEY:       !!process.env.OPENAI_API_KEY,
      SUPABASE_URL:         process.env.SUPABASE_URL || "MISSING",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
        ? process.env.SUPABASE_SERVICE_KEY.slice(0,20)+"..." : "MISSING",
    },
    tables: {},
  };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    report.error = "Supabase env vars missing";
    return res.status(200).json(report);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Check each table — count rows and sample first row
  const tables = [
    "Stars_Landscape",
    "HWAI_Enrollment",
    "Stars_Cutpoint",
    "PartD_MRx",
    "PartD_Ranking",
    "TPV_Crosswalk",
  ];

  for (const t of tables) {
    try {
      // Get first 3 rows to see actual column names and values
      const { data, error } = await db
        .from(t).select("*").limit(3);

      if (error) {
        report.tables[t] = { status: "ERROR", message: error.message };
      } else {
        report.tables[t] = {
          status:       "OK",
          row_count:    data.length,
          columns:      data.length > 0 ? Object.keys(data[0]) : [],
          sample_row:   data.length > 0 ? data[0] : null,
        };
      }
    } catch(e) {
      report.tables[t] = { status: "EXCEPTION", message: e.message };
    }
  }

  return res.status(200).json(report, null, 2);
}
