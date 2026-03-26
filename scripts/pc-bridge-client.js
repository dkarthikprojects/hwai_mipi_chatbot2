/**
 * pc-bridge-client.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop this script into the Plan Comparison app (plancomparison-ui).
 * It emits postMessage events to the MIPI POWER HOUSE parent window
 * whenever the user interacts with Plan Comparison.
 *
 * INTEGRATION STEPS FOR PLAN COMPARISON DEV TEAM:
 *
 * 1. Add this script to the Plan Comparison app:
 *    <script src="/pc-bridge-client.js"></script>
 *
 * 2. Call MIPIBridge.emit() whenever user interacts:
 *
 *    // User selects a plan
 *    MIPIBridge.emit("plan_selected", {
 *      bid_id:     "H1234-001",
 *      plan_name:  "Humana Gold Plus",
 *      payor:      "Humana Inc.",
 *      state:      "FL",
 *      plan_type:  "HMO",
 *      star_rating: 4.0,
 *      premium:    0,
 *    });
 *
 *    // User compares two plans side by side
 *    MIPIBridge.emit("plans_compared", {
 *      plans: [
 *        { bid_id: "H1234-001", plan_name: "Humana Gold Plus",  payor: "Humana",     state: "FL" },
 *        { bid_id: "H5678-002", plan_name: "UHC AARP MedicareC", payor: "UnitedHealth", state: "FL" },
 *      ]
 *    });
 *
 *    // User changes state filter
 *    MIPIBridge.emit("state_changed", { state: "TX" });
 *
 *    // User changes multiple filters
 *    MIPIBridge.emit("filter_changed", {
 *      state:     "FL",
 *      plan_type: "HMO",
 *      payor:     "Humana",
 *      snp_type:  "D-SNP",
 *    });
 *
 * 3. That's it. MIPI POWER HOUSE listens for these events automatically.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function(window) {
  "use strict";

  // Target origins that MIPI POWER HOUSE may be hosted on
  // Update this list to match your actual deployment URLs
  var MIPI_ORIGINS = [
    "https://mipi-powerhouse.vercel.app",
    "https://mipi.analytics-hub.com",
    "http://localhost:3000",
    // Add your Vercel URL here e.g. "https://your-app.vercel.app"
  ];

  // REST fallback URL (used when postMessage parent isn't available)
  var BRIDGE_API_URL = "https://mipi-powerhouse.vercel.app/api/bridge";

  var VALID_TYPES = [
    "plan_selected",
    "plans_compared",
    "filter_changed",
    "state_changed",
  ];

  /**
   * Emit an event to MIPI POWER HOUSE
   * @param {string} type    - Event type (see VALID_TYPES above)
   * @param {object} payload - Event data
   */
  function emit(type, payload) {
    if (!type || VALID_TYPES.indexOf(type) === -1) {
      console.warn("[MIPIBridge] Invalid event type:", type,
        " | Valid:", VALID_TYPES.join(", "));
      return;
    }

    var message = Object.assign({ type: type }, payload || {});

    // Strategy 1: postMessage to parent window (works when embedded as iframe)
    var sent = false;
    if (window.parent && window.parent !== window) {
      try {
        // Send to all known MIPI origins
        MIPI_ORIGINS.forEach(function(origin) {
          try {
            window.parent.postMessage(message, origin);
          } catch(e) { /* origin may not match — ignore */ }
        });
        // Also try wildcard as fallback
        window.parent.postMessage(message, "*");
        sent = true;
        console.log("[MIPIBridge] postMessage sent:", type, payload);
      } catch(e) {
        console.warn("[MIPIBridge] postMessage failed:", e.message);
      }
    }

    // Strategy 2: REST API fallback (works for direct navigation, mobile, etc.)
    try {
      fetch(BRIDGE_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(message),
        mode:    "no-cors", // fire-and-forget
      }).catch(function() { /* silent — bridge is best-effort */ });
    } catch(e) { /* silent */ }

    if (!sent) {
      console.log("[MIPIBridge] REST fallback used for event:", type);
    }
  }

  // ── Convenience methods ───────────────────────────────────────────────────

  function planSelected(data) {
    emit("plan_selected", {
      bid_id:      data.bid_id     || data.bidId     || null,
      plan_name:   data.plan_name  || data.planName  || null,
      payor:       data.payor      || data.parentOrg || null,
      state:       data.state      || null,
      plan_type:   data.plan_type  || data.planType  || null,
      star_rating: data.star_rating|| data.starRating|| null,
      premium:     data.premium    || null,
    });
  }

  function plansCompared(plans) {
    emit("plans_compared", {
      plans: (plans || []).map(function(p) {
        return {
          bid_id:    p.bid_id    || p.bidId    || null,
          plan_name: p.plan_name || p.planName || null,
          payor:     p.payor     || p.parentOrg|| null,
          state:     p.state     || null,
        };
      }),
    });
  }

  function filterChanged(filters) {
    emit("filter_changed", {
      state:     filters.state     || null,
      plan_type: filters.plan_type || filters.planType || null,
      payor:     filters.payor     || null,
      snp_type:  filters.snp_type  || filters.snpType  || null,
      year:      filters.year      || 2026,
    });
  }

  function stateChanged(state) {
    emit("state_changed", { state: state });
  }

  // ── Expose public API ─────────────────────────────────────────────────────
  window.MIPIBridge = {
    emit:          emit,
    planSelected:  planSelected,
    plansCompared: plansCompared,
    filterChanged: filterChanged,
    stateChanged:  stateChanged,
    version:       "1.0.0",
  };

  console.log("[MIPIBridge] v1.0.0 loaded — MIPI POWER HOUSE bridge ready");

})(window);
