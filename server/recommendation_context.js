const {normalizeGender} = require("./product_relevance");
const {
  normalizeStyleProfile,
  normalizeStyleSemantics,
  resolveExpressionFromStyleProfile,
} = require("./style_interpreter");
const {
  LOOK_INTENT_WEIGHTS,
  PRODUCT_INTENT_WEIGHTS,
  resolveIntentPriorityScore,
} = require("./intent_priority");
const {
  blueprintHasCoreItems,
  normalizeOutfitBlueprint,
} = require("./outfit_blueprint");

const STYLE_EXPRESSIONS = new Set(["feminine", "neutral", "masculine", "auto"]);
const PERSONA_CONSISTENCY_STATUS = Object.freeze({
  PASS: "PASS",
  NEUTRAL: "NEUTRAL",
  FAIL: "FAIL",
});
const PERSONA_EVIDENCE_TERMS = Object.freeze({
  female: Object.freeze([
    "female", "feminine", "women", "woman", "ladylike",
    "女性", "女性化", "女士", "女装", "女款",
  ]),
  male: Object.freeze([
    "male", "masculine", "menswear", "man", "men", "boyish",
    "男性", "男性化", "男士", "男装", "男款", "硬汉",
  ]),
});

function resolveStyleExpression({explicit, styleProfile} = {}) {
  const normalizedExplicit = String(explicit || "").trim().toLowerCase();
  if (STYLE_EXPRESSIONS.has(normalizedExplicit) && normalizedExplicit !== "auto") {
    return normalizedExplicit;
  }
  return resolveExpressionFromStyleProfile(styleProfile);
}

function createPersonaContract({gender, styleExpression} = {}) {
  const normalizedGender = normalizeGender(gender);
  const normalizedExpression = STYLE_EXPRESSIONS.has(
    String(styleExpression || "").trim().toLowerCase(),
  ) ? String(styleExpression).trim().toLowerCase() : "auto";
  const allowedExpressions = normalizedGender === "female"
    ? ["feminine", "neutral"]
    : normalizedGender === "male"
      ? ["masculine", "neutral"]
      : ["feminine", "neutral", "masculine"];
  const disallowedExpressions = normalizedGender === "female"
    ? ["masculine"]
    : normalizedGender === "male" ? ["feminine"] : [];
  return Object.freeze({
    gender: normalizedGender,
    style_expression: normalizedExpression,
    allowed_expressions: Object.freeze(allowedExpressions),
    disallowed_expressions: Object.freeze(disallowedExpressions),
  });
}

function personaLookEvidence(look = {}) {
  const direction = look.look_direction || look.lookDirection || {};
  return [
    look.style,
    look.style_direction,
    look.styleDirection,
    typeof direction === "string" ? direction : direction.name,
    typeof direction === "object" ? direction.silhouette : "",
    look.styling_goal,
    look.stylingGoal,
    ...(Array.isArray(look.items) ? look.items.flatMap((item) => [
      item?.product_type,
      item?.productType,
      item?.item_name,
      item?.itemName,
      item?.product_family,
      item?.productFamily,
      item?.fit,
      item?.style_role,
      item?.styleRole,
      item?.silhouette,
      ...(Array.isArray(item?.design_elements) ? item.design_elements : []),
    ]) : []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function containsPersonaTerm(evidence, term) {
  if (/^[a-z][a-z\s-]*$/i.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped.replace(/\\\s+/g, "\\s+")}\\b`, "i")
      .test(evidence);
  }
  return evidence.includes(term);
}

function personaConsistencyAssessment(look = {}, contract = {}) {
  const expectedGender = normalizeGender(contract.gender);
  const lookGender = normalizeGender(look.gender);
  const itemGenders = (Array.isArray(look.items) ? look.items : [])
    .map((item) => normalizeGender(item?.gender))
    .filter((gender) => gender !== "unisex");
  const genderConflicts = [];
  if (expectedGender !== "unisex" && lookGender !== expectedGender) {
    genderConflicts.push("LOOK_GENDER_CONFLICT");
  }
  if (expectedGender !== "unisex" && itemGenders.some(
    (gender) => gender !== expectedGender,
  )) {
    genderConflicts.push("ITEM_GENDER_CONFLICT");
  }

  const evidence = personaLookEvidence(look);
  const matchedFemale = PERSONA_EVIDENCE_TERMS.female.filter(
    (term) => containsPersonaTerm(evidence, term),
  );
  const matchedMale = PERSONA_EVIDENCE_TERMS.male.filter(
    (term) => containsPersonaTerm(evidence, term),
  );
  const personaConflicts = [...genderConflicts];
  if (expectedGender === "female" && matchedMale.length > 0 &&
      matchedFemale.length === 0) {
    personaConflicts.push("MASCULINE_PERSONA_DRIFT");
  }
  if (expectedGender === "male" && matchedFemale.length > 0 &&
      matchedMale.length === 0) {
    personaConflicts.push("FEMININE_PERSONA_DRIFT");
  }
  const explicitSupport = expectedGender === "female"
    ? matchedFemale.length > 0
    : expectedGender === "male" ? matchedMale.length > 0 : false;
  const status = personaConflicts.length > 0
    ? PERSONA_CONSISTENCY_STATUS.FAIL
    : explicitSupport ? PERSONA_CONSISTENCY_STATUS.PASS
      : PERSONA_CONSISTENCY_STATUS.NEUTRAL;
  return Object.freeze({
    status,
    allowed: status !== PERSONA_CONSISTENCY_STATUS.FAIL,
    expected_gender: expectedGender,
    look_gender: lookGender,
    matched_female_evidence: Object.freeze(matchedFemale),
    matched_male_evidence: Object.freeze(matchedMale),
    conflicts: Object.freeze(personaConflicts),
  });
}

function createRecommendationContext({
  requestId,
  gender,
  scene,
  requestedStyle,
  styleExpression,
  styleSemantics,
  styleProfile,
  outfitBlueprint,
  bodyProfile,
  weather,
  budget,
  userInput,
} = {}) {
  const normalizedGender = normalizeGender(gender);
  const normalizedStyleProfile = normalizeStyleProfile(styleProfile, {
    sourceText: requestedStyle || userInput,
  });
  const resolvedStyleExpression = resolveStyleExpression({
    explicit: styleExpression,
    styleProfile: normalizedStyleProfile,
  });
  const value = {
    request_id: String(requestId || "").trim(),
    gender: normalizedGender,
    scene: String(scene || "").trim(),
    style_expression: resolvedStyleExpression,
    persona_contract: createPersonaContract({
      gender: normalizedGender,
      styleExpression: resolvedStyleExpression,
    }),
    style_semantics: normalizeStyleSemantics(styleSemantics),
    style_profile: normalizedStyleProfile,
    outfit_blueprint: normalizeOutfitBlueprint(outfitBlueprint, {
      styleProfile: normalizedStyleProfile,
      styleSemantics: normalizeStyleSemantics(styleSemantics),
    }),
    intent_priority_score: resolveIntentPriorityScore(normalizedStyleProfile),
    intent_weights: Object.freeze({
      look: LOOK_INTENT_WEIGHTS,
      product: PRODUCT_INTENT_WEIGHTS,
    }),
    body_profile: Object.freeze({...bodyProfile}),
    weather: Object.freeze({...weather}),
    budget: Object.freeze({...budget}),
  };
  return Object.freeze(value);
}

function assertContextGender(context, value, stage) {
  const expected = normalizeGender(context?.gender);
  const actual = normalizeGender(value);
  if (expected !== "unisex" && actual !== expected) {
    const error = new Error(`${stage || "downstream"} gender conflicts with request context`);
    error.code = "REQUEST_CONTEXT_GENDER_CONFLICT";
    throw error;
  }
  return expected === "unisex" ? actual : expected;
}

function logRecommendationStage(logger, stage, context, details = {}) {
  logger.info?.("RecommendationContext stage", {
    stage,
    request_id: context?.request_id || undefined,
    gender: context?.gender || "unisex",
    persona_gender: context?.persona_contract?.gender || "unisex",
    style_expression: context?.style_expression || "auto",
    style_profile_configured: Boolean(context?.style_profile?.source_text),
    style_semantics_configured: Boolean(
      context?.style_semantics?.interpretation_summary,
    ),
    outfit_blueprint_configured: Boolean(
      blueprintHasCoreItems(context?.outfit_blueprint),
    ),
    requested_style: context?.style_profile?.source_text || undefined,
    intent_priority_score: context?.intent_priority_score,
    style_weight: context?.intent_weights?.product?.style,
    weather_weight: context?.intent_weights?.product?.weather,
    ...details,
  });
}

module.exports = {
  PERSONA_CONSISTENCY_STATUS,
  STYLE_EXPRESSIONS,
  assertContextGender,
  createPersonaContract,
  createRecommendationContext,
  logRecommendationStage,
  personaConsistencyAssessment,
  personaLookEvidence,
  resolveStyleExpression,
};
