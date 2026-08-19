"use strict";

const {getSupabaseErrorDetails, normalizeSupabaseUrl} = require("./supabase_network");

class ShoppingCandidateFunnelStore {
  constructor({
    url,
    serviceRoleKey,
    table = "shopping_candidate_funnel_diagnostics",
    fetchImpl = fetch,
    logger = console,
  } = {}) {
    this.url = normalizeSupabaseUrl(url);
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.table = table;
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  get configured() {
    return Boolean(this.url && this.serviceRoleKey);
  }

  async persist(result) {
    if (!this.configured || !result?.request_id) return false;
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    const diagnostic = buildCandidateFunnelDiagnostic(result);
    try {
      const response = await this.fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          "content-type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(diagnostic),
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), {
        code: `SUPABASE_HTTP_${response.status}`,
      });
      return true;
    } catch (error) {
      const safe = getSupabaseErrorDetails(error, endpoint.hostname);
      this.logger.warn?.("shopping_candidate_funnel_persistence_failed", {
        request_id: diagnostic.request_id,
        error_code: error?.code || safe.code || "PERSISTENCE_FAILED",
      });
      return false;
    }
  }
}

function buildCandidateFunnelDiagnostic(result) {
  const slots = Array.isArray(result?.slot_metrics) ? result.slot_metrics : [];
  return {
    request_id: String(result?.request_id || ""),
    state: String(result?.state || "unknown"),
    first_failure_stage: result?.first_failure_stage || null,
    slots: slots.map((slot) => ({
      slot_key: slot.slot_key,
      category: slot.category,
      raw_candidate_count: Number(slot.raw_candidate_count || 0),
      valid_candidate_count: Number(slot.valid_candidate_count || 0),
      candidate_gate_pass: Number(slot.candidate_gate_pass || 0),
      candidate_gate_unknown: Number(slot.candidate_gate_unknown || 0),
      candidate_gate_fail: Number(slot.candidate_gate_fail || 0),
      selector_ai_input_count: Number(slot.selector_ai_input_count || 0),
      selector_keep: Number(slot.selector_keep || 0),
      selector_reject: Number(slot.selector_reject || 0),
      selector_uncertain: Number(slot.selector_uncertain || 0),
      selector_fallback_used: slot.selector_fallback_used === true,
      final_candidate_count: Array.isArray(slot.final_candidate_pool)
        ? slot.final_candidate_pool.length : 0,
      refinement_attempted: slot.refinement_attempted === true,
      refinement_succeeded: slot.refinement_succeeded === true,
    })),
    final_look_count: Number(result?.final_look_count || 0),
    ai_call_count: Number(result?.ai_call_count || 0),
    taobao_call_count: Number(result?.taobao_call_count || 0),
    duration_ms: Number(result?.timings?.total_ms || 0),
  };
}

module.exports = {buildCandidateFunnelDiagnostic, ShoppingCandidateFunnelStore};
