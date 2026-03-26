// api/healthcheck.js — Raw connection test
import { createClient } from "@supabase/supabase-js";
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  const report = {
    env_url:  url  ? url  : "MISSING",
    env_key:  key  ? key.slice(0,30)+"..." : "MISSING",
    tests:    [],
  };

  if (!url || !key) {
    return res.status(200).json(report);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Test 1: raw select * no filters no limit override
  try {
    const { data, error, status } = await db
      .from("Stars_Landscape")
      .select("*")
      .limit(3);
    report.tests.push({
      test:   "select * limit 3",
      status: status,
      error:  error ? error.message : null,
      rows:   data ? data.length : 0,
      sample: data && data.length > 0 ? data[0] : null,
    });
  } catch(e) {
    report.tests.push({ test: "select * limit 3", exception: e.message });
  }

  // Test 2: count via head
  try {
    const { count, error } = await db
      .from("Stars_Landscape")
      .select("*", { count: "exact", head: true });
    report.tests.push({
      test:  "count exact",
      count: count,
      error: error ? error.message : null,
    });
  } catch(e) {
    report.tests.push({ test: "count exact", exception: e.message });
  }

  // Test 3: raw REST fetch bypassing JS client
  try {
    const rawRes = await fetch(
      url + "/rest/v1/Stars_Landscape?select=*&limit=1",
      {
        headers: {
          "apikey":        key,
          "Authorization": "Bearer " + key,
        },
      }
    );
    const rawData = await rawRes.json();
    report.tests.push({
      test:       "raw REST fetch",
      http_status: rawRes.status,
      rows:       Array.isArray(rawData) ? rawData.length : 0,
      sample:     Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData,
    });
  } catch(e) {
    report.tests.push({ test: "raw REST fetch", exception: e.message });
  }

  return res.status(200).json(report);
}
