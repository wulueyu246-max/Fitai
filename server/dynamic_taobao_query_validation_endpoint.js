"use strict";

const crypto = require("node:crypto");

const {compileLookConceptPortfolio} = require("./look_concept_compiler");
const {createProductProvider, ProductProviderError} = require("./product_provider");
const {interpretUserIntent} = require("./user_intent_brain");

const DYNAMIC_TAOBAO_QUERY_VALIDATION_PATH =
  "/internal/probes/taobao-query-planning-v1";
const QUERY_PLAN_VERSION = "concept_search_query_planner.v1";
const INTERNAL_PROBE_TOKEN_MIN_LENGTH = 32;
const MAX_TITLES_PER_QUERY = 5;

const VALIDATION_CASES = Object.freeze([
  Object.freeze({
    case_id: "A",
    gender: "female",
    scene: "nightlife",
    raw_user_input:
      "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
  }),
  Object.freeze({
    case_id: "B",
    gender: "male",
    scene: "date",
    raw_user_input:
      "周末约会，帮我搭3套，干净时髦一点，不要像上班。",
  }),
]);

function createDynamicTaobaoQueryValidationHandler({
  environment = process.env,
  providerFactory = createProductProvider,
  logger = console,
} = {}) {
  return async function dynamicTaobaoQueryValidationHandler(req, res) {
    const currentEnvironment = typeof environment === "function"
      ? environment()
      : environment;
    if (!validationEnabled(currentEnvironment)) {
      return res.status(404).json({error: "NOT_FOUND"});
    }
    if (!authorized(req, currentEnvironment.INTERNAL_PROBE_TOKEN)) {
      return res.status(403).json({error: "FORBIDDEN"});
    }

    try {
      const result = await executeDynamicTaobaoQueryValidation({
        environment: currentEnvironment,
        providerFactory,
        logger: safeLogger(logger),
      });
      return res.status(200).json(result);
    } catch (error) {
      logger.error?.("dynamic_taobao_query_validation_failed", {
        code: safeErrorCode(error),
      });
      return res.status(error instanceof ProductProviderError
        ? error.status
        : Number(error?.status) || 502).json({
        validation_status: "FAILED",
        error_code: safeErrorCode(error),
      });
    }
  };
}

async function executeDynamicTaobaoQueryValidation({
  environment,
  providerFactory = createProductProvider,
  logger = console,
} = {}) {
  const captures = new Map();
  const provider = providerFactory({
    environment: {
      ...environment,
      PRODUCT_PROVIDER: "taobao",
      ALLOW_MOCK_PRODUCTS: "false",
    },
    logger,
    reranker: null,
    visualVerifier: null,
    rawCapture: ({query, products, responseSummary}) => {
      const normalizedQuery = String(query || "").trim();
      if (!normalizedQuery) return;
      const titles = (Array.isArray(products) ? products : [])
        .map((product) => String(product?.text?.title || "").trim())
        .filter(Boolean);
      captures.set(normalizedQuery, Object.freeze({
        result_count: Array.isArray(products) ? products.length : 0,
        titles: Object.freeze(titles.slice(0, MAX_TITLES_PER_QUERY)),
        request_id_present: Boolean(responseSummary?.requestId),
      }));
    },
  });
  if (provider?.name !== "taobao" || provider?.configured !== true) {
    throw new ProductProviderError("Real Taobao provider is unavailable", {
      status: 503,
      code: "TAOBAO_PROVIDER_UNAVAILABLE",
    });
  }

  const cases = [];
  for (const definition of VALIDATION_CASES) {
    const decisionContext = buildValidationDecisionContext(definition);
    const compiled = compileLookConceptPortfolio(decisionContext);
    const requirements = compiled.requirements;
    for (const requirement of requirements) {
      try {
        await provider.recommendForQueries([requirement], {
          requestId: `${decisionContext.request_id}:${requirement.slot_key}`,
        });
      } catch (error) {
        const hasCapturedRecall = requirement.search_keywords.some((query) =>
          captures.has(query));
        if (!hasCapturedRecall) throw error;
        logger.warn?.("dynamic_query_downstream_ignored_after_raw_capture", {
          category: requirement.category,
          errorCode: safeErrorCode(error),
        });
      }
    }
    cases.push(summarizeCase(definition, decisionContext, compiled, captures));
  }

  const queryCount = cases.reduce((sum, entry) => sum + entry.query_count, 0);
  return Object.freeze({
    validation_status: "SUCCESS",
    provider: "taobao",
    is_mock: false,
    query_plan_version: QUERY_PLAN_VERSION,
    case_count: cases.length,
    query_count: queryCount,
    limits: Object.freeze({
      queries_per_slot: 2,
      page_size_max: 8,
      page_count: 1,
      title_sample_per_query: MAX_TITLES_PER_QUERY,
    }),
    cases: Object.freeze(cases),
  });
}

function buildValidationDecisionContext(definition) {
  const requestId = `dynamic-query-validation-${definition.case_id}`;
  const base = {
    decision_context_id: requestId,
    request_id: requestId,
    raw_user_input: definition.raw_user_input,
    user_truth: {
      gender: definition.gender,
      scene: definition.scene,
      budget: {item: "300-800", outfit: "800-1800", preferred_item: 0},
      explicit_style: "",
      explicit_requirements: [],
      explicit_avoid: [],
      explicit_preferences: [],
    },
    body_fit_profile: Object.freeze({
      top_strategy: "comfortable_non_restrictive_fit",
      bottom_strategy: "style_led_leg_shape",
      shoe_strategy: "balanced_visual_weight",
      waistline_strategy: "natural_waistline",
      vertical_balance_strategy: "preserve_natural_vertical_balance",
    }),
    market: Object.freeze({status: "NOT_CONNECTED", signals: []}),
    style_targets: Object.freeze([]),
  };
  const brain = interpretUserIntent(base);
  return Object.freeze({
    ...base,
    intent: Object.freeze({user_intent_brain: brain}),
    concepts: Object.freeze(buildOpenValidationConcepts({
      brain,
      scene: definition.scene,
    })),
  });
}

function buildOpenValidationConcepts({brain, scene}) {
  const desired = valuesOf(brain?.desired_impression);
  const avoid = valuesOf(brain?.explicit_avoid);
  const requestedFormality = valueOf(brain?.formality_preference);
  const templates = [
    {
      id: "polished",
      name: "精炼方向",
      top: "clean_or_gently_defined",
      bottom: "structured_with_clear_line",
      overall: "clean_vertical_balance",
      footwear: "refined_low_visual_noise_footwear",
      palette: "restrained_harmonious_palette",
      intensity: "low_to_medium",
      formality: "polished_casual",
      statement: "low_to_medium",
      niche: "balanced",
    },
    {
      id: "relaxed",
      name: "松弛方向",
      top: "relaxed_with_visible_structure",
      bottom: "easy_line_with_controlled_length",
      overall: "relaxed_but_balanced",
      footwear: "lightweight_relaxed_footwear",
      palette: "soft_harmonious_palette",
      intensity: "medium",
      formality: requestedFormality || "relaxed",
      statement: "medium",
      niche: "mainstream_to_balanced",
    },
    {
      id: "expressive",
      name: "表达方向",
      top: "defined_focal_shape",
      bottom: "supporting_shape_with_clear_proportion",
      overall: "intentional_focal_balance",
      footwear: "design_led_but_wearable_footwear",
      palette: "focused_accent_palette",
      intensity: "medium_to_high",
      formality: requestedFormality || "relaxed",
      statement: "medium_to_high",
      niche: "niche_but_wearable",
    },
  ];
  return templates.map((template, index) => Object.freeze({
    version: "dynamic_query_validation_concept.v1",
    concept_id: `concept-${index + 1}-${template.id}`,
    concept_name: template.name,
    concept_summary: `${scene} ${template.name}`,
    style_anchor: Object.freeze({
      value: null,
      role: "open_scene_direction",
      source: "ai_inference",
      confidence: 0.58,
    }),
    style_flexibility: "open_exploration",
    scene_fit: scene,
    desired_impression: Object.freeze(desired),
    silhouette_direction: Object.freeze({
      top: template.top,
      bottom: template.bottom,
      overall_proportion: template.overall,
      volume: "controlled",
    }),
    color_direction: Object.freeze({
      palette: template.palette,
      intensity: template.intensity,
      contrast: template.intensity,
    }),
    footwear_direction: Object.freeze({
      preference: template.footwear,
      avoid: Object.freeze([]),
    }),
    formality: template.formality,
    statement_level: template.statement,
    mainstream_vs_niche: template.niche,
    body_fit_strategy: Object.freeze({
      top: "comfortable_non_restrictive_fit",
      bottom: "style_led_leg_shape",
      shoes: "balanced_visual_weight",
      waistline: "natural_waistline",
      vertical_balance: template.overall,
    }),
    quality_direction: Object.freeze({tier: "balanced_quality"}),
    must: Object.freeze([]),
    prefer: Object.freeze([]),
    avoid: Object.freeze(avoid),
  }));
}

function summarizeCase(definition, context, compiled, captures) {
  const brain = context.intent.user_intent_brain;
  const concepts = compiled.looks.map((look) => Object.freeze({
    concept_id: look.concept_id,
    concept_name: look.concept.concept_name,
    slots: Object.freeze(look.items.map((requirement) => Object.freeze({
      slot: requirement.category,
      intent: Object.freeze({
        desired_impression: valuesOf(brain.desired_impression),
        formality: valueOf(brain.formality_preference),
        avoid: valuesOf(brain.explicit_avoid),
        statement_level: valueOf(brain.statement_level),
        style_flexibility: valueOf(brain.style_flexibility),
      }),
      avoid: Object.freeze([
        ...(requirement.commerce_query_plan?.commerce_negatives || []),
      ]),
      queries: Object.freeze(requirement.search_keywords.map((query) => {
        const capture = captures.get(query) || {result_count: 0, titles: []};
        return Object.freeze({
          q: query,
          result_count: capture.result_count,
          titles: Object.freeze([...capture.titles]),
          quality: qualitySignals(definition.case_id, capture.titles),
        });
      })),
    }))),
  }));
  return Object.freeze({
    case_id: definition.case_id,
    gender: definition.gender,
    scene: definition.scene,
    raw_user_input: definition.raw_user_input,
    query_count: concepts.reduce((sum, concept) => sum +
      concept.slots.reduce((slotSum, slot) => slotSum + slot.queries.length, 0), 0),
    concepts: Object.freeze(concepts),
  });
}

function qualitySignals(caseId, titles) {
  const values = Array.isArray(titles) ? titles : [];
  const count = values.length;
  const ratio = (pattern) => count === 0 ? 0 : Number((
    values.filter((title) => pattern.test(title)).length / count
  ).toFixed(4));
  if (caseId === "A") {
    return Object.freeze({
      youth_ratio: ratio(/年轻|少女|青春|学生|学院|潮|时尚|短款|高腰/u),
      design_ratio: ratio(/设计感|小众|不规则|拼接|撞色|褶|蝴蝶结|方领|收腰|廓形/u),
      office_or_older_ratio: ratio(/商务|职业|正装|工作装|中老年|妈妈|奶奶|爸爸/u),
    });
  }
  return Object.freeze({
    clean_fashion_ratio: ratio(/简约|干净|利落|时尚|潮|百搭|休闲|德训|小白|直筒|九分/u),
    office_ratio: ratio(/商务|职业|正装|工作装/u),
    dad_ratio: ratio(/爸爸|中老年|一脚蹬/u),
    young_date_shoe_ratio: ratio(/德训|板鞋|小白鞋|休闲鞋|乐福|帆布|运动鞋/u),
  });
}

function validationEnabled(environment = {}) {
  return String(environment.ENABLE_TAOBAO_RAW_PROBE || "").trim().toLowerCase() ===
      "true" &&
    String(environment.RENDER || "").trim().toLowerCase() === "true" &&
    String(environment.INTERNAL_PROBE_TOKEN || "").length >=
      INTERNAL_PROBE_TOKEN_MIN_LENGTH;
}

function authorized(req, expectedToken) {
  const authorization = String(req?.headers?.authorization || "");
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expected = String(expectedToken || "");
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function valueOf(evidence, fallback = null) {
  return evidence && typeof evidence === "object" &&
      Object.hasOwn(evidence, "value")
    ? evidence.value
    : evidence ?? fallback;
}

function valuesOf(evidence) {
  const value = valueOf(evidence, []);
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean))];
}

function safeLogger(logger = console) {
  return {
    info(message, details) {
      logger.info?.(message, safeLogDetails(details));
    },
    warn(message, details) {
      logger.warn?.(message, safeLogDetails(details));
    },
    error(message, details) {
      logger.error?.(message, safeLogDetails(details));
    },
  };
}

function safeLogDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const allowed = [
    "provider", "category", "candidate_count", "result_status", "errorCode",
  ];
  return Object.fromEntries(allowed
    .filter((key) => details[key] !== undefined)
    .map((key) => [key, details[key]]));
}

function safeErrorCode(error) {
  return String(error?.code || "DYNAMIC_TAOBAO_QUERY_VALIDATION_FAILED")
    .slice(0, 100);
}

module.exports = {
  DYNAMIC_TAOBAO_QUERY_VALIDATION_PATH,
  MAX_TITLES_PER_QUERY,
  QUERY_PLAN_VERSION,
  VALIDATION_CASES,
  buildOpenValidationConcepts,
  buildValidationDecisionContext,
  createDynamicTaobaoQueryValidationHandler,
  executeDynamicTaobaoQueryValidation,
  qualitySignals,
  validationEnabled,
};
