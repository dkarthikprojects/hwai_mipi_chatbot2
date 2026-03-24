# MIPI POWER HOUSE

**HealthWorksAI** — Medicare Advantage Market & Product Intelligence Platform

Built with React + Vite. Deployed on Vercel.

---

## What's inside

| Section | Description |
|---|---|
| 💬 Client Queries | AI chatbot powered by Claude — answers MA plan questions using PY2026 CMS data |
| 📑 Custom Reports | Generate competitive landscape, premium benchmarking, SNP analysis, star ratings, and executive summary reports |
| ⬇️ Data Downloads | Filter by State, County, Plan Type, SNP Type — download Landscape, Stars, Premium, SNP Analysis CSVs + EOC/Dental manifests |
| 📰 MA Industry News | Latest Medicare Advantage policy, enrollment, and benefit updates |
| 🧠 MA Knowledge Quiz | Test your Medicare Advantage knowledge across MOOP, SNP, Stars, Premium, and D-SNP topics |
| 📊 Dashboards | 6 embedded dashboards (Competitor Analysis, Enrollment Trends, Market Snapshot, Plan Comparison, Stars, TPV YOY) with HWAI Copilot |

---

## Quick start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/mipi-powerhouse.git
cd mipi-powerhouse
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
# Then edit .env.local and add your Anthropic API key
```

### 4. Run locally

```bash
npm run dev
# Opens at http://localhost:3000
```

### 5. Build for production

```bash
npm run build
npm run preview   # preview the production build locally
```

---

## Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm install -g vercel
vercel login
vercel --prod
```

### Option B — Connect Git repo (recommended for ongoing deployment)

1. Push this repo to GitHub / GitLab / Bitbucket
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Vercel auto-detects Vite — no framework config needed
5. Add environment variable: `VITE_ANTHROPIC_API_KEY` → your key
6. Click **Deploy**

Every `git push` to `main` triggers an automatic redeploy.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude (chatbot + HWAI Copilot) |
| `VITE_APP_ENV` | No | `production` or `development` |
| `VITE_API_BASE_URL` | No | Backend Express API URL (when wired) |

> **Note:** In Vite, all env vars must be prefixed with `VITE_` to be accessible in the browser bundle.

---

## Wiring the backend

The app uses mock/sample data by default. To serve full CMS data:

1. Deploy the Express backend (see `server/` — coming soon)
2. Set `VITE_API_BASE_URL` to your backend URL
3. Replace mock functions in `src/App.jsx`:
   - `mockResult()` → `fetch(import.meta.env.VITE_API_BASE_URL + "/api/query/..." )`
   - `makeRows()` → `fetch(import.meta.env.VITE_API_BASE_URL + "/api/export/..." )`

---

## Project structure

```
mipi-powerhouse/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx          # React entry point
│   └── App.jsx           # MIPI POWER HOUSE — full platform
├── .env.example          # Environment variable template
├── .gitignore
├── eslint.config.js
├── index.html            # HTML shell
├── package.json
├── vercel.json           # Vercel deployment config
└── vite.config.js        # Vite build config
```

---

## Data coverage

- **Plan Year:** PY2026
- **States:** California, Florida, Texas
- **Total plans:** 15,955
- **Source:** CMS Medicare Advantage Landscape Files

---

## Tech stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 |
| Build Tool | Vite 5 |
| AI | Anthropic Claude (claude-sonnet-4) |
| Deployment | Vercel |
| Styling | Inline React styles (zero CSS deps) |
| Data | CMS MA Landscape PY2026 (sample) |

---

*HealthWorksAI — Medicare Advantage Intelligence · Confidential*
