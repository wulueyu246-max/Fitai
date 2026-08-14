"use strict";

const PRODUCT_TAG_RULES = Object.freeze([
  ["女性化", /女性化|女士|女款|feminine/iu],
  ["精致", /精致|细带|细跟|小巧|精巧/iu],
  ["复古", /复古|retro|vintage/iu],
  ["玛丽珍", /玛丽珍|mary.?jane/iu],
  ["蕾丝", /蕾丝|lace/iu],
  ["蝴蝶结", /蝴蝶结|bow/iu],
  ["裙装", /半身裙|连衣裙|百褶裙|A字裙|裙装/iu],
  ["百褶", /百褶|pleated/iu],
  ["A字", /A字|a-line/iu],
  ["真丝", /真丝|桑蚕丝|silk/iu],
  ["醋酸", /醋酸|acetate/iu],
  ["结构感", /结构感|挺括|西装|剪裁|structured/iu],
  ["尖头", /尖头|pointed.?toe/iu],
  ["高跟", /高跟|细高跟|细跟|heels?/iu],
  ["低跟", /低跟|猫跟|low.?heel|kitten.?heel/iu],
  ["浅口", /浅口|低鞋口|low.?vamp/iu],
  ["修身", /修身|合身|fitted/iu],
  ["高腰", /高腰|high.?rise/iu],
  ["短款", /短款|不过胯|cropped/iu],
  ["垂感", /垂感|垂坠|drape/iu],
  ["运动", /运动|跑步|训练|篮球|气垫|sneaker|running|training/iu],
  ["厚底", /厚底|厚重鞋底|platform/iu],
  ["跑鞋", /跑鞋|跑步鞋|running.?shoe/iu],
  ["工装", /工装|机能|cargo|utility/iu],
  ["松垮", /松垮|超宽松|oversize/iu],
  ["学生感", /学生|校园/iu],
]);

const MATERIAL_TAGS = new Set([
  "真丝", "醋酸", "皮质", "真皮", "羊绒", "羊毛", "棉", "亚麻", "缎面", "蕾丝",
]);
const SILHOUETTE_TAGS = new Set([
  "结构感", "尖头", "高跟", "低跟", "浅口", "修身", "高腰", "短款", "垂感",
  "百褶", "A字", "裙装", "厚底", "松垮",
]);
const OCCASION_TAGS = Object.freeze([
  ["约会", /约会|浪漫|女性化|精致/iu],
  ["通勤", /通勤|职场|商务|结构感|西装/iu],
  ["正式", /正式|礼服|高跟|真丝|醋酸/iu],
  ["运动", /运动|跑步|训练|健身/iu],
  ["日常", /日常|休闲/iu],
]);

function text(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function evidenceForProduct(product) {
  return [
    product?.title,
    product?._category_text,
    product?.category,
    product?.material,
    product?.style,
    product?.product_type,
    product?.product_family,
  ].filter(Boolean).join(" ");
}

function evidenceForSpecification(specification) {
  return [
    specification?.product_type,
    specification?.product_family,
    ...(specification?.must_attributes || []),
    ...(specification?.should_attributes || []),
    ...(specification?.preferred_attributes || []),
    ...(specification?.style_roles || []),
  ].filter(Boolean).join(" ");
}

function extractTags(evidence) {
  return PRODUCT_TAG_RULES.filter(([, pattern]) => pattern.test(text(evidence)))
    .map(([tag]) => tag);
}

function bounded(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dimensionScore(desiredTags, productTags, neutral = 70) {
  if (desiredTags.length === 0) return neutral;
  const matches = desiredTags.filter((tag) => productTags.includes(tag)).length;
  return bounded(35 + (65 * matches / desiredTags.length));
}

function explicitAvoidConflicts(productEvidence, specification) {
  const conflicts = [];
  for (const avoid of specification?.avoid_attributes || []) {
    const avoidText = text(avoid);
    if (avoidText && productEvidence.toLowerCase().includes(avoidText.toLowerCase())) {
      conflicts.push(avoidText);
    }
  }
  const reportConflicts = specification?.candidate_match_report?.matched_conflict || [];
  conflicts.push(...reportConflicts);
  return [...new Set(conflicts)];
}

function aestheticConflictTags(productTags, specification) {
  const policy = [
    ...(specification?.must_attributes || []),
    ...(specification?.avoid_attributes || []),
  ].join(" ");
  const conflicts = [];
  if (/非.*运动|避免.*运动|运动感|跑鞋结构|厚底运动|老爹鞋/u.test(policy)) {
    conflicts.push(...productTags.filter((tag) =>
      ["运动", "厚底", "跑鞋"].includes(tag)));
  }
  if (/工装|机能/u.test(policy)) {
    conflicts.push(...productTags.filter((tag) => tag === "工装"));
  }
  if (/松垮|宽松/u.test(policy)) {
    conflicts.push(...productTags.filter((tag) => tag === "松垮"));
  }
  if (/学生感|校园/u.test(policy)) {
    conflicts.push(...productTags.filter((tag) => tag === "学生感"));
  }
  return [...new Set(conflicts)];
}

function assessProductAesthetic(product, specification = {}) {
  const productEvidence = evidenceForProduct(product);
  const specificationEvidence = evidenceForSpecification(specification);
  const productTags = extractTags(productEvidence);
  const desiredTags = extractTags(specificationEvidence);
  const matchedTags = desiredTags.filter((tag) => productTags.includes(tag));
  const conflictTags = [...new Set([
    ...aestheticConflictTags(productTags, specification),
    ...explicitAvoidConflicts(productEvidence, specification),
  ])];

  const desiredSilhouette = desiredTags.filter((tag) => SILHOUETTE_TAGS.has(tag));
  const desiredMaterials = [
    ...desiredTags.filter((tag) => MATERIAL_TAGS.has(tag)),
    ...(specification.preferred_attributes || []).filter((value) =>
      [...MATERIAL_TAGS].some((tag) => text(value).includes(tag))),
  ];
  const productMaterials = [...MATERIAL_TAGS].filter((tag) =>
    text(productEvidence).toLowerCase().includes(tag.toLowerCase()));
  const desiredOccasions = OCCASION_TAGS
    .filter(([, pattern]) => pattern.test(specificationEvidence))
    .map(([tag]) => tag);
  const productOccasions = OCCASION_TAGS
    .filter(([, pattern]) => pattern.test(productEvidence))
    .map(([tag]) => tag);

  const styleMatch = dimensionScore(desiredTags, productTags);
  const silhouetteMatch = dimensionScore(desiredSilhouette, productTags);
  const materialMatch = dimensionScore([...new Set(desiredMaterials)], productMaterials, 65);
  const occasionMatch = dimensionScore(desiredOccasions, productOccasions, 70);
  const avoidConflict = conflictTags.length === 0 ? 100 : 0;
  const score = bounded(
    styleMatch * 0.30 +
    silhouetteMatch * 0.20 +
    materialMatch * 0.15 +
    occasionMatch * 0.15 +
    avoidConflict * 0.20,
  );
  return {
    score,
    style_match: styleMatch,
    silhouette_match: silhouetteMatch,
    material_match: materialMatch,
    occasion_match: occasionMatch,
    avoid_conflict: avoidConflict,
    matched_tags: matchedTags,
    conflict_tags: conflictTags,
  };
}

function purchaseMatchPriority(product) {
  return ({PASS: 2, UNKNOWN: 1, FAIL: 0})[product?.candidate_gate_state] ?? 0;
}

function salesVolume(value) {
  const source = text(value).replace(/,/g, "");
  const number = Number.parseFloat(source);
  if (!Number.isFinite(number)) return 0;
  return /万/u.test(source) ? number * 10_000 : number;
}

function compareProductPurchaseAesthetic(left, right) {
  return purchaseMatchPriority(right) - purchaseMatchPriority(left) ||
    Number(right?.product_aesthetic_score || 0) - Number(left?.product_aesthetic_score || 0) ||
    salesVolume(right?.sales) - salesVolume(left?.sales);
}

function scoreAndSortProducts(products, specification) {
  return (Array.isArray(products) ? products : []).map((product) => {
    const assessment = assessProductAesthetic(product, specification);
    return {
      ...product,
      product_aesthetic_score: assessment.score,
      product_aesthetic_match: assessment,
    };
  }).sort(compareProductPurchaseAesthetic);
}

module.exports = {
  assessProductAesthetic,
  compareProductPurchaseAesthetic,
  scoreAndSortProducts,
};
