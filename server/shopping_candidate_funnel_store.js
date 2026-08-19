"use strict";

const {getSupabaseErrorDetails, normalizeSupabaseUrl} = require("./supabase_network");

const DIAGNOSTIC_TRACE_VERSION = 2;
const DEFAULT_RETENTION_LIMIT = 20;
const SENSITIVE_KEY = /(?:api.?key|app.?secret|secret|token|cookie|authorization|credential|password|email|phone|photo|purchase.?url|affiliate.?url|click.?url)/i;

class ShoppingCandidateFunnelStore {
  constructor({url, serviceRoleKey, table = "shopping_candidate_funnel_diagnostics",
    enabled = false, retentionLimit = DEFAULT_RETENTION_LIMIT,
    fetchImpl = fetch, logger = console} = {}) {
    this.url = normalizeSupabaseUrl(url);
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.table = table;
    this.enabled = enabled === true;
    this.retentionLimit = Math.max(1, Number(retentionLimit || DEFAULT_RETENTION_LIMIT));
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  get configured() { return Boolean(this.url && this.serviceRoleKey); }
  get writable() { return this.enabled && this.configured; }

  async persist(result) {
    if (!this.writable || !result?.request_id) return false;
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    const diagnostic = buildCandidateFunnelDiagnostic(result);
    try {
      const response = await this.fetch(endpoint, {
        method: "POST",
        headers: {...this.#headers(), "content-type": "application/json",
          Prefer: "return=minimal"},
        body: JSON.stringify(diagnostic),
      });
      if (!response.ok) throw httpError(response.status);
      await this.#trim().catch((error) => this.#warn(
        "shopping_candidate_funnel_retention_failed", diagnostic.request_id, error,
      ));
      return true;
    } catch (error) {
      this.#warn("shopping_candidate_funnel_persistence_failed", diagnostic.request_id, error);
      return false;
    }
  }

  async latest() { return this.#read({latest: true}); }

  async readByRequestId(requestId) {
    const normalized = String(requestId || "").trim();
    return normalized ? this.#read({requestId: normalized}) : null;
  }

  async #read({requestId}) {
    if (!this.writable) return null;
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    endpoint.searchParams.set("select",
      "request_id,state,first_failure_stage,trace_version,trace,created_at");
    if (requestId) endpoint.searchParams.set("request_id", `eq.${requestId}`);
    endpoint.searchParams.set("order", "created_at.desc");
    endpoint.searchParams.set("limit", "1");
    const response = await this.fetch(endpoint, {headers: this.#headers()});
    if (!response.ok) throw httpError(response.status);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return sanitizeDiagnosticTrace(rows[0].trace || {
      trace_version: rows[0].trace_version || 1,
      request_id: rows[0].request_id,
      state: rows[0].state,
      first_failure_stage: rows[0].first_failure_stage,
      slots: [], composer: {looks: []},
    });
  }

  async #trim() {
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("order", "created_at.desc");
    endpoint.searchParams.set("offset", String(this.retentionLimit));
    endpoint.searchParams.set("limit", "100");
    const response = await this.fetch(endpoint, {headers: this.#headers()});
    if (!response.ok) throw httpError(response.status);
    const rows = await response.json();
    const ids = (Array.isArray(rows) ? rows : []).map((row) => String(row?.id || ""))
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (ids.length === 0) return;
    const deletion = new URL(`${this.url}/rest/v1/${this.table}`);
    deletion.searchParams.set("id", `in.(${ids.join(",")})`);
    const deleted = await this.fetch(deletion, {
      method: "DELETE", headers: {...this.#headers(), Prefer: "return=minimal"},
    });
    if (!deleted.ok) throw httpError(deleted.status);
  }

  #headers() {
    return {apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`, accept: "application/json"};
  }

  #warn(event, requestId, error) {
    const safe = this.url ? getSupabaseErrorDetails(error, new URL(this.url).hostname) : {};
    this.logger.warn?.(event, {request_id: requestId,
      error_code: error?.code || safe.code || "PERSISTENCE_FAILED"});
  }
}

function buildCandidateFunnelDiagnostic(result) {
  const trace = buildShoppingAgentDiagnosticTrace(result);
  const slots = Array.isArray(result?.slot_metrics) ? result.slot_metrics : [];
  return {
    request_id: trace.request_id, state: trace.state,
    first_failure_stage: trace.first_failure_stage,
    slots: slots.map((slot) => ({
      slot_key: slot.slot_key, category: slot.category,
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
    trace_version: DIAGNOSTIC_TRACE_VERSION, trace,
  };
}

function buildShoppingAgentDiagnosticTrace(result) {
  const source = result?.diagnostic_source || {};
  const intent = source.shopping_intent || result?.shopping_intent || {};
  const selections = Array.isArray(source.selections) ? source.selections : [];
  const metrics = Array.isArray(result?.slot_metrics) ? result.slot_metrics : [];
  const slots = (Array.isArray(intent?.slots) ? intent.slots : []).map((slot) =>
    buildSlotTrace(slot,
      selections.find((item) => item?.slot?.category === slot.category),
      metrics.find((item) => item?.category === slot.category)));
  const validated = source.validated_looks || {};
  const looks = Array.isArray(validated.looks) ? validated.looks
    : Array.isArray(result?.looks) ? result.looks : [];
  return sanitizeDiagnosticTrace({
    trace_version: DIAGNOSTIC_TRACE_VERSION,
    request_id: String(result?.request_id || ""),
    state: String(result?.state || "unknown"),
    first_failure_stage: result?.first_failure_stage || null,
    authoritative_gender: result?.authoritative_gender || intent?.gender || null,
    shopping_intent: sanitizeShoppingIntent(intent), slots,
    composer: {
      looks: looks.map((look) => ({
        look_id: look?.look_id || null,
        top_candidate_id: look?.candidate_ids?.top || look?.top_candidate_id || null,
        bottom_candidate_id: look?.candidate_ids?.bottom || look?.bottom_candidate_id || null,
        shoes_candidate_id: look?.candidate_ids?.shoes || look?.shoes_candidate_id || null,
        scores: look?.scores || {},
        structural_diversity_status: look?.structural_diversity_status || null,
        female_expression_status: look?.female_expression_status || null,
        female_expression_evidence: look?.female_expression_evidence || [],
        shoe_taxonomy_rank: look?.shoe_taxonomy_rank || null,
      })),
      candidate_reference_audit: validated.candidate_reference_audit ||
        result?.candidate_reference_audit || [],
      look_diversity_status: validated.look_diversity_status ||
        result?.look_diversity_status || null,
      structural_duplicate_detected: validated.structural_duplicate_detected === true ||
        result?.structural_duplicate_detected === true,
      exact_duplicate_detected: validated.exact_duplicate_detected === true ||
        result?.exact_duplicate_detected === true,
      diversity_insufficient: validated.diversity_insufficient === true ||
        result?.diversity_insufficient === true,
    },
    timings: result?.timings || {}, ai_call_count: Number(result?.ai_call_count || 0),
    taobao_call_count: Number(result?.taobao_call_count || 0),
  });
}

function buildSlotTrace(slot, selection, metric = {}) {
  const rounds = diagnosticRounds(selection);
  const gateDecisions = rounds.flatMap((round) =>
    (Array.isArray(round?.diagnostic_gate_assessments)
      ? round.diagnostic_gate_assessments : []).map((assessment) => ({
      round: Number(round?.round || 1), query: round?.query || slot?.search_query || "",
      candidate: diagnosticCandidate(assessment?.product, assessment?.candidate_id),
      status: assessment?.gate?.status || null,
      reason_codes: assessment?.gate?.reason_codes || [],
    })));
  const candidates = Array.isArray(selection?.candidates)
    ? selection.candidates.map((item) => diagnosticCandidate(item)) : [];
  const candidatesById = new Map(candidates.map((item) => [item.candidate_id, item]));
  const assessments = Array.isArray(selection?.assessments)
    ? selection.assessments.map((item) => ({
      candidate_id: item?.candidate_id || null, status: item?.status || null,
      selection_tier: item?.selection_tier || null, scores: item?.scores || {},
      reason_codes: item?.reason_codes || [],
      candidate: candidatesById.get(item?.candidate_id) || null,
    })) : [];
  return {
    slot_key: selection?.slot_key || metric?.slot_key || null,
    category: slot?.category || metric?.category || null,
    search: {
      query: selection?.query || metric?.query || slot?.search_query || "",
      original_query: metric?.original_query || slot?.original_search_query || null,
      broadened_query: metric?.broadened_query || null,
      structured_intent: {role: slot?.role || "",
        hard_constraints: slot?.hard_constraints || [],
        soft_preferences: slot?.soft_preferences || [], avoid: slot?.avoid || []},
      silhouette_requirements: slot?.silhouette || slot?.silhouette_requirements || [],
      aesthetic_requirements: slot?.aesthetic || slot?.aesthetic_requirements ||
        slot?.soft_preferences || [],
    },
    recall: {
      raw_candidate_count: Number(metric?.raw_candidate_count || selection?.raw_count || 0),
      valid_candidate_count: Number(metric?.valid_candidate_count || selection?.valid_count || 0),
      rounds: rounds.map((round) => ({round: Number(round?.round || 1),
        query: round?.query || slot?.search_query || "",
        raw_candidate_count: Number(round?.raw_count || 0),
        valid_candidate_count: Number(round?.valid_count || 0),
        candidates: (Array.isArray(round?.candidates) ? round.candidates : [])
          .map((item) => diagnosticCandidate(item))})),
      candidates,
    },
    candidate_gate: {
      pass_count: Number(metric?.candidate_gate_pass || selection?.candidate_gate_pass || 0),
      fail_count: Number(metric?.candidate_gate_fail || selection?.candidate_gate_fail || 0),
      decisions: gateDecisions,
    },
    selector: {
      status: selection?.selector_status || metric?.selector_status || null,
      ai_status: selection?.selector_ai_status || metric?.selector_ai_status || null,
      ai_input_candidate_ids: selection?.selector_ai_candidate_ids || [],
      keep_count: Number(selection?.selector_keep || metric?.selector_keep || 0),
      reject_count: Number(selection?.selector_reject || metric?.selector_reject || 0),
      uncertain_count: Number(selection?.selector_uncertain || metric?.selector_uncertain || 0),
      fallback_used: selection?.selector_fallback_used === true ||
        metric?.selector_fallback_used === true, assessments,
    },
    final_pool: (Array.isArray(selection?.final_candidate_pool)
      ? selection.final_candidate_pool : []).map((item) => diagnosticCandidate(item)),
    refinement: selection?.refinement || metric?.refinement || null,
  };
}

function diagnosticRounds(selection) {
  if (!selection) return [];
  if (Array.isArray(selection.diagnostic_rounds)) return selection.diagnostic_rounds;
  return [...(selection.first_round_retrieval ? [selection.first_round_retrieval] : []),
    selection];
}

function diagnosticCandidate(candidate, candidateId) {
  const product = candidate && typeof candidate === "object" ? candidate : {};
  return {
    candidate_id: candidateId || product.candidate_id || product.product_id || null,
    title: product.title || "", price: Number(product.price || 0),
    brand: product.brand || "", category: product.category || null,
    image_url: sanitizeImageUrl(product.image_url || product.image),
    taxonomy: product.taxonomy || product.product_family || null,
    aesthetic_tags: product.aesthetic_tags || product.style_tags || [],
    silhouette_tags: product.silhouette_tags || product.silhouette || [],
    detail_tags: product.detail_tags || product.details || [],
    variation_axes: product.variation_axes || null,
    selector_status: product.selector_status || null,
    selection_tier: product.selection_tier || null,
    selector_quality_score: product.selector_quality_score ?? null,
    selector_scores: product.selector_scores || {},
    selector_reason_codes: product.selector_reason_codes || [],
    candidate_gate_status: product.candidate_gate_status || null,
    candidate_gate_reasons: product.candidate_gate_reasons || [],
    value_reasonableness: product.value_reasonableness ?? null,
    value_reason_codes: product.value_reason_codes || [],
  };
}

function sanitizeShoppingIntent(intent) {
  return {gender: intent?.gender || null, persona: intent?.persona || {},
    overall_aesthetic: intent?.overall_aesthetic || {},
    body_strategy: intent?.body_strategy || {}, occasion: intent?.occasion || {},
    budget: intent?.budget || {}};
}

function sanitizeDiagnosticTrace(trace) { return sanitizeValue(trace, ""); }

function sanitizeValue(value, key) {
  if (SENSITIVE_KEY.test(key) && key !== "image_url") return undefined;
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return key === "image_url" ? sanitizeImageUrl(value) : redactPersonalText(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key))
    .filter((item) => item !== undefined);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value)
    .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)])
    .filter(([, childValue]) => childValue !== undefined));
  return undefined;
}

function sanitizeImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch (_) { return ""; }
}

function redactPersonalText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]");
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), {code: `SUPABASE_HTTP_${status}`});
}

module.exports = {DEFAULT_RETENTION_LIMIT, DIAGNOSTIC_TRACE_VERSION,
  ShoppingCandidateFunnelStore, buildCandidateFunnelDiagnostic,
  buildShoppingAgentDiagnosticTrace, sanitizeDiagnosticTrace};
