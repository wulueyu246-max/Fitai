const {
  blueprintItemsForRequirement,
} = require("./outfit_blueprint");
const {
  normalizeGender,
  normalizeProductRequirement,
} = require("./product_relevance");

const ITEM_PATTERNS = Object.freeze({
  top: Object.freeze([
    [/polo/i, "Polo"], [/衬衫|衬衣/u, "衬衫"], [/针织/u, "针织衫"],
    [/毛衣/u, "毛衣"], [/卫衣/u, "卫衣"], [/背心/u, "背心"],
    [/T恤|tee/i, "T恤"], [/上衣|上装/u, "上衣"],
  ]),
  bottom: Object.freeze([
    [/百褶/u, "百褶裙"], [/A字/u, "A字裙"], [/半身裙/u, "半身裙"],
    [/西装裤|西裤/u, "西装裤"], [/阔腿/u, "阔腿裤"],
    [/牛仔/u, "牛仔裤"], [/短裤/u, "短裤"], [/裤|下装/u, "裤子"],
  ]),
  dress: Object.freeze([
    [/连衣裙/u, "连衣裙"], [/礼服/u, "礼服裙"], [/裙装/u, "连衣裙"],
  ]),
  shoes: Object.freeze([
    [/玛丽珍/u, "玛丽珍鞋"], [/芭蕾/u, "芭蕾鞋"], [/尖头/u, "尖头鞋"],
    [/低跟/u, "低跟鞋"], [/高跟/u, "高跟鞋"], [/乐福/u, "乐福鞋"],
    [/皮鞋/u, "皮鞋"], [/单鞋/u, "单鞋"], [/短靴/u, "短靴"],
    [/长靴/u, "长靴"], [/鞋履|女鞋|男鞋|鞋子|鞋/u, "单鞋"],
  ]),
  outerwear: Object.freeze([
    [/西装/u, "西装外套"], [/风衣/u, "风衣"], [/大衣/u, "大衣"],
    [/夹克/u, "夹克"], [/外套/u, "外套"],
  ]),
  bag: Object.freeze([
    [/手提包/u, "手提包"], [/腋下包/u, "腋下包"], [/斜挎包/u, "斜挎包"],
    [/托特包/u, "托特包"], [/单肩包/u, "单肩包"], [/双肩包/u, "双肩包"],
    [/包包|女包|男包|箱包|包/u, "手提包"],
  ]),
  hat: Object.freeze([
    [/贝雷帽/u, "贝雷帽"], [/棒球帽/u, "棒球帽"], [/渔夫帽/u, "渔夫帽"],
    [/礼帽/u, "礼帽"], [/帽/u, "帽子"],
  ]),
  accessory: Object.freeze([
    [/珍珠耳|耳环|耳饰|耳钉/u, "耳饰"], [/项链/u, "项链"],
    [/手链/u, "手链"], [/戒指/u, "戒指"], [/胸针/u, "胸针"],
    [/腰带|皮带/u, "腰带"], [/丝巾/u, "丝巾"], [/围巾/u, "围巾"],
    [/眼镜|墨镜/u, "眼镜"], [/腕表|手表/u, "腕表"], [/袜/u, "袜子"],
  ]),
});

const BASE_CATEGORY_QUERIES = Object.freeze({
  top: Object.freeze({female: ["女士 上衣", "女装 上衣"], male: ["男士 上衣", "男装 上衣"], unisex: ["上衣"]}),
  bottom: Object.freeze({female: ["女士 裤子", "女裤"], male: ["男士 裤子", "男裤"], unisex: ["裤子"]}),
  dress: Object.freeze({female: ["女士 连衣裙", "女装 连衣裙"], male: ["连衣裙"], unisex: ["连衣裙"]}),
  shoes: Object.freeze({female: ["女士 单鞋", "女鞋"], male: ["男士 皮鞋", "男鞋"], unisex: ["单鞋", "鞋子"]}),
  outerwear: Object.freeze({female: ["女士 外套", "女装 外套"], male: ["男士 外套", "男装 外套"], unisex: ["外套"]}),
  bag: Object.freeze({female: ["女士 手提包", "女包"], male: ["男士 手提包", "男包"], unisex: ["手提包", "包包"]}),
  hat: Object.freeze({female: ["女士 帽子", "女帽"], male: ["男士 帽子", "男帽"], unisex: ["帽子"]}),
  accessory: Object.freeze({female: ["女士 耳饰", "女士 项链"], male: ["男士 腰带", "男士 腕表"], unisex: ["耳饰", "腰带"]}),
});

const ACCESSORY_BASE_TERMS = Object.freeze({
  jewelry: Object.freeze(["耳饰", "项链"]),
  belt: Object.freeze(["腰带", "皮带"]),
  scarf: Object.freeze(["丝巾", "围巾"]),
  glasses: Object.freeze(["眼镜", "墨镜"]),
  watch: Object.freeze(["腕表", "手表"]),
  socks: Object.freeze(["袜子", "长袜"]),
});

const ABSTRACT_SUFFIX = /(?:穿搭|搭配|造型|风格|风格感|风格鞋履|鞋履)$/gu;
const VAGUE_ELEMENTS = /^(?:高级|成熟|甜美|女性化|男性化|浪漫|精致|经典|时尚|氛围|风格)$/u;

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function audience(gender) {
  const normalized = normalizeGender(gender);
  if (normalized === "female") return "女士";
  if (normalized === "male") return "男士";
  return "";
}

function blueprintEvidence(blueprint, requirement) {
  return unique([
    ...blueprintItemsForRequirement(blueprint, requirement),
    ...(requirement.source_elements || []),
    requirement.item_name,
    ...(blueprint.core_elements || []),
    ...(blueprint.material_direction || []),
    ...(blueprint.silhouette_strategy || []),
    ...(blueprint.color_palette || []),
    ...(blueprint.visual_keywords || []),
  ]);
}

function configuredBlueprintEvidence(blueprint, requirement) {
  return unique([
    ...blueprintItemsForRequirement(blueprint, requirement),
    ...(blueprint.core_elements || []),
    ...(blueprint.material_direction || []),
    ...(blueprint.silhouette_strategy || []),
    ...(blueprint.color_palette || []),
    ...(blueprint.visual_keywords || []),
  ]);
}

function marketplaceTerms(category, evidence) {
  const patterns = ITEM_PATTERNS[category] || [];
  const terms = [];
  for (const text of evidence) {
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) terms.push(label);
    }
  }
  return unique(terms);
}

function featureElements(blueprint, requirement, marketplaceLabels) {
  const categoryPatterns = ITEM_PATTERNS[requirement.category] || [];
  const sourceValues = ["shoes", "bag", "hat", "accessory"].includes(requirement.category)
    ? [
      ...(blueprint.core_elements || []),
      ...(blueprint.material_direction || []),
    ]
    : [
      ...(blueprint.material_direction || []),
      ...(blueprint.core_elements || []),
    ];
  return unique([
    ...sourceValues,
    ...(blueprint.color_palette || []),
    ...(blueprint.silhouette_strategy || []),
    ...(blueprint.visual_keywords || []),
  ]).map((value) => value.replace(ABSTRACT_SUFFIX, "").trim())
    .filter((value) => value.length >= 2 && value.length <= 10)
    .filter((value) => !VAGUE_ELEMENTS.test(value))
    .filter((value) => !marketplaceLabels.some((label) => value.includes(label)))
    .filter((value) => !categoryPatterns.some(([pattern]) => pattern.test(value)));
}

function baseQueries(requirement, primaryLabel = "") {
  const gender = normalizeGender(requirement.gender);
  if (requirement.category === "accessory") {
    const terms = ACCESSORY_BASE_TERMS[requirement.search_subcategory] ||
      (primaryLabel ? [primaryLabel] : []);
    return unique(terms.map((term) => cleanText([
      audience(gender),
      term,
    ].filter(Boolean).join(" "))));
  }
  const configured = BASE_CATEGORY_QUERIES[requirement.category]?.[gender] || [];
  return [...configured];
}

function expandBlueprintSearchPlan(requirementInput = {}, blueprint = {}, basePlan = {}) {
  const requirement = normalizeProductRequirement(requirementInput, requirementInput);
  const configuredEvidence = configuredBlueprintEvidence(blueprint, requirement);
  const evidence = blueprintEvidence(blueprint, requirement);
  if (configuredEvidence.length === 0) {
    return {
      ...basePlan,
      blueprint_element: requirement.item_name,
      expanded_queries: unique([basePlan.exact, ...(basePlan.fallbacks || [])]).slice(0, 3),
    };
  }

  const labels = marketplaceTerms(requirement.category, evidence);
  const provisionalBases = baseQueries(requirement);
  const primaryLabel = labels[0] || provisionalBases[0]?.replace(/^(?:女士|男士|女装|男装)\s*/u, "") || "";
  const bases = baseQueries(requirement, primaryLabel);
  const modifiers = featureElements(blueprint, requirement, labels);
  const precise = cleanText([audience(requirement.gender), modifiers[0], primaryLabel]
    .filter(Boolean).join(" "));
  const core = cleanText([audience(requirement.gender), primaryLabel]
    .filter(Boolean).join(" "));
  const queries = unique([
    precise,
    core,
    ...bases,
    ...labels.slice(1).map((label) => cleanText([
      audience(requirement.gender),
      label,
    ].filter(Boolean).join(" "))),
    basePlan.exact,
    ...(basePlan.fallbacks || []),
  ]).slice(0, 3);

  return {
    original_keyword: basePlan.original_keyword || requirement.search_keywords[0] || requirement.item_name,
    exact: queries[0] || basePlan.exact || "",
    fallbacks: queries.slice(1, 3),
    blueprint_element: blueprintItemsForRequirement(blueprint, requirement)[0] ||
      requirement.source_elements?.[0] || requirement.item_name,
    expanded_queries: queries,
  };
}

module.exports = {
  expandBlueprintSearchPlan,
};
