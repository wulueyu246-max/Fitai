const {
  authorizedAestheticTarget,
  authoritativeProductGender,
  normalizeGender,
  normalizeProductCategory,
} = require("./product_relevance");
const {
  resolveAestheticTargetProfile,
} = require("./style_intelligence");
const {canonicalProductIdentity} = require("./product_acceptance_gate");
const {evaluateFinalLookQuality} = require("./final_look_quality");
const {targetFitScore} = require("./target_fit_assessment");

const STRATEGY_VERSION = "outfit_aesthetic_target_alignment_v1";
const DEFAULT_TOP_PER_REQUIREMENT = 6;
const DEFAULT_BEAM_WIDTH = 72;
const TARGET_ALIGNMENT_WEIGHT = 0.62;
const INTERNAL_COHERENCE_WEIGHT = 0.38;
const CORE_TARGET_FLOOR = 72;

const SPORT_PATTERN = /运动|跑鞋|板鞋|德训鞋|赛车鞋|篮球鞋|网球鞋|老爹鞋|sneaker|trainer|running|sport/i;
const REFINED_SHOE_PATTERN = /玛丽珍|芭蕾|尖头|浅口|低跟|中跟|高跟|细跟|猫跟|乐福|单鞋|pumps?|heel|mary\s*jane|ballet|loafer/i;
const HEAVY_SHOE_PATTERN = /厚底|超厚|松糕|高帮|巨齿|笨重|老爹鞋/i;
const FEMININE_PATTERN = /收腰|高腰|短款|修身|裹身|a字|伞摆|百褶|鱼尾|蕾丝|提花|刺绣|荷叶边|泡泡袖|方领|蝴蝶结|珍珠|玛丽珍|芭蕾|浅口|尖头|低跟|高跟|连衣裙|半身裙/i;
const DESIGN_DETAIL_PATTERN = /剪裁|廓形|收腰|腰封|褶裥|提花|刺绣|蕾丝|拼接|不对称|立体|鱼尾|伞摆|百褶|方领|v领|泡泡袖|荷叶边|设计感/i;
const LOOSE_PATTERN = /宽松|oversize|廓形|落肩|阔腿|拖地|肥大/i;
const WAISTLINE_PATTERN = /高腰|收腰|腰封|短款|修身|裹身/i;
const PREMIUM_PATTERN = /高级|精致|优雅|法式|真丝|桑蚕丝|羊毛|羊绒|头层皮|牛皮|剪裁|设计师|提花|刺绣/i;
const FORMAL_PRODUCT_PATTERN = /礼服|正装|宴会|晚宴|典礼|婚礼|燕尾|西装|西服|领结|领带|牛津|德比|oxford|formal|ceremonial/i;
const NEUTRAL_INTENT_PATTERN = /中性|无性别|男女同款|男女通用|unisex|neutral/i;
const NON_FASHION_PATTERN = /孕妇|产妇|月子|医疗|医用|护理|劳保|劳动防护|安全帽|工作帽|厨师帽|睡帽|浴帽|干发帽|焗油帽|染发帽|防尘|无尘|一次性|头套|面罩|脸基尼|防晒面罩|防风面罩|家居|收纳|工具包|保温包|妈咪包/i;
const EXPLICIT_MALE_PATTERN = /男装|男款|男士|男鞋|男裤|men'?s|\bmen\b/i;
const EXPLICIT_FEMALE_PATTERN = /女装|女款|女士|女鞋|女裤|women'?s|\bwomen\b/i;

const COLOR_DEFINITIONS = Object.freeze([
  ["black", /黑|墨色|炭黑|black/i],
  ["white", /白|奶油白|米白|ivory|cream|white/i],
  ["beige", /米色|杏色|卡其|驼色|燕麦|beige|khaki|camel/i],
  ["gray", /灰|银灰|gray|grey|silver/i],
  ["brown", /棕|咖|巧克力|brown|coffee/i],
  ["red", /红|酒红|勃艮第|red|burgundy/i],
  ["pink", /粉|玫瑰|pink|rose/i],
  ["orange", /橙|orange/i],
  ["yellow", /黄|鹅黄|yellow/i],
  ["green", /绿|薄荷|green|mint/i],
  ["blue", /蓝|牛仔蓝|blue|denim/i],
  ["purple", /紫|薰衣草|purple|lavender/i],
]);
const NEUTRAL_COLORS = new Set(["black", "white", "beige", "gray", "brown"]);
const ADJACENT_COLORS = new Set([
  "pink:red", "orange:red", "orange:yellow", "blue:green", "blue:purple",
  "pink:purple", "beige:brown", "black:gray", "gray:white", "beige:white",
]);
const CONFLICT_COLORS = new Set(["green:red", "orange:purple", "pink:red"]);

function composeOutfitCandidates({
  requirements = [],
  products = [],
  context = {},
  topPerRequirement = DEFAULT_TOP_PER_REQUIREMENT,
  beamWidth = DEFAULT_BEAM_WIDTH,
} = {}) {
  const safeRequirements = Array.isArray(requirements) ? requirements : [];
  const safeProducts = Array.isArray(products) ? products : [];
  const looks = groupRequirementsByLook(safeRequirements);
  const composableLooks = looks.filter((look) => look.structure.recognized);
  if (composableLooks.length === 0) {
    return Object.freeze({
      applied: false,
      products: safeProducts,
      looks: [],
      rejected_looks: [],
      reason_codes: [],
      version: STRATEGY_VERSION,
    });
  }

  const selectedLooks = [];
  const selectedProducts = [];
  const rejectedLooks = [];
  const usedProductKeys = new Set();
  for (const look of composableLooks) {
    const aestheticTargetProfile = resolveStrategyTarget(
      context,
      look.requirements,
    );
    const strategyContext = {
      ...context,
      aesthetic_target_profile: aestheticTargetProfile,
    };
    const pools = look.requirements.map((requirement, requirementIndex) => ({
      requirement,
      requirementIndex,
      required: look.structure.coreCategories.has(requirement.category),
      candidates: candidatesForRequirement(
        safeProducts,
        requirement,
        strategyContext,
      ).sort(compareCandidateBase).slice(0, positiveInteger(
        topPerRequirement,
        DEFAULT_TOP_PER_REQUIREMENT,
      )),
    }));
    const missingCore = pools.some((pool) =>
      look.structure.coreCategories.has(pool.requirement.category) &&
      pool.candidates.length === 0);
    if (missingCore || look.structure.invalid) continue;

    const combinationMetrics = {
      expandedCombinationCount: 0,
      prunedCombinationCount: 0,
      maxFrontierCount: 1,
      budgetRejectedCombinationCount: 0,
      budgetRejections: [],
    };
    const combinations = buildCombinations(
      pools,
      strategyContext,
      positiveInteger(beamWidth, DEFAULT_BEAM_WIDTH),
      combinationMetrics,
    ).map((entries) => ({
      entries,
      ...scoreOutfitCombination(entries, strategyContext),
    })).sort((left, right) => right.finalScore - left.finalScore ||
      compareCombinationIdentity(left.entries, right.entries));
    if (combinations.length === 0) continue;

    const ranked = combinations.map((combination) => {
      const repeatedEntries = combination.entries.filter(({product}) =>
        usedProductKeys.has(productIdentity(product)));
      const repeatedIds = repeatedEntries.map(({product}) => productId(product));
      const repeatedProductKeys = repeatedEntries.map(({product}) =>
        productIdentity(product));
      const duplicatePenalty = repeatedEntries.length * 45;
      return {
        ...combination,
        repeatedIds,
        repeatedProductKeys,
        duplicatePenalty,
        adjustedScore: Math.max(0, roundScore(
          combination.finalScore - duplicatePenalty,
        )),
      };
    }).sort((left, right) => right.adjustedScore - left.adjustedScore ||
      right.finalScore - left.finalScore ||
      compareCombinationIdentity(left.entries, right.entries));
    const qualityRanked = ranked.map((combination) => ({
      ...combination,
      quality: evaluateCombinationQuality(combination),
    }));
    const chosen = qualityRanked.find((combination) =>
      combination.quality.status === "PASS");
    const combinationTraces = Object.freeze(qualityRanked.map((combination, index) =>
      Object.freeze({
        rank: index + 1,
        look_candidate_id: combinationIdentity(combination.entries),
        candidate_ids: Object.freeze(
          combination.entries.map(({product}) => productId(product)),
        ),
        base_score: combination.finalScore,
        cross_look_duplicate_penalty: combination.duplicatePenalty,
        adjusted_score: combination.adjustedScore,
        strategy_trace: combination.strategyTrace,
        quality: combination.quality,
        whole_look_quality: combination.quality,
      })));
    if (!chosen) {
      rejectedLooks.push(Object.freeze({
        look_id: look.lookId,
        status: "FAIL",
        reason_codes: Object.freeze(["LOW_QUALITY_LOOK"]),
        whole_look_quality: qualityRanked[0].quality,
        selected_candidate_ids: Object.freeze([]),
        quality_valid_alternatives: Object.freeze([]),
        rejected_combination_traces: combinationTraces,
        combination_traces: combinationTraces,
        candidate_breadth: candidateBreadth(pools, combinationMetrics,
          topPerRequirement, beamWidth, combinations.length),
        aesthetic_target_profile: aestheticTargetProfile,
      }));
      continue;
    }
    const qualityValidAlternatives = Object.freeze(qualityRanked
      .filter((combination) => combination.quality.status === "PASS")
      .slice(0, 3)
      .map((combination) => combinationTrace(combination, qualityRanked)));
    const qualityValidAlternativeOnly = Object.freeze(qualityValidAlternatives
      .filter((combination) =>
        combination.look_candidate_id !== combinationIdentity(chosen.entries)));
    const rejectedCombinationTraces = Object.freeze(combinationTraces.filter(
      (trace) => trace.quality.status === "FAIL",
    ));
    const report = Object.freeze({
      look_id: look.lookId,
      look_candidate_id: combinationIdentity(chosen.entries),
      final_score: chosen.adjustedScore,
      base_score: chosen.finalScore,
      duplicate_penalty: chosen.duplicatePenalty,
      repeated_candidate_ids: Object.freeze([...chosen.repeatedIds]),
      repeated_product_identities: Object.freeze([
        ...chosen.repeatedProductKeys,
      ]),
      scores: chosen.scores,
      target_profile_match: chosen.targetProfileMatch,
      internal_coherence: chosen.internalCoherence,
      cross_style_conflict_penalty: chosen.crossStyleConflictPenalty,
      target_miss_penalty: chosen.targetMissPenalty,
      product_acceptance_penalty: chosen.productAcceptancePenalty,
      ranking_reason: chosen.rankingReason,
      strategy_trace: chosen.strategyTrace,
      quality: chosen.quality,
      whole_look_quality: chosen.quality,
      quality_status: chosen.quality.status,
      quality_reason_codes: chosen.quality.reason_codes,
      quality_valid_alternatives: qualityValidAlternatives,
      quality_valid_alternative_only: qualityValidAlternativeOnly,
      rejected_combination_traces: rejectedCombinationTraces,
      combination_traces: combinationTraces,
      selected_candidate_ids: Object.freeze(
        chosen.entries.map(({product}) => productId(product)),
      ),
      candidate_breadth: candidateBreadth(pools, combinationMetrics,
        topPerRequirement, beamWidth, combinations.length),
      budget_rejections: Object.freeze(combinationMetrics.budgetRejections
        .map((entry) => Object.freeze({
          ...entry,
          candidate_ids: Object.freeze([...entry.candidate_ids]),
        }))),
      aesthetic_target_profile: aestheticTargetProfile,
    });
    for (const {product, requirement} of chosen.entries) {
      const identity = productIdentity(product);
      if (identity) usedProductKeys.add(identity);
      selectedProducts.push({
        ...product,
        look_id: look.lookId,
        category: requirement.category,
        outfit_selected: true,
        outfit_strategy_version: STRATEGY_VERSION,
        outfit_strategy_score: chosen.adjustedScore,
        outfit_duplicate_penalty: chosen.duplicatePenalty,
        outfit_style_coherence_score: chosen.scores.styleCoherence,
        outfit_occasion_formality_score: chosen.scores.occasionFormalityFit,
        outfit_silhouette_score: chosen.scores.silhouetteCoherence,
        outfit_color_harmony_score: chosen.scores.colorHarmony,
        outfit_footwear_compatibility_score: chosen.scores.footwearCompatibility,
        outfit_femininity_expression_score: chosen.scores.femininityExpression,
        outfit_brand_quality_value_score: chosen.scores.brandQualityValueCoherence,
        outfit_legwear_compatibility_score: chosen.scores.legwearCompatibility,
        outfit_accessory_compatibility_score: chosen.scores.accessoryCompatibility,
        outfit_material_texture_score: chosen.scores.materialTexture,
        outfit_layering_score: chosen.scores.layering,
        outfit_masculinity_expression_score: chosen.scores.masculinityExpression,
        outfit_focal_hierarchy_score: chosen.scores.focalHierarchy,
        outfit_market_alignment_score: chosen.scores.marketAlignment,
        outfit_body_proportion_score: chosen.scores.bodyProportion,
        outfit_color_intensity_score: chosen.scores.colorIntensity,
        outfit_strategy_breakdown: chosen.dimensionScores,
        outfit_target_profile_match_score: chosen.targetProfileMatch,
        outfit_internal_coherence_score: chosen.internalCoherence,
        outfit_cross_style_conflict_penalty: chosen.crossStyleConflictPenalty,
        outfit_target_miss_penalty: chosen.targetMissPenalty,
        outfit_product_acceptance_penalty: chosen.productAcceptancePenalty,
        outfit_strategy_ranking_reason: chosen.rankingReason,
        outfit_strategy_trace: chosen.strategyTrace,
        outfit_quality_status: chosen.quality.status,
        outfit_quality_reason_codes: chosen.quality.reason_codes,
        outfit_quality_trace: chosen.quality,
        whole_look_quality_status: chosen.quality.status,
        whole_look_quality: chosen.quality,
      });
    }
    selectedLooks.push(report);
  }

  return Object.freeze({
    applied: true,
    products: selectedProducts,
    looks: Object.freeze(selectedLooks),
    rejected_looks: Object.freeze(rejectedLooks),
    reason_codes: Object.freeze(rejectedLooks.length > 0
      ? ["LOW_QUALITY_LOOK"] : []),
    version: STRATEGY_VERSION,
  });
}

function evaluateCombinationQuality(combination) {
  const trace = combination.strategyTrace;
  const entries = combination.entries;
  return evaluateFinalLookQuality({
    overall_score: combination.adjustedScore,
    dimension_scores: {
      scene: conservativeScore([
        trace.occasionFormalityFit,
        trace.slotOccasionFitSummary?.minimum,
        minimumProductScore(entries, ["scene_fit_score", "occasion_fit_score"]),
        minimumAcceptanceEvidenceScore(entries, "occasion_fit"),
      ]),
      desired_impression: conservativeScore([
        trace.targetProfileMatch,
        minimumProductScore(entries, [
          "desired_impression_fit_score", "impression_fit_score", "persona_fit_score",
        ]),
        minimumAcceptanceEvidenceScore(entries, "desired_impression_fit"),
        minimumAcceptanceEvidenceScore(entries, "audience_fit"),
      ]),
      contemporary: conservativeScore([
        trace.marketAlignment,
        minimumProductScore(entries, [
          "contemporary_fit_score", "contemporary_score", "market_soft_match_score",
        ]),
        minimumAcceptanceEvidenceScore(entries, "contemporary_fit"),
        average([trace.targetProfileMatch, trace.focalHierarchy], 60),
      ]),
      style: conservativeScore([
        trace.styleCoherence,
        trace.slotStyleFitSummary?.minimum,
      ]),
      silhouette: conservativeScore([
        trace.silhouetteCoherence,
        trace.slotSilhouetteFitSummary?.minimum,
      ]),
      color: conservativeScore([
        trace.colorHarmony,
        trace.colorIntensityFit,
        trace.slotColorFitSummary?.minimum,
      ]),
      footwear: conservativeScore([
        trace.footwearCompatibility,
        trace.slotFootwearFitSummary?.minimum,
      ]),
      quality: conservativeScore([
        trace.brandQualityValueCoherence,
        trace.materialTexture,
        trace.slotQualityFitSummary?.minimum,
        minimumAcceptanceEvidenceScore(entries, "visual_quality"),
        minimumAcceptanceEvidenceScore(entries, "commerce_quality"),
      ]),
      body: conservativeScore([
        trace.bodyProportion,
        minimumProductScore(entries, [
          "body_fit_score", "body_strategy_match_score", "proportion_score",
        ]),
      ]),
      statement: conservativeScore([
        trace.focalHierarchy,
        minimumProductScore(entries, [
          "statement_fit_score", "visual_hierarchy_score", "distinctiveness_score",
        ]),
      ]),
    },
  });
}

function minimumProductScore(entries, fields) {
  const values = entries.flatMap(({product}) => fields
    .map((field) => finiteNumber(product?.[field]))
    .filter((value) => value != null));
  return values.length > 0 ? Math.min(...values) : null;
}

function minimumAcceptanceEvidenceScore(entries, dimension) {
  const values = entries.map(({product}) =>
    acceptanceEvidenceScore(product?.product_acceptance_evidence?.[dimension]))
    .filter((value) => value != null);
  return values.length > 0 ? Math.min(...values) : null;
}

function acceptanceEvidenceScore(record) {
  if (!record || typeof record !== "object" ||
      record.applicability === "NOT_APPLICABLE") return null;
  const value = String(record.value || "").trim().toLowerCase();
  const baseScores = {
    strong_match: 95,
    match: 85,
    supported: 80,
    high: 80,
    pass: 80,
    partial_match: 65,
    neutral: 60,
    anomaly_risk: 45,
    low: 30,
    unsupported: 25,
    mismatch: 20,
    severe_mismatch: 10,
  };
  if (!Object.hasOwn(baseScores, value)) return null;
  const confidence = finiteNumber(record.confidence);
  const weight = confidence == null ? 0.5 : Math.max(0, Math.min(1, confidence));
  return bounded(60 + (baseScores[value] - 60) * weight);
}

function conservativeScore(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? bounded(Math.min(...finite)) : 60;
}

function combinationTrace(combination, ranked) {
  return Object.freeze({
    rank: ranked.indexOf(combination) + 1,
    look_candidate_id: combinationIdentity(combination.entries),
    candidate_ids: Object.freeze(
      combination.entries.map(({product}) => productId(product)),
    ),
    base_score: combination.finalScore,
    cross_look_duplicate_penalty: combination.duplicatePenalty,
    adjusted_score: combination.adjustedScore,
    strategy_trace: combination.strategyTrace,
    quality: combination.quality,
    whole_look_quality: combination.quality,
  });
}

function combinationIdentity(entries) {
  return entries.map(({product}) => productId(product)).join("|");
}

function candidateBreadth(pools, metrics, topPerRequirement, beamWidth,
  combinationCount) {
  return Object.freeze({
    candidate_count_per_slot: Object.freeze(Object.fromEntries(
      pools.map((pool) => [pool.requirement.category, pool.candidates.length]),
    )),
    candidate_pool_limit: positiveInteger(
      topPerRequirement,
      DEFAULT_TOP_PER_REQUIREMENT,
    ),
    beam_width: positiveInteger(beamWidth, DEFAULT_BEAM_WIDTH),
    expanded_combination_count: metrics.expandedCombinationCount,
    pruned_combination_count: metrics.prunedCombinationCount,
    max_frontier_count: metrics.maxFrontierCount,
    evaluated_complete_combination_count: combinationCount,
    budget_rejected_combination_count: metrics.budgetRejectedCombinationCount,
  });
}

function groupRequirementsByLook(requirements) {
  const looks = new Map();
  for (const raw of requirements) {
    const category = canonicalOutfitSlot(raw);
    const lookId = String(raw?.look_id || raw?.lookId || "").trim();
    if (!category || !lookId) continue;
    const requirement = {
      ...raw,
      category,
      look_id: lookId,
      ...(category === "socks" && !raw?.search_subcategory
        ? {search_subcategory: "socks"} : {}),
    };
    const entry = looks.get(lookId) || {lookId, requirements: []};
    entry.requirements.push(requirement);
    looks.set(lookId, entry);
  }
  return [...looks.values()].map((look) => ({
    ...look,
    structure: analyzeLookStructure(look.requirements),
  }));
}

function analyzeLookStructure(requirements) {
  const categories = new Set(requirements.map((item) => item.category));
  const hasDress = categories.has("dress");
  const invalid = hasDress && (categories.has("top") || categories.has("bottom"));
  const dressBased = hasDress && categories.has("shoes");
  const separates = categories.has("bottom") && categories.has("shoes") &&
    (categories.has("top") || categories.has("outerwear"));
  const coreCategories = new Set(hasDress
    ? ["dress", "shoes"]
    : [categories.has("top") ? "top" : "outerwear", "bottom", "shoes"]);
  return {
    invalid,
    recognized: invalid || dressBased || separates,
    dressBased,
    separates,
    coreCategories,
  };
}

function candidatesForRequirement(products, requirement, context) {
  return products.filter((product) => {
    if (String(product?.look_id || "") !== requirement.look_id) return false;
    if (canonicalOutfitSlot(product) !== requirement.category) return false;
    const requiredSubcategory = String(requirement.search_subcategory || "").trim();
    const productSubcategory = String(product?.search_subcategory || "").trim();
    if (requiredSubcategory && productSubcategory && requiredSubcategory !== productSubcategory) {
      return false;
    }
    return candidateHardGate(product, requirement, context).allowed;
  });
}

function candidateHardGate(product, requirement, context = {}) {
  const evidence = productEvidence(product, requirement);
  const expectedGender = normalizeGender(
    requirement.gender || context.gender || context.recommendation_context?.gender,
  );
  const productGender = authoritativeProductGender(product);
  if (canonicalOutfitSlot(product) !== requirement.category) {
    return {allowed: false, reason: "CATEGORY_SLOT_CONFLICT"};
  }
  if ((expectedGender === "female" && EXPLICIT_MALE_PATTERN.test(evidence)) ||
      (expectedGender === "male" && EXPLICIT_FEMALE_PATTERN.test(evidence))) {
    return {allowed: false, reason: "EXPLICIT_GENDER_CONFLICT"};
  }
  if ((expectedGender === "female" && productGender === "male") ||
      (expectedGender === "male" && productGender === "female")) {
    return {allowed: false, reason: "STRUCTURED_GENDER_CONFLICT"};
  }
  if (productGender === "unisex" && expectedGender !== "unisex" &&
      !profileAllowsUnisex(requirement, context, expectedGender)) {
    return {allowed: false, reason: "UNISEX_PROFILE_CONFLICT"};
  }
  if (NON_FASHION_PATTERN.test(evidence)) {
    return {allowed: false, reason: "NON_FASHION_UTILITY_PRODUCT"};
  }
  if (product?.candidate_gate_result === "FAIL" ||
      product?.hard_constraint_pass === false ||
      product?.blueprint_hard_gate_pass === false) {
    return {allowed: false, reason: "UPSTREAM_HARD_CONSTRAINT_FAILED"};
  }
  const avoid = list(requirement.avoid_attributes || requirement.avoidAttributes);
  if (avoid.some((value) => includesSemantic(evidence, value))) {
    return {allowed: false, reason: "BLUEPRINT_AVOID_CONFLICT"};
  }
  if (requiresNonSportShoe(requirement) && SPORT_PATTERN.test(evidence)) {
    return {allowed: false, reason: "EXPLICIT_NON_SPORT_CONFLICT"};
  }
  const itemBudget = readBudget(context, "item");
  const price = finiteNumber(product?.price);
  if (itemBudget > 0) {
    if (price == null) return {allowed: false, reason: "BUDGET_PRICE_UNKNOWN"};
    if (price > itemBudget) {
      return {allowed: false, reason: "ITEM_BUDGET_EXCEEDED"};
    }
  }
  return {allowed: true, reason: "PASS"};
}

function profileAllowsUnisex(requirement, context, expectedGender) {
  if (expectedGender === "unisex") return true;
  const styleText = [
    requirement?.style,
    context?.style,
    context?.style_expression,
    context?.recommendation_context?.style,
    context?.recommendation_context?.style_expression,
  ].filter(Boolean).join(" ");
  if (NEUTRAL_INTENT_PATTERN.test(styleText)) return true;
  const target = context?.aesthetic_target_profile ||
    context?.recommendation_context?.aesthetic_target_profile || {};
  const profile = context?.style_profile ||
    context?.recommendation_context?.style_profile || {};
  const explicitPolicy = target.allow_unisex ?? target.allowUnisex ??
    target.gender_expression?.allow_unisex ??
    profile.allow_unisex ?? profile.allowUnisex;
  // Gender-expression strength is a ranking signal, not proof that a
  // structurally unisex product is a hard conflict. Only an explicit profile
  // prohibition can turn it into a gate failure.
  return explicitPolicy !== false;
}

function buildCombinations(pools, context, beamWidth, metrics = {}) {
  let combinations = [[]];
  for (const pool of pools) {
    if (pool.candidates.length === 0) {
      if (pool.required) return [];
      continue;
    }
    const expanded = [];
    for (const combination of combinations) {
      for (const product of pool.candidates) {
        const identity = productIdentity(product);
        if (identity && combination.some((entry) =>
          productIdentity(entry.product) === identity)) continue;
        expanded.push([...combination, {product, requirement: pool.requirement}]);
      }
    }
    metrics.expandedCombinationCount =
      (metrics.expandedCombinationCount || 0) + expanded.length;
    metrics.prunedCombinationCount =
      (metrics.prunedCombinationCount || 0) +
      Math.max(0, expanded.length - beamWidth);
    combinations = expanded.map((entries) => ({
      entries,
      outfitScore: scoreOutfitCombination(entries, context).finalScore,
      baseScore: partialCombinationScore(entries),
    })).sort((left, right) =>
      right.outfitScore - left.outfitScore ||
      right.baseScore - left.baseScore ||
      compareCombinationIdentity(left.entries, right.entries))
      .slice(0, beamWidth)
      .map(({entries}) => entries);
    metrics.maxFrontierCount = Math.max(
      metrics.maxFrontierCount || 0,
      combinations.length,
    );
    if (combinations.length === 0) return [];
  }
  const outfitBudget = readBudget(context, "outfit");
  return combinations.filter((combination) => {
    if (new Set(combination.map(({product}) => productId(product))).size !==
        combination.length) return false;
    if (outfitBudget <= 0) return true;
    const prices = combination.map(({product}) => finiteNumber(product?.price));
    if (prices.some((price) => price == null)) {
      metrics.budgetRejectedCombinationCount =
        (metrics.budgetRejectedCombinationCount || 0) + 1;
      metrics.budgetRejections = metrics.budgetRejections || [];
      metrics.budgetRejections.push({
        candidate_ids: combination.map(({product}) => productId(product)),
        total_price: null,
        outfit_budget: outfitBudget,
        reason: "BUDGET_PRICE_UNKNOWN",
      });
      return false;
    }
    const total = prices.reduce((sum, price) => sum + price, 0);
    if (total <= outfitBudget) return true;
    metrics.budgetRejectedCombinationCount =
      (metrics.budgetRejectedCombinationCount || 0) + 1;
    metrics.budgetRejections = metrics.budgetRejections || [];
    metrics.budgetRejections.push({
      candidate_ids: combination.map(({product}) => productId(product)),
      total_price: roundScore(total),
      outfit_budget: outfitBudget,
      reason: "OUTFIT_BUDGET_EXCEEDED",
    });
    return false;
  });
}

function scoreMarketAlignment(entries) {
  return average(entries.map(({product}) => finiteNumber(
    product?.market_soft_match_score,
  )), 60);
}

function scoreOutfitCombination(entries, context = {}) {
  const target = resolveStrategyTarget(context, entries.map(({requirement}) => requirement));
  const slotStyleFitSummary = summarizeSlotTargetFit(entries, target, "style");
  const slotOccasionFitSummary = summarizeSlotTargetFit(entries, target, "occasion");
  const slotQualityFitSummary = summarizeSlotTargetFit(entries, target, "quality");
  const slotColorFitSummary = summarizeSlotTargetFit(entries, target, "color");
  const slotSilhouetteFitSummary = summarizeSlotTargetFit(entries, target, "silhouette");
  const slotFootwearFitSummary = summarizeSlotTargetFit(
    entries.filter(({requirement}) => requirement.category === "shoes"),
    target,
    "footwear",
  );
  const slotGenderFitSummary = summarizeSlotTargetFit(entries, target, "gender");
  const scores = {
    styleCoherence: scoreStyleCoherence(entries),
    occasionFormalityFit: scoreOccasionFormalityFit(entries, target),
    formality: scoreFormality(entries, target),
    silhouetteCoherence: scoreSilhouetteCoherence(entries, target, context),
    bodyProportion: scoreBodyProportion(entries, target, context),
    colorHarmony: scoreColorHarmony(entries, target),
    colorIntensity: scoreColorIntensity(entries, target),
    materialTexture: scoreMaterialTexture(entries, target),
    footwearCompatibility: scoreFootwearCompatibility(entries, target),
    femininityExpression: target.weights.femininity_expression > 0
      ? scoreGenderExpression(entries, target, "feminine") : null,
    masculinityExpression: target.weights.masculinity_expression > 0
      ? scoreGenderExpression(entries, target, "masculine") : null,
    brandQualityValueCoherence: scoreBrandQualityValueCoherence(entries, target, context),
    legwearCompatibility: entries.some(({requirement}) => requirement.category === "socks")
      ? scoreLegwearCompatibility(entries, target) : null,
    accessoryCompatibility: entries.some(({requirement}) =>
      ["bag", "accessory"].includes(requirement.category))
      ? scoreAccessoryCompatibility(entries, target) : null,
    layering: scoreLayering(entries, target),
    focalHierarchy: scoreFocalHierarchy(entries, target),
    marketAlignment: context?.decision_pipeline === "new_decision_pipeline.v1"
      ? scoreMarketAlignment(entries) : null,
    duplicateDiversity: 100,
  };
  const internalCoherence = scoreInternalCoherence(scores);
  const targetProfileMatch = scoreTargetProfileMatch({
    slotStyleFitSummary,
    slotOccasionFitSummary,
    slotQualityFitSummary,
    slotColorFitSummary,
    slotSilhouetteFitSummary,
    slotFootwearFitSummary,
    slotGenderFitSummary,
    formality: scores.formality,
  });
  const crossStyleConflictPenalty = scoreCrossStyleConflictPenalty(
    entries,
    target,
    slotStyleFitSummary,
  );
  const targetMissPenalty = scoreTargetMissPenalty({
    slotStyleFitSummary,
    slotOccasionFitSummary,
    formality: scores.formality,
  });
  const productAcceptancePenalty = scoreProductAcceptancePenalty(entries);
  const rawOutfitScore = targetProfileMatch * TARGET_ALIGNMENT_WEIGHT +
    internalCoherence * INTERNAL_COHERENCE_WEIGHT;
  const finalScore = bounded(rawOutfitScore - crossStyleConflictPenalty -
    targetMissPenalty - productAcceptancePenalty);
  scores.internalCoherence = internalCoherence;
  scores.targetProfileMatch = targetProfileMatch;
  scores.crossStyleConflictPenalty = crossStyleConflictPenalty;
  scores.targetMissPenalty = targetMissPenalty;
  scores.productAcceptancePenalty = productAcceptancePenalty;
  const dimensionScores = Object.freeze({
    style_coherence: scores.styleCoherence,
    occasion_fit: scores.occasionFormalityFit,
    formality: scores.formality,
    silhouette: scores.silhouetteCoherence,
    body_proportion: scores.bodyProportion,
    color_harmony: scores.colorHarmony,
    color_intensity: scores.colorIntensity,
    material_texture: scores.materialTexture,
    footwear_compatibility: scores.footwearCompatibility,
    legwear_compatibility: scores.legwearCompatibility,
    accessory_compatibility: scores.accessoryCompatibility,
    layering: scores.layering,
    femininity_expression: scores.femininityExpression,
    masculinity_expression: scores.masculinityExpression,
    brand_quality_value: scores.brandQualityValueCoherence,
    focal_hierarchy: scores.focalHierarchy,
    market_alignment: scores.marketAlignment,
    duplicate_diversity: scores.duplicateDiversity,
    internal_coherence: internalCoherence,
    target_profile_match: targetProfileMatch,
    cross_style_conflict_penalty: crossStyleConflictPenalty,
    target_miss_penalty: targetMissPenalty,
    product_acceptance_penalty: productAcceptancePenalty,
  });
  const rankingReason = buildRankingReason({
    internalCoherence,
    targetProfileMatch,
    crossStyleConflictPenalty,
    targetMissPenalty,
    productAcceptancePenalty,
  });
  const strategyTrace = Object.freeze({
    candidate_ids: Object.freeze(entries.map(({product}) => productId(product))),
    styleCoherence: scores.styleCoherence,
    occasionFormalityFit: scores.occasionFormalityFit,
    formality: scores.formality,
    silhouetteCoherence: scores.silhouetteCoherence,
    bodyProportion: scores.bodyProportion,
    colorHarmony: scores.colorHarmony,
    colorIntensityFit: scores.colorIntensity,
    materialTexture: scores.materialTexture,
    footwearCompatibility: scores.footwearCompatibility,
    femininityExpression: scores.femininityExpression,
    masculinityExpression: scores.masculinityExpression,
    brandQualityValueCoherence: scores.brandQualityValueCoherence,
    legwearCompatibility: scores.legwearCompatibility,
    accessoryCompatibility: scores.accessoryCompatibility,
    layering: scores.layering,
    focalHierarchy: scores.focalHierarchy,
    marketAlignment: scores.marketAlignment,
    duplicateDiversity: scores.duplicateDiversity,
    internalCoherence,
    targetProfileMatch,
    slotStyleFitSummary,
    slotOccasionFitSummary,
    slotQualityFitSummary,
    slotColorFitSummary,
    slotSilhouetteFitSummary,
    slotFootwearFitSummary,
    slotGenderFitSummary,
    crossStyleConflictPenalty,
    targetMissPenalty,
    productAcceptancePenalty,
    rawOutfitScore: roundScore(rawOutfitScore),
    finalOutfitScore: finalScore,
    ranking_reason: rankingReason,
  });
  return {
    finalScore,
    scores: Object.freeze(scores),
    dimensionScores,
    aestheticTargetProfile: target,
    internalCoherence,
    targetProfileMatch,
    crossStyleConflictPenalty,
    targetMissPenalty,
    productAcceptancePenalty,
    rankingReason,
    strategyTrace,
  };
}

function scoreProductAcceptancePenalty(entries) {
  const penalties = entries.map(({product}) => finiteNumber(
    product?.product_acceptance_penalty,
  ) ?? 0);
  if (penalties.length === 0) return 0;
  const maximum = Math.max(...penalties);
  const mean = average(penalties, 0);
  // A single human-obvious mismatch must not be hidden by color/coherence
  // scores from the other slots.
  return bounded(Math.min(45, maximum + mean * 0.35));
}

function scoreInternalCoherence(scores) {
  const weights = {
    styleCoherence: 0.28,
    silhouetteCoherence: 0.11,
    bodyProportion: 0.06,
    colorHarmony: 0.12,
    colorIntensity: 0.04,
    materialTexture: 0.08,
    footwearCompatibility: 0.12,
    legwearCompatibility: 0.05,
    accessoryCompatibility: 0.04,
    layering: 0.03,
    focalHierarchy: 0.04,
    marketAlignment: 0.03,
    duplicateDiversity: 0.03,
  };
  let weighted = 0;
  let activeWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (!Number.isFinite(scores[key])) continue;
    weighted += scores[key] * weight;
    activeWeight += weight;
  }
  return activeWeight > 0 ? bounded(weighted / activeWeight) : 0;
}

function scoreTargetProfileMatch({
  slotStyleFitSummary,
  slotOccasionFitSummary,
  slotQualityFitSummary,
  slotColorFitSummary,
  slotSilhouetteFitSummary,
  slotFootwearFitSummary,
  slotGenderFitSummary,
  formality,
}) {
  const style = lowerTailFit(slotStyleFitSummary);
  const occasion = lowerTailFit(slotOccasionFitSummary);
  const quality = lowerTailFit(slotQualityFitSummary, 0.20);
  const components = [
    [style, 0.38],
    [occasion, 0.17],
    [quality, 0.14],
    [slotSilhouetteFitSummary.average, 0.08],
    [slotColorFitSummary.average, 0.06],
    [slotFootwearFitSummary.average, 0.08],
    [slotGenderFitSummary.average, 0.03],
    [formality, 0.06],
  ];
  let weighted = 0;
  let activeWeight = 0;
  for (const [score, weight] of components) {
    if (!Number.isFinite(score)) continue;
    weighted += score * weight;
    activeWeight += weight;
  }
  return activeWeight > 0 ? bounded(weighted / activeWeight) : 0;
}

function scoreTargetMissPenalty({
  slotStyleFitSummary,
  slotOccasionFitSummary,
  formality,
}) {
  const styleCore = lowerTailFit(slotStyleFitSummary);
  const occasionCore = lowerTailFit(slotOccasionFitSummary);
  const coreFit = styleCore * 0.52 + occasionCore * 0.28 + formality * 0.20;
  const deficit = Math.max(0, CORE_TARGET_FLOOR - coreFit);
  const styleDeficit = Math.max(0, CORE_TARGET_FLOOR - styleCore);
  const occasionDeficit = Math.max(0, 68 - occasionCore);
  const weakestStyleDeficit = Math.max(0, 58 - slotStyleFitSummary.minimum);
  return bounded(Math.min(28,
    deficit * 0.08 + deficit * deficit * 0.012 +
    styleDeficit * 0.10 + styleDeficit * styleDeficit * 0.012 +
    occasionDeficit * 0.06 + occasionDeficit * occasionDeficit * 0.008 +
    weakestStyleDeficit * 0.18,
  ));
}

function scoreCrossStyleConflictPenalty(entries, target, styleSummary) {
  if (entries.length < 2) return 0;
  const targetStyleValues = Array.isArray(target?.style_targets)
    ? target.style_targets : [target?.style_targets];
  const targetStyles = new Set(targetStyleValues
    .map((value) => typeof value === "object" ? value?.id : value)
    .map(normalizeStyleToken).filter(Boolean));
  const scoresById = new Map(styleSummary.slots.map((slot) => [
    slot.candidate_id,
    slot.score,
  ]));
  const conflicts = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEntry = entries[left];
      const rightEntry = entries[right];
      const leftStyle = primaryProductStyle(leftEntry.product);
      const rightStyle = primaryProductStyle(rightEntry.product);
      const leftTokens = productStyleTokens(leftEntry.product);
      const rightTokens = productStyleTokens(rightEntry.product);
      const sharedToken = [...leftTokens].some((token) => rightTokens.has(token));
      const bothExplicitTargets = Boolean(leftStyle && rightStyle &&
        targetStyles.has(leftStyle) && targetStyles.has(rightStyle));
      const minimumFit = Math.min(
        scoresById.get(productId(leftEntry.product)) ?? 60,
        scoresById.get(productId(rightEntry.product)) ?? 60,
      );
      let taxonomyConflict;
      if (leftStyle && leftStyle === rightStyle) taxonomyConflict = 0;
      else if ((!leftStyle || !rightStyle) && sharedToken) taxonomyConflict = 0.08;
      else if (bothExplicitTargets || minimumFit >= 90) taxonomyConflict = 0.10;
      else if (minimumFit >= 78) taxonomyConflict = 0.16;
      else if (minimumFit >= 60) taxonomyConflict = 0.48;
      else taxonomyConflict = 0.82;
      const vectors = [leftEntry, rightEntry].map(({product, requirement}) =>
        inferProductAesthetic(productEvidence(product), requirement.category));
      const vectorConflict = average([
        Math.abs(vectors[0].formality - vectors[1].formality),
        Math.abs(vectors[0].sportiness - vectors[1].sportiness),
        Math.abs(vectors[0].quality - vectors[1].quality),
        Math.abs(vectors[0].structure - vectors[1].structure),
      ], 0);
      conflicts.push(taxonomyConflict * 0.70 + vectorConflict * 0.30);
    }
  }
  return bounded(Math.min(18, average(conflicts, 0) * 18));
}

function summarizeSlotTargetFit(entries, target, kind) {
  const slots = Object.freeze(entries.map(({product, requirement}) => Object.freeze({
    slot: requirement.category,
    candidate_id: productId(product),
    score: candidateTargetFit(product, requirement, target, kind),
  })));
  const values = slots.map((slot) => slot.score);
  return Object.freeze({
    average: values.length > 0 ? roundScore(average(values, 0)) : null,
    minimum: values.length > 0 ? roundScore(Math.min(...values)) : null,
    maximum: values.length > 0 ? roundScore(Math.max(...values)) : null,
    slots,
  });
}

function candidateTargetFit(product, requirement, target, kind) {
  const canonicalDimension = {
    style: "style_fit",
    occasion: "occasion_fit",
    quality: "quality_fit",
    color: "color_fit",
    silhouette: "silhouette_fit",
    footwear: "footwear_fit",
    gender: "audience_fit",
  }[kind];
  const canonical = targetFitScore(product, canonicalDimension);
  if (canonical != null) return canonical;
  const assessment = product?.aesthetic_target_assessment || {};
  const directFields = {
    style: [product?.style_fit_score, assessment.style_fit, product?.style_match_score],
    occasion: [product?.occasion_fit_score, assessment.occasion_fit],
    quality: [product?.quality_fit_score, assessment.quality_fit],
    color: [product?.color_fit_score, assessment.color_fit],
    silhouette: [product?.silhouette_fit_score, assessment.silhouette_fit],
    footwear: [product?.footwear_fit_score, assessment.footwear_fit],
    gender: [product?.gender_fit_score, assessment.gender_fit],
  };
  for (const value of directFields[kind] || []) {
    const number = finiteNumber(value);
    if (number != null) return bounded(number);
  }
  const evidence = productEvidence(product);
  const vector = inferProductAesthetic(evidence, requirement.category);
  switch (kind) {
    case "style":
      return average([
        closeness(vector.femininity, target.dimensions?.femininity),
        closeness(vector.masculinity, target.dimensions?.masculinity),
        closeness(vector.sportiness, target.dimensions?.sportiness),
        closeness(vector.structure, target.dimensions?.structure),
      ], 60);
    case "occasion":
      return average([
        closeness(vector.formality, target.formality_target),
        closeness(vector.sportiness, target.dimensions?.sportiness),
      ], 60);
    case "quality":
      return closeness(vector.quality, target.quality_target);
    case "color":
      return closeness(vector.colorIntensity, target.color_targets?.intensity);
    case "silhouette":
      return closeness(vector.structure, target.silhouette_targets?.structure);
    case "footwear":
      return requirement.category === "shoes"
        ? scoreFootwearCompatibility([{product, requirement}], target) : 70;
    case "gender":
      return 100;
    default:
      return 60;
  }
}

function lowerTailFit(summary, minimumWeight = 0.28) {
  if (!summary || !Number.isFinite(summary.average)) return 60;
  const minimum = Number.isFinite(summary.minimum) ? summary.minimum : summary.average;
  return summary.average * (1 - minimumWeight) + minimum * minimumWeight;
}

function buildRankingReason({
  internalCoherence,
  targetProfileMatch,
  crossStyleConflictPenalty,
  targetMissPenalty,
  productAcceptancePenalty = 0,
}) {
  const reasons = [];
  if (targetProfileMatch >= 88) reasons.push("STRONG_TARGET_ALIGNMENT");
  else if (targetProfileMatch >= 74) reasons.push("TARGET_ALIGNMENT_ACCEPTABLE");
  else reasons.push("TARGET_ALIGNMENT_WEAK");
  if (internalCoherence >= 82) reasons.push("STRONG_INTERNAL_COHERENCE");
  else if (internalCoherence >= 68) reasons.push("INTERNAL_COHERENCE_ACCEPTABLE");
  else reasons.push("INTERNAL_COHERENCE_WEAK");
  if (crossStyleConflictPenalty >= 6) reasons.push("CROSS_STYLE_CONFLICT");
  if (productAcceptancePenalty > 0) {
    reasons.push("REAL_PRODUCT_ACCEPTANCE_PENALTY");
  }
  if (targetMissPenalty > 0) reasons.push("CORE_TARGET_FLOOR_PENALTY");
  return Object.freeze(reasons);
}

function scoreWeights(target) {
  const map = {
    styleCoherence: "style_coherence",
    occasionFormalityFit: "occasion_fit",
    formality: "formality",
    silhouetteCoherence: "silhouette",
    bodyProportion: "body_proportion",
    colorHarmony: "color_harmony",
    colorIntensity: "color_intensity",
    materialTexture: "material_texture",
    footwearCompatibility: "footwear_compatibility",
    legwearCompatibility: "legwear_compatibility",
    accessoryCompatibility: "accessory_compatibility",
    layering: "layering",
    femininityExpression: "femininity_expression",
    masculinityExpression: "masculinity_expression",
    brandQualityValueCoherence: "brand_quality_value",
    focalHierarchy: "focal_hierarchy",
    duplicateDiversity: "duplicate_diversity",
  };
  return Object.freeze(Object.fromEntries(Object.entries(map).map(([score, targetKey]) =>
    [score, Number(target.weights?.[targetKey] || 0)])));
}

function scoreStyleCoherence(entries) {
  if (entries.length < 2) return 100;
  const pairScores = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const leftEntry = entries[left];
      const rightEntry = entries[right];
      const leftVector = inferProductAesthetic(
        productEvidence(leftEntry.product),
        leftEntry.requirement.category,
      );
      const rightVector = inferProductAesthetic(
        productEvidence(rightEntry.product),
        rightEntry.requirement.category,
      );
      const vectorCoherence = bounded(100 - average([
        Math.abs(leftVector.formality - rightVector.formality),
        Math.abs(leftVector.sportiness - rightVector.sportiness),
        Math.abs(leftVector.quality - rightVector.quality),
        Math.abs(leftVector.structure - rightVector.structure),
        Math.abs(leftVector.statement - rightVector.statement),
        Math.abs(leftVector.texture - rightVector.texture),
      ], 0) * 100);
      const leftStyle = primaryProductStyle(leftEntry.product);
      const rightStyle = primaryProductStyle(rightEntry.product);
      const leftTokens = productStyleTokens(leftEntry.product);
      const rightTokens = productStyleTokens(rightEntry.product);
      const shared = [...leftTokens].some((token) => rightTokens.has(token));
      const taxonomyCoherence = leftStyle && leftStyle === rightStyle
        ? 100 : shared ? 88 : 52;
      pairScores.push(vectorCoherence * 0.58 + taxonomyCoherence * 0.42);
    }
  }
  return bounded(average(pairScores, 70));
}

function scoreOccasionFormalityFit(entries, target) {
  const vectors = entries.map(({product, requirement}) =>
    inferProductAesthetic(productEvidence(product), requirement.category));
  const actualFormality = average(vectors.map((value) => value.formality), 0.5);
  const actualSportiness = average(vectors.map((value) => value.sportiness), 0.4);
  const upstream = summarizeSlotTargetFit(entries, target, "occasion").average;
  const inferred = 0.72 * closeness(actualFormality, target.formality_target) +
    0.28 * closeness(actualSportiness, target.dimensions.sportiness);
  return bounded((Number.isFinite(upstream) ? upstream : 60) * 0.68 +
    inferred * 0.32);
}

function scoreFormality(entries, target) {
  const actual = average(entries.map(({product, requirement}) =>
    inferProductAesthetic(productEvidence(product), requirement.category)
      .formality), 0.5);
  return closeness(actual, target.formality_target);
}

function scoreSilhouetteCoherence(entries, target, context) {
  const byCategory = productEntriesByCategory(entries);
  const evidence = entries.map(({product, requirement}) =>
    productEvidence(product, requirement));
  let score = average(entries.map(({product}) =>
    finiteNumber(product?.body_strategy_match_score)), 64);
  if (evidence.length > 1 && evidence.every((value) => LOOSE_PATTERN.test(value))) score -= 30;
  const top = byCategory.get("top")?.[0];
  const bottom = byCategory.get("bottom")?.[0];
  if (top && bottom && LOOSE_PATTERN.test(productEvidence(top.product, top.requirement)) &&
      LOOSE_PATTERN.test(productEvidence(bottom.product, bottom.requirement))) score -= 22;
  if (bottom && WAISTLINE_PATTERN.test(productEvidence(bottom.product, bottom.requirement))) {
    score += 10;
  }
  const dress = byCategory.get("dress")?.[0];
  if (dress && WAISTLINE_PATTERN.test(productEvidence(dress.product, dress.requirement))) {
    score += 12;
  }
  const height = readHeight(context);
  if (height > 0 && height <= 162) {
    if (evidence.some((value) => WAISTLINE_PATTERN.test(value))) score += 7;
    if (evidence.some((value) => HEAVY_SHOE_PATTERN.test(value))) score -= 12;
  }
  const targetStructure = Number(target.silhouette_targets?.structure || 0.5);
  const actualStructure = average(evidence.map((value) =>
    inferProductAesthetic(value).structure), 0.5);
  score = score * 0.72 + closeness(actualStructure, targetStructure) * 0.28;
  return bounded(score);
}

function scoreBodyProportion(entries, target, context) {
  const evidence = entries.map(({product, requirement}) =>
    productEvidence(product, requirement));
  let score = average(entries.map(({product}) =>
    finiteNumber(product?.body_strategy_match_score)), 65);
  const height = readHeight(context);
  if (height > 0 && height <= 162) {
    if (evidence.some((value) => WAISTLINE_PATTERN.test(value))) score += 12;
    if (evidence.some((value) => HEAVY_SHOE_PATTERN.test(value))) score -= 14;
  }
  if (evidence.length > 1 && evidence.every((value) => LOOSE_PATTERN.test(value))) score -= 18;
  const targetVerticality = Number(target.silhouette_targets?.verticality || 0.5);
  const actualVerticality = evidence.some((value) => WAISTLINE_PATTERN.test(value))
    ? 0.78 : evidence.some((value) => /拖地|低腰|五分裤/i.test(value)) ? 0.28 : 0.52;
  return bounded(score * 0.68 + closeness(actualVerticality, targetVerticality) * 0.32);
}

function scoreColorHarmony(entries, target) {
  const colors = entries.flatMap(({product, requirement}) =>
    detectColors(productEvidence(product, requirement)));
  const unique = [...new Set(colors)];
  if (unique.length === 0) return 68;
  const maxColors = Number(target.color_targets?.max_main_colors || 3);
  let score = unique.length === 1 ? 94 : unique.length <= maxColors ? 82 : 52;
  if (unique.length > maxColors) score -= (unique.length - maxColors) * 12;
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      const pair = normalizedPair(unique[left], unique[right]);
      if (NEUTRAL_COLORS.has(unique[left]) || NEUTRAL_COLORS.has(unique[right])) score += 3;
      else if (ADJACENT_COLORS.has(pair)) score += 6;
      else if (CONFLICT_COLORS.has(pair)) score -= 14;
    }
  }
  return bounded(score);
}

function scoreColorIntensity(entries, target) {
  const evidence = entries.map(({product, requirement}) =>
    productEvidence(product, requirement));
  const actual = average(evidence.map(inferColorIntensity), 0.35);
  return closeness(actual, target.color_targets?.intensity ?? 0.4);
}

function scoreMaterialTexture(entries, target) {
  const vectors = entries.map(({product, requirement}) =>
    inferProductAesthetic(productEvidence(product, requirement), requirement.category));
  return bounded(0.58 * closeness(
    average(vectors.map((value) => value.quality), 0.5),
    target.material_targets?.quality ?? 0.5,
  ) + 0.42 * closeness(
    average(vectors.map((value) => value.texture), 0.5),
    target.material_targets?.texture ?? 0.5,
  ));
}

function scoreFootwearCompatibility(entries, target) {
  const shoeEntry = entries.find(({requirement}) => requirement.category === "shoes");
  if (!shoeEntry) return 0;
  const evidence = productEvidence(shoeEntry.product, shoeEntry.requirement);
  const shoe = inferFootwearAesthetic(evidence);
  const desired = target.footwear_targets || {};
  const hasDressOrSkirt = entries.some(({product, requirement}) =>
    requirement.category === "dress" ||
    (requirement.category === "bottom" && /裙/i.test(productEvidence(product, requirement))));
  let score = average([
    closeness(shoe.formality, desired.formality ?? 0.5),
    closeness(shoe.femininity, desired.femininity ?? 0.5),
    closeness(shoe.masculinity, desired.masculinity ?? 0.5),
    closeness(shoe.visualWeight, desired.visual_weight ?? 0.5),
    closeness(shoe.toeRefinement, desired.toe_refinement ?? 0.5),
    closeness(shoe.heelPresence, desired.heel_presence ?? 0.35),
    closeness(shoe.quality, desired.material_quality ?? 0.5),
    closeness(shoe.sportiness, desired.sportiness ?? 0.4),
  ], 60);
  if ((desired.sportiness ?? 0.4) >= 0.75 && shoe.sportiness >= 0.75) {
    score += 10;
  }
  if (hasDressOrSkirt && shoe.toeRefinement >= 0.65) score += 5;
  if (hasDressOrSkirt && shoe.visualWeight >= 0.78 && desired.visual_weight < 0.6) score -= 9;
  return bounded(score);
}

function scoreGenderExpression(entries, target, expression) {
  const signals = entries.map(({product, requirement}) => {
    const evidence = productEvidence(product, requirement);
    const vector = inferProductAesthetic(evidence, requirement.category);
    return expression === "feminine" ? vector.femininity : vector.masculinity;
  });
  const desired = target.gender_expression?.[expression] ?? 0.5;
  return closeness(average(signals, 0.5), desired);
}

function scoreBrandQualityValueCoherence(entries, target, context) {
  const targetFits = entries.map(({product, requirement}) =>
    candidateTargetFit(product, requirement, target, "quality"));
  const observedTiers = entries.map(({product}) => productQualityTier(product));
  const tierCoherence = observedTiers.length < 2 ? 100 : bounded(
    100 - (Math.max(...observedTiers) - Math.min(...observedTiers)) * 100,
  );
  const values = entries.map(({product}) => finiteNumber(
    product?.value_reasonableness ?? product?.value_score ?? product?.aesthetic_score,
  )).filter((value) => value != null).map(bounded);
  const valueFit = average(values, 70);
  return bounded(average(targetFits, 60) * 0.68 +
    tierCoherence * 0.18 + valueFit * 0.14);
}

function scoreLegwearCompatibility(entries, target) {
  const sockEntry = entries.find(({requirement}) => requirement.category === "socks");
  const shoeEntry = entries.find(({requirement}) => requirement.category === "shoes");
  if (!sockEntry || !shoeEntry) return 60;
  const socks = productEvidence(sockEntry.product, sockEntry.requirement);
  const shoes = productEvidence(shoeEntry.product, shoeEntry.requirement);
  const hasDressOrSkirt = entries.some(({product, requirement}) =>
    requirement.category === "dress" ||
    (requirement.category === "bottom" && /裙/i.test(productEvidence(product, requirement))));
  const legwear = inferLegwearAesthetic(socks);
  const desired = target.legwear_targets || {};
  let score = average([
    closeness(legwear.formality, desired.formality ?? 0.5),
    closeness(legwear.length, desired.length ?? 0.5),
    closeness(legwear.opacity, desired.opacity ?? 0.5),
    closeness(legwear.pattern, desired.pattern ?? 0.3),
    closeness(legwear.colorIntensity, desired.color_intensity ?? 0.4),
    closeness(legwear.warmth, desired.warmth ?? 0.5),
    closeness(legwear.styleExpression, desired.style_expression ?? 0.5),
  ], 60);
  if (hasDressOrSkirt) score += 10;
  if (REFINED_SHOE_PATTERN.test(shoes)) score += 10;
  if (SPORT_PATTERN.test(shoes) && legwear.formality > 0.7 &&
      (target.footwear_targets?.sportiness ?? 0.4) < 0.5) score -= 14;
  const sockColors = detectColors(socks);
  const shoeColors = detectColors(shoes);
  if (sockColors.some((color) => shoeColors.includes(color) || NEUTRAL_COLORS.has(color))) {
    score += 10;
  }
  return bounded(score);
}

function scoreAccessoryCompatibility(entries, target) {
  const accessories = entries.filter(({requirement}) =>
    ["bag", "accessory"].includes(requirement.category));
  const desired = target.accessory_targets || {};
  return average(accessories.map(({product, requirement}) => {
    const vector = inferProductAesthetic(productEvidence(product, requirement), requirement.category);
    return average([
      closeness(vector.formality, desired.formality ?? 0.5),
      closeness(vector.quality, desired.quality ?? 0.5),
      closeness(vector.statement, desired.statement_strength ?? 0.4),
      closeness(vector.utility, desired.utility ?? 0.3),
    ], 60);
  }), 65);
}

function scoreLayering(entries, target) {
  const categories = new Set(entries.map(({requirement}) => requirement.category));
  const actualComplexity = categories.has("outerwear") ? 0.76 :
    categories.size >= 5 ? 0.62 : 0.32;
  return closeness(actualComplexity, target.layering_targets?.complexity ?? 0.4);
}

function scoreFocalHierarchy(entries, target) {
  const focalCount = entries.filter(({product, requirement}) => {
    const evidence = productEvidence(product, requirement);
    return /刺绣|蕾丝|蝴蝶结|亮片|金属|撞色|印花|statement|夸张|荷叶边|泡泡袖/i
      .test(evidence);
  }).length;
  const desiredCount = Number(target.focal_hierarchy?.max_focal_points || 1);
  const countScore = bounded(100 - Math.abs(focalCount - desiredCount) * 28);
  const actualStrength = Math.min(1, focalCount / Math.max(1, entries.length) * 1.8);
  return bounded(0.55 * countScore + 0.45 * closeness(
    actualStrength,
    target.focal_hierarchy?.strength ?? 0.4,
  ));
}

function resolveStrategyTarget(context = {}, requirements = []) {
  const authorizedTargets = requirements.map(authorizedAestheticTarget)
    .filter(Boolean);
  if (authorizedTargets.length > 0) {
    return authorizedTargets[0];
  }
  const configured = context.aesthetic_target_profile ||
    context.aestheticTargetProfile ||
    context.recommendation_context?.aesthetic_target_profile;
  if (configured?.version && configured?.weights) return configured;
  const profile = context.style_profile || context.styleProfile ||
    context.recommendation_context?.style_profile ||
    context.user_requirements?.style_profile || {};
  const styleText = [
    context.style,
    context.user_requirements?.style,
    profile.source_text,
    profile.primary_style,
    ...requirements.flatMap((requirement) => [
      requirement?.style,
      requirement?.style_role,
    ]),
  ].filter(Boolean).join(" ");
  const expression = String(
    context.style_expression || context.recommendation_context?.style_expression || "",
  ).trim().toLowerCase();
  const explicitNeutral = expression === "neutral" || NEUTRAL_INTENT_PATTERN.test(styleText);
  const resolved = resolveAestheticTargetProfile({
    gender: context.gender || context.user_requirements?.gender ||
      context.recommendation_context?.gender,
    style: styleText,
    scene: context.scene || context.user_requirements?.scene ||
      context.recommendation_context?.scene,
    style_profile: profile,
    budget: context.budget || context.user_requirements?.budget ||
      context.recommendation_context?.budget,
    item_budget: context.item_budget || context.user_requirements?.item_budget,
    outfit_budget: context.outfit_budget || context.user_requirements?.outfit_budget,
    weather: context.weather || context.user_requirements?.weather,
  });
  if (!explicitNeutral) return resolved;
  const weights = {...resolved.weights,
    femininity_expression: 0,
    masculinity_expression: 0,
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze({...resolved,
    gender_expression: Object.freeze({feminine: 0.35, masculine: 0.35, neutral: 0.9}),
    weights: Object.freeze(Object.fromEntries(Object.entries(weights)
      .map(([key, value]) => [key, Number((value / total).toFixed(4))]))),
  });
}

function inferProductAesthetic(evidence, category = "") {
  const sportiness = SPORT_PATTERN.test(evidence) ? 0.90 :
    /休闲|帆布|牛仔|卫衣/i.test(evidence) ? 0.48 : 0.22;
  const femininity = FEMININE_PATTERN.test(evidence) ? 0.86 :
    /甜美|浪漫|柔美|soft|romantic|sweet/i.test(evidence) ? 0.68 : 0.42;
  const masculinity = /工装|宽大|硬朗|军旅|粗犷|workwear|rugged/i.test(evidence)
    ? 0.78 : /tailored|structured|clean_fit|利落|挺括/i.test(evidence) ? 0.56 : 0.42;
  const quality = /luxury|奢华|高端|顶级|礼服级/i.test(evidence) ? 0.94 :
    PREMIUM_PATTERN.test(evidence) || /premium/i.test(evidence) ? 0.82 :
    /基础|普通|塑料|pu|廉价/i.test(evidence) ? 0.36 : 0.56;
  const formality = FORMAL_PRODUCT_PATTERN.test(evidence) ? 0.94 :
    SPORT_PATTERN.test(evidence) ? 0.24 :
    REFINED_SHOE_PATTERN.test(evidence) || PREMIUM_PATTERN.test(evidence) ? 0.78 :
      /连衣裙|半身裙|衬衫|乐福|商务|business|tailored/i.test(evidence) ? 0.66 : 0.48;
  const structure = /西装|剪裁|挺括|廓形|直线|高腰|structured|tailored|tapered|fitted/i.test(evidence) ? 0.76 :
    /柔软|薄纱|宽松|慵懒/i.test(evidence) ? 0.34 : 0.52;
  const statement = DESIGN_DETAIL_PATTERN.test(evidence) ||
    /金属|亮片|撞色|印花|夸张/i.test(evidence) ? 0.76 : 0.30;
  const utility = /功能|防晒|户外|多口袋|收纳|运动/i.test(evidence) ? 0.82 : 0.24;
  const texture = /真丝|羊绒|羊毛|蕾丝|粗花呢|皮革|提花|刺绣/i.test(evidence)
    ? 0.78 : 0.42;
  return {
    femininity,
    masculinity,
    sportiness,
    quality,
    formality,
    structure,
    statement,
    utility,
    texture,
    colorIntensity: inferColorIntensity(evidence),
    category,
  };
}

function inferFootwearAesthetic(evidence) {
  const base = inferProductAesthetic(evidence, "shoes");
  return {
    formality: base.formality,
    femininity: base.femininity,
    masculinity: base.masculinity,
    visualWeight: HEAVY_SHOE_PATTERN.test(evidence) ? 0.92 :
      /轻量|浅口|芭蕾|尖头|低跟|细跟/i.test(evidence) ? 0.28 : 0.52,
    toeRefinement: /尖头|杏仁头|浅口|芭蕾|玛丽珍|乐福/i.test(evidence)
      ? 0.84 : /圆头|大头|厚底/i.test(evidence) ? 0.38 : 0.56,
    heelPresence: /高跟|细跟|中跟/i.test(evidence) ? 0.86 :
      /低跟|猫跟/i.test(evidence) ? 0.58 : 0.16,
    quality: base.quality,
    sportiness: base.sportiness,
  };
}

function inferLegwearAesthetic(evidence) {
  return {
    length: /连裤|长筒|过膝/i.test(evidence) ? 0.88 :
      /中筒|及膝/i.test(evidence) ? 0.64 : /船袜|短袜|踝袜/i.test(evidence) ? 0.24 : 0.50,
    formality: /丝袜|连裤袜|蕾丝|羊毛/i.test(evidence) ? 0.72 :
      /运动|棉袜/i.test(evidence) ? 0.38 : 0.52,
    opacity: /厚|不透|羊毛/i.test(evidence) ? 0.86 :
      /薄|半透|丝袜/i.test(evidence) ? 0.32 : 0.58,
    pattern: /花纹|蕾丝|条纹|格纹|刺绣/i.test(evidence) ? 0.78 : 0.18,
    colorIntensity: inferColorIntensity(evidence),
    warmth: /羊毛|加厚|保暖|绒/i.test(evidence) ? 0.88 :
      /薄|丝袜|冰丝/i.test(evidence) ? 0.24 : 0.52,
    styleExpression: /蕾丝|丝袜|花纹|刺绣|运动|学院/i.test(evidence) ? 0.76 : 0.42,
  };
}

function inferColorIntensity(evidence) {
  if (/荧光|亮色|高饱和|撞色|彩色|玫红|橙|明黄/i.test(evidence)) return 0.88;
  if (/黑|白|灰|米|杏|卡其|驼|棕|海军蓝|藏蓝/i.test(evidence)) return 0.24;
  if (/粉|红|绿|蓝|紫|黄/i.test(evidence)) return 0.58;
  return 0.38;
}

function averageVectors(vectors) {
  const keys = ["femininity", "masculinity", "sportiness", "quality", "formality",
    "structure", "statement", "utility", "texture", "colorIntensity"];
  return Object.fromEntries(keys.map((key) => [key,
    average(vectors.map((value) => value[key]), 0.5)]));
}

function vectorSpread(vectors, keys) {
  if (vectors.length < 2) return 0;
  return average(keys.map((key) => {
    const values = vectors.map((vector) => vector[key]);
    return Math.max(...values) - Math.min(...values);
  }), 0);
}

function closeness(actual, target) {
  const left = Number(actual);
  const right = Number(target);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 60;
  return bounded(100 - Math.abs(left - right) * 112);
}

function productEntriesByCategory(entries) {
  const result = new Map();
  for (const entry of entries) {
    const values = result.get(entry.requirement.category) || [];
    values.push(entry);
    result.set(entry.requirement.category, values);
  }
  return result;
}

function requiresNonSportShoe(requirement) {
  if (requirement.category !== "shoes") return false;
  return list([
    requirement.required_attributes,
    requirement.avoid_attributes,
    requirement.product_type,
  ]).some((value) => /非.*运动|不要.*运动|避免.*运动|不含.*运动|non.?sport/i.test(value)) ||
    list(requirement.avoid_attributes).some((value) => /运动/i.test(value));
}

function productEvidence(product = {}) {
  return [
    product.title,
    product.name,
    product.brand,
    product.shop_name,
    product.category,
    product.search_subcategory,
    product.style,
    product.color,
    product.material,
    product.product_type,
    product.product_family,
    product.style_tags,
    product.occasion_tags,
    product.quality_tier,
    product.color_label,
    product.aesthetic_tags,
    product.silhouette_tags,
    product.detail_tags,
    product.matched_elements,
  ].flat().filter(Boolean).join(" ");
}

function primaryProductStyle(product = {}) {
  const explicit = normalizeStyleToken(product.style || product.canonical_style);
  if (explicit) return explicit;
  return [...productStyleTokens(product)][0] || "";
}

function productStyleTokens(product = {}) {
  return new Set([
    product.style,
    product.canonical_style,
    product.style_tags,
    product.aesthetic_tags,
  ].flat(Infinity).map(normalizeStyleToken).filter(Boolean));
}

function normalizeStyleToken(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function productQualityTier(product = {}) {
  const tier = String(product.quality_tier || "").trim().toLowerCase();
  if (["luxury", "designer", "high_luxury"].includes(tier)) return 1;
  if (["premium", "high", "elevated"].includes(tier)) return 0.82;
  if (["mid", "standard", "mass_premium"].includes(tier)) return 0.62;
  if (["value", "budget", "basic"].includes(tier)) return 0.42;
  const structured = finiteNumber(product.brand_quality_score);
  return structured == null ? 0.58 : Math.max(0, Math.min(1, structured / 100));
}

function detectColors(evidence) {
  return COLOR_DEFINITIONS.filter(([, pattern]) => pattern.test(evidence))
    .map(([name]) => name);
}

function normalizedPair(left, right) {
  return [left, right].sort().join(":");
}

function readBudget(context, type) {
  const snake = `${type}_budget`;
  const camel = `${type}Budget`;
  const candidates = [
    context?.[snake],
    context?.[camel],
    context?.budget?.[type],
    context?.user_requirements?.[snake],
    context?.userRequirements?.[camel],
    context?.recommendation_context?.budget?.[type],
  ];
  for (const value of candidates) {
    const number = finiteNumber(value);
    if (number != null && number > 0) return number;
  }
  return 0;
}

function readHeight(context) {
  const values = [
    context?.user_profile?.height,
    context?.userProfile?.height,
    context?.body_profile?.height,
    context?.recommendation_context?.body_profile?.height,
  ];
  for (const value of values) {
    const number = finiteNumber(value);
    if (number != null && number > 0) return number;
  }
  return 0;
}

function partialCombinationScore(entries) {
  return average(entries.map(({product}) => finiteNumber(
    product?.final_score ?? product?.ai_match_score ??
    product?.aesthetic_score ?? product?.relevance_score,
  )), 50);
}

function compareCandidateBase(left, right) {
  return partialCombinationScore([{product: right}]) -
      partialCombinationScore([{product: left}]) ||
    productId(left).localeCompare(productId(right));
}

function compareCombinationIdentity(left, right) {
  return left.map(({product}) => productId(product)).join("|")
    .localeCompare(right.map(({product}) => productId(product)).join("|"));
}

function productId(product) {
  return String(product?.product_id || product?.id || "").trim();
}

function productIdentity(product) {
  return String(
    product?.canonical_product_identity || canonicalProductIdentity(product),
  ).trim();
}

function canonicalOutfitSlot(value = {}) {
  const rawCategory = String(value?.category || value || "").trim().toLowerCase();
  const subcategory = String(
    value?.search_subcategory || value?.subcategory || "",
  ).trim().toLowerCase();
  if (rawCategory === "socks" || subcategory === "socks") return "socks";
  if (rawCategory === "skirt") return "bottom";
  return normalizeProductCategory(rawCategory);
}

function includesSemantic(evidence, value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target) return false;
  if (/运动/i.test(target) && SPORT_PATTERN.test(evidence)) return true;
  if (/(?:leather_shoes|皮鞋|leather\s*(?:dress\s*)?shoes?)/iu.test(target)) {
    return /(?:皮鞋|皮革|(?:^|[^a-z_])leather(?:$|[^a-z_])|oxford|derby|loafer|乐福)/iu
      .test(String(evidence || ""));
  }
  return String(evidence || "").toLowerCase().includes(target);
}

function list(value) {
  return (Array.isArray(value) ? value : [value]).flat(Infinity)
    .map((item) => String(item || "").trim()).filter(Boolean);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values, fallback = 0) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : fallback;
}

function bounded(value) {
  return Math.max(0, Math.min(100, roundScore(value)));
}

function roundScore(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  STRATEGY_VERSION,
  candidateHardGate,
  composeOutfitCandidates,
  scoreOutfitCombination,
};
