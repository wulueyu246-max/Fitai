"use strict";

const {
  EVAL_POLICY,
  STATUS,
  evaluateHumanGroundedWholeLook,
} = require("./evaluation/human_grounded_whole_look_eval_contract");
const {
  applyFemaleNightlifeScoringContract,
} = require("./female_nightlife_scoring_adapter");

const WHOLE_LOOK_HUMAN_GROUNDED_SCORE_VERSION =
  "whole_look_human_grounded_score.v1";
const DESIGN_SIGNAL_VALUES = new Set(["design_expression", "design_led"]);
const CONTEMPORARY_SIGNAL_VALUES = new Set([
  "contemporary", "fashion_forward", "trend_mention",
]);
const STRUCTURAL_INTEREST_VALUES = new Set([
  "cropped", "a_line", "wide_leg", "oversized", "fitted", "longline",
  "cropped_proportion", "waist_definition", "relaxed_volume",
]);
const STATEMENT_DETAIL_PATTERN =
  /厚底|松糕|异形|金属|拼色|撞色|漆皮|尖头|粗跟|短靴|长靴|platform|chunky|sculptural|metallic/iu;

function evaluateProductionWholeLook({
  entries = [],
  strategyTrace = {},
  context = {},
  target = {},
  lookCandidateId = null,
} = {}) {
  const intent = authoritativeIntent(context);
  const sample = buildProductionAssessment({
    entries,
    strategyTrace,
    intent,
    target,
    lookCandidateId,
  });
  const evaluation = evaluateHumanGroundedWholeLook(sample);
  const evidenceCoverage = round(
    evaluation.baseline_integrity.coverage * EVAL_POLICY.baseline_weight +
    evaluation.intent_expression.coverage * EVAL_POLICY.intent_expression_weight,
    4,
  );
  const dimensionScores = legacyDimensionAliases(evaluation);
  const authorityFailures = [];
  if (!sample.authority_checks.formality_consumed) {
    authorityFailures.push("FORMALITY_EVIDENCE_MISSING");
  }
  if (!sample.authority_checks.explicit_avoid_consumed) {
    authorityFailures.push("EXPLICIT_AVOID_VIOLATION");
  }
  const failureReasons = unique([
    ...evaluation.reason_codes,
    ...authorityFailures,
  ]);
  const passed = evaluation.passed && authorityFailures.length === 0;

  return deepFreeze({
    version: WHOLE_LOOK_HUMAN_GROUNDED_SCORE_VERSION,
    status: passed ? "PASS" : "FAIL",
    passed,
    pass: passed,
    baseline_integrity_score: evaluation.baseline_integrity.score,
    intent_expression_score: evaluation.intent_expression.score,
    evidence_coverage: evidenceCoverage,
    evidence_coverage_by_layer: {
      baseline_integrity: evaluation.baseline_integrity.coverage,
      intent_expression: evaluation.intent_expression.coverage,
      required_intent: requiredEvidenceCoverage(evaluation),
    },
    final_score: evaluation.overall_score,
    overall_score: evaluation.overall_score,
    overall_floor: EVAL_POLICY.overall_floor,
    baseline_floor: EVAL_POLICY.baseline_floor,
    intent_expression_floor: EVAL_POLICY.intent_expression_floor,
    dimension_scores: dimensionScores,
    baseline_integrity: evaluation.baseline_integrity,
    intent_expression: evaluation.intent_expression,
    intent_authority: sample.intent_authority,
    scene_scoring_contract: sample.scene_scoring_contract,
    authority_checks: sample.authority_checks,
    target_fidelity: evaluation.target_fidelity,
    required_intent_dimensions: evaluation.required_intent_dimensions,
    missing_required_intent_evidence:
      evaluation.missing_required_intent_evidence,
    failure_reasons: failureReasons,
    reason_codes: failureReasons,
    defaulted_dimensions: [],
    dimension_score_provenance: dimensionProvenance(evaluation),
    calibration_provenance: {
      source: "human_grounded_pairwise_contract_v1",
      source_kind: "human_grounded_whole_look_evidence",
      scale: "0_to_100",
      unknown_policy: "NULL_NEVER_DEFAULT_60",
      baseline_compensates_intent: false,
    },
  });
}

function buildProductionAssessment({
  entries,
  strategyTrace,
  intent,
  target,
  lookCandidateId,
}) {
  const sceneIntegration = applyFemaleNightlifeScoringContract(
    requiredIntentDimensionsFor(intent),
    intent,
  );
  const requiredIntentDimensions = sceneIntegration.required_intent_dimensions;
  const baselineIntegrity = {
    category_integrity: categoryIntegrity(entries),
    gender_integrity: aggregateTargetFit(entries, "audience_fit"),
    body_fit: numericAssessment(
      strategyTrace.bodyProportion,
      "outfit_strategy.body_proportion",
      entries,
    ),
    color_harmony: numericAssessment(
      strategyTrace.colorHarmony,
      "outfit_strategy.color_harmony",
      entries,
    ),
    footwear_compatibility: numericAssessment(
      strategyTrace.footwearCompatibility,
      "outfit_strategy.footwear_compatibility",
      entries.filter(({requirement}) => requirement?.category === "shoes"),
    ),
    quality_consistency: qualityConsistency(entries, strategyTrace),
    silhouette_coherence: numericAssessment(
      strategyTrace.silhouetteCoherence,
      "outfit_strategy.silhouette_coherence",
      entries,
    ),
  };

  const sceneExpression = sceneExpressionAssessment(entries, strategyTrace, intent);
  const desiredImpression = intent.desired_impression.length > 0
    ? aggregateTargetFit(entries, "desired_impression_fit")
    : notApplicable("no_explicit_desired_impression");
  const contemporary = contemporaryAssessment(entries, intent);
  const designInterest = designInterestAssessment(entries, intent);
  const silhouetteInterest = silhouetteInterestAssessment(entries, intent);
  const colorStory = colorStoryAssessment(entries, strategyTrace);
  const footwearStatement = footwearStatementAssessment(entries, intent);
  const stylingDistinction = derivedExpressionAssessment(
    "styling_distinction",
    [designInterest, silhouetteInterest, colorStory, footwearStatement],
    intent.statement_strength,
  );
  const memorability = derivedExpressionAssessment(
    "overall_memorability",
    [designInterest, silhouetteInterest, footwearStatement, stylingDistinction],
    intent.statement_strength,
  );
  const targetContract = targetContractFor(intent, requiredIntentDimensions);

  return {
    sample_id: String(lookCandidateId || "production-look"),
    human_score: null,
    required_intent_dimensions: requiredIntentDimensions,
    scene_scoring_contract: sceneIntegration.scene_contract,
    target_contract: targetContract,
    baseline_integrity: baselineIntegrity,
    intent_expression: {
      scene_expression_strength: sceneExpression,
      desired_impression_coverage: desiredImpression,
      design_interest: designInterest,
      contemporary_expression: contemporary,
      silhouette_interest: silhouetteInterest,
      color_story: colorStory,
      footwear_statement: footwearStatement,
      styling_distinction: stylingDistinction,
      overall_memorability: memorability,
    },
    intent_authority: deepFreeze({
      source: "decision_context.user_intent_brain",
      gender: intent.gender,
      scene: intent.scene,
      desired_impression: intent.desired_impression,
      formality_preference: intent.formality_preference,
      statement_preference: intent.statement_preference,
      explicit_avoid: intent.explicit_avoid,
      target_profile_role: "SUPPORTING_ONLY",
      explicit_intent_overridden_by_target_profile: false,
      target_profile_id: target?.id || target?.profile_id || null,
    }),
    authority_checks: deepFreeze({
      formality_consumed: intent.formality_preference == null ||
        Number.isFinite(Number(strategyTrace.formality)),
      explicit_avoid_consumed: intent.explicit_avoid.length === 0 ||
        entries.every(({product}) => !hasAcceptanceReject(product)),
    }),
  };
}

function authoritativeIntent(context = {}) {
  const decision = context.decision_context ||
    context.recommendation_context?.decision_context || context;
  const brain = decision?.intent?.user_intent_brain ||
    context?.intent?.user_intent_brain || {};
  const truth = decision?.user_truth || context.user_truth ||
    context.user_requirements || {};
  const gender = clean(valueOf(brain.gender) || truth.gender || context.gender)
    .toLowerCase();
  const desired = unique(list(valueOf(brain.desired_impression) ||
    truth.desired_impression || context.desired_impression));
  const scene = clean(valueOf(brain.scene_intent) || truth.scene || context.scene);
  const formality = clean(valueOf(brain.formality_preference) ||
    truth.formality_preference || context.formality_preference);
  const statement = clean(valueOf(brain.statement_level) ||
    truth.statement_level || context.statement_level).toLowerCase();
  return deepFreeze({
    gender,
    scene,
    scene_source: brain.scene_intent?.source ||
      (truth.scene ? "user_truth" : "unknown"),
    desired_impression: desired,
    desired_impression_source: brain.desired_impression?.source ||
      (desired.length ? "user_truth" : "unknown"),
    formality_preference: formality || null,
    formality_source: brain.formality_preference?.source || "unknown",
    statement_preference: statement || null,
    statement_strength: statementStrength(statement),
    statement_source: brain.statement_level?.source || "unknown",
    trend_preference: clean(valueOf(brain.trend_preference)),
    explicit_avoid: unique(list(valueOf(brain.explicit_avoid) ||
      truth.explicit_avoid || context.explicit_avoid)),
  });
}

function requiredIntentDimensionsFor(intent) {
  const required = [];
  if (intent.scene) required.push("scene_expression_strength");
  if (intent.desired_impression.length > 0) {
    required.push("desired_impression_coverage");
  }
  if (intent.statement_strength >= 0.5) required.push("design_interest");
  if (intent.trend_preference) required.push("contemporary_expression");
  return unique(required);
}

function targetContractFor(intent, requiredDimensions) {
  const values = {
    scene_expression_strength: intent.scene,
    desired_impression_coverage: intent.desired_impression.join("|"),
    design_interest: intent.statement_preference,
    contemporary_expression: intent.trend_preference,
  };
  const explicitRequirements = requiredDimensions.map((dimension) => ({
    dimension,
    value: values[dimension] || "required",
  }));
  return {
    explicit_requirements: explicitRequirements,
    resolved_requirements: explicitRequirements.map((requirement) => ({
      ...requirement,
      source: "user_intent",
    })),
  };
}

function sceneExpressionAssessment(entries, strategyTrace, intent) {
  if (!intent.scene) return notApplicable("no_scene_intent");
  const occasion = aggregateTargetFit(entries, "occasion_fit");
  if (occasion.status !== STATUS.EVIDENCED) return occasion;
  const formality = Number(strategyTrace.formality);
  if (!intent.formality_preference || !Number.isFinite(formality)) return occasion;
  return evidenced(
    Math.min(occasion.score, bounded(formality)),
    `${occasion.source}+outfit_strategy.formality`,
    Math.min(occasion.confidence ?? 0.5, 0.9),
    [...occasion.evidence, `formality:${intent.formality_preference}`],
  );
}

function contemporaryAssessment(entries, intent) {
  const expected = intent.desired_impression.length > 0 ||
    Boolean(intent.trend_preference) || intent.statement_strength >= 0.5;
  if (!expected) return notApplicable("no_contemporary_expression_target");
  return aggregateTargetFit(entries, "contemporary_fit");
}

function designInterestAssessment(entries, intent) {
  if (intent.statement_strength < 0.5) {
    return notApplicable("no_statement_or_design_target");
  }
  const records = entries.flatMap(({product}) => [
    semanticRecord(product, "style_expression"),
    semanticRecord(product, "desired_impression_evidence"),
  ]).filter(Boolean);
  const designRecords = records.filter((record) =>
    record.values.some((value) => DESIGN_SIGNAL_VALUES.has(value)));
  if (designRecords.length === 0) return unknown("product_design_evidence_missing");
  const coverage = unique(designRecords.map(({candidate_id}) => candidate_id)).length /
    Math.max(1, entries.length);
  const confidence = Math.max(...designRecords.map(({confidence}) => confidence));
  const actualStrength = Math.min(100, 76 + coverage * 18);
  return evidenced(
    actualStrength,
    unique(designRecords.map(({source}) => source)).join("+"),
    confidence,
    unique(designRecords.flatMap(({evidence}) => evidence)),
  );
}

function silhouetteInterestAssessment(entries, intent) {
  if (intent.statement_strength < 0.5) {
    return notApplicable("no_silhouette_interest_target");
  }
  const records = entries.map(({product}) =>
    semanticRecord(product, "silhouette_evidence")).filter(Boolean);
  if (records.length === 0) return unknown("product_silhouette_evidence_missing");
  const tokens = unique(records.flatMap(({values}) => values)
    .filter((value) => STRUCTURAL_INTEREST_VALUES.has(value)));
  if (tokens.length === 0) return unknown("silhouette_interest_not_observed");
  const relationBonus = hasComplementarySilhouette(entries) ? 14 : 0;
  const designBonus = entries.some(({product}) =>
    semanticValues(product, "style_expression").some((value) =>
      DESIGN_SIGNAL_VALUES.has(value))) ? 10 : 0;
  return evidenced(
    Math.min(92, 42 + tokens.length * 10 + relationBonus + designBonus),
    unique(records.map(({source}) => source)).join("+"),
    Math.max(...records.map(({confidence}) => confidence)),
    unique(records.flatMap(({evidence}) => evidence)),
  );
}

function colorStoryAssessment(entries, strategyTrace) {
  const colors = entries.map(({product}) => semanticValues(product, "color_evidence")[0] ||
    clean(product.color || product.color_label)).filter(Boolean).map(normalizeToken);
  if (colors.length < 2) return unknown("product_color_evidence_insufficient");
  const uniqueColors = unique(colors);
  const counts = new Map(colors.map((color) => [
    color,
    colors.filter((entry) => entry === color).length,
  ]));
  const repeated = Math.max(...counts.values()) >= 2;
  const structure = uniqueColors.length === 1 ? 82 :
    uniqueColors.length === 2 && repeated ? 86 :
      uniqueColors.length === 2 ? 74 : uniqueColors.length === 3 ? 56 : 35;
  const harmony = Number(strategyTrace.colorHarmony);
  const score = Number.isFinite(harmony)
    ? structure * 0.58 + bounded(harmony) * 0.42
    : structure;
  return evidenced(
    score,
    "product_color_evidence+outfit_strategy.color_harmony",
    0.82,
    colors.map((color) => `color:${color}`),
  );
}

function footwearStatementAssessment(entries, intent) {
  if (intent.statement_strength < 0.5) {
    return notApplicable("no_footwear_statement_target");
  }
  const shoe = entries.find(({requirement}) => requirement?.category === "shoes");
  if (!shoe) return unknown("shoe_candidate_missing");
  const text = productText(shoe.product);
  const designSignals = [
    ...semanticValues(shoe.product, "style_expression"),
    ...semanticValues(shoe.product, "desired_impression_evidence"),
  ];
  const contemporarySignals = semanticValues(
    shoe.product,
    "contemporary_expression",
  );
  const evidence = semanticEvidence(shoe.product, [
    "footwear_evidence",
    "style_expression",
    "desired_impression_evidence",
    "contemporary_expression",
  ]);
  if (!evidence.length && !text) return unknown("footwear_statement_evidence_missing");
  let score = 42;
  if (designSignals.some((value) => DESIGN_SIGNAL_VALUES.has(value))) score += 28;
  if (contemporarySignals.some((value) => CONTEMPORARY_SIGNAL_VALUES.has(value))) {
    score += 12;
  }
  if (STATEMENT_DETAIL_PATTERN.test(text)) score += 18;
  return evidenced(
    Math.min(95, score),
    "product_footwear_visual_text_evidence",
    evidence.length ? 0.82 : 0.58,
    evidence.length ? evidence : [`title:${clean(shoe.product.title)}`],
  );
}

function derivedExpressionAssessment(name, assessments, statementStrengthValue) {
  if (statementStrengthValue < 0.5) {
    return notApplicable(`no_${name}_target`);
  }
  const evidencedInputs = assessments.filter((assessment) =>
    assessment.status === STATUS.EVIDENCED && Number.isFinite(assessment.score));
  if (evidencedInputs.length < 2) return unknown(`${name}_evidence_insufficient`);
  const scores = evidencedInputs.map(({score}) => score);
  return evidenced(
    average(scores) * 0.7 + Math.min(...scores) * 0.3,
    `derived_product_evidence.${name}`,
    Math.min(...evidencedInputs.map(({confidence}) => confidence ?? 0.5)),
    unique(evidencedInputs.flatMap(({evidence}) => evidence)).slice(0, 16),
  );
}

function categoryIntegrity(entries) {
  const categories = new Set(entries.map(({requirement, product}) =>
    clean(requirement?.category || product?.category)));
  const separates = categories.has("top") && categories.has("bottom") &&
    categories.has("shoes");
  const dress = categories.has("dress") && categories.has("shoes") &&
    !categories.has("top") && !categories.has("bottom");
  return evidenced(
    separates || dress ? 100 : 0,
    "candidate_structure",
    1,
    [...categories].map((category) => `slot:${category}`),
  );
}

function qualityConsistency(entries, strategyTrace) {
  const assessment = aggregateTargetFit(entries, "quality_fit");
  const material = Number(strategyTrace.materialTexture);
  if (assessment.status !== STATUS.EVIDENCED) {
    return Number.isFinite(material)
      ? numericAssessment(material, "outfit_strategy.material_texture", entries)
      : assessment;
  }
  if (!Number.isFinite(material)) return assessment;
  return evidenced(
    Math.min(assessment.score, bounded(material)),
    `${assessment.source}+outfit_strategy.material_texture`,
    assessment.confidence,
    [...assessment.evidence, "material_texture:whole_look"],
  );
}

function aggregateTargetFit(entries, dimension) {
  const records = entries.map(({product}) => ({
    candidate_id: productId(product),
    record: product?.target_fit_assessment?.[dimension],
  })).filter(({record}) => isObservedTargetFit(record));
  if (records.length === 0) return unknown(`target_fit.${dimension}:missing`);
  const scores = records.map(({record}) => Number(record.score));
  const mean = average(scores);
  const score = mean * 0.68 + Math.min(...scores) * 0.32;
  return evidenced(
    score,
    unique(records.map(({record}) => record.source)).join("+"),
    Math.min(...records.map(({record}) => Number(record.confidence) || 0.5)),
    unique(records.flatMap(({candidate_id, record}) =>
      list(record.evidence).map((item) => `${candidate_id}:${item}`))),
  );
}

function isObservedTargetFit(record) {
  if (!record || typeof record !== "object") return false;
  const status = String(record.status || "").toUpperCase();
  return !["", "UNKNOWN", "NOT_APPLICABLE"].includes(status) &&
    Number.isFinite(Number(record.score)) &&
    Number(record.confidence) > 0 && list(record.evidence).length > 0 &&
    !String(record.source || "").startsWith("unknown");
}

function semanticRecord(product, key) {
  const record = product?.candidate_enrichment?.[key];
  const values = list(record?.value).map(normalizeToken).filter(Boolean);
  const evidence = list(record?.evidence);
  const confidence = Number(record?.confidence);
  if (values.length === 0 || evidence.length === 0 || !(confidence > 0)) return null;
  return {
    candidate_id: productId(product),
    values,
    evidence,
    confidence: clamp01(confidence),
    source: clean(record.source) || "candidate_enrichment",
  };
}

function semanticValues(product, key) {
  return semanticRecord(product, key)?.values || [];
}

function semanticEvidence(product, keys) {
  return unique(keys.flatMap((key) => semanticRecord(product, key)?.evidence || []));
}

function hasComplementarySilhouette(entries) {
  const top = entries.find(({requirement}) => requirement?.category === "top");
  const bottom = entries.find(({requirement}) => requirement?.category === "bottom");
  if (!top || !bottom) return false;
  const topValues = new Set(semanticValues(top.product, "silhouette_evidence"));
  const bottomValues = new Set(semanticValues(bottom.product, "silhouette_evidence"));
  const definedTop = topValues.has("cropped") || topValues.has("fitted");
  const shapedBottom = bottomValues.has("a_line") ||
    bottomValues.has("wide_leg") || bottomValues.has("straight");
  return definedTop && shapedBottom;
}

function numericAssessment(value, source, entries) {
  const score = Number(value);
  if (!Number.isFinite(score)) return unknown(`${source}:missing`);
  return evidenced(
    score,
    source,
    0.75,
    entries.map(({product}) => `candidate:${productId(product)}`).filter(Boolean),
  );
}

function evidenced(score, source, confidence, evidence) {
  const items = unique(list(evidence));
  if (!Number.isFinite(Number(score)) || items.length === 0 || !clean(source)) {
    return unknown("invalid_evidenced_assessment");
  }
  return {
    status: STATUS.EVIDENCED,
    score: bounded(score),
    source: clean(source),
    confidence: clamp01(confidence),
    evidence: items,
  };
}

function unknown(source) {
  return {
    status: STATUS.UNKNOWN,
    score: null,
    source: clean(source) || "unknown_product_evidence",
    confidence: 0,
    evidence: [],
  };
}

function notApplicable(source) {
  return {
    status: STATUS.NOT_APPLICABLE,
    score: null,
    source: clean(source) || "not_applicable",
    confidence: 1,
    evidence: [],
  };
}

function legacyDimensionAliases(evaluation) {
  const baseline = evaluation.baseline_integrity.dimensions;
  const intent = evaluation.intent_expression.dimensions;
  return deepFreeze({
    scene: intent.scene_expression_strength.score,
    desired_impression: intent.desired_impression_coverage.score,
    contemporary: intent.contemporary_expression.score,
    style: averageOrNull([
      intent.desired_impression_coverage.score,
      intent.design_interest.score,
      intent.styling_distinction.score,
    ]),
    silhouette: minimumOrNull([
      baseline.silhouette_coherence.score,
      intent.silhouette_interest.score,
    ]),
    color: minimumOrNull([
      baseline.color_harmony.score,
      intent.color_story.score,
    ]),
    footwear: minimumOrNull([
      baseline.footwear_compatibility.score,
      intent.footwear_statement.score,
    ]),
    quality: baseline.quality_consistency.score,
    body: baseline.body_fit.score,
    statement: averageOrNull([
      intent.design_interest.score,
      intent.styling_distinction.score,
      intent.overall_memorability.score,
    ]),
  });
}

function dimensionProvenance(evaluation) {
  const baseline = evaluation.baseline_integrity.dimensions;
  const intent = evaluation.intent_expression.dimensions;
  return deepFreeze({
    baseline_integrity: Object.fromEntries(Object.entries(baseline)
      .map(([key, value]) => [key, value.source])),
    intent_expression: Object.fromEntries(Object.entries(intent)
      .map(([key, value]) => [key, value.source])),
  });
}

function requiredEvidenceCoverage(evaluation) {
  const required = evaluation.required_intent_dimensions;
  if (required.length === 0) return 1;
  return round((required.length - evaluation.missing_required_intent_evidence.length) /
    required.length, 4);
}

function hasAcceptanceReject(product) {
  return product?.hard_reject === true || product?.has_hard_reject === true ||
    String(product?.product_acceptance_result || "").toUpperCase() === "HARD_REJECT";
}

function productText(product = {}) {
  return [
    product.title,
    product.name,
    product.category,
    product.subcategory,
    product.search_subcategory,
    product.style_tags,
    product.silhouette_tags,
    product.detail_tags,
  ].flat(Infinity).filter(Boolean).join(" ");
}

function valueOf(record) {
  return record && typeof record === "object" && Object.hasOwn(record, "value")
    ? record.value : record;
}

function statementStrength(value) {
  const levels = {none: 0, low: 0.25, medium: 0.6, high: 0.85, bold: 1};
  return levels[clean(value).toLowerCase()] ?? 0;
}

function productId(product) {
  return clean(product?.candidate_id || product?.product_id || product?.id);
}

function normalizeToken(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function minimumOrNull(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? round(Math.min(...finite)) : null;
}

function averageOrNull(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? round(average(finite)) : null;
}

function average(values) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : 0;
}

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, round(number))) : 0;
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function list(value) {
  return (Array.isArray(value) ? value : [value]).flat(Infinity)
    .filter((item) => item !== undefined && item !== null && item !== "");
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  WHOLE_LOOK_HUMAN_GROUNDED_SCORE_VERSION,
  authoritativeIntent,
  buildProductionAssessment,
  evaluateProductionWholeLook,
};
