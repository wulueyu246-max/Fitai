"use strict";

const {
  authorizeAestheticTargetRequirement,
  normalizeGender,
} = require("./product_relevance");
const {
  planConceptSearchQueries,
} = require("./concept_search_query_planner");

const LOOK_CONCEPT_COMPILER_VERSION = "look_concept_compiler.v1";
const PRODUCTION_PIPELINE_MODE = "NEW_DECISION_PIPELINE";

class LookConceptCompileError extends Error {
  constructor(message, {code = "LOOK_CONCEPT_COMPILE_FAILED", details} = {}) {
    super(message);
    this.name = "LookConceptCompileError";
    this.code = code;
    this.fallbackAllowed = true;
    if (details) this.details = details;
  }
}

function valueOf(evidence, fallback = null) {
  return evidence && typeof evidence === "object" &&
      Object.hasOwn(evidence, "value")
    ? evidence.value
    : evidence ?? fallback;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function budgetCeiling(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const values = String(value || "").match(/\d+(?:\.\d+)?/gu) || [];
  return values.length > 0 ? Math.max(...values.map(Number)) : null;
}

function conceptMarketEntry(context, conceptId) {
  return (Array.isArray(context?.market?.concept_enrichment)
    ? context.market.concept_enrichment : [])
    .find((entry) => entry?.concept_id === conceptId) || null;
}

function conceptStyleTarget(context, conceptId) {
  return (Array.isArray(context?.style_targets) ? context.style_targets : [])
    .find((entry) => entry?.concept_id === conceptId) || null;
}

function productionConcept(context, concept) {
  const market = conceptMarketEntry(context, concept.concept_id);
  return market ? {...concept, ...market} : concept;
}

function explicitAvoids(context, concept) {
  const brain = context?.intent?.user_intent_brain || {};
  return unique([
    concept?.avoid,
    valueOf(brain.explicit_avoid, []),
    context?.user_truth?.explicit_avoid,
  ]);
}

function expandedAvoidAttributes(avoids) {
  const expanded = [...avoids];
  if (avoids.some((value) => /(?:leather_shoes|\u76ae\u978b|leather\s*(?:dress\s*)?shoes?)/iu
    .test(value))) {
    expanded.push(
      "leather_shoes",
      "leather dress shoes",
      "\u76ae\u978b",
      "\u76ae\u9769\u978b",
      "oxford shoes",
      "derby shoes",
      "loafer",
    );
  }
  return unique(expanded);
}

function marketSoftSignals(context, concept) {
  const brain = context?.intent?.user_intent_brain || {};
  const niche = valueOf(brain.mainstream_vs_niche) === "niche";
  const current = valueOf(brain.trend_preference) === "current";
  const opportunities = Array.isArray(concept?.market_opportunities)
    ? concept.market_opportunities : [];
  const prioritized = opportunities.filter((entry) => niche
    ? String(entry?.trend_state || "").startsWith("niche_")
    : current
      ? ["hot", "rising", "stable"].includes(String(entry?.trend_state || ""))
      : false).map((entry) => entry?.value);
  const adjustments = (Array.isArray(concept?.recommended_market_adjustments)
    ? concept.recommended_market_adjustments : [])
    .filter((entry) => entry?.preserves_style_anchor !== false)
    .map((entry) => entry?.value);
  return unique([...prioritized, ...adjustments]).slice(0, 5);
}

function styleLabel(concept) {
  return String(
    concept?.style_anchor?.value ||
    concept?.style_anchor?.compatible_with ||
    "",
  ).trim();
}

function requirementForSlot({
  context,
  concept,
  lookId,
  category,
  index,
  styleTarget,
}) {
  const gender = normalizeGender(context?.user_truth?.gender);
  const style = styleLabel(concept);
  const body = concept?.body_fit_strategy || {};
  const marketSignals = marketSoftSignals(context, concept);
  const brain = context?.intent?.user_intent_brain || {};
  const declaredAvoids = explicitAvoids(context, concept);
  const shoeSpecificAvoid = (value) =>
    /(?:leather_shoes|\u76ae\u978b|\u76ae\u9769\u978b|leather\s*(?:dress\s*)?shoes?|loafer|oxford\s*shoes?|derby\s*shoes?)/iu
      .test(String(value || ""));
  const avoids = category === "shoes"
    ? expandedAvoidAttributes(declaredAvoids)
    : declaredAvoids.filter((value) => !shoeSpecificAvoid(value));
  const slotFit = category === "top" ? body.top
    : category === "bottom" ? body.bottom
      : body.shoes;
  const slotDirection = category === "top"
    ? concept?.silhouette_direction?.top
    : category === "bottom"
      ? concept?.silhouette_direction?.bottom
      : concept?.footwear_direction?.preference;
  const itemNames = {
    top: gender === "male" ? "men style-compatible top" :
      gender === "female" ? "women style-compatible top" : "style-compatible top",
    bottom: gender === "male" ? "men proportion-compatible bottom" :
      gender === "female" ? "women proportion-compatible bottom" :
        "proportion-compatible bottom",
    shoes: gender === "male" ? "men scene-compatible shoes" :
      gender === "female" ? "women scene-compatible shoes" :
        "scene-compatible shoes",
  };
  const styleTokens = unique([
    style,
    concept?.statement_level,
    concept?.formality,
    concept?.mainstream_vs_niche,
  ]);
  const preferred = unique([
    concept?.prefer,
    slotFit,
    slotDirection,
    concept?.color_direction?.palette,
    concept?.quality_direction?.tier,
    marketSignals,
  ]);
  const commerceQueryPlan = planConceptSearchQueries({
    decisionContext: context,
    userIntentBrain: brain,
    lookConcept: concept,
    bodyFitProfile: context?.body_fit_profile,
    slot: category,
    marketPreference: valueOf(brain.trend_preference),
  });
  const searchKeywords = commerceQueryPlan.query_candidates
    .map(({query}) => query);
  const hardGateAvoids = unique([
    ...avoids,
    ...commerceQueryPlan.hard_gate_negatives,
  ]);
  const requirement = {
    request_id: context.request_id,
    look_id: lookId,
    concept_id: concept.concept_id,
    slot_key: `${context.request_id}:${lookId}:${category}:${index}`,
    category,
    gender,
    scene: concept.scene_fit,
    style,
    style_role: concept.style_anchor?.role || "open_scene_direction",
    item_name: itemNames[category],
    product_type: category,
    fit: String(slotFit || "style_led"),
    color: String(concept?.color_direction?.palette || ""),
    search_keywords: searchKeywords,
    query_plan_version: commerceQueryPlan.version,
    commerce_query_plan: commerceQueryPlan,
    query_reason: "由用户意图、Look Concept 与中文电商语义共同编译",
    source_elements: unique(commerceQueryPlan.query_candidates
      .flatMap(({source_elements: elements}) => elements)),
    translated_queries: commerceQueryPlan.query_candidates.map((entry) => ({
      category,
      query: entry.query,
      source_elements: entry.source_elements,
      query_reason: entry.reason_codes.join("+"),
    })),
    required_attributes: unique(concept?.must),
    preferred_attributes: preferred,
    avoid_attributes: hardGateAvoids,
    negative_keywords: unique([
      ...hardGateAvoids,
      ...commerceQueryPlan.contextual_negatives,
    ]),
    body_fit_soft_signals: Object.freeze(unique([
      slotFit,
      body.waistline,
      body.vertical_balance,
    ])),
    market_soft_signals: Object.freeze(marketSignals),
    market_influence_cap: 0.08,
    aesthetic_target_profile:
      styleTarget?.aesthetic_target_profile || undefined,
    decision_authority: Object.freeze({
      user_intent: "highest",
      body_fit: "soft",
      market: "soft_capped",
      style_intelligence: "normalization_helper",
    }),
  };
  return Object.freeze(requirement.aesthetic_target_profile
    ? authorizeAestheticTargetRequirement(requirement)
    : requirement);
}

function compileLookConcept(context, rawConcept, index) {
  if (!rawConcept?.concept_id) {
    throw new LookConceptCompileError("Look concept is missing concept_id", {
      code: "LOOK_CONCEPT_ID_MISSING",
    });
  }
  const concept = productionConcept(context, rawConcept);
  const styleTarget = conceptStyleTarget(context, concept.concept_id);
  const lookId = `new-look-${index + 1}-${concept.concept_id}`;
  const requirements = ["top", "bottom", "shoes"].map((category, slotIndex) =>
    requirementForSlot({
      context,
      concept,
      lookId,
      category,
      index: slotIndex,
      styleTarget,
    }));
  return Object.freeze({
    version: LOOK_CONCEPT_COMPILER_VERSION,
    look_id: lookId,
    concept_id: concept.concept_id,
    gender: normalizeGender(context?.user_truth?.gender),
    scene: String(concept.scene_fit || context?.user_truth?.scene || ""),
    style: styleLabel(concept),
    style_direction: String(concept.concept_name || concept.concept_id),
    styling_goal: String(concept.concept_summary || ""),
    proportion_strategy: String(
      concept?.body_fit_strategy?.vertical_balance ||
      concept?.silhouette_direction?.overall_proportion || "style_led",
    ),
    concept,
    style_target: styleTarget,
    budget_allocation: Object.freeze({
      item_ceiling: budgetCeiling(context?.user_truth?.budget?.item),
      outfit_ceiling: budgetCeiling(context?.user_truth?.budget?.outfit),
      quality_direction: concept?.quality_direction?.tier || "budget_unspecified",
    }),
    must: Object.freeze(unique(concept.must)),
    prefer: Object.freeze(unique(concept.prefer)),
    avoid: Object.freeze(expandedAvoidAttributes(explicitAvoids(context, concept))),
    items: Object.freeze(requirements),
  });
}

function compileLookConceptPortfolio(context = {}) {
  const concepts = Array.isArray(context.concepts) ? context.concepts : [];
  if (concepts.length < 2 || concepts.length > 4) {
    throw new LookConceptCompileError(
      "DecisionContext must contain 2 to 4 validated concepts",
      {code: "LOOK_CONCEPT_PORTFOLIO_NOT_COMPILABLE", details: {count: concepts.length}},
    );
  }
  const looks = concepts.map((concept, index) =>
    compileLookConcept(context, concept, index));
  return Object.freeze({
    version: LOOK_CONCEPT_COMPILER_VERSION,
    mode: PRODUCTION_PIPELINE_MODE,
    decision_context_id: context.decision_context_id,
    looks: Object.freeze(looks),
    requirements: Object.freeze(looks.flatMap((look) => look.items)),
    trace: Object.freeze({
      concept_count: concepts.length,
      compiled_look_count: looks.length,
      independent_contracts: looks.map((look) => Object.freeze({
        concept_id: look.concept_id,
        look_id: look.look_id,
        requirement_count: look.items.length,
        contract_identity: `${look.concept_id}:${look.look_id}`,
      })),
      legacy_blueprint_consumed: false,
      body_fit_mode: "SOFT_PRODUCTION_SIGNAL",
      market_mode: "SOFT_PRODUCTION_SIGNAL_CAPPED",
    }),
  });
}

module.exports = {
  LOOK_CONCEPT_COMPILER_VERSION,
  LookConceptCompileError,
  compileLookConcept,
  compileLookConceptPortfolio,
};
