"use strict";

const crypto = require("node:crypto");
const {
  authoritativeProductGender,
  normalizeGender,
  normalizeProductCategory,
} = require("./product_relevance");
const {
  acceptanceEvidenceFromTargetFit,
  attachTargetFitAssessment,
} = require("./target_fit_assessment");

const PRODUCT_ACCEPTANCE_VERSION = "real_product_acceptance_gate_v1";
const EVIDENCE_APPLICABILITY = Object.freeze({
  APPLICABLE: "APPLICABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNKNOWN: "UNKNOWN",
});

// These are general product-taxonomy signals. They are deliberately not brand,
// merchant, candidate-id, or exact-listing blacklists.
const CHILD_AUDIENCE_PATTERN = /(?:婴幼儿|婴儿|幼童|儿童|童装|男童|女童|少儿|小童|中童|大童|kids?|children)/iu;
const MATURE_EXPRESSION_PATTERN = /(?:中老年|老年|老人|奶奶|爷爷|妈妈款|妈妈鞋|爸爸款|爸爸鞋|老人鞋)/iu;
const TRADITIONAL_FOOTWEAR_PATTERN = /(?:布鞋|千层底|传统鞋|一脚蹬)/iu;
const WORK_UTILITY_PATTERN = /(?:工作鞋|劳保|防砸|防穿刺|安全鞋|职业装|工作装|工装制服)/iu;
const OUTDOOR_TECHNICAL_PATTERN = /(?:登山鞋|徒步鞋|户外鞋|溯溪鞋|攀岩鞋)/iu;
const PERFORMANCE_UTILITY_PATTERN = /(?:速干|冲锋|防风|防水|机能户外|专业训练)/iu;
const BUSINESS_PATTERN = /(?:商务正装|商务皮鞋|正装皮鞋|职业装|工作装|通勤|西装套装|牛津鞋|德比鞋)/iu;
const CONTEMPORARY_PATTERN = /(?:设计感|时髦|潮流|潮款|新款|廓形|解构|不对称|拼接|立体剪裁|简约|极简|clean\s*fit|street|cityboy)/iu;
const DESIGN_DETAIL_PATTERN = /(?:设计感|廓形|解构|不对称|拼接|立体剪裁|褶裥|提花|刺绣|方领|收腰|腰封|开衩)/iu;
const CLEAN_PATTERN = /(?:干净|利落|简约|极简|纯色|基础款|clean|minimal)/iu;
const FASHION_PATTERN = /(?:时髦|潮流|潮款|设计感|新款|流行|fashion|trend)/iu;
const FORMAL_OR_TRADITIONAL_TARGET_PATTERN = /(?:正式|商务|工作|通勤|传统|复古|国风|中式|business|formal|vintage|traditional)/iu;
const SPORT_OUTDOOR_TARGET_PATTERN = /(?:运动|户外|徒步|登山|露营|sport|outdoor|hiking)/iu;
const YOUNG_TARGET_PATTERN = /(?:年轻|少年感|少女感|减龄|青春|活力|时髦|设计感|young|youth|contemporary)/iu;
const DESIGN_TARGET_PATTERN = /(?:设计感|有特点|特别|小众|表达|大胆|时髦|design|statement|niche)/iu;
const CLEAN_TARGET_PATTERN = /(?:干净|利落|克制|简约|clean|polished|minimal)/iu;
const NON_OFFICE_TARGET_PATTERN = /(?:不要像上班|别像上班|不.?职业|不.?商务|别太正式|不要太正式|relaxed|casual|non.?office)/iu;
const FORMAL_TARGET_PATTERN = /(?:正式|商务|礼服|典礼|婚礼|晚宴|formal|business|ceremonial)/iu;
const EXAGGERATED_STREET_HEADWEAR_PATTERN = /(?:夸张|街头|嘻哈|涂鸦|超大|oversized|street|graffiti|hip.?hop)/iu;

const CATEGORY_PRICE_FLOOR = Object.freeze({
  top: 8,
  bottom: 10,
  dress: 15,
  outerwear: 18,
  shoes: 18,
  bag: 10,
  accessory: 3,
  socks: 1,
});

function evidence(
  value,
  source,
  confidence,
  facts = [],
  applicability = EVIDENCE_APPLICABILITY.APPLICABLE,
) {
  return Object.freeze({
    value,
    source: String(source || "unknown"),
    confidence: clamp01(confidence),
    evidence: Object.freeze(unique(facts)),
    applicability: Object.values(EVIDENCE_APPLICABILITY).includes(applicability)
      ? applicability : EVIDENCE_APPLICABILITY.UNKNOWN,
  });
}

function stylingCompletionSlot(requirement = {}) {
  const trustedCompletion =
    String(requirement.style_role || requirement.styleRole || "")
      .trim().toLowerCase() === "styling_completion" &&
    (requirement.styling_completion_required === true ||
      requirement.styling_completion_recommended === true);
  if (!trustedCompletion) return "";
  const category = normalizeProductCategory(requirement.category) ||
    String(requirement.category || "").trim().toLowerCase();
  const subcategory = String(
    requirement.search_subcategory || requirement.searchSubcategory || "",
  ).trim().toLowerCase();
  const productType = String(
    requirement.item_name || requirement.itemName ||
      requirement.product_type || requirement.productType || "",
  ).trim().toLowerCase();
  if (subcategory === "socks") {
    return /(?:丝袜|连裤袜|stocking|hosiery|tights)/iu.test(productType)
      ? "hosiery" : "socks";
  }
  if (category === "bag") return "bag";
  if (category === "hat") return "headwear";
  if (category === "outerwear") return "outerwear";
  if (subcategory === "belt") return "belt";
  if (category === "accessory") return "accessory";
  return "";
}

function notApplicableEvidence(reason, slot) {
  return evidence(
    "not_applicable",
    "styling_completion_role",
    1,
    [`optional_slot:${slot}`, reason],
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function asValues(value) {
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Object.hasOwn(value, "value")) return asValues(value.value);
  return unique(value);
}

function productText(product = {}) {
  const enrichment = product.candidate_enrichment || {};
  return unique([
    product.title,
    product.name,
    product.category,
    product.subcategory,
    product.style,
    product.style_tags,
    product.occasion_tags,
    product.tags,
    product.footwear,
    product.material,
    asValues(enrichment.style_evidence),
    asValues(enrichment.occasion_evidence),
    asValues(enrichment.footwear_evidence),
    asValues(enrichment.material_evidence),
  ]).join(" ");
}

function targetContext(requirement = {}, context = {}) {
  const decisionContext = context.decision_context ||
    context.recommendation_context?.decision_context || {};
  const brain = decisionContext?.intent?.user_intent_brain || {};
  const raw = String(decisionContext.raw_user_input || "");
  const desired = asValues(brain.desired_impression);
  const avoids = unique([
    asValues(brain.explicit_avoid),
    decisionContext?.user_truth?.explicit_avoid,
    requirement.avoid_attributes,
    requirement.negative_keywords,
    requirement.commerce_query_plan?.commerce_negatives,
  ]);
  const scene = unique([
    requirement.scene,
    context.scene,
    decisionContext?.user_truth?.scene,
  ]).join(" ");
  const style = unique([
    requirement.style,
    context.style,
    asValues(decisionContext?.intent?.user_intent_brain?.explicit_style),
  ]).join(" ");
  const targetText = unique([raw, desired, avoids, scene, style]).join(" ");
  const childTarget = /(?:儿童|孩子|男童|女童|童装|小朋友|child|kid)/iu.test(targetText);
  return Object.freeze({
    raw,
    desired: Object.freeze(desired),
    avoids: Object.freeze(avoids),
    scene,
    style,
    targetText,
    targetAudience: childTarget ? "child" : "adult",
    wantsYoung: YOUNG_TARGET_PATTERN.test(targetText),
    wantsDesign: DESIGN_TARGET_PATTERN.test(targetText),
    wantsClean: CLEAN_TARGET_PATTERN.test(targetText),
    wantsNonOffice: NON_OFFICE_TARGET_PATTERN.test(targetText),
    allowsTraditional: FORMAL_OR_TRADITIONAL_TARGET_PATTERN.test(targetText) &&
      !NON_OFFICE_TARGET_PATTERN.test(targetText),
    allowsOutdoor: SPORT_OUTDOOR_TARGET_PATTERN.test(targetText),
    requestedGender: normalizeGender(
      requirement.gender || context.gender || decisionContext?.user_truth?.gender,
    ),
  });
}

function visionEvidence(product = {}) {
  const observation = product.visual_observation ||
    product.candidate_enrichment?.vision_observation || null;
  const fields = [
    "visible_category", "audience_expression", "style_expression",
    "silhouette", "footwear_type", "visual_age_expression",
    "design_detail_level", "visual_quality",
  ];
  if (!observation || typeof observation !== "object") {
    return Object.freeze({
      available: false,
      reason: "VISION_NOT_CONSUMED",
      fields: Object.freeze(Object.fromEntries(fields.map((field) => [
        field,
        evidence("unknown", "not_observed", 0, ["VISION_NOT_CONSUMED"]),
      ]))),
    });
  }
  const normalized = Object.fromEntries(fields.map((field) => {
    const item = observation[field];
    if (item && typeof item === "object" && Object.hasOwn(item, "value")) {
      return [field, evidence(
        item.value,
        item.source || "vision",
        item.confidence,
        item.evidence,
      )];
    }
    return [field, evidence(
      item ?? "unknown",
      item == null ? "not_observed" : "vision",
      item == null ? 0 : 0.6,
      item == null ? [] : [String(item)],
    )];
  }));
  return Object.freeze({
    available: Object.values(normalized).some((item) => item.confidence > 0),
    reason: "VISION_OBSERVATION_AVAILABLE",
    fields: Object.freeze(normalized),
  });
}

function audienceFit(product, target, text, vision) {
  const productGender = authoritativeProductGender(product);
  const requestedGender = target.requestedGender;
  const childMatch = text.match(CHILD_AUDIENCE_PATTERN);
  if (childMatch) {
    const mismatch = target.targetAudience !== "child";
    return evidence(
      mismatch ? "severe_mismatch" : "match",
      "explicit_product_text",
      0.99,
      [`audience:${childMatch[0]}`, `target:${target.targetAudience}`],
    );
  }
  const explicitOppositeGender =
    (requestedGender === "male" && productGender === "female") ||
    (requestedGender === "female" && productGender === "male");
  if (explicitOppositeGender) {
    return evidence("severe_mismatch", "structured_product_metadata", 0.99, [
      `product_gender:${productGender}`,
      `target_gender:${requestedGender}`,
    ]);
  }
  if (productGender === "unknown") {
    return evidence(
      "unknown",
      "missing_product_gender_evidence",
      0,
      [
        "product_gender:unknown",
        `target_gender:${requestedGender}`,
      ],
      EVIDENCE_APPLICABILITY.UNKNOWN,
    );
  }
  const matureMatch = text.match(MATURE_EXPRESSION_PATTERN);
  if (matureMatch && target.wantsYoung && !target.allowsTraditional) {
    return evidence("mismatch", "explicit_product_text", 0.9, [
      `audience_expression:${matureMatch[0]}`,
      "target_expression:younger",
    ]);
  }
  const visualAudience = vision.fields.audience_expression;
  if (visualAudience.confidence >= 0.8 &&
      /(?:child|mature|elderly)/iu.test(String(visualAudience.value)) &&
      target.targetAudience === "adult") {
    return evidence("mismatch", "vision", visualAudience.confidence, [
      ...visualAudience.evidence,
      `visual_audience:${visualAudience.value}`,
    ]);
  }
  return evidence("compatible_or_unknown", "product_contract", 0.62, [
    `product_gender:${productGender}`,
    `target_gender:${requestedGender}`,
  ]);
}

function contemporaryFit(target, text, {optionalSlot = ""} = {}) {
  const traditional = text.match(TRADITIONAL_FOOTWEAR_PATTERN) ||
    text.match(MATURE_EXPRESSION_PATTERN);
  const contemporary = text.match(CONTEMPORARY_PATTERN);
  if (traditional && (target.wantsYoung || target.wantsDesign) &&
      !target.allowsTraditional) {
    return evidence("mismatch", "explicit_product_text", 0.88, [
      `product_expression:${traditional[0]}`,
      "target_expression:contemporary",
    ]);
  }
  if (contemporary) {
    return evidence("match", "explicit_product_text", 0.8, [
      `product_expression:${contemporary[0]}`,
    ]);
  }
  if (target.wantsYoung || target.wantsDesign) {
    if (optionalSlot) {
      return notApplicableEvidence(
        "OPTIONAL_SUPPORT_ITEM_NEED_NOT_CARRY_CONTEMPORARY_EXPRESSION",
        optionalSlot,
      );
    }
    return evidence("unsupported", "missing_product_evidence", 0.66, [
      "target_expression:contemporary",
      "product_contemporary_evidence:missing",
    ]);
  }
  return evidence(
    "unknown",
    "unknown",
    0,
    [],
    EVIDENCE_APPLICABILITY.UNKNOWN,
  );
}

function occasionFit(target, text, {optionalSlot = ""} = {}) {
  const work = text.match(WORK_UTILITY_PATTERN) ||
    (target.wantsNonOffice ? text.match(BUSINESS_PATTERN) : null);
  const outdoor = text.match(OUTDOOR_TECHNICAL_PATTERN);
  const performance = text.match(PERFORMANCE_UTILITY_PATTERN);
  if (work && target.wantsNonOffice) {
    return evidence("mismatch", "explicit_product_text", 0.92, [
      `product_use:${work[0]}`,
      "target_avoid:office_like",
    ]);
  }
  if (outdoor && !target.allowsOutdoor) {
    return evidence("mismatch", "explicit_product_text", 0.9, [
      `product_use:${outdoor[0]}`,
      `target_scene:${target.scene || "unspecified"}`,
    ]);
  }
  if (performance && !target.allowsOutdoor) {
    return evidence("mismatch", "explicit_product_text", 0.78, [
      `product_use:${performance[0]}`,
      `target_scene:${target.scene || "unspecified"}`,
    ]);
  }
  if (optionalSlot === "headwear" && FORMAL_TARGET_PATTERN.test(target.targetText) &&
      EXAGGERATED_STREET_HEADWEAR_PATTERN.test(text)) {
    return evidence("mismatch", "explicit_product_text", 0.9, [
      "optional_slot:headwear",
      "target_scene:formal",
      "product_expression:exaggerated_street",
    ]);
  }
  const enrichment = String(text || "");
  if (target.scene && enrichment.includes(target.scene)) {
    return evidence("match", "explicit_product_text", 0.76, [
      `target_scene:${target.scene}`,
    ]);
  }
  if (optionalSlot) {
    return notApplicableEvidence(
      "OPTIONAL_ITEM_HAS_NO_OBSERVABLE_SCENE_CONFLICT",
      optionalSlot,
    );
  }
  return evidence(
    "compatible_or_unknown",
    "insufficient_product_evidence",
    0.35,
    [`target_scene:${target.scene || "unspecified"}`],
    EVIDENCE_APPLICABILITY.UNKNOWN,
  );
}

function desiredImpressionFit(target, text, vision, {optionalSlot = ""} = {}) {
  const matches = [];
  if (target.wantsDesign && DESIGN_DETAIL_PATTERN.test(text)) matches.push("design_detail");
  if (target.wantsClean && CLEAN_PATTERN.test(text)) matches.push("clean_expression");
  if (target.wantsYoung && FASHION_PATTERN.test(text)) matches.push("young_contemporary");
  if (matches.length > 0) {
    return evidence("match", "explicit_product_text", 0.82, matches);
  }
  const visualStyle = vision.fields.style_expression;
  const visualDetail = vision.fields.design_detail_level;
  if (vision.available && Math.max(visualStyle.confidence, visualDetail.confidence) >= 0.7) {
    const visualText = `${visualStyle.value} ${visualDetail.value}`;
    if ((target.wantsDesign && /(?:design|detailed|statement|high)/iu.test(visualText)) ||
        (target.wantsClean && /(?:clean|minimal|polished)/iu.test(visualText))) {
      return evidence("match", "vision", Math.max(
        visualStyle.confidence,
        visualDetail.confidence,
      ), [...visualStyle.evidence, ...visualDetail.evidence]);
    }
  }
  if (target.wantsDesign || target.wantsClean || target.wantsYoung) {
    if (optionalSlot) {
      return notApplicableEvidence(
        "OPTIONAL_SUPPORT_ITEM_NEED_NOT_CARRY_WHOLE_LOOK_IMPRESSION",
        optionalSlot,
      );
    }
    return evidence("unsupported", "missing_product_evidence", 0.7, [
      ...target.desired.map((value) => `target:${value}`),
      "matching_product_evidence:missing",
    ]);
  }
  return evidence(
    "unknown",
    "unknown",
    0,
    [],
    EVIDENCE_APPLICABILITY.UNKNOWN,
  );
}

function visualQualityEvidence(product, vision) {
  const enriched = product.candidate_enrichment?.visual_quality_evidence;
  if (vision.available) {
    const item = vision.fields.visual_quality;
    return evidence(item.value, "vision", item.confidence, item.evidence);
  }
  if (enriched && enriched.source !== "unknown" && Number(enriched.confidence) > 0) {
    return evidence(
      enriched.value,
      enriched.source,
      enriched.confidence,
      enriched.evidence,
    );
  }
  return evidence(
    "unknown",
    "not_observed",
    0,
    ["VISION_NOT_CONSUMED"],
    EVIDENCE_APPLICABILITY.UNKNOWN,
  );
}

function commerceQuality(product, text, vision) {
  const category = normalizeProductCategory(product.category) ||
    String(product.category || "").toLowerCase();
  const floor = CATEGORY_PRICE_FLOOR[category] || 0;
  const price = Number(product.price);
  const anomalouslyLow = floor > 0 && Number.isFinite(price) && price > 0 && price < floor;
  const qualityEvidence = product.candidate_enrichment?.quality_evidence;
  const qualitySupported = Number(qualityEvidence?.confidence) >= 0.6 ||
    vision.fields.visual_quality.confidence >= 0.7 ||
    DESIGN_DETAIL_PATTERN.test(text);
  if (anomalouslyLow && !qualitySupported) {
    return evidence("anomaly_risk", "category_price_plus_quality_evidence", 0.78, [
      `price:${price}`,
      `category:${category}`,
      `category_reference_floor:${floor}`,
      "supporting_quality_evidence:missing",
    ]);
  }
  if (anomalouslyLow) {
    return evidence("low_price_but_supported", "mixed_product_evidence", 0.62, [
      `price:${price}`,
      `category:${category}`,
      "supporting_quality_evidence:present",
    ]);
  }
  return evidence("no_anomaly_observed", "commerce_api", Number.isFinite(price) ? 0.7 : 0.2, [
    `price:${Number.isFinite(price) ? price : "unknown"}`,
    `category:${category || "unknown"}`,
  ]);
}

function productIdentityConfidence(product) {
  const facts = [];
  if (product.raw_product_ref?.item_id || product.product_id || product.id) facts.push("identity:item_id");
  if (product.title || product.name) facts.push("identity:title");
  if (normalizeProductCategory(product.category)) facts.push("identity:category");
  if (product.image_url) facts.push("identity:image");
  const confidence = facts.length / 4;
  return evidence(
    confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low",
    "product_contract",
    confidence,
    facts,
  );
}

function acceptancePenalty(evidenceSet) {
  let penalty = 0;
  const applicable = (item) =>
    item?.applicability !== EVIDENCE_APPLICABILITY.NOT_APPLICABLE;
  if (applicable(evidenceSet.audience_fit) &&
      evidenceSet.audience_fit.value === "mismatch") penalty += 22;
  if (applicable(evidenceSet.contemporary_fit) &&
      evidenceSet.contemporary_fit.value === "mismatch") penalty += 15;
  if (applicable(evidenceSet.contemporary_fit) &&
      evidenceSet.contemporary_fit.value === "unsupported") penalty += 7;
  if (applicable(evidenceSet.occasion_fit) &&
      evidenceSet.occasion_fit.value === "mismatch") penalty += 18;
  if (applicable(evidenceSet.desired_impression_fit) &&
      evidenceSet.desired_impression_fit.value === "mismatch") penalty += 18;
  if (applicable(evidenceSet.desired_impression_fit) &&
      evidenceSet.desired_impression_fit.value === "unsupported") penalty += 9;
  if (applicable(evidenceSet.visual_quality) &&
      evidenceSet.visual_quality.value === "low") penalty += 12;
  if (applicable(evidenceSet.visual_quality) &&
      evidenceSet.visual_quality.value === "unknown") penalty += 2;
  if (applicable(evidenceSet.commerce_quality) &&
      evidenceSet.commerce_quality.value === "anomaly_risk") penalty += 10;
  if (applicable(evidenceSet.product_identity_confidence) &&
      evidenceSet.product_identity_confidence.value === "low") penalty += 14;
  return Math.min(45, Math.round(penalty * 100) / 100);
}

function evaluateProductAcceptance(product = {}, requirement = {}, context = {}) {
  const assessedProduct = product.target_fit_assessment ||
      product.candidate_enrichment
    ? attachTargetFitAssessment(product, requirement, context)
    : product;
  const text = productText(assessedProduct);
  const target = targetContext(requirement, context);
  const vision = visionEvidence(assessedProduct);
  const optionalSlot = stylingCompletionSlot(requirement);
  const canonical = (dimension, fallback) =>
    acceptanceEvidenceFromTargetFit(assessedProduct, dimension) || fallback();
  const evidenceSet = Object.freeze({
    audience_fit: canonical("audience_fit",
      () => audienceFit(assessedProduct, target, text, vision)),
    contemporary_fit: canonical("contemporary_fit",
      () => contemporaryFit(target, text, {optionalSlot})),
    occasion_fit: canonical("occasion_fit",
      () => occasionFit(target, text, {optionalSlot})),
    desired_impression_fit: canonical("desired_impression_fit", () =>
      desiredImpressionFit(target, text, vision, {optionalSlot})),
    visual_quality: visualQualityEvidence(assessedProduct, vision),
    commerce_quality: commerceQuality(assessedProduct, text, vision),
    product_identity_confidence: productIdentityConfidence(assessedProduct),
  });
  const hardReasons = [];
  if (evidenceSet.audience_fit.value === "severe_mismatch" &&
      evidenceSet.audience_fit.confidence >= 0.95) {
    hardReasons.push("AUDIENCE_SEVERE_MISMATCH");
  }
  if (evidenceSet.product_identity_confidence.value === "low" &&
      evidenceSet.product_identity_confidence.confidence < 0.5) {
    hardReasons.push("PRODUCT_IDENTITY_UNVERIFIABLE");
  }
  const penalty = acceptancePenalty(evidenceSet);
  const softReasons = [];
  for (const [key, item] of Object.entries(evidenceSet)) {
    if (["mismatch", "unsupported", "anomaly_risk", "low"].includes(item.value)) {
      softReasons.push(`${key.toUpperCase()}:${item.value.toUpperCase()}`);
    }
  }
  const result = hardReasons.length > 0 ? "HARD_REJECT"
    : penalty >= 14 ? "SOFT_REJECT"
      : penalty > 0 ? "PASS_WITH_UNCERTAINTY" : "PASS";
  const acceptance = Object.freeze({
    version: PRODUCT_ACCEPTANCE_VERSION,
    result,
    hard_reasons: Object.freeze(hardReasons),
    soft_reasons: Object.freeze(softReasons),
    penalty,
    evidence: evidenceSet,
    vision,
    target: Object.freeze({
      audience: target.targetAudience,
      gender: target.requestedGender,
      scene: target.scene,
      desired_impression: target.desired,
      wants_young: target.wantsYoung,
      wants_design: target.wantsDesign,
      wants_clean: target.wantsClean,
      wants_non_office: target.wantsNonOffice,
    }),
  });
  return Object.freeze({
    allowed: result !== "HARD_REJECT",
    reason: hardReasons[0] || (softReasons[0] || "PASS"),
    acceptance,
    product: Object.freeze({
      ...assessedProduct,
      product_acceptance_result: result,
      product_acceptance_penalty: penalty,
      product_acceptance_evidence: evidenceSet,
      product_acceptance_trace: acceptance,
      canonical_product_identity: canonicalProductIdentity(assessedProduct),
    }),
  });
}

function canonicalProductIdentity(product = {}) {
  const source = String(product.source || "unknown").trim().toLowerCase();
  const title = String(product.title || product.name || "").trim().toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  const image = normalizedPublicUrl(product.image_url);
  const itemId = String(
    product.raw_product_ref?.item_id || product.item_id ||
    product.product_id || product.id || "",
  ).trim();
  const merchant = String(product.shop_name || product.brand || "").trim().toLowerCase();
  const material = image && title
    ? `${source}:visual:${image}:${title}`
    : itemId
      ? `${source}:item:${itemId}`
      : `${source}:text:${title}:${merchant}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 24);
}

function normalizedPublicUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text.startsWith("//") ? `https:${text}` : text);
    url.search = "";
    url.hash = "";
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  } catch (_) {
    return "";
  }
}

module.exports = {
  EVIDENCE_APPLICABILITY,
  PRODUCT_ACCEPTANCE_VERSION,
  canonicalProductIdentity,
  evaluateProductAcceptance,
};
