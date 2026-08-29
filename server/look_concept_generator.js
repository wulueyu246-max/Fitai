"use strict";

const {resolveAestheticTargetProfile} = require("./style_intelligence");

const LOOK_CONCEPT_GENERATOR_VERSION = "look_concept_generator.v1";
const PORTFOLIO_VALIDATOR_VERSION = "portfolio_validator.v1";
const MARKET_NOT_CONNECTED = "NOT_CONNECTED";

const DIVERSITY_DIMENSIONS = Object.freeze([
  "silhouette",
  "style_direction",
  "statement_level",
  "formality",
  "color_intensity",
  "footwear",
  "mainstream_vs_niche",
  "layering",
]);

const VARIANTS = Object.freeze([
  Object.freeze({
    id: "polished",
    label: "精炼",
    silhouette: Object.freeze({
      top: "clean_or_gently_defined",
      bottom: "structured_with_clear_line",
      overall_proportion: "clean_vertical_balance",
      volume: "controlled",
    }),
    color: Object.freeze({
      palette: "restrained_harmonious_palette",
      intensity: "low_to_medium",
      contrast: "low_to_medium",
    }),
    footwear: "refined_low_visual_noise_footwear",
    layering: "concise_layering",
    formalityDelta: 1,
    statement: "low_to_medium",
    niche: "balanced",
    bodyMode: "precise_proportion_control",
  }),
  Object.freeze({
    id: "relaxed",
    label: "松弛",
    silhouette: Object.freeze({
      top: "relaxed_with_visible_structure",
      bottom: "easy_line_with_controlled_length",
      overall_proportion: "relaxed_but_balanced",
      volume: "moderate",
    }),
    color: Object.freeze({
      palette: "soft_harmonious_palette",
      intensity: "medium",
      contrast: "low",
    }),
    footwear: "lightweight_relaxed_footwear",
    layering: "soft_functional_layering",
    formalityDelta: 0,
    statement: "medium",
    niche: "mainstream_to_balanced",
    bodyMode: "relaxed_volume_with_proportion_control",
  }),
  Object.freeze({
    id: "expressive",
    label: "表达",
    silhouette: Object.freeze({
      top: "defined_focal_shape",
      bottom: "supporting_shape_with_clear_proportion",
      overall_proportion: "intentional_focal_balance",
      volume: "contrasted_but_controlled",
    }),
    color: Object.freeze({
      palette: "focused_accent_palette",
      intensity: "medium_to_high",
      contrast: "medium_to_high",
    }),
    footwear: "design_led_but_wearable_footwear",
    layering: "one_intentional_focal_layer",
    formalityDelta: 0,
    statement: "medium_to_high",
    niche: "niche_but_wearable",
    bodyMode: "statement_with_body_aware_balance",
  }),
  Object.freeze({
    id: "balanced",
    label: "平衡",
    silhouette: Object.freeze({
      top: "balanced_everyday_shape",
      bottom: "versatile_balanced_line",
      overall_proportion: "adaptable_balanced_proportion",
      volume: "light_to_moderate",
    }),
    color: Object.freeze({
      palette: "versatile_neutral_supported_palette",
      intensity: "medium",
      contrast: "medium",
    }),
    footwear: "versatile_scene_compatible_footwear",
    layering: "adaptable_optional_layering",
    formalityDelta: 0,
    statement: "medium",
    niche: "balanced",
    bodyMode: "adaptive_body_aware_balance",
  }),
]);

function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat()
    .filter((value) => value !== null && typeof value !== "undefined")
    .map((value) => typeof value === "string" ? value.trim() : value)
    .filter((value) => typeof value !== "string" || value.length > 0))];
}

function evidenceValue(item, fallback = null) {
  return item && typeof item === "object" && Object.hasOwn(item, "value")
    ? item.value
    : typeof item === "undefined" ? fallback : item;
}

function evidenceSource(item, fallback = "system") {
  return item && typeof item === "object" && item.source
    ? String(item.source)
    : fallback;
}

function clampConfidence(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function intentBrain(context) {
  return context?.intent?.user_intent_brain || {};
}

function requestedConceptCount(brain) {
  const constraints = evidenceValue(brain.constraints, []);
  const requested = Array.isArray(constraints)
    ? constraints.find((item) => item?.type === "look_count")?.value
    : null;
  if (Number.isInteger(requested)) return Math.max(2, Math.min(4, requested));
  const creativeFreedom = evidenceValue(brain.creative_freedom, "medium");
  const diversityPreference = evidenceValue(
    brain.portfolio_diversity_preference,
    "medium",
  );
  if (creativeFreedom === "high" || diversityPreference === "high") return 4;
  if (creativeFreedom === "low" && diversityPreference === "low") return 2;
  return 3;
}

function parseBudgetNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/gu) || [];
  return numbers.length > 0 ? Math.max(...numbers.map(Number)) : null;
}

function budgetDirection(context) {
  const budget = context?.user_truth?.budget || {};
  const outfitCeiling = parseBudgetNumber(budget.outfit);
  const itemCeiling = parseBudgetNumber(budget.preferred_item ?? budget.item);
  const ceiling = outfitCeiling ?? itemCeiling;
  if (ceiling !== null && ceiling <= 800) {
    return deepFreeze({
      tier: "focused_value",
      brand_expectation: "quality_evidence_over_brand_premium",
      layering_complexity: "light",
      value_priority: "high",
      source: "user",
      confidence: 1,
    });
  }
  if (ceiling !== null && ceiling <= 2000) {
    return deepFreeze({
      tier: "balanced_quality",
      brand_expectation: "balanced_brand_quality_and_value",
      layering_complexity: "moderate",
      value_priority: "balanced",
      source: "user",
      confidence: 1,
    });
  }
  if (ceiling !== null) {
    return deepFreeze({
      tier: "elevated_quality",
      brand_expectation: "construction_material_and_design_quality",
      layering_complexity: "considered",
      value_priority: "quality_led_within_budget",
      source: "user",
      confidence: 1,
    });
  }
  return deepFreeze({
    tier: "budget_unspecified",
    brand_expectation: "avoid_unverified_brand_assumptions",
    layering_complexity: "moderate",
    value_priority: "balanced",
    source: "system",
    confidence: 0,
  });
}

function sceneFormality(scene) {
  const normalized = normalizedText(scene);
  if (/(?:formal|正式活动|婚礼|典礼)/u.test(normalized)) return 3;
  if (/(?:commute|work|通勤|工作)/u.test(normalized)) return 2;
  if (/(?:date|party|nightlife|ktv|约会|聚会|夜生活)/u.test(normalized)) {
    return 1;
  }
  return 0;
}

function formalityLabel(level) {
  if (level >= 3) return "formal";
  if (level === 2) return "elevated";
  if (level === 1) return "polished_casual";
  return "relaxed";
}

function allowsAlternativeStyle(rawInput) {
  return /(?:也可以|可以|你也可以|都可以).{0,8}(?:试|尝试|看看|搭).{0,8}(?:别的|其他)|(?:试|尝试)(?:试|点)?(?:别的|其他)/u
    .test(String(rawInput || ""));
}

function styleState(brain, rawInput = "") {
  const locked = evidenceValue(brain.explicit_style);
  const normalized = evidenceValue(brain.normalized_style);
  const constraint = evidenceValue(brain.style_constraint, "low");
  const alternativePermission = allowsAlternativeStyle(rawInput);
  return {
    locked: locked && !alternativePermission ? locked : null,
    preferred: alternativePermission
      ? normalized || locked || null
      : !locked && normalized ? normalized : null,
    constraint: alternativePermission ? "medium" : constraint,
    source: locked
      ? evidenceSource(brain.explicit_style, "user")
      : normalized ? evidenceSource(brain.normalized_style, "user") : "system",
    confidence: locked
      ? clampConfidence(brain.explicit_style?.confidence, 1)
      : normalized ? clampConfidence(brain.normalized_style?.confidence, 1) : 0,
  };
}

function conceptAnchor(style, index) {
  if (style.locked) {
    return {
      value: style.locked,
      role: "locked_anchor",
      source: style.source,
      confidence: style.confidence,
    };
  }
  if (style.preferred && index === 0) {
    return {
      value: style.preferred,
      role: "strong_preference",
      source: style.source,
      confidence: style.confidence,
    };
  }
  if (style.preferred) {
    return {
      value: null,
      compatible_with: style.preferred,
      role: "compatible_exploration",
      source: "ai_inference",
      confidence: 0.62,
    };
  }
  return {
    value: null,
    role: "open_scene_direction",
    source: "ai_inference",
    confidence: 0.58,
  };
}

function userValues(brain, field) {
  const value = evidenceValue(brain[field], []);
  return unique(Array.isArray(value) ? value : value == null ? [] : [value]);
}

function footwearDirection(variant, avoids) {
  const avoidsLeatherShoes = avoids.some((item) =>
    /(?:leather_shoes|皮鞋|leather\s*dress\s*shoes?)/iu.test(String(item)));
  if (avoidsLeatherShoes) {
    return deepFreeze({
      preference: variant.id === "relaxed"
        ? "lightweight_non_dress_scene_compatible_footwear"
        : "refined_non_dress_scene_compatible_footwear",
      avoid: unique([...avoids, "leather_dress_shoes"]),
    });
  }
  return deepFreeze({
    preference: variant.footwear,
    avoid: avoids,
  });
}

function bodyFitStrategy(bodyFit, variant) {
  const garments = bodyFit?.garment_preferences || {};
  const goals = bodyFit?.proportion_goals || {};
  const read = (value, fallback = "style_led") =>
    String(evidenceValue(value, fallback));
  const strategy = {
    mode: variant.bodyMode,
    top: read(garments.top?.preferred_fit),
    bottom: variant.id === "relaxed"
      ? `${read(garments.bottom?.leg_shape)}_with_controlled_length`
      : read(garments.bottom?.leg_shape),
    shoes: variant.id === "expressive"
      ? `${read(garments.shoes?.visual_weight)}_with_statement_control`
      : read(garments.shoes?.visual_weight),
    waistline: read(goals.waistline_goal, "intent_led_waistline"),
    vertical_balance: read(goals.vertical_balance, "balanced_proportion"),
    source: bodyFit?.version ? "body_fit_profile" : "system",
    confidence: bodyFit?.version ? 0.8 : 0,
  };
  return deepFreeze(strategy);
}

function sourceMap({anchor, sceneSource, budget, bodyStrategy}) {
  return deepFreeze({
    style_anchor: {
      source: anchor.source,
      confidence: anchor.confidence,
    },
    scene_fit: {source: sceneSource.source, confidence: sceneSource.confidence},
    desired_impression: {source: "user_or_intent", confidence: 0.8},
    silhouette_direction: {source: "ai_inference", confidence: 0.68},
    color_direction: {source: "ai_inference", confidence: 0.65},
    footwear_direction: {source: "ai_inference", confidence: 0.7},
    layering_direction: {source: "ai_inference", confidence: 0.65},
    formality: {source: "scene_and_intent", confidence: 0.78},
    quality_direction: {source: budget.source, confidence: budget.confidence},
    body_fit_strategy: {
      source: bodyStrategy.source,
      confidence: bodyStrategy.confidence,
    },
    market_evidence: {source: "market", confidence: 0},
  });
}

function conceptName(anchor, variant, scene) {
  const style = anchor.value || anchor.compatible_with || "开放";
  const sceneLabel = String(scene || "日常");
  return `${style} · ${sceneLabel}${variant.label}方向`;
}

function conceptSummary(anchor, variant, scene) {
  const stylePhrase = anchor.value
    ? `保持 ${anchor.value} 风格锚点`
    : anchor.compatible_with
      ? `从 ${anchor.compatible_with} 偏好向兼容方向探索`
      : "在未锁定风格时保留开放创意空间";
  return `${stylePhrase}，以${variant.label}的廓形、色彩和鞋履语言适配${scene || "当前"}场景。`;
}

function conceptStyleFlexibility(anchor, style) {
  if (style.locked) return "locked_anchor_with_internal_variation";
  if (anchor.value) return "preferred_anchor_with_compatible_variation";
  if (anchor.compatible_with) return "compatible_exploration";
  return "open_exploration";
}

function buildConcept(context, variant, index, style, budget) {
  const brain = intentBrain(context);
  const sceneValue = evidenceValue(
    brain.scene_intent,
    context?.user_truth?.scene || "daily",
  );
  const sceneSource = {
    source: evidenceSource(brain.scene_intent, "system"),
    confidence: clampConfidence(brain.scene_intent?.confidence, 0),
  };
  const anchor = conceptAnchor(style, index);
  const avoids = userValues(brain, "explicit_avoid");
  const must = userValues(brain, "explicit_requirements");
  const preferences = userValues(brain, "explicit_preferences");
  const impressions = userValues(brain, "desired_impression");
  const bodyStrategy = bodyFitStrategy(context?.body_fit_profile, variant);
  const explicitFormality = evidenceValue(brain.formality_preference);
  const baseFormality = explicitFormality === "elevated"
    ? 2 : explicitFormality === "relaxed" ? 0 : sceneFormality(sceneValue);
  const formality = formalityLabel(Math.max(
    0,
    Math.min(3, baseFormality + variant.formalityDelta),
  ));
  const footwear = footwearDirection(variant, avoids);
  const confidence = style.locked ? 0.84 : style.preferred ? 0.76 : 0.68;
  const marketStatus = String(context?.market?.status || MARKET_NOT_CONNECTED);
  return deepFreeze({
    version: LOOK_CONCEPT_GENERATOR_VERSION,
    concept_id: `concept-${index + 1}-${variant.id}`,
    concept_name: conceptName(anchor, variant, sceneValue),
    concept_summary: conceptSummary(anchor, variant, sceneValue),
    style_anchor: deepFreeze(anchor),
    style_flexibility: conceptStyleFlexibility(anchor, style),
    scene_fit: sceneValue,
    desired_impression: impressions.length > 0
      ? impressions : [`${variant.id}_scene_appropriate_impression`],
    silhouette_direction: deepFreeze(deepClone(variant.silhouette)),
    color_direction: deepFreeze(deepClone(variant.color)),
    footwear_direction: footwear,
    layering_direction: deepFreeze({
      approach: variant.layering,
      complexity: budget.layering_complexity,
    }),
    formality,
    quality_direction: budget,
    statement_level: variant.statement,
    mainstream_vs_niche: evidenceValue(brain.mainstream_vs_niche) ||
      variant.niche,
    body_fit_strategy: bodyStrategy,
    must,
    prefer: preferences,
    avoid: unique([...avoids, ...footwear.avoid]),
    market_evidence: deepFreeze({
      status: marketStatus,
      signals_used: marketStatus === MARKET_NOT_CONNECTED ? [] : [],
      source: "market",
      confidence: 0,
    }),
    source_map: sourceMap({anchor, sceneSource, budget, bodyStrategy}),
    confidence,
    reasoning_summary: `${variant.id} direction derived from user intent, scene, ` +
      "budget and BodyFit; no product or market-trend evidence was used.",
  });
}

function conceptSignature(concept) {
  return {
    silhouette: concept.silhouette_direction.overall_proportion,
    style_direction: `${concept.style_anchor.value || "open"}:` +
      concept.body_fit_strategy.mode,
    statement_level: concept.statement_level,
    formality: concept.formality,
    color_intensity: concept.color_direction.intensity,
    footwear: concept.footwear_direction.preference,
    mainstream_vs_niche: concept.mainstream_vs_niche,
    layering: concept.layering_direction.approach,
  };
}

function assessPortfolioDiversity(concepts) {
  const pairwise = [];
  for (let left = 0; left < concepts.length; left += 1) {
    for (let right = left + 1; right < concepts.length; right += 1) {
      const leftSignature = conceptSignature(concepts[left]);
      const rightSignature = conceptSignature(concepts[right]);
      const differences = DIVERSITY_DIMENSIONS.filter((dimension) =>
        leftSignature[dimension] !== rightSignature[dimension]);
      pairwise.push(deepFreeze({
        left: concepts[left].concept_id,
        right: concepts[right].concept_id,
        differing_dimensions: differences,
        difference_count: differences.length,
      }));
    }
  }
  const minimum = pairwise.length > 0
    ? Math.min(...pairwise.map(({difference_count: count}) => count))
    : 0;
  return deepFreeze({
    contract: "PORTFOLIO_DIVERSITY_V1",
    status: concepts.length >= 2 && concepts.length <= 4 && minimum >= 3
      ? "PASS" : "FAIL",
    dimensions: DIVERSITY_DIMENSIONS,
    minimum_pairwise_difference_count: minimum,
    pairwise,
  });
}

function hasForbiddenProductIdentity(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenProductIdentity);
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:product_id|candidate_id|merchant|taobao_item|item_id)$/iu.test(key)) {
      return true;
    }
    if (hasForbiddenProductIdentity(item)) return true;
  }
  return false;
}

function validateLookConceptPortfolio({context, concepts, diversity} = {}) {
  const brain = intentBrain(context);
  const errors = [];
  const lockedStyle = allowsAlternativeStyle(context?.raw_user_input)
    ? null : evidenceValue(brain.explicit_style);
  const scene = evidenceValue(brain.scene_intent, context?.user_truth?.scene);
  const avoids = userValues(brain, "explicit_avoid");
  if (!Array.isArray(concepts) || concepts.length < 2 || concepts.length > 4) {
    errors.push("CONCEPT_COUNT_OUT_OF_RANGE");
  }
  if (new Set((concepts || []).map(({concept_id: id}) => id)).size !==
      (concepts || []).length) {
    errors.push("CONCEPT_ID_NOT_UNIQUE");
  }
  if (diversity?.status !== "PASS") errors.push("PORTFOLIO_NOT_DIVERSE");
  for (const concept of concepts || []) {
    if (lockedStyle && concept.style_anchor?.value !== lockedStyle) {
      errors.push(`STYLE_LOCK_DRIFT:${concept.concept_id}`);
    }
    if (scene && concept.scene_fit !== scene) {
      errors.push(`SCENE_DRIFT:${concept.concept_id}`);
    }
    if (concept.body_fit_strategy?.source !== "body_fit_profile") {
      errors.push(`BODY_FIT_NOT_CONSUMED:${concept.concept_id}`);
    }
    for (const avoid of avoids) {
      if (!concept.avoid.includes(avoid)) {
        errors.push(`USER_AVOID_MISSING:${concept.concept_id}:${avoid}`);
      }
    }
    if (avoids.includes("leather_shoes") &&
        /leather.*dress|dress.*leather/iu.test(
          concept.footwear_direction?.preference || "",
        )) {
      errors.push(`FOOTWEAR_AVOID_CONFLICT:${concept.concept_id}`);
    }
    if (hasForbiddenProductIdentity(concept)) {
      errors.push(`PRODUCT_IDENTITY_FORBIDDEN:${concept.concept_id}`);
    }
  }
  return deepFreeze({
    version: PORTFOLIO_VALIDATOR_VERSION,
    status: errors.length === 0 ? "PASS" : "FAIL",
    checks: deepFreeze({
      concept_count: concepts?.length || 0,
      concept_uniqueness: diversity?.status || "FAIL",
      style_lock_compliance: !errors.some((item) =>
        item.startsWith("STYLE_LOCK_DRIFT")),
      user_avoid_compliance: !errors.some((item) =>
        item.includes("AVOID")),
      body_compatibility: !errors.some((item) =>
        item.startsWith("BODY_FIT_NOT_CONSUMED")),
      scene_compatibility: !errors.some((item) =>
        item.startsWith("SCENE_DRIFT")),
      no_product_identity: !errors.some((item) =>
        item.startsWith("PRODUCT_IDENTITY_FORBIDDEN")),
    }),
    errors: deepFreeze(errors),
  });
}

function styleTargetForConcept(context, concept) {
  const anchor = concept.style_anchor?.value ||
    concept.style_anchor?.compatible_with || "";
  const target = resolveAestheticTargetProfile({
    gender: context?.user_truth?.gender || "unisex",
    style: anchor,
    scene: concept.scene_fit,
    outfit_budget: context?.user_truth?.budget?.outfit,
    item_budget: context?.user_truth?.budget?.item,
  });
  return deepFreeze({
    concept_id: concept.concept_id,
    role: "CONCEPT_NORMALIZATION_HELPER",
    source: "style_intelligence",
    confidence: target.mapping.confidence,
    aesthetic_target_profile: target,
  });
}

function generateLookConceptPortfolio(context = {}) {
  const brain = intentBrain(context);
  if (!brain.version || !context?.body_fit_profile?.version) {
    const error = new Error(
      "LookConceptGenerator requires UserIntentBrain and BodyFitProfile",
    );
    error.code = "LOOK_CONCEPT_CONTEXT_INCOMPLETE";
    throw error;
  }
  const count = requestedConceptCount(brain);
  const style = styleState(brain, context.raw_user_input);
  const budget = budgetDirection(context);
  const concepts = deepFreeze(VARIANTS.slice(0, count).map(
    (variant, index) => buildConcept(context, variant, index, style, budget),
  ));
  const conceptDiversity = assessPortfolioDiversity(concepts);
  const validation = validateLookConceptPortfolio({
    context,
    concepts,
    diversity: conceptDiversity,
  });
  if (validation.status !== "PASS") {
    const error = new Error("Look concept portfolio failed validation");
    error.code = "LOOK_CONCEPT_PORTFOLIO_INVALID";
    error.details = validation;
    throw error;
  }
  const styleTargets = deepFreeze(concepts.map((concept) =>
    styleTargetForConcept(context, concept)));
  return deepFreeze({
    version: LOOK_CONCEPT_GENERATOR_VERSION,
    mode: "SHADOW_ONLY",
    concepts,
    concept_diversity: conceptDiversity,
    validation,
    style_targets: styleTargets,
    trace: deepFreeze({
      raw_user_input: context.raw_user_input,
      market_status: context?.market?.status || MARKET_NOT_CONNECTED,
      concept_count: concepts.length,
      new_look_concepts: concepts,
      concept_diversity: conceptDiversity,
      style_targets: styleTargets,
      validation,
    }),
  });
}

function createLookConceptTrace(portfolio = {}) {
  return deepFreeze(deepClone(portfolio.trace || {}));
}

class PortfolioValidator {
  validate(input) {
    return validateLookConceptPortfolio(input);
  }
}

class LookConceptGenerator {
  generate(context) {
    return generateLookConceptPortfolio(context);
  }
}

module.exports = {
  LOOK_CONCEPT_GENERATOR_VERSION,
  PORTFOLIO_VALIDATOR_VERSION,
  LookConceptGenerator,
  PortfolioValidator,
  assessPortfolioDiversity,
  createLookConceptTrace,
  generateLookConceptPortfolio,
  validateLookConceptPortfolio,
};
