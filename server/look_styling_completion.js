"use strict";

const {canonicalProductIdentity} = require("./product_acceptance_gate");
const {
  STYLING_COMPLETION_AUTHORITY,
  normalizeGender,
} = require("./product_relevance");

const LOOK_STYLING_COMPLETION_VERSION = "look_styling_completion.v1";
const LOOK_STYLING_COMPLETENESS_VERSION = "look_styling_completeness.v1";
const OPTIONAL_STYLING_SLOTS = Object.freeze([
  "bag",
  "socks",
  "hosiery",
  "accessory",
  "belt",
  "outerwear",
  "headwear",
]);
const MIN_COMPLETION_DELTA = 1.5;
const MAX_COMPLETION_REQUIREMENTS = 16;

const COLOR_PATTERNS = Object.freeze({
  black: /(?:黑色|黑\b|black)/iu,
  white: /(?:白色|米白|象牙白|白\b|white|ivory)/iu,
  beige: /(?:米色|燕麦|卡其|驼色|杏色|beige|khaki|camel)/iu,
  grey: /(?:灰色|灰\b|gray|grey)/iu,
  navy: /(?:藏青|海军蓝|navy)/iu,
  blue: /(?:蓝色|蓝\b|blue)/iu,
  brown: /(?:棕色|咖色|褐色|brown|coffee)/iu,
  pink: /(?:粉色|粉\b|pink)/iu,
  red: /(?:红色|酒红|红\b|red|burgundy)/iu,
  green: /(?:绿色|绿\b|green)/iu,
  yellow: /(?:黄色|黄\b|yellow)/iu,
  purple: /(?:紫色|紫\b|purple)/iu,
});
const NEUTRAL_COLORS = new Set(["black", "white", "beige", "grey", "navy", "brown"]);
const FOCAL_PATTERN = /(?:设计感|剪裁|褶|百褶|刺绣|蕾丝|蝴蝶结|金属|撞色|印花|荷叶边|泡泡袖|不对称|结构感|statement|detail|pleat|texture)/iu;
const REFINED_PATTERN = /(?:精致|利落|简洁|学院|乐福|玛丽珍|芭蕾|尖头|低跟|高级|refined|polished|tailored|clean)/iu;
const CASUAL_PATTERN = /(?:休闲|轻便|松弛|帆布|运动|街头|casual|relaxed|sport|sneaker)/iu;
const SKIRT_PATTERN = /(?:裙|skirt|dress)/iu;
const WAIST_PATTERN = /(?:高腰|收腰|腰线|短款|cropped|high.?waist|defined.?waist)/iu;

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function bounded(value) {
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100) / 100));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function average(values, fallback = 0) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length > 0
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : fallback;
}

function valueOf(evidence, fallback = null) {
  return evidence && typeof evidence === "object" &&
      Object.hasOwn(evidence, "value")
    ? evidence.value
    : evidence ?? fallback;
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

function evidenceText(product = {}) {
  return [
    product.title,
    product.name,
    product.category,
    product.subcategory,
    product.search_subcategory,
    product.color,
    product.color_label,
    product.style,
    product.style_tags,
    product.aesthetic_tags,
    product.silhouette,
    product.silhouette_tags,
    product.detail_tags,
    product.material,
    product.fit,
    product.footwear,
    product.occasion_tags,
    product.tags,
  ].flat(Infinity).filter(Boolean).join(" ").toLowerCase();
}

function completionSlot(product = {}) {
  const explicit = String(
    product.styling_completion_slot || product.styling_slot || product.slot || "",
  ).trim().toLowerCase();
  if (OPTIONAL_STYLING_SLOTS.includes(explicit)) return explicit;
  const category = String(product.category || "").trim().toLowerCase();
  const subcategory = String(
    product.search_subcategory || product.subcategory || "",
  ).trim().toLowerCase();
  if (category === "bag" || subcategory === "bag") return "bag";
  if (subcategory === "socks") {
    return /(?:丝袜|连裤袜|stocking|hosiery|tights)/iu.test(evidenceText(product))
      ? "hosiery" : "socks";
  }
  if (subcategory === "belt") return "belt";
  if (category === "outerwear") return "outerwear";
  if (category === "hat" || subcategory === "hat") return "headwear";
  if (category === "accessory") return "accessory";
  return "";
}

function isCoreProduct(product = {}) {
  return ["top", "bottom", "dress", "shoes"].includes(
    String(product.category || "").toLowerCase(),
  ) && !completionSlot(product);
}

function selectedProducts(look = {}) {
  return Array.isArray(look.selected_products) ? look.selected_products : [];
}

function coreProducts(look = {}) {
  return selectedProducts(look).filter(isCoreProduct);
}

function optionalProducts(look = {}) {
  return selectedProducts(look).filter((product) => completionSlot(product));
}

function detectColors(products = []) {
  const found = [];
  for (const product of products) {
    const evidence = evidenceText(product);
    for (const [color, pattern] of Object.entries(COLOR_PATTERNS)) {
      if (pattern.test(evidence)) found.push(color);
    }
  }
  return found;
}

function dimension(score, reason, confidence) {
  return Object.freeze({
    score: bounded(score),
    reason: String(reason || "NO_EVIDENCE"),
    confidence: bounded(confidence) / 100,
  });
}

function targetProfileFor({look = {}, contract = {}, decisionContext = {}} = {}) {
  const direct = contract?.style_target?.aesthetic_target_profile ||
    contract?.aesthetic_target_profile || look?.aesthetic_target_profile;
  if (direct) return direct;
  return (Array.isArray(decisionContext?.style_targets)
    ? decisionContext.style_targets : []).find((entry) =>
    entry?.concept_id === (look.concept_id || contract.concept_id))
    ?.aesthetic_target_profile || {};
}

function bodySignalsFor({look = {}, contract = {}, decisionContext = {}} = {}) {
  return {
    ...(decisionContext?.body_fit_profile?.recommendations || {}),
    ...(decisionContext?.body_fit_profile?.strategy || {}),
    ...(decisionContext?.body_fit_profile?.optional_styling || {}),
    ...(contract?.concept?.body_fit_strategy || {}),
    ...(look?.body_fit_strategy || {}),
  };
}

function targetScalar(target, paths, fallback) {
  for (const path of paths) {
    let value = target;
    for (const part of path.split(".")) value = value?.[part];
    const resolved = valueOf(value);
    if (resolved == null || resolved === "") continue;
    if (Number.isFinite(Number(resolved))) return Number(resolved);
  }
  return fallback;
}

function diagnosisContext({look, contract, decisionContext}) {
  const products = selectedProducts(look);
  const core = products.filter(isCoreProduct);
  const optionals = products.filter((product) => completionSlot(product));
  const target = targetProfileFor({look, contract, decisionContext});
  const body = bodySignalsFor({look, contract, decisionContext});
  const evidence = core.map(evidenceText);
  const colors = detectColors(products);
  const coreColors = detectColors(core);
  const coreColorSet = new Set(coreColors);
  const colorCounts = new Map(colors.map((color) => [
    color,
    colors.filter((entry) => entry === color).length,
  ]));
  const distinctColors = [...colorCounts.keys()];
  const focalCount = products.filter((product) => FOCAL_PATTERN.test(evidenceText(product))).length;
  const refinedCount = products.filter((product) => REFINED_PATTERN.test(evidenceText(product))).length;
  const skirtOrDress = core.some((product) =>
    product.category === "dress" ||
    (product.category === "bottom" && SKIRT_PATTERN.test(evidenceText(product))));
  const hasWaistDefinition = core.some((product) => WAIST_PATTERN.test(evidenceText(product)));
  const byOptional = new Set(optionals.map(completionSlot));
  const isolatedAnchor = distinctColors.some((color) =>
    colorCounts.get(color) === 1 && NEUTRAL_COLORS.has(color)) &&
    distinctColors.length >= 2;
  const maxMainColors = targetScalar(target, ["color_targets.max_main_colors"], 3);
  const focalTarget = targetScalar(target, ["focal_hierarchy.max_focal_points"], 1);
  const focalStrength = targetScalar(target, ["focal_hierarchy.strength"], 0.45);
  const layeringTarget = targetScalar(target, [
    "layering_targets.complexity",
    "layering_profile.complexity",
  ], 0.4);
  const statementTarget = targetScalar(target, [
    "accessory_targets.statement_strength",
    "accessory_profile.statement_strength",
    "dimensions.statement_level",
  ], 0.42);
  const restraint = layeringTarget <= 0.32 && focalTarget <= 1 && statementTarget <= 0.42;
  return {
    products,
    core,
    optionals,
    target,
    body,
    evidence,
    distinctColors,
    colorCounts,
    coreColors,
    coreColorSet,
    focalCount,
    refinedCount,
    skirtOrDress,
    hasWaistDefinition,
    byOptional,
    isolatedAnchor,
    maxMainColors,
    focalTarget,
    focalStrength,
    layeringTarget,
    statementTarget,
    restraint,
  };
}

function diagnoseStylingCompletion({
  look = {},
  decisionContext = {},
  contract = {},
} = {}) {
  const state = diagnosisContext({look, contract, decisionContext});
  const optionalCount = state.optionals.length;
  const coreCount = state.core.length;
  const mainColorCount = state.distinctColors.length;
  const hasBag = state.byOptional.has("bag");
  const hasLegwear = state.byOptional.has("socks") || state.byOptional.has("hosiery");
  const hasAccessory = state.byOptional.has("accessory") ||
    state.byOptional.has("belt") || state.byOptional.has("headwear");
  const hasOuterwear = state.byOptional.has("outerwear");
  const hasBelt = state.byOptional.has("belt");
  const maxFocal = Math.max(1, state.focalTarget);

  let visualHierarchy = 58 + Math.min(state.focalCount, maxFocal) * 17;
  if (state.focalCount > maxFocal) visualHierarchy -= (state.focalCount - maxFocal) * 17;
  if (hasBag) visualHierarchy += 7;
  if (hasBelt && !state.hasWaistDefinition) visualHierarchy += 8;

  let colorEcho = mainColorCount === 0 ? 60
    : mainColorCount === 1 ? 88
      : mainColorCount <= state.maxMainColors ? 72 : 44;
  if (state.isolatedAnchor) colorEcho -= 18;
  // An optional item only earns an echo bonus by repeating an existing Core
  // Look color. Comparing against the merged palette would let a conflicting
  // new color match itself and falsely improve harmony.
  if (state.optionals.some((item) => detectColors([item]).some((color) =>
    state.coreColorSet.has(color)))) colorEcho += 16;

  let stylingDepth = coreCount >= 3 ? 55 : 48;
  stylingDepth += Math.min(18, state.focalCount * 5);
  stylingDepth += Math.min(24, optionalCount * 10);
  if (hasOuterwear) stylingDepth += 7;

  let focalPoint = state.focalCount === 0 ? 43
    : state.focalCount <= maxFocal ? 82 : 56;
  if (state.focalStrength >= 0.65 && state.focalCount === 1) focalPoint += 6;

  const legLineContinuity = targetScalar(
    state.body,
    ["leg_line_continuity"],
    0.5,
  );
  let legStyling = !state.skirtOrDress ? 78 : hasLegwear ? 86 : 44;
  if (state.skirtOrDress && !hasLegwear && legLineContinuity > 0.5) {
    legStyling -= Math.min(8, (legLineContinuity - 0.5) * 16);
  }
  if (state.skirtOrDress && state.core.some((product) =>
    product.category === "shoes" && REFINED_PATTERN.test(evidenceText(product)))) {
    legStyling += hasLegwear ? 5 : 3;
  }

  const scene = String(
    look.scene || contract.scene || decisionContext?.user_truth?.scene || "",
  ).toLowerCase();
  const socialUse = /(?:date|night|party|ktv|travel|daily|约会|聚会|夜|出游)/iu.test(scene);
  let bagIntegration = hasBag ? 84 : socialUse ? 48 : 64;
  if (state.restraint && visualHierarchy >= 75) bagIntegration += 12;

  let accessoryNeed = hasAccessory ? 84 : state.focalCount === 0 ? 46 : 68;
  if (state.restraint) accessoryNeed += 12;

  let layeringNeed = hasOuterwear ? 86 : state.layeringTarget >= 0.62 ? 45 : 72;
  if (stylingDepth < 55 && state.layeringTarget >= 0.45) layeringNeed -= 8;

  const contemporaryEvidence = state.core.map((product) => {
    const acceptance = product?.product_acceptance_evidence || {};
    const value = acceptance?.contemporary_fit?.value ??
      acceptance?.contemporary_fit?.score ?? product?.contemporary_fit_score;
    if (Number.isFinite(Number(value))) return Number(value);
    const text = evidenceText(product);
    return FOCAL_PATTERN.test(text) || REFINED_PATTERN.test(text) ? 77
      : CASUAL_PATTERN.test(text) ? 68 : 61;
  });
  let contemporaryExpression = average(contemporaryEvidence, 62);
  if (state.optionals.some((product) =>
    FOCAL_PATTERN.test(evidenceText(product)) || REFINED_PATTERN.test(evidenceText(product)))) {
    contemporaryExpression += 7;
  }

  let overStylingRisk = optionalCount * 16 + Math.max(0, state.focalCount - maxFocal) * 21;
  if (state.restraint) overStylingRisk += optionalCount * 12;
  if (state.focalCount >= maxFocal + 1 && optionalCount > 0) overStylingRisk += 12;

  const dimensions = Object.freeze({
    visual_hierarchy: dimension(
      visualHierarchy,
      visualHierarchy < 62 ? "VISUAL_HIERARCHY_UNDER_DEFINED" : "VISUAL_HIERARCHY_ESTABLISHED",
      82,
    ),
    color_echo: dimension(
      colorEcho,
      state.isolatedAnchor ? "ISOLATED_COLOR_ANCHOR" :
        mainColorCount > state.maxMainColors ? "TOO_MANY_MAIN_COLORS" : "COLOR_SYSTEM_COHERENT",
      mainColorCount > 0 ? 86 : 56,
    ),
    styling_depth: dimension(
      stylingDepth,
      stylingDepth < 62 ? "CORE_LOOK_NEEDS_DEPTH" : "STYLING_DEPTH_SUFFICIENT",
      84,
    ),
    focal_point: dimension(
      focalPoint,
      state.focalCount === 0 ? "FOCAL_POINT_MISSING" :
        state.focalCount > maxFocal ? "FOCAL_POINTS_COMPETE" : "FOCAL_POINT_CLEAR",
      82,
    ),
    leg_styling: dimension(
      legStyling,
      state.skirtOrDress && !hasLegwear ? "EXPOSED_LEG_AREA_UNRESOLVED" :
        hasLegwear ? "LEGWEAR_INTEGRATED" : "LEGWEAR_NOT_NEEDED",
      state.skirtOrDress ? 84 : 74,
    ),
    bag_integration: dimension(
      bagIntegration,
      hasBag ? "BAG_INTEGRATED" : socialUse ? "SOCIAL_LOOK_HAS_NO_BAG_ANCHOR" : "BAG_OPTIONAL",
      socialUse ? 80 : 66,
    ),
    accessory_need: dimension(
      accessoryNeed,
      hasAccessory ? "ACCESSORY_INTEGRATED" :
        state.focalCount === 0 ? "ACCESSORY_COULD_ESTABLISH_FOCUS" : "ACCESSORY_NOT_ESSENTIAL",
      76,
    ),
    layering_need: dimension(
      layeringNeed,
      hasOuterwear ? "LAYER_INTEGRATED" :
        state.layeringTarget >= 0.62 ? "TARGET_CALLS_FOR_MORE_LAYERING" : "LAYERING_NOT_ESSENTIAL",
      72,
    ),
    contemporary_expression: dimension(
      contemporaryExpression,
      contemporaryExpression < 62 ? "CONTEMPORARY_EXPRESSION_WEAK" : "CONTEMPORARY_EXPRESSION_SUPPORTED",
      70,
    ),
    over_styling_risk: dimension(
      overStylingRisk,
      overStylingRisk >= 65 ? "OVER_STYLING_RISK_HIGH" : "OVER_STYLING_RISK_CONTROLLED",
      82,
    ),
  });

  const slotScores = new Map();
  if (dimensions.bag_integration.score < 64) {
    slotScores.set("bag", 100 - dimensions.bag_integration.score);
  }
  if (dimensions.leg_styling.score < 64 && state.skirtOrDress) {
    const legwearFormality = targetScalar(state.target, ["legwear_targets.formality"], 0.5);
    const legwearOpacity = targetScalar(state.target, ["legwear_targets.opacity"], 0.45);
    const shoeRefinement = state.core.some((product) =>
      product.category === "shoes" && REFINED_PATTERN.test(evidenceText(product)));
    const legSlot = legwearFormality >= 0.56 || legwearOpacity >= 0.58 || shoeRefinement
      ? "hosiery" : "socks";
    slotScores.set(legSlot, 100 - dimensions.leg_styling.score);
  }
  if (dimensions.accessory_need.score < 58) {
    slotScores.set("accessory", 100 - dimensions.accessory_need.score);
  }
  if (dimensions.layering_need.score < 52) {
    slotScores.set("outerwear", 100 - dimensions.layering_need.score);
  }
  if (!state.hasWaistDefinition && dimensions.visual_hierarchy.score < 60 &&
      targetScalar(state.target, [
        "silhouette_targets.verticality",
        "silhouette_profile.verticality",
        "silhouette_profile.waist_emphasis",
      ], 0.5) >= 0.56) {
    slotScores.set("belt", 100 - dimensions.visual_hierarchy.score);
  }
  if (dimensions.focal_point.score < 50 && !state.restraint &&
      dimensions.over_styling_risk.score < 45) {
    slotScores.set("headwear", 100 - dimensions.focal_point.score);
  }

  const rankedSlots = [...slotScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const required = rankedSlots.filter(([, severity]) => severity >= 62)
    .map(([slot]) => slot);
  const recommended = rankedSlots.filter(([, severity]) => severity < 62)
    .map(([slot]) => slot);
  const maxOptionalItems = state.restraint ? 1
    : dimensions.over_styling_risk.score >= 55 ? 1
      : rankedSlots.length >= 3 ? 2 : Math.min(2, rankedSlots.length);
  const shouldAdd = rankedSlots.length > 0 && maxOptionalItems > 0 &&
    dimensions.over_styling_risk.score < 70;
  const requiredSlots = shouldAdd ? required.slice(0, maxOptionalItems) : [];
  const recommendedSlots = shouldAdd
    ? recommended.slice(0, Math.max(0, maxOptionalItems - requiredSlots.length)) : [];
  const active = new Set([...requiredSlots, ...recommendedSlots]);
  const unnecessary = OPTIONAL_STYLING_SLOTS.filter((slot) => !active.has(slot));
  const reasonCodes = unique([
    ...Object.values(dimensions).map((entry) => entry.reason),
    shouldAdd ? "DYNAMIC_OPTIONAL_SLOTS_IDENTIFIED" : "CORE_LOOK_COMPLETE_WITHOUT_OPTIONALS",
  ]);

  return Object.freeze({
    version: LOOK_STYLING_COMPLETION_VERSION,
    look_id: String(look.look_id || contract.look_id || ""),
    completion_action: shouldAdd ? "PLAN" : "NONE",
    required_optional_slots: Object.freeze(requiredSlots),
    recommended_optional_slots: Object.freeze(recommendedSlots),
    unnecessary_slots: Object.freeze(unnecessary),
    max_optional_items: maxOptionalItems,
    dimensions,
    reason_codes: Object.freeze(reasonCodes),
    target_basis: Object.freeze({
      focal_target: state.focalTarget,
      layering_target: state.layeringTarget,
      statement_target: state.statementTarget,
      restraint: state.restraint,
    }),
  });
}

function strongestCommerceSignal(decisionContext = {}, contract = {}) {
  const brain = decisionContext?.intent?.user_intent_brain || {};
  const values = unique([
    valueOf(brain.desired_impression, []),
    contract?.prefer,
    contract?.concept?.prefer,
  ]).join(" ");
  if (/(?:设计感|特别|辨识度|独特)/u.test(values)) return "设计感";
  if (/(?:年轻|减龄|青春)/u.test(values)) return "年轻";
  if (/(?:精致|高级|质感)/u.test(values)) return "精致";
  if (/(?:干净|利落|清爽)/u.test(values)) return "简约";
  if (/(?:复古|vintage)/iu.test(values)) return "复古";
  if (/(?:松弛|休闲)/u.test(values)) return "休闲";
  return "百搭";
}

function optionalCommerceSpec(slot, {decisionContext = {}, contract = {}} = {}) {
  const target = targetProfileFor({contract, decisionContext});
  const refined = targetScalar(target, [
    "accessory_targets.formality",
    "accessory_targets.quality",
  ], 0.5) >= 0.58;
  const values = {
    bag: {category: "bag", subcategory: "bag", concrete: refined ? "精致小包" : "单肩包", broad: "包包"},
    socks: {category: "accessory", subcategory: "socks", concrete: "袜子", broad: "袜子"},
    hosiery: {category: "accessory", subcategory: "socks", concrete: "连裤袜", broad: "袜子"},
    accessory: {category: "accessory", subcategory: "jewelry", concrete: refined ? "简约首饰" : "项链", broad: "首饰"},
    belt: {category: "accessory", subcategory: "belt", concrete: "腰带", broad: "腰带"},
    outerwear: {category: "outerwear", subcategory: "", concrete: "轻薄外套", broad: "外套"},
    headwear: {category: "hat", subcategory: "hat", concrete: "时尚帽子", broad: "帽子"},
  };
  return values[slot];
}

function compactQuery(values) {
  return unique(values).slice(0, 3).join(" ").slice(0, 24).trim();
}

function completionQueryPlan({slot, decisionContext, contract}) {
  const gender = normalizeGender(decisionContext?.user_truth?.gender || contract?.gender);
  const audience = gender === "female" ? "女" : gender === "male" ? "男" : "中性";
  const spec = optionalCommerceSpec(slot, {decisionContext, contract});
  const signal = strongestCommerceSignal(decisionContext, contract);
  const q1 = compactQuery([audience, spec.concrete]);
  const q2 = compactQuery([audience, spec.concrete, signal]);
  const q3 = compactQuery([audience, spec.broad]);
  const queryCandidate = (queryId, queryType, execution, query, rank, aestheticSignal = null) =>
    Object.freeze({
      rank,
      query_id: queryId,
      query_type: queryType,
      execution,
      query,
      core_category: spec.concrete,
      aesthetic_signal: aestheticSignal,
      searchable_signal_budget: Object.freeze({
        core_category_terms: 1,
        aesthetic_terms: aestheticSignal ? 1 : 0,
        max_aesthetic_terms: 1,
      }),
      fallback_level: queryId === "Q3" ? 2 : 0,
      fallback_reason: queryId === "Q3" ? "OPTIONAL_Q1_Q2_ZERO" : null,
      reason_codes: Object.freeze([
        queryId === "Q1" ? "OPTIONAL_HIGH_RECALL" :
          queryId === "Q2" ? "OPTIONAL_ONE_SIGNAL" : "OPTIONAL_BROAD_FALLBACK",
      ]),
      source_elements: Object.freeze(unique([spec.concrete, aestheticSignal])),
    });
  return Object.freeze({
    version: "styling_completion_query.v1",
    concept_id: String(contract?.concept_id || ""),
    slot,
    gender,
    query_candidates: Object.freeze([
      queryCandidate("Q1", "HIGH_RECALL", "DEFAULT", q1, 1),
      queryCandidate("Q2", "INTENT", "DEFAULT", q2, 2, signal),
    ]),
    fallback_query: queryCandidate(
      "Q3", "BROAD_CATEGORY_FALLBACK", "ON_Q1_Q2_ZERO", q3, 3,
    ),
    commerce_negatives: Object.freeze(unique([
      valueOf(decisionContext?.intent?.user_intent_brain?.explicit_avoid, []),
      contract?.avoid,
    ])),
    hard_gate_negatives: Object.freeze(unique(contract?.avoid || [])),
    contextual_negatives: Object.freeze([]),
    trace: Object.freeze({
      semantic_compiler: "styling_completion_zh-CN_v1",
      abstract_tokens_sent: false,
      searchable_signal_budget: Object.freeze({
        core_category_required: true,
        max_aesthetic_terms: 1,
      }),
      optional_slot: slot,
    }),
  });
}

function compileOptionalStylingRequirements({
  look = {},
  diagnosis,
  decisionContext = {},
  contract = {},
} = {}) {
  if (!diagnosis || diagnosis.completion_action === "NONE") return Object.freeze([]);
  const slots = unique([
    diagnosis.required_optional_slots,
    diagnosis.recommended_optional_slots,
  ]).slice(0, diagnosis.max_optional_items || 0);
  const gender = normalizeGender(decisionContext?.user_truth?.gender || contract.gender);
  const scene = String(
    look.scene || contract.scene || decisionContext?.user_truth?.scene || "",
  );
  const target = targetProfileFor({look, contract, decisionContext});
  const body = bodySignalsFor({look, contract, decisionContext});
  const style = String(look.style || contract.style || "");
  const requiredSet = new Set(diagnosis.required_optional_slots || []);
  return Object.freeze(slots.map((slot, index) => {
    const spec = optionalCommerceSpec(slot, {decisionContext, contract});
    const queryPlan = completionQueryPlan({slot, decisionContext, contract});
    const syntheticLookId = `${look.look_id}:completion:${slot}`;
    const isRequired = requiredSet.has(slot);
    return Object.freeze({
      request_id: decisionContext.request_id,
      look_id: syntheticLookId,
      concept_id: look.concept_id || contract.concept_id,
      slot_key: `${decisionContext.request_id}:${syntheticLookId}:${spec.category}:${index}`,
      category: spec.category,
      search_subcategory: spec.subcategory,
      gender,
      scene,
      style,
      style_role: "styling_completion",
      item_name: spec.concrete,
      product_type: spec.concrete,
      search_keywords: Object.freeze(queryPlan.query_candidates.map(({query}) => query)),
      query_plan_version: queryPlan.version,
      commerce_query_plan: queryPlan,
      query_reason: "由固定 Core Look 的造型缺口动态编译，不重选核心商品",
      source_elements: Object.freeze(unique([
        `completion_slot:${slot}`,
        diagnosis.dimensions.color_echo.reason,
        diagnosis.dimensions.styling_depth.reason,
        diagnosis.dimensions.focal_point.reason,
      ])),
      translated_queries: Object.freeze(queryPlan.query_candidates.map((entry) => Object.freeze({
        category: spec.category,
        query: entry.query,
        source_elements: entry.source_elements,
        query_reason: entry.reason_codes.join("+"),
      }))),
      required_attributes: Object.freeze([]),
      preferred_attributes: Object.freeze(unique([
        strongestCommerceSignal(decisionContext, contract),
        valueOf(body.bag_scale),
        valueOf(body.waistline),
        valueOf(body.vertical_balance),
        valueOf(body.leg_line_continuity),
        valueOf(body.outerwear_length),
      ])),
      avoid_attributes: Object.freeze(unique([
        contract.avoid,
        valueOf(decisionContext?.intent?.user_intent_brain?.explicit_avoid, []),
      ])),
      negative_keywords: queryPlan.commerce_negatives,
      body_fit_soft_signals: Object.freeze(unique([
        valueOf(body.bag_scale),
        valueOf(body.waistline),
        valueOf(body.vertical_balance),
        valueOf(body.layering),
        valueOf(body.leg_line_continuity),
        valueOf(body.outerwear_length),
      ])),
      market_soft_signals: Object.freeze([]),
      market_influence_cap: 0.08,
      aesthetic_target_profile: target,
      styling_completion_slot: slot,
      styling_completion_parent_look_id: look.look_id,
      styling_completion_required: isRequired,
      styling_completion_recommended: !isRequired,
      blueprint_required: false,
      explicit_user_search: false,
      decision_authority: Object.freeze({
        core_look: "immutable",
        user_intent: "highest",
        body_fit: "soft",
        styling_completion: isRequired ? "dynamic_required" : "dynamic_recommended",
      }),
    });
  }));
}

function bodyIntegrationScore({look, optionals, decisionContext, contract}) {
  const base = average(coreProducts(look).map((product) =>
    finite(product.body_strategy_match_score, 65)), 65);
  if (optionals.length === 0) return bounded(base);
  const body = bodySignalsFor({look, contract, decisionContext});
  const legLineContinuity = targetScalar(body, ["leg_line_continuity"], 0.5);
  const desiredBagScale = String(valueOf(body.bag_scale, "") || "").toLowerCase();
  const optionalScore = average(optionals.map((product) => {
    let score = finite(product.body_strategy_match_score, 60);
    const slot = completionSlot(product);
    const evidence = evidenceText(product);
    if (["socks", "hosiery"].includes(slot) && legLineContinuity > 0.5 &&
        /(?:leg.?line|vertical|修腿|显腿|连贯|轻薄|细罗纹)/iu.test(evidence)) {
      score += Math.min(10, (legLineContinuity - 0.5) * 20);
    }
    if (slot === "bag" && desiredBagScale) {
      const compactTarget = /(?:small|compact|小|轻量|medium)/iu.test(desiredBagScale);
      const compactProduct = /(?:small|compact|小号|迷你|轻量|medium)/iu.test(evidence);
      if (compactTarget && compactProduct) score += 8;
      if (compactTarget && /(?:oversized|超大|大容量)/iu.test(evidence)) score -= 8;
    }
    return score;
  }), 60);
  return bounded(base * 0.68 + optionalScore * 0.32);
}

function optionalContextFit(product, {look = {}, contract = {}, decisionContext = {}} = {}) {
  const evidence = evidenceText(product);
  const target = targetProfileFor({look, contract, decisionContext});
  const formality = targetScalar(target, [
    "formality_target",
    "formality",
    "dimensions.formality",
  ], 0.5);
  const restraint = targetScalar(target, ["dimensions.minimalism"], 0.45) >= 0.78 ||
    (targetScalar(target, ["focal_hierarchy.max_focal_points"], 1) <= 1 &&
     targetScalar(target, [
       "accessory_targets.statement_strength",
       "accessory_profile.statement_strength",
     ], 0.42) <= 0.28);
  let score = 72;
  if (formality >= 0.78 && /(?:街头|涂鸦|棒球帽|运动|street|graffiti|sporty)/iu.test(evidence)) {
    score -= 48;
  }
  if (formality <= 0.45 && /(?:宴会|礼服|商务正装|formal|ceremonial)/iu.test(evidence)) {
    score -= 28;
  }
  if (restraint && /(?:夸张|超大|多层|满钻|oversized|maximal|multi.?layer)/iu.test(evidence)) {
    score -= 42;
  }
  if (REFINED_PATTERN.test(evidence)) score += 10;
  return bounded(score);
}

function optionalRelevanceScore(optionals, context = {}) {
  if (optionals.length === 0) return 60;
  return bounded(average(optionals.map((product) => {
    const quality = finite(
      product.final_score ?? product.aesthetic_score ?? product.relevance_score,
      60,
    );
    const penalty = finite(product.product_acceptance_penalty, 0);
    const contextFit = optionalContextFit(product, context);
    return (quality - Math.min(35, penalty)) * 0.62 + contextFit * 0.38;
  }), 60));
}

function calculateLookStylingCompleteness({
  look = {},
  optionalProducts: added = [],
  decisionContext = {},
  contract = {},
} = {}) {
  const merged = Object.freeze({
    ...look,
    selected_products: Object.freeze([
      ...coreProducts(look),
      ...optionalProducts(look),
      ...(Array.isArray(added) ? added : []),
    ]),
  });
  const diagnosis = diagnoseStylingCompletion({
    look: merged,
    decisionContext,
    contract,
  });
  const optionals = optionalProducts(merged);
  const dimensions = Object.freeze({
    visual_hierarchy: diagnosis.dimensions.visual_hierarchy.score,
    color_echo: diagnosis.dimensions.color_echo.score,
    styling_depth: diagnosis.dimensions.styling_depth.score,
    focal_point: diagnosis.dimensions.focal_point.score,
    accessory_relevance: optionalRelevanceScore(optionals, {
      look: merged,
      contract,
      decisionContext,
    }),
    leg_styling: diagnosis.dimensions.leg_styling.score,
    bag_integration: diagnosis.dimensions.bag_integration.score,
    contemporary_expression: diagnosis.dimensions.contemporary_expression.score,
    body_integration: bodyIntegrationScore({
      look: merged,
      optionals,
      decisionContext,
      contract,
    }),
  });
  const weights = Object.freeze({
    visual_hierarchy: 0.14,
    color_echo: 0.12,
    styling_depth: 0.14,
    focal_point: 0.10,
    accessory_relevance: 0.09,
    leg_styling: 0.10,
    bag_integration: 0.09,
    contemporary_expression: 0.10,
    body_integration: 0.12,
  });
  const weighted = Object.entries(weights).reduce((sum, [key, weight]) =>
    sum + dimensions[key] * weight, 0);
  const overStylingPenalty = bounded(
    diagnosis.dimensions.over_styling_risk.score * 0.12,
  );
  return Object.freeze({
    version: LOOK_STYLING_COMPLETENESS_VERSION,
    score: bounded(weighted - overStylingPenalty),
    dimensions,
    weights,
    over_styling_penalty: overStylingPenalty,
    diagnosis,
  });
}

function validTaobaoOptional(product, slot, context = {}) {
  if (String(product?.source || "").toLowerCase() !== "taobao" ||
      product?.is_mock !== false) return false;
  if (product?.product_acceptance_result === "HARD_REJECT" ||
      product?.product_acceptance_result === "SOFT_REJECT") return false;
  if (completionSlot(product) !== slot) return false;
  const score = finite(
    product?.final_score ?? product?.aesthetic_score ?? product?.relevance_score,
    60,
  );
  const penalty = finite(product?.product_acceptance_penalty, 0);
  return score >= 55 && penalty < 30 && optionalContextFit(product, context) >= 50;
}

function budgetCeiling(decisionContext = {}, type) {
  const value = decisionContext?.user_truth?.budget?.[type];
  if (Number.isFinite(Number(value))) return Number(value);
  const values = String(value || "").match(/\d+(?:\.\d+)?/gu) || [];
  return values.length > 0 ? Math.max(...values.map(Number)) : 0;
}

function totalPrice(products) {
  return products.reduce((sum, product) => {
    const price = Number(product?.price);
    return sum + (Number.isFinite(price) ? price : 0);
  }, 0);
}

function coreIdentityMap(look) {
  return Object.freeze(Object.fromEntries(coreProducts(look).map((product) => [
    String(product.category || ""),
    productId(product),
  ])));
}

function sameCore(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectStylingCompletion({
  look = {},
  diagnosis,
  candidates = [],
  decisionContext = {},
  contract = {},
  usedProductIdentities = new Set(),
} = {}) {
  const resolvedDiagnosis = diagnosis || diagnoseStylingCompletion({
    look,
    decisionContext,
    contract,
  });
  const before = calculateLookStylingCompleteness({
    look,
    decisionContext,
    contract,
  });
  const beforeCore = coreIdentityMap(look);
  const selected = [];
  const rejected = [];
  const plannedSlots = unique([
    resolvedDiagnosis.required_optional_slots,
    resolvedDiagnosis.recommended_optional_slots,
  ]).slice(0, resolvedDiagnosis.max_optional_items || 0);
  const outfitBudget = budgetCeiling(decisionContext, "outfit");
  const itemBudget = budgetCeiling(decisionContext, "item");
  let current = before;

  for (const slot of plannedSlots) {
    const slotCandidates = candidates.filter((product) => completionSlot(product) === slot)
      .sort((left, right) => finite(
        right.final_score ?? right.aesthetic_score ?? right.relevance_score,
      ) - finite(left.final_score ?? left.aesthetic_score ?? left.relevance_score));
    let best = null;
    for (const product of slotCandidates.slice(0, 4)) {
      const identity = productIdentity(product);
      if (!validTaobaoOptional(product, slot, {look, contract, decisionContext})) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: "OPTIONAL_CANDIDATE_NOT_QUALITY_VALID",
        }));
        continue;
      }
      if (identity && usedProductIdentities.has(identity)) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: "CROSS_LOOK_DUPLICATE",
        }));
        continue;
      }
      if (selected.some((item) =>
        productIdentity(item) === identity || productId(item) === productId(product))) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: "INTRA_LOOK_DUPLICATE",
        }));
        continue;
      }
      if (itemBudget > 0 && (!Number.isFinite(Number(product?.price)) ||
          Number(product.price) > itemBudget)) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: "ITEM_BUDGET_EXCEEDED",
        }));
        continue;
      }
      if (outfitBudget > 0 && totalPrice([
        ...selectedProducts(look),
        ...selected,
        product,
      ]) > outfitBudget) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: "OUTFIT_BUDGET_EXCEEDED",
        }));
        continue;
      }
      const after = calculateLookStylingCompleteness({
        look,
        optionalProducts: [...selected, product],
        decisionContext,
        contract,
      });
      const delta = bounded(after.score - current.score);
      if (after.diagnosis.dimensions.over_styling_risk.score >= 72 ||
          delta < MIN_COMPLETION_DELTA) {
        rejected.push(Object.freeze({
          candidate_id: productId(product),
          slot,
          reason: after.diagnosis.dimensions.over_styling_risk.score >= 72
            ? "OVER_STYLING_RISK" : "COMPLETENESS_NOT_IMPROVED",
          score_delta: delta,
        }));
        continue;
      }
      if (!best || after.score > best.after.score ||
          (after.score === best.after.score && productId(product) < productId(best.product))) {
        best = {product, after, delta};
      }
    }
    if (!best) continue;
    const annotated = Object.freeze({
      ...best.product,
      look_id: look.look_id,
      concept_id: look.concept_id,
      slot,
      styling_slot: slot,
      styling_completion_slot: slot,
      styling_completion_selected: true,
      styling_completion_score_delta: best.delta,
      styling_completion_version: LOOK_STYLING_COMPLETION_VERSION,
    });
    selected.push(annotated);
    current = best.after;
    const identity = productIdentity(annotated);
    if (identity) usedProductIdentities.add(identity);
  }

  const completedProducts = Object.freeze([
    ...selectedProducts(look),
    ...selected,
  ]);
  const completedLook = Object.freeze({
    ...look,
    selected_products: completedProducts,
    selected_candidate_ids: Object.freeze(completedProducts.map(productId)),
  });
  const afterCore = coreIdentityMap(completedLook);
  const coreUnchanged = sameCore(beforeCore, afterCore);
  if (!coreUnchanged) {
    throw new Error("Styling Completion attempted to modify immutable core products");
  }
  return Object.freeze({
    version: LOOK_STYLING_COMPLETION_VERSION,
    look_id: String(look.look_id || ""),
    completion_action: selected.length > 0 ? "ADD" : "NONE",
    diagnosis: resolvedDiagnosis,
    before_score: before.score,
    after_score: selected.length > 0 ? current.score : before.score,
    score_delta: selected.length > 0 ? bounded(current.score - before.score) : 0,
    completeness_before: before,
    completeness_after: selected.length > 0 ? current : before,
    selected_optional_products: Object.freeze(selected),
    selected_optional_candidate_ids: Object.freeze(selected.map(productId)),
    rejected_candidates: Object.freeze(rejected),
    core_candidate_ids_before: beforeCore,
    core_candidate_ids_after: afterCore,
    core_unchanged: coreUnchanged,
    completed_look: Object.freeze({
      ...completedLook,
      styling_completion: Object.freeze({
        version: LOOK_STYLING_COMPLETION_VERSION,
        action: selected.length > 0 ? "ADD" : "NONE",
        before_score: before.score,
        after_score: selected.length > 0 ? current.score : before.score,
        score_delta: selected.length > 0 ? bounded(current.score - before.score) : 0,
        selected_optional_slots: Object.freeze(selected.map(completionSlot)),
      }),
    }),
  });
}

function annotateOptionalCandidates(candidates, requirements) {
  const bySyntheticLook = new Map(requirements.map((requirement) => [
    requirement.look_id,
    requirement,
  ]));
  return candidates.map((candidate) => {
    const requirement = bySyntheticLook.get(String(candidate.look_id || ""));
    if (!requirement) return candidate;
    return Object.freeze({
      ...candidate,
      styling_completion_slot: requirement.styling_completion_slot,
      styling_completion_parent_look_id:
        requirement.styling_completion_parent_look_id,
    });
  });
}

function resolveRealTaobaoProvider(productProvider, products) {
  const realCore = products.length > 0 && products.every((product) =>
    String(product?.source || "").toLowerCase() === "taobao" &&
    product?.is_mock === false);
  if (!realCore) return null;
  const providerName = String(productProvider?.name || "").toLowerCase();
  if (providerName === "taobao") return productProvider;
  // Auto is supported only through its real provider directly. This prevents
  // the Optional path from ever reaching AutoProductProvider's Mock fallback.
  if (providerName === "auto" &&
      String(productProvider?.taobao?.name || "").toLowerCase() === "taobao") {
    return productProvider.taobao;
  }
  return null;
}

async function completePortfolioStyling({
  decisionContext = {},
  compiled = {},
  coreValidation = {},
  coreProducts: products = [],
  productProvider,
  providerContext = {},
  coreTrace = null,
  logger = console,
} = {}) {
  const coreLooks = Array.isArray(coreValidation.looks) ? coreValidation.looks : [];
  const contracts = new Map((compiled.looks || []).map((contract) => [
    contract.look_id,
    contract,
  ]));
  const diagnoses = coreLooks.map((look) => diagnoseStylingCompletion({
    look,
    decisionContext,
    contract: contracts.get(look.look_id) || {},
  }));
  const requirements = coreLooks.flatMap((look, index) =>
    compileOptionalStylingRequirements({
      look,
      diagnosis: diagnoses[index],
      decisionContext,
      contract: contracts.get(look.look_id) || {},
    })).slice(0, MAX_COMPLETION_REQUIREMENTS);
  const baseTrace = {
    status: "NONE",
    core_pipeline_trace: coreTrace,
    optional_candidate_pipeline_trace: null,
    required_optional_slots: Object.freeze(unique(
      diagnoses.flatMap((entry) => entry.required_optional_slots),
    )),
    recommended_optional_slots: Object.freeze(unique(
      diagnoses.flatMap((entry) => entry.recommended_optional_slots),
    )),
    requirements: Object.freeze(requirements),
    results: Object.freeze([]),
    optional_retrieval_attempted: false,
    optional_retrieval_provider: "NONE",
    core_unchanged: true,
  };
  if (requirements.length === 0) {
    return Object.freeze({
      version: LOOK_STYLING_COMPLETION_VERSION,
      products: Object.freeze([...products]),
      looks: Object.freeze([...coreLooks]),
      trace: Object.freeze({...baseTrace, status: "NONE"}),
    });
  }
  const realTaobaoProvider = resolveRealTaobaoProvider(productProvider, products);
  if (!realTaobaoProvider) {
    const results = coreLooks.map((look, index) => Object.freeze({
      look_id: look.look_id,
      completion_action: "NONE",
      diagnosis: diagnoses[index],
      reason: "REAL_TAOBAO_PROVIDER_REQUIRED",
      core_unchanged: true,
    }));
    return Object.freeze({
      version: LOOK_STYLING_COMPLETION_VERSION,
      products: Object.freeze([...products]),
      looks: Object.freeze([...coreLooks]),
      trace: Object.freeze({
        ...baseTrace,
        status: "SKIPPED_REAL_TAOBAO_REQUIRED",
        results: Object.freeze(results),
      }),
    });
  }

  let retrieved;
  let optionalTrace = null;
  try {
    retrieved = await realTaobaoProvider.recommendForQueries(requirements, {
      ...providerContext,
      styling_completion: true,
      core_look_immutable: true,
      [STYLING_COMPLETION_AUTHORITY]: true,
      outfit_plan: Object.freeze({
        looks: Object.freeze([]),
        source: LOOK_STYLING_COMPLETION_VERSION,
      }),
    });
    optionalTrace = realTaobaoProvider.lastPipelineTrace || null;
  } catch (error) {
    logger.warn?.("look_styling_completion_retrieval_failed", {
      request_id: decisionContext.request_id || undefined,
      error_code: error?.code || "OPTIONAL_RETRIEVAL_FAILED",
    });
    const results = coreLooks.map((look, index) => Object.freeze({
      look_id: look.look_id,
      completion_action: "NONE",
      diagnosis: diagnoses[index],
      reason: "OPTIONAL_RETRIEVAL_FAILED",
      core_unchanged: true,
    }));
    return Object.freeze({
      version: LOOK_STYLING_COMPLETION_VERSION,
      products: Object.freeze([...products]),
      looks: Object.freeze([...coreLooks]),
      trace: Object.freeze({
        ...baseTrace,
        status: "OPTIONAL_RETRIEVAL_FAILED_CORE_RETAINED",
        optional_candidate_pipeline_trace: optionalTrace,
        optional_retrieval_attempted: true,
        optional_retrieval_provider: "taobao",
        results: Object.freeze(results),
      }),
    });
  }

  const candidates = annotateOptionalCandidates(
    Array.isArray(retrieved) ? retrieved : [],
    requirements,
  );
  const used = new Set(products.map(productIdentity).filter(Boolean));
  const results = coreLooks.map((look, index) => selectStylingCompletion({
    look,
    diagnosis: diagnoses[index],
    candidates: candidates.filter((candidate) =>
      candidate.styling_completion_parent_look_id === look.look_id),
    decisionContext,
    contract: contracts.get(look.look_id) || {},
    usedProductIdentities: used,
  }));
  const selectedOptionals = results.flatMap((result) =>
    result.selected_optional_products);
  const completedLooks = results.map((result) => result.completed_look);
  const coreUnchanged = results.every((result) => result.core_unchanged);
  logger.info?.("look_styling_completion_summary", {
    request_id: decisionContext.request_id || undefined,
    look_count: coreLooks.length,
    requirement_count: requirements.length,
    candidate_count: candidates.length,
    selected_count: selectedOptionals.length,
    core_unchanged: coreUnchanged,
    before_after: results.map((result) => ({
      look_id: result.look_id,
      before_score: result.before_score,
      after_score: result.after_score,
      score_delta: result.score_delta,
      action: result.completion_action,
    })),
  });
  return Object.freeze({
    version: LOOK_STYLING_COMPLETION_VERSION,
    products: Object.freeze([...products, ...selectedOptionals]),
    looks: Object.freeze(completedLooks),
    trace: Object.freeze({
      ...baseTrace,
      status: selectedOptionals.length > 0 ? "COMPLETED" : "NONE_QUALITY_SAFE",
      optional_candidate_pipeline_trace: optionalTrace,
      optional_retrieval_attempted: true,
      optional_retrieval_provider: "taobao",
      optional_candidate_count: candidates.length,
      selected_optional_count: selectedOptionals.length,
      selected_optional_candidate_ids: Object.freeze(selectedOptionals.map(productId)),
      results: Object.freeze(results),
      core_unchanged: coreUnchanged,
    }),
  });
}

module.exports = {
  LOOK_STYLING_COMPLETENESS_VERSION,
  LOOK_STYLING_COMPLETION_VERSION,
  OPTIONAL_STYLING_SLOTS,
  calculateLookStylingCompleteness,
  compileOptionalStylingRequirements,
  completePortfolioStyling,
  diagnoseStylingCompletion,
  selectStylingCompletion,
};
