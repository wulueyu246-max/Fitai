"use strict";

const {
  LookConceptCompileError,
  compileLookConceptPortfolio,
} = require("./look_concept_compiler");
const {ProductProviderError} = require("./product_provider");
const {canonicalProductIdentity} = require("./product_acceptance_gate");
const {
  LOOK_STYLING_COMPLETION_VERSION,
  completePortfolioStyling,
} = require("./look_styling_completion");

const NEW_DECISION_PIPELINE_VERSION = "new_decision_pipeline.v1";
const FINAL_PORTFOLIO_VALIDATOR_VERSION = "final_portfolio_validator.v1";

class NewDecisionPipelineError extends Error {
  constructor(message, {
    code = "NEW_DECISION_PIPELINE_FAILED",
    stage = "UNKNOWN",
    cause,
    details,
    fallbackAllowed = true,
  } = {}) {
    super(message, {cause});
    this.name = "NewDecisionPipelineError";
    this.code = code;
    this.stage = stage;
    this.fallbackAllowed = fallbackAllowed;
    if (details) this.details = details;
  }
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function productId(product = {}) {
  return String(
    product.candidate_id || product.product_id || product.id || "",
  ).trim();
}

function productIdentity(product = {}) {
  return String(
    product.canonical_product_identity || canonicalProductIdentity(product),
  ).trim();
}

const PUBLIC_PRODUCT_FIELDS = Object.freeze([
  "id", "product_id", "candidate_id", "title", "name", "brand",
  "brand_name", "shop_name", "category", "original_category",
  "subcategory", "search_subcategory", "slot", "look_id", "concept_id",
  "gender", "original_gender", "requested_gender", "price",
  "original_price", "currency", "image_url", "detail_url", "purchase_url",
  "source", "platform", "is_mock", "color", "color_label", "material",
  "style", "style_tags", "occasion_tags", "silhouette", "fit",
  "footwear", "quality", "quality_tier", "raw_product_ref",
  "candidate_enrichment", "relevance_score", "candidate_gate_result",
  "candidate_gate_reason", "aesthetic_score", "aesthetic_score_breakdown",
  "style_fit_score", "occasion_fit_score", "color_fit_score",
  "silhouette_fit_score", "footwear_fit_score", "quality_fit_score",
  "gender_fit_score", "style_match_score", "fit_score",
  "body_strategy_match_score", "body_strategy_configured",
  "market_soft_match_score", "market_adjustment", "final_score",
  "outfit_strategy_score", "outfit_strategy_breakdown",
  "outfit_target_profile_match_score", "search_keyword",
  "canonical_product_identity", "product_acceptance_result",
  "product_acceptance_penalty", "product_acceptance_evidence",
  "product_acceptance_trace", "ai_rerank_fallback_reason",
  "outfit_product_acceptance_penalty",
  "whole_look_quality_status", "whole_look_quality",
  "styling_slot", "styling_completion_slot",
  "styling_completion_selected", "styling_completion_score_delta",
  "styling_completion_version",
]);

function publicUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:token|sign|secret|pid|app[_-]?key|session|authorization|cookie)/iu
        .test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch (_) {
    return "";
  }
}

function publicProductForResponse(product = {}) {
  const result = {};
  for (const key of PUBLIC_PRODUCT_FIELDS) {
    if (!Object.hasOwn(product, key) || typeof product[key] === "undefined") {
      continue;
    }
    result[key] = product[key];
  }
  for (const key of ["image_url", "detail_url", "purchase_url"]) {
    if (Object.hasOwn(result, key)) result[key] = publicUrl(result[key]);
  }
  return Object.freeze(result);
}

function publicLookForResponse(look = {}) {
  const selectedProducts = Object.freeze(
    (look.selected_products || []).map(publicProductForResponse),
  );
  return Object.freeze({
    ...look,
    selected_products: selectedProducts,
    selected_candidate_ids: Object.freeze(selectedProducts.map(productId)),
  });
}

function productEvidence(product = {}) {
  return [
    product.title,
    product.name,
    product.category,
    product.subcategory,
    product.product_type,
    product.style,
    product.style_tags,
    product.occasion_tags,
    product.material,
    product.tags,
  ].flat(Infinity).filter(Boolean).join(" ").toLowerCase();
}

function budgetCeiling(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/gu) || [];
  return numbers.length > 0 ? Math.max(...numbers.map(Number)) : 0;
}

function violatesAvoid(product, avoid) {
  const evidence = productEvidence(product);
  const normalized = String(avoid || "").trim().toLowerCase();
  if (!normalized) return false;
  if (/(?:leather_shoes|\u76ae\u978b|leather\s*(?:dress\s*)?shoes?)/iu.test(normalized)) {
    return product.category === "shoes" &&
      /(?:\u76ae\u978b|\u76ae\u9769|(?:^|[^a-z_])leather(?:$|[^a-z_])|oxford|derby|loafer|\u4e50\u798f)/iu
        .test(evidence);
  }
  return evidence.includes(normalized.replace(/_/gu, " ")) ||
    evidence.includes(normalized);
}

function finalLookForContract(contract, products) {
  const selected = products.filter((product) => product.look_id === contract.look_id);
  const byCategory = new Map(selected.map((product) => [product.category, product]));
  return Object.freeze({
    look_id: contract.look_id,
    concept_id: contract.concept_id,
    gender: contract.gender,
    scene: contract.scene,
    style: contract.style,
    style_direction: contract.style_direction,
    styling_goal: contract.styling_goal,
    proportion_strategy: contract.proportion_strategy,
    items: Object.freeze(contract.items.map((requirement) => Object.freeze({
      ...requirement,
      selected_candidate_id: productId(byCategory.get(requirement.category)),
    }))),
    selected_products: Object.freeze(selected),
    selected_candidate_ids: Object.freeze(selected.map(productId)),
    outfit_strategy_score: selected.length > 0
      ? Number(selected[0].outfit_strategy_score || 0) : 0,
    outfit_strategy_breakdown: selected[0]?.outfit_strategy_breakdown || null,
  });
}

function wholeLookQualityPasses(contract, look) {
  const requiredCategories = new Set((contract?.items || []).map((item) =>
    String(item?.category || "")));
  const coreProducts = (look?.selected_products || []).filter((product) =>
    requiredCategories.has(String(product?.category || "")));
  if (coreProducts.length === 0) return false;
  return coreProducts.every((product) =>
    product?.whole_look_quality_status === "PASS" &&
    product?.whole_look_quality?.status === "PASS");
}

function validateFinalPortfolio({decisionContext, compiled, products} = {}) {
  const errors = [];
  const warnings = [];
  const requestedLookCount = compiled.looks.length;
  const candidateLooks = compiled.looks.map((contract) => ({
    contract,
    look: finalLookForContract(contract, products),
  })).filter(({contract, look}) => contract.items.every((requirement) =>
    look.items.some((item) =>
      item.category === requirement.category && item.selected_candidate_id)) &&
      wholeLookQualityPasses(contract, look))
    .map(({look}) => look);
  const looks = candidateLooks;
  const returnedLookIds = new Set(looks.map((look) => look.look_id));
  const unfulfilledLookIds = compiled.looks
    .map((look) => look.look_id)
    .filter((lookId) => !returnedLookIds.has(lookId));
  if (unfulfilledLookIds.length > 0) {
    warnings.push(
      `INSUFFICIENT_QUALITY_LOOKS:${unfulfilledLookIds.join(",")}`,
    );
  }
  const explicitStyle = String(
    decisionContext?.intent?.user_intent_brain?.explicit_style?.value || "",
  ).trim().toLowerCase();
  const explicitAvoid = unique([
    decisionContext?.intent?.user_intent_brain?.explicit_avoid?.value,
    decisionContext?.user_truth?.explicit_avoid,
  ]);
  const itemBudget = budgetCeiling(decisionContext?.user_truth?.budget?.item);
  const outfitBudget = budgetCeiling(decisionContext?.user_truth?.budget?.outfit);
  const allIds = [];
  const allProductIdentities = [];

  if (looks.length < 1 || looks.length > 4) errors.push("LOOK_COUNT_OUT_OF_RANGE");
  for (const look of looks) {
    const categories = new Set(look.selected_products.map((product) => product.category));
    for (const required of ["top", "bottom", "shoes"]) {
      if (!categories.has(required)) {
        errors.push(`CORE_SLOT_MISSING:${look.look_id}:${required}`);
      }
    }
    const ids = look.selected_candidate_ids.filter(Boolean);
    if (ids.length !== look.selected_products.length) {
      errors.push(`CANDIDATE_ID_MISSING:${look.look_id}`);
    }
    if (new Set(ids).size !== ids.length) {
      errors.push(`INTRA_LOOK_PRODUCT_DUPLICATE:${look.look_id}`);
    }
    allIds.push(...ids);
    const identities = look.selected_products.map(productIdentity).filter(Boolean);
    if (new Set(identities).size !== identities.length) {
      errors.push(`INTRA_LOOK_UNDERLYING_PRODUCT_DUPLICATE:${look.look_id}`);
    }
    allProductIdentities.push(...identities);
    const contract = compiled.looks.find((item) => item.look_id === look.look_id);
    if (explicitStyle && String(contract?.style || "").toLowerCase() !== explicitStyle) {
      errors.push(`STYLE_LOCK_DRIFT:${look.look_id}`);
    }
    if (explicitStyle && !look.selected_products.some((product) =>
      Number.isFinite(Number(product.outfit_target_profile_match_score)))) {
      errors.push(`STYLE_LOCK_SIGNAL_MISSING:${look.look_id}`);
    }
    for (const product of look.selected_products) {
      if (product.product_acceptance_result === "HARD_REJECT") {
        errors.push(
          `PRODUCT_ACCEPTANCE_REJECTED:${look.look_id}:${productId(product)}`,
        );
      }
      if (explicitAvoid.some((avoid) => violatesAvoid(product, avoid))) {
        errors.push(`USER_AVOID_CONFLICT:${look.look_id}:${productId(product)}`);
      }
      if (itemBudget > 0 && (!Number.isFinite(Number(product.price)) ||
          Number(product.price) > itemBudget)) {
        errors.push(`ITEM_BUDGET_CONFLICT:${look.look_id}:${productId(product)}`);
      }
      if (!Number.isFinite(Number(product.body_strategy_match_score))) {
        errors.push(`BODY_FIT_SIGNAL_NOT_CONSUMED:${look.look_id}:${productId(product)}`);
      }
      if (!Number.isFinite(Number(product.market_soft_match_score))) {
        warnings.push(`MARKET_SIGNAL_NOT_APPLICABLE:${look.look_id}:${productId(product)}`);
      }
    }
    if (outfitBudget > 0) {
      const prices = look.selected_products.map((product) => Number(product.price));
      if (prices.some((price) => !Number.isFinite(price)) ||
          prices.reduce((sum, price) => sum + price, 0) > outfitBudget) {
        errors.push(`OUTFIT_BUDGET_CONFLICT:${look.look_id}`);
      }
    }
    const occasionScores = look.selected_products.map((product) =>
      Number(product.outfit_occasion_formality_score));
    if (!occasionScores.some(Number.isFinite)) {
      errors.push(`SCENE_FIT_SIGNAL_MISSING:${look.look_id}`);
    }
  }

  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    errors.push(`CROSS_LOOK_PRODUCT_DUPLICATE:${unique(duplicates).join(",")}`);
  }
  const underlyingDuplicates = allProductIdentities.filter((identity, index) =>
    allProductIdentities.indexOf(identity) !== index);
  if (underlyingDuplicates.length > 0) {
    errors.push(
      `CROSS_LOOK_UNDERLYING_PRODUCT_DUPLICATE:${unique(underlyingDuplicates).join(",")}`,
    );
  }
  const conceptIds = looks.map((look) => look.concept_id);
  if (new Set(conceptIds).size !== looks.length ||
      decisionContext?.concept_diversity?.status !== "PASS") {
    errors.push("CONCEPT_DIVERSITY_FAILED");
  }

  return Object.freeze({
    version: FINAL_PORTFOLIO_VALIDATOR_VERSION,
    status: errors.length === 0 ? "PASS" : "FAIL",
    fulfillment_status: errors.length === 0 && looks.length < requestedLookCount
      ? "PARTIAL" : errors.length === 0 ? "COMPLETE" : "FAILED",
    fulfillment_reason: errors.length === 0 && looks.length < requestedLookCount
      ? "INSUFFICIENT_QUALITY_LOOKS" : null,
    requested_look_count: requestedLookCount,
    quality_valid_look_count: looks.length,
    unfulfilled_look_ids: Object.freeze(unfulfilledLookIds),
    checks: Object.freeze({
      concept_uniqueness: new Set(conceptIds).size === looks.length,
      product_uniqueness:
        duplicates.length === 0 && underlyingDuplicates.length === 0,
      style_lock: !errors.some((error) => error.startsWith("STYLE_LOCK_DRIFT")),
      avoid_compliance: !errors.some((error) => error.startsWith("USER_AVOID")),
      scene_fit: !errors.some((error) => error.startsWith("SCENE_FIT")),
      body_compatibility: !errors.some((error) => error.startsWith("BODY_FIT")),
      budget_compliance: !errors.some((error) => error.includes("BUDGET")),
      concept_diversity: decisionContext?.concept_diversity?.status === "PASS",
    }),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    looks: Object.freeze(looks),
  });
}

function providerContext(decisionContext, compiled) {
  const truth = decisionContext.user_truth || {};
  const body = decisionContext.body_fit_profile || {};
  const explicitStyle = String(
    decisionContext?.intent?.user_intent_brain?.explicit_style?.value || "",
  ).trim();
  return {
    requestId: decisionContext.request_id,
    request_id: decisionContext.request_id,
    decision_context_id: decisionContext.decision_context_id,
    decision_context: decisionContext,
    decision_pipeline: NEW_DECISION_PIPELINE_VERSION,
    body_fit_soft_only: true,
    market_soft_only: true,
    gender: truth.gender,
    scene: truth.scene,
    style: explicitStyle,
    item_budget: budgetCeiling(truth.budget?.item) || undefined,
    outfit_budget: budgetCeiling(truth.budget?.outfit) || undefined,
    user_profile: {
      gender: truth.gender,
      height: decisionContext.body?.height?.value,
      weight: decisionContext.body?.weight?.value,
      structured_measurements: decisionContext.body?.structured_measurements || {},
      body_fit_profile: body,
    },
    user_requirements: {
      gender: truth.gender,
      scene: truth.scene,
      style: explicitStyle,
      explicit_requirements: truth.explicit_requirements || [],
      explicit_avoid: truth.explicit_avoid || [],
      explicit_preferences: truth.explicit_preferences || [],
      body_fit_profile: body,
      market: decisionContext.market,
    },
    outfit_plan: {
      looks: compiled.looks,
      source: NEW_DECISION_PIPELINE_VERSION,
    },
  };
}

function publicCompletionForLook(result = {}) {
  const diagnosis = result.diagnosis || {};
  return Object.freeze({
    version: result.version || LOOK_STYLING_COMPLETION_VERSION,
    action: result.completion_action || "NONE",
    required_optional_slots: Object.freeze([
      ...(diagnosis.required_optional_slots || []),
    ]),
    recommended_optional_slots: Object.freeze([
      ...(diagnosis.recommended_optional_slots || []),
    ]),
    unnecessary_slots: Object.freeze([
      ...(diagnosis.unnecessary_slots || []),
    ]),
    diagnosis: diagnosis.dimensions || null,
    before_score: Number.isFinite(Number(result.before_score))
      ? Number(result.before_score) : null,
    after_score: Number.isFinite(Number(result.after_score))
      ? Number(result.after_score) : null,
    score_delta: Number.isFinite(Number(result.score_delta))
      ? Number(result.score_delta) : 0,
    selected_optional_candidate_ids: Object.freeze([
      ...(result.selected_optional_candidate_ids || []),
    ]),
    rejected_candidates: Object.freeze((result.rejected_candidates || []).map(
      (entry) => Object.freeze({
        candidate_id: String(entry?.candidate_id || ""),
        slot: String(entry?.slot || ""),
        reason: String(entry?.reason || "UNKNOWN"),
        score_delta: Number.isFinite(Number(entry?.score_delta))
          ? Number(entry.score_delta) : null,
      }),
    )),
    core_unchanged: result.core_unchanged !== false,
  });
}

function publicEvidenceValue(value) {
  if (["string", "number", "boolean"].includes(typeof value) || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, 20).map((entry) =>
      ["string", "number", "boolean"].includes(typeof entry)
        ? entry : String(entry ?? "").slice(0, 240)));
  }
  return String(value).slice(0, 240);
}

function publicEvidenceRecord(entry = {}) {
  if (!entry || typeof entry !== "object") return null;
  return Object.freeze({
    value: publicEvidenceValue(entry.value),
    applicability: ["APPLICABLE", "NOT_APPLICABLE", "UNKNOWN"].includes(
      entry.applicability,
    ) ? entry.applicability : "UNKNOWN",
    source: String(entry.source || "unknown").slice(0, 80),
    confidence: Number.isFinite(Number(entry.confidence))
      ? Number(entry.confidence) : 0,
    evidence: Object.freeze((entry.evidence || []).slice(0, 12).map((value) =>
      String(value ?? "").replace(/https?:\/\/\S+/giu, "[URL_REDACTED]")
        .slice(0, 240))),
  });
}

function publicAcceptanceEvidence(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  return Object.freeze(Object.fromEntries(Object.entries(evidence).map(
    ([dimension, entry]) => [dimension, publicEvidenceRecord(entry)],
  )));
}

function publicEnrichmentTaxonomy(enrichment = null) {
  if (!enrichment || typeof enrichment !== "object") return null;
  return Object.freeze({
    category: publicEvidenceRecord(
      enrichment.category_evidence || enrichment.normalized_category,
    ),
    subcategory: publicEvidenceRecord(enrichment.subcategory),
  });
}

function traceCandidateKey(entry = {}) {
  return [entry.look_id, entry.slot, entry.candidate_id].map((value) =>
    String(value || "")).join(":");
}

function acceptanceReasonCodes(entry = {}) {
  const trace = entry.product_acceptance_trace || {};
  const explicit = [
    ...(trace.hard_reasons || []),
    ...(trace.soft_reasons || []),
  ];
  if (explicit.length > 0) return [...new Set(explicit.map(String))];
  const evidence = entry.product_acceptance_evidence || {};
  return Object.entries(evidence).flatMap(([dimension, item]) =>
    ["mismatch", "severe_mismatch", "unsupported", "anomaly_risk", "low"]
      .includes(item?.value)
      ? [`${dimension.toUpperCase()}:${String(item.value).toUpperCase()}`] : []);
}

function publicCandidateTimeline(trace, {selectedIds = [], completionRejects = []} = {}) {
  const selected = new Set(selectedIds.map(String));
  const completionRejected = new Map(completionRejects.map((entry) => [
    String(entry?.candidate_id || ""),
    String(entry?.reason || "COMPLETION_REJECTED"),
  ]));
  const stages = [
    ["raw_candidates", "RAW"],
    ["relevance_pass", "RELEVANCE_PASS"],
    ["gate_reject", "GATE_REJECT"],
    ["gate_pass", "GATE_PASS"],
    ["reranker_keep", "RERANKER_KEEP"],
    ["strategy_selected", "STRATEGY_SELECTED"],
  ];
  const candidates = new Map();
  for (const [collection, stage] of stages) {
    for (const entry of trace?.[collection] || []) {
      const key = traceCandidateKey(entry);
      const current = candidates.get(key) || {entry, stages: new Set()};
      current.entry = entry;
      current.stages.add(stage);
      candidates.set(key, current);
    }
  }
  return Object.freeze([...candidates.values()].map(({entry, stages: seen}) => {
    const id = String(entry.candidate_id || "");
    const relevancePass = seen.has("RELEVANCE_PASS");
    const gatePass = seen.has("GATE_PASS");
    const gateReject = seen.has("GATE_REJECT");
    const completionReason = completionRejected.get(id);
    const finalDisposition = selected.has(id) ? "SELECTED_OPTIONAL"
      : completionReason ? `COMPLETION_REJECTED:${completionReason}`
        : seen.has("STRATEGY_SELECTED") ? "STRATEGY_SELECTED"
          : seen.has("RERANKER_KEEP") ? "RERANKER_KEEP_NOT_SELECTED"
            : gateReject ? "GATE_REJECTED"
              : gatePass ? "GATE_PASS_NOT_SELECTED"
                : relevancePass ? "RELEVANCE_ONLY" : "RELEVANCE_REJECTED";
    return Object.freeze({
      look_id: String(entry.look_id || ""),
      slot: String(entry.slot || ""),
      candidate_id: id,
      title: String(entry.title || "").slice(0, 240),
      price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : null,
      brand: String(entry.brand || "").slice(0, 120),
      category: String(entry.category || ""),
      taxonomy: publicEnrichmentTaxonomy(entry.candidate_enrichment),
      source: String(entry.source || "unknown"),
      query: String(entry.search_keyword || "").slice(0, 240),
      commerce_queries: Object.freeze([...(entry.commerce_queries || [])]
        .map((value) => String(value).slice(0, 240))),
      relevance_result: relevancePass ? "PASS" : "REJECT",
      relevance_score: Number.isFinite(Number(entry.relevance_score))
        ? Number(entry.relevance_score) : null,
      // Candidate Gate stage and Product Acceptance are separate decisions.
      // A candidate may pass Acceptance yet fail another upstream hard
      // constraint, so never expose the Acceptance result as the Gate result.
      gate_result: gatePass ? "PASS" : gateReject ? "REJECT" : "NOT_EVALUATED",
      gate_reasons: Object.freeze([...new Set([
        entry.reason,
        ...acceptanceReasonCodes(entry),
      ].filter(Boolean).map(String))]),
      acceptance_result: entry.product_acceptance_result || null,
      acceptance_penalty: Number.isFinite(Number(entry.product_acceptance_penalty))
        ? Number(entry.product_acceptance_penalty) : null,
      applicability: publicAcceptanceEvidence(entry.product_acceptance_evidence),
      stages: Object.freeze([...seen]),
      final_disposition: finalDisposition,
    });
  }));
}

function publicCandidatePipelineSummary(trace = null, completion = {}) {
  if (!trace || typeof trace !== "object") return null;
  const count = (key) => Array.isArray(trace[key]) ? trace[key].length : 0;
  return Object.freeze({
    request_id: trace.request_id || null,
    provider: trace.provider || null,
    relevance_executed: trace.relevance_executed === true,
    reranker_executed: trace.reranker_executed === true,
    strategy_executed: trace.strategy_executed === true,
    reranker_status: trace.reranker_status || null,
    raw_candidate_count: count("raw_candidates"),
    relevance_pass_count: count("relevance_pass"),
    gate_pass_count: count("gate_pass"),
    gate_reject_count: count("gate_reject"),
    reranker_keep_count: count("reranker_keep"),
    candidate_complete_looks: Number(trace.candidate_complete_looks || 0),
    whole_look_quality_valid_looks: Number(
      trace.whole_look_quality_valid_looks || 0,
    ),
    rejected: Object.freeze([...(trace.rejected || [])]),
    whole_look_ai_adjudication: Object.freeze([
      ...(trace.whole_look_ai_adjudication || []),
    ]),
    candidates: publicCandidateTimeline(trace, completion),
    query_plans: Object.freeze((trace.query_plans || []).map((entry) =>
      Object.freeze({
        look_id: entry.look_id,
        concept_id: entry.concept_id,
        slot: entry.slot,
        query_plan_version: entry.query_plan_version,
        commerce_queries: Object.freeze([...(entry.commerce_queries || [])]),
      }))),
  });
}

function publicStylingCompletionTrace(trace = null) {
  if (!trace || typeof trace !== "object") return null;
  const completionRejects = (trace.results || []).flatMap((result) =>
    result.rejected_candidates || []);
  return Object.freeze({
    version: LOOK_STYLING_COMPLETION_VERSION,
    status: trace.status || "NONE",
    required_optional_slots: Object.freeze([
      ...(trace.required_optional_slots || []),
    ]),
    recommended_optional_slots: Object.freeze([
      ...(trace.recommended_optional_slots || []),
    ]),
    optional_retrieval_attempted: trace.optional_retrieval_attempted === true,
    optional_retrieval_provider: trace.optional_retrieval_provider || "NONE",
    optional_candidate_count: Number(trace.optional_candidate_count || 0),
    selected_optional_count: Number(trace.selected_optional_count || 0),
    selected_optional_candidate_ids: Object.freeze([
      ...(trace.selected_optional_candidate_ids || []),
    ]),
    core_unchanged: trace.core_unchanged !== false,
    validation_errors: Object.freeze([...(trace.validation_errors || [])]),
    requirements: Object.freeze((trace.requirements || []).map((requirement) =>
      Object.freeze({
        look_id: requirement.look_id,
        concept_id: requirement.concept_id,
        category: requirement.category,
        search_subcategory: requirement.search_subcategory,
        styling_completion_slot: requirement.styling_completion_slot,
        styling_completion_parent_look_id:
          requirement.styling_completion_parent_look_id,
        styling_completion_required:
          requirement.styling_completion_required === true,
        styling_completion_recommended:
          requirement.styling_completion_recommended === true,
        query_plan_version: requirement.query_plan_version,
        search_keywords: Object.freeze([...(requirement.search_keywords || [])]),
      }))),
    optional_candidate_pipeline_trace: publicCandidatePipelineSummary(
      trace.optional_candidate_pipeline_trace,
      {
        selectedIds: trace.selected_optional_candidate_ids || [],
        completionRejects,
      },
    ),
    results: Object.freeze((trace.results || []).map(publicCompletionForLook)),
  });
}

function buildResponse({
  decisionContext,
  compiled,
  validation,
  products,
  trace,
  stylingCompletion,
}) {
  const brain = decisionContext.intent?.user_intent_brain || {};
  const style = String(brain.explicit_style?.value || "").trim();
  const bodySummary = String(
    decisionContext.body_fit_profile?.trace?.accepted_body_facts
      ? "BodyFit soft production signals applied"
      : "BodyFit context available",
  );
  const acceptedLookIds = new Set(validation.looks.map((look) => look.look_id));
  const acceptedProducts = products.filter((product) =>
    acceptedLookIds.has(product.look_id)).map(publicProductForResponse);
  const acceptedRequirements = compiled.requirements.filter((requirement) =>
    acceptedLookIds.has(requirement.look_id));
  const completionByLook = new Map(
    (stylingCompletion?.results || []).map((result) => [result.look_id, result]),
  );
  const publicLooks = Object.freeze(validation.looks.map((look) =>
    publicLookForResponse({
      ...look,
      styling_completion: publicCompletionForLook(
        completionByLook.get(look.look_id) || {},
      ),
    })));
  const publicValidation = Object.freeze({
    ...validation,
    looks: publicLooks,
  });
  const publicStylingCompletion = publicStylingCompletionTrace(stylingCompletion);
  return Object.freeze({
    request_id: decisionContext.request_id,
    decision_context_id: decisionContext.decision_context_id,
    decision_context: decisionContext,
    gender: decisionContext.user_truth?.gender,
    bodyProfile: bodySummary,
    style,
    style_expression: style ? "explicit" : "adaptive",
    analysisMode: NEW_DECISION_PIPELINE_VERSION,
    decision_pipeline: Object.freeze({
      version: NEW_DECISION_PIPELINE_VERSION,
      mode: "PRIMARY",
      fallback_used: false,
      fallback_reason: null,
      legacy_blueprint_calls: 0,
      production_roles: Object.freeze({
        decision_context: "AUTHORITATIVE_INPUT",
        user_intent_brain: "PRODUCTION",
        body_fit_intelligence: "SOFT_PRODUCTION_SIGNAL",
        look_concept_generator: "PRODUCTION",
        market_fashion_brain: "SOFT_PRODUCTION_SIGNAL_CAPPED",
        style_intelligence: "NORMALIZATION_TARGET_HELPER_ONLY",
        legacy_blueprint: "NOT_CALLED",
      }),
      compiled_concept_count: compiled.looks.length,
      portfolio_validation: publicValidation,
      candidate_pipeline_trace: trace || null,
      styling_completion: publicStylingCompletion,
    }),
    styling_strategy: Object.freeze({
      source: "BodyFitIntelligence",
      mode: "SOFT_PRODUCTION_SIGNAL",
    }),
    recommendations: Object.freeze({
      top: "See concept-backed final Looks",
      bottom: "See concept-backed final Looks",
      shoes: "See concept-backed final Looks",
      accessories: publicStylingCompletion?.selected_optional_count > 0
        ? "Selected dynamically after the immutable Core Look"
        : "No quality-safe optional styling item improved the Core Look",
      summary: `${validation.looks.length} candidate-backed concept Looks`,
      products: Object.freeze(acceptedProducts),
    }),
    looks: publicLooks,
    products: Object.freeze(acceptedRequirements),
    final_looks: publicLooks,
  });
}

async function executeNewDecisionPipeline({
  decisionContext,
  productProvider,
  logger = console,
} = {}) {
  if (!decisionContext?.decision_context_id || !productProvider ||
      typeof productProvider.recommendForQueries !== "function") {
    throw new NewDecisionPipelineError("New pipeline context/provider is invalid", {
      code: "NEW_DECISION_PIPELINE_CONTEXT_INVALID",
      stage: "CONTEXT",
    });
  }
  let compiled;
  try {
    compiled = compileLookConceptPortfolio(decisionContext);
  } catch (error) {
    if (error instanceof LookConceptCompileError) {
      throw new NewDecisionPipelineError(error.message, {
        code: error.code,
        stage: "LOOK_CONCEPT_COMPILER",
        cause: error,
        details: error.details,
      });
    }
    throw new NewDecisionPipelineError(error?.message || "Concept compilation failed", {
      code: error?.code || "LOOK_CONCEPT_COMPILE_FAILED",
      stage: "LOOK_CONCEPT_COMPILER",
      cause: error,
    });
  }

  let products;
  try {
    products = await productProvider.recommendForQueries(
      compiled.requirements,
      providerContext(decisionContext, compiled),
    );
  } catch (error) {
    throw new NewDecisionPipelineError(
      error?.message || "Product provider contract failed",
      {
        code: error instanceof ProductProviderError || error?.code
          ? error.code || "NEW_DECISION_PROVIDER_FAILED"
          : "NEW_DECISION_PROVIDER_CONTRACT_FAILED",
        stage: "PRODUCT_PROVIDER_CONTRACT",
        cause: error,
        details: error?.details,
        fallbackAllowed: !new Set([
          "INSUFFICIENT_QUALITY_CANDIDATES",
          "INSUFFICIENT_QUALITY_LOOKS",
        ]).has(error?.code),
      },
    );
  }

  const coreTrace = productProvider.lastPipelineTrace || null;
  const coreValidation = validateFinalPortfolio({
    decisionContext,
    compiled,
    products,
  });
  if (coreValidation.quality_valid_look_count === 0) {
    throw new NewDecisionPipelineError("No whole-look quality PASS result", {
      code: "INSUFFICIENT_QUALITY_LOOKS",
      stage: "PORTFOLIO_VALIDATOR",
      details: coreValidation,
      fallbackAllowed: false,
    });
  }
  if (coreValidation.status !== "PASS") {
    throw new NewDecisionPipelineError("Final concept portfolio is invalid", {
      code: "NEW_DECISION_PORTFOLIO_INVALID",
      stage: "PORTFOLIO_VALIDATOR",
      details: coreValidation,
      fallbackAllowed: false,
    });
  }

  const completion = await completePortfolioStyling({
    decisionContext,
    compiled,
    coreValidation,
    coreProducts: products,
    productProvider,
    providerContext: providerContext(decisionContext, compiled),
    coreTrace,
    logger,
  });
  let completedProducts = completion.products;
  let stylingCompletion = completion.trace;
  let validation = validateFinalPortfolio({
    decisionContext,
    compiled,
    products: completedProducts,
  });
  if (validation.status !== "PASS") {
    const completionValidationErrors = Object.freeze([...(validation.errors || [])]);
    logger.warn?.("look_styling_completion_portfolio_reverted", {
      request_id: decisionContext.request_id || undefined,
      errors: completionValidationErrors,
    });
    completedProducts = products;
    validation = coreValidation;
    stylingCompletion = Object.freeze({
      ...completion.trace,
      status: "OPTIONAL_VALIDATION_FAILED_CORE_RETAINED",
      selected_optional_count: 0,
      selected_optional_candidate_ids: Object.freeze([]),
      core_unchanged: true,
      validation_errors: completionValidationErrors,
    });
  }
  logger.info?.("new_decision_pipeline_summary", {
    request_id: decisionContext.request_id,
    concept_count: compiled.looks.length,
    final_look_count: validation.looks.length,
    body_fit_mode: "SOFT_PRODUCTION_SIGNAL",
    market_mode: "SOFT_PRODUCTION_SIGNAL_CAPPED",
    fallback_used: false,
  });
  return buildResponse({
    decisionContext,
    compiled,
    validation,
    products: completedProducts,
    trace: coreTrace,
    stylingCompletion,
  });
}

function comparePipelineOutcomes({legacy = {}, next = {}} = {}) {
  const metric = (value, fallback = 0) => Number.isFinite(Number(value))
    ? Number(value) : fallback;
  return Object.freeze({
    user_intent_retention: Object.freeze({
      legacy: metric(legacy.user_intent_retention),
      new: metric(next.user_intent_retention),
    }),
    body_fit_usage: Object.freeze({
      legacy: metric(legacy.body_fit_usage),
      new: metric(next.body_fit_usage),
    }),
    concept_diversity: Object.freeze({
      legacy: metric(legacy.concept_diversity),
      new: metric(next.concept_diversity),
    }),
    style_accuracy: Object.freeze({
      legacy: metric(legacy.style_accuracy),
      new: metric(next.style_accuracy),
    }),
    scene_fit: Object.freeze({
      legacy: metric(legacy.scene_fit),
      new: metric(next.scene_fit),
    }),
    budget_compliance: Object.freeze({
      legacy: metric(legacy.budget_compliance),
      new: metric(next.budget_compliance),
    }),
    avoid_compliance: Object.freeze({
      legacy: metric(legacy.avoid_compliance),
      new: metric(next.avoid_compliance),
    }),
    product_duplicate_rate: Object.freeze({
      legacy: metric(legacy.product_duplicate_rate),
      new: metric(next.product_duplicate_rate),
    }),
  });
}

module.exports = {
  FINAL_PORTFOLIO_VALIDATOR_VERSION,
  NEW_DECISION_PIPELINE_VERSION,
  NewDecisionPipelineError,
  comparePipelineOutcomes,
  executeNewDecisionPipeline,
  publicProductForResponse,
  validateFinalPortfolio,
};
