// api/healthcheck.js
// Diagnostic endpoint — visit /api/healthcheck to see connection status.
// Remove or restrict this file after debugging.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const report = {
    timestamp:    new Date().toISOString(),
    env: {
      OPENAI_API_KEY:       process.env.OPENAI_API_KEY
        ? "SET (" + process.env.OPENAI_API_KEY.slice(0,8) + "...)" : "MISSING ❌",
      SUPABASE_URL:         process.env.SUPABASE_URL
        ? "SET (" + process.env.SUPABASE_URL + ")" : "MISSING ❌",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
        ? "SET (" + process.env.SUPABASE_SERVICE_KEY.slice(0,12) + "...)" : "MISSING ❌",
    },
    supabase_connection: null,
    tables_visible:      [],
  };

  // Test Supabase connection
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    report.supabase_connection = "FAILED — env vars missing";
  } else {
    try {
      const db = createClient(url, key, { auth: { persistSession: false } });

      // Try a minimal query on Stars_Landscape
      const { data, error } = await db
        .from("Stars_Landscape")
        .select("Bid_id")
        .limit(1);

      if (error) {
        report.supabase_connection = "FAILED — " + error.message;
      } else {
        report.supabase_connection = "OK ✅ — Stars_Landscape reachable";
        report.sample_bid_id = data?.[0]?.Bid_id || "no rows";
      }

      // Check which tables exist
      const tables = [
        "Stars_Landscape","HWAI_Enrollment","Stars_Cutpoint",
        "PartD_MRx","PartD_Ranking","TPV_Crosswalk",
      ];
      for (const t of tables) {
        const { error: te } = await db.from(t).select("*").limit(1);
        report.tables_visible.push({ table: t, status: te ? "❌ " + te.message : "✅" });
      }
    } catch (e) {
      report.supabase_connection = "EXCEPTION — " + e.message;
    }
  }

  return res.status(200).json(report);
}
