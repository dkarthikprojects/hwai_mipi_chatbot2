// api/bridge.js — Plan Comparison → MIPI POWER HOUSE Context Bridge
//
// This endpoint receives plan context from the Plan Comparison iframe
// when postMessage isn't available (cross-origin restrictions, mobile etc.)
//
// Usage from Plan Comparison app:
//   fetch("https://your-mipi-app.vercel.app/api/bridge", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       type: "plan_selected",
//       bid_id: "H1234-001",
//       plan_name: "Humana Gold Plus",
//       payor: "Humana Inc.",
//       state: "FL"
//     })
//   });
//
// Supported event types:
//   plan_selected    — user clicked on a plan
//   plans_compared   — user is comparing 2+ plans side by side
//   filter_changed   — user changed state/plan_type/payor filter
//   state_changed    — user changed the state dropdown

export const config = { api: { bodyParser: true } };

// In-memory store (resets on cold start — for persistent storage use Supabase)
let lastContext = null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — return latest context (polled by frontend if needed) ────────────
  if (req.method === "GET") {
    return res.status(200).json({
      context: lastContext,
      timestamp: lastContext ? lastContext._ts : null,
    });
  }

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const { type } = body;

  const VALID_TYPES = [
    "plan_selected","plans_compared","filter_changed","state_changed",
  ];

  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({
      error: "Invalid or missing event type",
      valid_types: VALID_TYPES,
    });
  }

  // Build normalised context
  const context = {
    type,
    _ts: new Date().toISOString(),
  };

  if (type === "plan_selected") {
    context.bid_id    = body.bid_id    || body.bidId     || null;
    context.plan_name = body.plan_name || body.planName  || null;
    context.payor     = body.payor     || body.parent_org|| null;
    context.state     = body.state     || null;
    context.plan_type = body.plan_type || null;
    context.star_rating = body.star_rating || null;
    context.premium   = body.premium   || null;
  }

  if (type === "plans_compared") {
    context.plans = (body.plans || []).map(function(p) {
      return {
        bid_id:    p.bid_id    || p.bidId    || null,
        plan_name: p.plan_name || p.planName || null,
        payor:     p.payor     || p.parent_org|| null,
        state:     p.state     || null,
      };
    });
  }

  if (type === "filter_changed") {
    context.state     = body.state     || null;
    context.plan_type = body.plan_type || null;
    context.payor     = body.payor     || null;
    context.snp_type  = body.snp_type  || null;
    context.year      = body.year      || 2026;
  }

  if (type === "state_changed") {
    context.state = body.state || null;
  }

  // Store and return
  lastContext = context;
  console.log("[bridge] received event:", type, JSON.stringify(context));

  return res.status(200).json({
    ok:      true,
    context,
    message: "Context received. MIPI Copilot will be updated on next interaction.",
  });
}
