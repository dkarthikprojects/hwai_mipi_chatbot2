// api/context.js — MIPI POWER HOUSE External Context API
// ─────────────────────────────────────────────────────────────────────────────
// POST filters/context from any external source (Plan Comparison, iframe,
// another app, Postman, curl) → MIPI stores it → GenieAI auto-prompts with it.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//
// POST /api/context
// Content-Type: application/json
//
// {
//   "session_id": "user-123",          // optional — ties context to a user
//   "source":     "plan_comparison",   // where the context came from
//   "filters": {
//     "state":      "Florida",          // or "FL" — both work
//     "plan_type":  "HMO",
//     "payor":      "Humana",
//     "snp_type":   "D-SNP",
//     "year":       2026,
//     "county":     "Miami-Dade",
//     "min_stars":  4
//   },
//   "selected_plans": [                // optional — specific plans in view
//     {
//       "bid_id":     "H5619_003_0",
//       "plan_name":  "Humana Gold Plus H5619-003",
//       "payor":      "Humana Inc.",
//       "state":      "Florida",
//       "premium":    0,
//       "star_rating": 4.0
//     }
//   ],
//   "action": "filter_changed"         // what the user just did
// }
//
// ── RESPONSE ─────────────────────────────────────────────────────────────────
// {
//   "ok": true,
//   "session_id": "user-123",
//   "prompt": "The user is viewing HMO plans in Florida...",  ← auto-generated
//   "context_id": "ctx_1748291234"
// }
//
// ── POLL FOR LATEST CONTEXT ───────────────────────────────────────────────────
// GET /api/context?session_id=user-123
// Returns the latest context stored for that session.
//
// ── DELETE CONTEXT ────────────────────────────────────────────────────────────
// DELETE /api/context?session_id=user-123
// Clears stored context for that session.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: true } };

// In-memory store (survives within a serverless instance — ~minutes)
// For persistent cross-session storage, swap this for a Supabase table.
const contextStore = {};

// ── State normaliser ──────────────────────────────────────────────────────────
const ABBR_TO_FULL = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas",
  CA:"California", CO:"Colorado", CT:"Connecticut", DE:"Delaware",
  FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho",
  IL:"Illinois", IN:"Indiana", IA:"Iowa", KS:"Kansas",
  KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi",
  MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada",
  NH:"New Hampshire", NJ:"New Jersey", NM:"New Mexico", NY:"New York",
  NC:"North Carolina", ND:"North Dakota", OH:"Ohio", OK:"Oklahoma",
  OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah",
  VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia",
  WI:"Wisconsin", WY:"Wyoming", PR:"Puerto Rico", DC:"District of Columbia",
};
function toFullName(s) {
  if (!s) return null;
  const t = s.trim();
  if (t.length <= 2) return ABBR_TO_FULL[t.toUpperCase()] || t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Auto-prompt builder ───────────────────────────────────────────────────────
// Turns the posted filters into a natural language prompt for GenieAI
function buildPrompt(body) {
  const f       = body.filters        || {};
  const plans   = body.selected_plans || [];
  const action  = body.action         || "filter_changed";
  const source  = body.source         || "external";

  const state     = f.state     ? toFullName(f.state) : null;
  const payor     = f.payor     || f.parent_org        || null;
  const planType  = f.plan_type || f.planType          || null;
  const snpType   = f.snp_type  || f.snpType           || null;
  const county    = f.county                           || null;
  const minStars  = f.min_stars || f.minStars          || null;
  const year      = f.year                             || 2026;

  const parts = [];

  // Action context
  const actionMap = {
    filter_changed:  "The user just updated their plan filters",
    plan_selected:   "The user just selected a specific plan",
    plans_compared:  "The user is comparing multiple plans side by side",
    state_changed:   "The user just changed the state selection",
    payor_changed:   "The user just filtered by a specific payor",
    view_loaded:     "The user just opened the plan comparison view",
  };
  parts.push(actionMap[action] || "The user is viewing plan data");

  // Build filter description
  const filterParts = [];
  if (state)    filterParts.push("State: " + state);
  if (payor)    filterParts.push("Payor: " + payor);
  if (planType) filterParts.push("Plan type: " + planType);
  if (snpType)  filterParts.push("SNP type: " + snpType);
  if (county)   filterParts.push("County: " + county);
  if (minStars) filterParts.push("Min stars: " + minStars);
  filterParts.push("Year: PY" + year);

  if (filterParts.length > 0) {
    parts.push("with the following filters: " + filterParts.join(", ") + ".");
  }

  // Selected plans
  if (plans.length === 1) {
    const p = plans[0];
    parts.push(
      "The selected plan is: " +
      (p.plan_name || p.bid_id || "unknown") +
      (p.payor     ? " from " + p.payor       : "") +
      (p.premium !== undefined ? ", premium: $" + p.premium : "") +
      (p.star_rating           ? ", stars: "   + p.star_rating : "") + "."
    );
  } else if (plans.length > 1) {
    const names = plans
      .map(p => p.plan_name || p.bid_id)
      .filter(Boolean).join(", ");
    parts.push("The plans being compared are: " + names + ".");
  }

  // Instruction to GenieAI
  const toolMap = {
    "filter_changed":  "query_landscape_data and query_enrollment_data",
    "plan_selected":   "query_plan_comparison",
    "plans_compared":  "query_plan_comparison",
    "state_changed":   "query_landscape_data",
    "payor_changed":   "query_landscape_data and query_enrollment_data",
    "view_loaded":     "query_landscape_data",
  };
  const toolHint = toolMap[action] || "query_landscape_data";

  parts.push(
    "Using " + toolHint + ", provide a concise summary including: " +
    "the number of unique plans available, top payors by plan count, " +
    (plans.length > 1 ? "a comparison of the selected plans, " : "") +
    "average star rating, and 2 relevant follow-up questions."
  );

  return parts.join(" ");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const url        = new URL(req.url, "http://localhost");
  const sessionId  = url.searchParams.get("session_id") || "default";

  // ── DELETE — clear context ────────────────────────────────────────────────
  if (req.method === "DELETE") {
    delete contextStore[sessionId];
    return res.status(200).json({
      ok:         true,
      session_id: sessionId,
      message:    "Context cleared",
    });
  }

  // ── GET — return latest context for session ───────────────────────────────
  if (req.method === "GET") {
    const ctx = contextStore[sessionId] || null;
    return res.status(200).json({
      ok:         true,
      session_id: sessionId,
      context:    ctx,
      has_context: ctx !== null,
    });
  }

  // ── POST — receive and store new context ──────────────────────────────────
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};

  // Validate — at least filters or selected_plans required
  if (!body.filters && !body.selected_plans && !body.action) {
    return res.status(400).json({
      error: "Request must include at least one of: filters, selected_plans, action",
      example: {
        session_id: "user-123",
        source:     "plan_comparison",
        action:     "filter_changed",
        filters: {
          state:     "FL",
          plan_type: "HMO",
          payor:     "Humana",
          year:      2026,
        },
      },
    });
  }

  const sid = body.session_id || sessionId;

  // Normalise state in filters
  if (body.filters && body.filters.state) {
    body.filters.state = toFullName(body.filters.state);
  }

  // Build auto-prompt
  const prompt     = buildPrompt(body);
  const contextId  = "ctx_" + Date.now();
  const timestamp  = new Date().toISOString();

  // Store context
  contextStore[sid] = {
    context_id:     contextId,
    session_id:     sid,
    source:         body.source     || "external",
    action:         body.action     || "filter_changed",
    filters:        body.filters    || {},
    selected_plans: body.selected_plans || [],
    prompt,
    timestamp,
  };

  console.log("[context] stored for session:", sid,
    "| action:", body.action, "| filters:", JSON.stringify(body.filters));

  return res.status(200).json({
    ok:          true,
    context_id:  contextId,
    session_id:  sid,
    timestamp,
    prompt,
    message:     "Context stored. GenieAI will use this on next question.",
    filters_normalised: body.filters,
  });
}
