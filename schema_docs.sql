# MIPI POWER HOUSE — Database Setup

## Quick start (15 minutes)

### Step 1 — Create Supabase project
1. Go to **supabase.com** → New project
2. Name: `mipi-powerhouse` | Region: pick closest to your users
3. Save your database password

### Step 2 — Run the schema
1. Go to **SQL Editor** in your Supabase dashboard
2. Open `db/schema.sql` from this repo
3. Paste the entire contents and click **Run**
4. You should see 8 tables + 4 views created successfully

### Step 3 — Get your keys
Go to **Project Settings → API**:
- `SUPABASE_URL` = Project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_KEY` = `service_role` key (secret — not the anon key)

### Step 4 — Add keys to Vercel
Vercel → your project → Settings → Environment Variables:
```
SUPABASE_URL          = https://xxxx.supabase.co
SUPABASE_SERVICE_KEY  = eyJhbGc...  (service_role key)
```

### Step 5 — Load your ETL data

Place your CSV files in `scripts/data/`:
```
scripts/data/
  landscape.csv
  star_ratings.csv
  benefits.csv
  formulary.csv
  snp_details.csv
  crosswalk.csv
  benchmark_rates.csv
  enrollment.csv
```

Install ingestion dependencies:
```bash
npm install @supabase/supabase-js csv-parse dotenv
```

Create `scripts/.env.local`:
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
```

Load all datasets:
```bash
node scripts/ingest.js all
```

Or load individually:
```bash
node scripts/ingest.js landscape
node scripts/ingest.js stars
node scripts/ingest.js benefits
# etc.
```

### Step 6 — Column name mapping

If your CSV column names differ from the defaults in `scripts/ingest.js`,
update the `MAPS` object for each dataset. For example if your landscape CSV
uses `"Org_Name"` instead of `"Organization_Name"`:

```js
// In MAPS.landscape:
"Org_Name": "org_name",   // ← change left side to match your CSV header
```

### Step 7 — Redeploy
```bash
git add api/ db/ scripts/
git commit -m "Add Supabase integration"
git push
```

Vercel auto-deploys. The chatbot now answers from real data.

---

## Verifying it works

After deploying, ask the chatbot:
> "How many MA plans are in Florida for PY2026?"

If you see real numbers matching your data, it's working.
If you see mock data with "connect Supabase" in the source field,
check that SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Vercel.

---

## Column name reference

The ingestion script does **case-insensitive** header matching, so
`State_Code`, `state_code`, and `STATE CODE` all work.

When you share your CSV files, share just the header row first
and I'll update the column maps to match exactly.
