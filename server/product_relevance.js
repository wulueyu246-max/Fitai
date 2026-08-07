const SUPPORTED_PRODUCT_CATEGORIES = Object.freeze([
  "top",
  "bottom",
  "dress",
  "shoes",
  "outerwear",
  "bag",
  "hat",
  "accessory",
]);

const PRODUCT_CATEGORY_PRIORITY = Object.freeze({
  top: 60,
  bottom: 60,
  shoes: 60,
  outerwear: 60,
  dress: 60,
  bag: 60,
  hat: 30,
  accessory: 20,
  accessories: 20,
  underwear: 0,
  homewear: 0,
});

const LOW_VALUE_PRODUCT_GROUPS = Object.freeze([
  Object.freeze({category: "underwear", terms: Object.freeze([
    "内裤", "文胸", "胸罩", "内衣", "安全裤", "打底裤", "塑身衣", "塑身裤",
  ])}),
  Object.freeze({category: "hosiery", terms: Object.freeze([
    "袜子", "丝袜", "连裤袜", "打底袜", "船袜", "长筒袜",
  ])}),
  Object.freeze({category: "homewear", terms: Object.freeze([
    "睡衣", "家居服", "睡袍", "浴袍",
  ])}),
  Object.freeze({category: "adult", terms: Object.freeze([
    "情趣用品", "情趣内衣", "性感内衣",
  ])}),
  Object.freeze({category: "swimwear", terms: Object.freeze([
    "泳衣", "泳装", "泳裤", "比基尼",
  ])}),
]);

const CATEGORY_TERMS = Object.freeze({
  top: ["polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "背心", "短袖", "长袖"],
  bottom: ["休闲裤", "西裤", "阔腿裤", "牛仔裤", "长裤", "短裤", "九分裤", "半身裙", "裙裤", "裤"],
  dress: ["连衣裙", "礼服裙", "长裙", "短裙", "裙装"],
  shoes: ["德训鞋", "玛丽珍", "乐福鞋", "皮鞋", "运动鞋", "跑鞋", "板鞋", "鞋", "靴"],
  outerwear: ["外套", "西装", "夹克", "大衣", "风衣", "防晒衣"],
  bag: ["手提包", "斜挎包", "托特包", "双肩包", "腋下包", "女包", "男包", "包"],
  hat: ["棒球帽", "渔夫帽", "贝雷帽", "遮阳帽", "帽"],
  accessory: ["项链", "耳环", "耳饰", "手链", "腰带", "领带", "围巾", "手表", "配饰"],
});

const CATEGORY_LABELS = Object.freeze({
  top: "上衣",
  bottom: "裤子",
  dress: "连衣裙",
  shoes: "鞋子",
  outerwear: "外套",
  bag: "包",
  hat: "帽子",
  accessory: "配饰",
});

const CATEGORY_CONFLICTS = Object.freeze({
  top: ["裤", "鞋", "靴", "包", "连衣裙", "半身裙", "裙裤"],
  bottom: ["polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "鞋", "靴", "包", "连衣裙"],
  dress: ["裤", "鞋", "靴", "包", "polo", "t恤", "衬衫"],
  shoes: ["裤", "polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "连衣裙", "半身裙", "包"],
  outerwear: ["裤", "鞋", "靴", "包", "连衣裙", "半身裙"],
  bag: ["裤", "鞋", "靴", "polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "连衣裙", "半身裙"],
  hat: ["裤", "鞋", "靴", "polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "连衣裙", "包"],
  accessory: ["裤", "鞋", "靴", "polo", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "连衣裙"],
});

const MALE_NEGATIVE_TERMS = Object.freeze([
  "女", "女士", "女装", "女款", "女鞋", "文胸", "内衣", "吊带", "连衣裙", "半身裙", "孕妇", "少女",
]);
const FEMALE_NEGATIVE_TERMS = Object.freeze([
  "男", "男士", "男装", "男款", "商务男鞋",
]);
const UNISEX_TERMS = Object.freeze(["中性", "情侣", "男女同款", "男女款", "男女可穿"]);
const GENDER_TERMS = Object.freeze({
  male: ["男士", "男装", "男款", "男鞋"],
  female: ["女士", "女装", "女款", "女鞋"],
  unisex: UNISEX_TERMS,
});
const GENDER_SEARCH_TERM = Object.freeze({male: "男士", female: "女士", unisex: ""});
const SEASON_TERMS = Object.freeze({
  spring: ["春季", "春款", "春夏"],
  summer: ["夏季", "夏款", "夏天", "春夏"],
  autumn: ["秋季", "秋款", "秋冬"],
  winter: ["冬季", "冬款", "秋冬"],
  all: ["四季", "全年"],
});
const STYLE_ALIASES = Object.freeze({
  "clean fit": ["clean fit", "简约", "利落", "修身"],
  french: ["法式", "优雅"],
  korean: ["韩系", "韩版"],
  formal: ["正式", "商务"],
  casual: ["休闲", "日常"],
});

function normalizeGender(value) {
  const normalized = normalizeText(value);
  if (/^(male|man|men)$/.test(normalized) || /男性|男士|男生|^男$/.test(normalized)) {
    return "male";
  }
  if (/^(female|woman|women)$/.test(normalized) || /女性|女士|女生|^女$/.test(normalized)) {
    return "female";
  }
  return "unisex";
}

function normalizeProductCategory(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (/连衣裙|礼服裙|裙装|(^|[^a-z])dress([^a-z]|$)/.test(normalized)) return "dress";
  if (/包|(^|[^a-z])(bag|handbag|tote)([^a-z]|$)/.test(normalized)) return "bag";
  if (/帽|(^|[^a-z])(hat|cap)([^a-z]|$)/.test(normalized)) return "hat";
  if (/项链|耳环|耳饰|手链|腰带|领带|围巾|手表|配饰/.test(normalized) ||
      /(^|[^a-z])(accessory|accessories|scarf|watch|belt|tie)([^a-z]|$)/.test(normalized)) {
    return "accessory";
  }
  if (/外套|夹克|西装|大衣|风衣|防晒衣/.test(normalized) ||
      /(^|[^a-z])(coat|jacket|blazer|outerwear)([^a-z]|$)/.test(normalized)) {
    return "outerwear";
  }
  if (/鞋|靴|乐福/.test(normalized) ||
      /(^|[^a-z])(shoe|shoes|sneaker|sneakers|loafer|loafers|boots?)([^a-z]|$)/.test(normalized)) {
    return "shoes";
  }
  if (/裤|下装|半身裙|裙裤/.test(normalized) ||
      /(^|[^a-z])(pants|trousers|trouser|skirt|bottom)([^a-z]|$)/.test(normalized)) {
    return "bottom";
  }
  if (/polo|t恤|短袖|长袖|衬衫|针织衫|毛衣|卫衣|上衣|上装|背心/.test(normalized) ||
      /(^|[^a-z])(t-?shirt|tshirt|shirt|tee|upper|top|polo)([^a-z]|$)/.test(normalized)) {
    return "top";
  }
  return SUPPORTED_PRODUCT_CATEGORIES.includes(normalized) ? normalized : "";
}

function normalizeProductRequirement(input = {}, context = {}) {
  const category = normalizeProductCategory(input.category || context.category);
  if (!category) throw new TypeError("category is not supported");
  const gender = normalizeGender(input.gender || context.gender);
  const itemName = safeText(
    input.item_name || input.itemName || input.keyword || CATEGORY_LABELS[category],
    "item_name",
  );
  const searchKeywords = normalizeStringList(
    input.search_keywords || input.searchKeywords || (input.keyword ? [input.keyword] : []),
    "search_keywords",
    3,
  );
  const negativeKeywords = normalizeStringList(
    input.negative_keywords || input.negativeKeywords || [],
    "negative_keywords",
    30,
  );
  return {
    look_id: optionalText(input.look_id || input.lookId || context.look_id || context.lookId, "look_id"),
    category,
    gender,
    item_name: itemName,
    color: optionalText(input.color || context.color, "color"),
    material: optionalText(input.material || context.material, "material"),
    style: optionalText(input.style || context.style, "style"),
    season: normalizeSeason(input.season || context.season),
    scene: optionalText(input.scene || context.scene, "scene"),
    fit: optionalText(input.fit || context.fit, "fit"),
    search_keywords: searchKeywords,
    negative_keywords: uniqueStrings([
      ...negativeKeywords,
      ...(gender === "male" ? MALE_NEGATIVE_TERMS : []),
      ...(gender === "female" ? FEMALE_NEGATIVE_TERMS : []),
    ]),
    explicit_user_search: input.explicit_user_search === true ||
      context.explicit_user_search === true,
    user_search_keyword: optionalLooseText(
      input.user_search_keyword || context.user_search_keyword,
    ),
  };
}

function buildSearchKeywords(input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  const gender = GENDER_SEARCH_TERM[requirement.gender];
  const category = CATEGORY_LABELS[requirement.category];
  const supplied = requirement.search_keywords.map((keyword) =>
    makeKeywordPrecise(keyword, requirement));
  const generated = [
    [gender, requirement.color, requirement.item_name],
    [gender, requirement.style, requirement.item_name, seasonLabel(requirement.season)],
    [gender, requirement.color, requirement.fit, category, requirement.scene],
  ].map((parts) => normalizeWhitespace(parts.filter(Boolean).join(" ")));
  const keywords = uniqueStrings([...supplied, ...generated]).filter(Boolean);
  while (keywords.length < 2) {
    keywords.push(normalizeWhitespace([gender, requirement.item_name, category, "百搭"].filter(Boolean).join(" ")));
  }
  return uniqueStrings(keywords).slice(0, 3);
}

function rankProducts(products, input = {}, searchKeyword = "", options = {}) {
  const requirement = normalizeProductRequirement(input);
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Number(options.minimumScore)
    : requirement.gender === "unisex" ? 0 : 50;
  return (Array.isArray(products) ? products : [])
    .map((product) => scoreProduct(product, requirement, searchKeyword))
    .filter((product) => product && product.relevance_score >= minimumScore)
    .sort((left, right) => right.relevance_score - left.relevance_score ||
      String(left.product_id).localeCompare(String(right.product_id)));
}

function scoreProduct(product, requirement, searchKeyword = "") {
  const title = normalizeText(product?.title);
  const evidence = normalizeText(`${product?._category_text || ""} ${title}`);
  if (!title || productQualityBlock(product, requirement) ||
      containsNegativeKeyword(title, requirement)) return null;
  if (!matchesTargetCategory(evidence, requirement.category)) return null;

  let score = 35;
  if (matchesGender(title, requirement.gender)) score += 20;
  if (matchesColor(title, requirement.color)) score += 15;
  if (matchesStyle(title, requirement.style, requirement.fit)) score += 10;
  if (matchesSeason(title, requirement.season)) score += 5;
  score += Math.min(keywordOverlapScore(title, searchKeyword, requirement), 15);
  score += categoryPriorityScore(requirement.category);

  const {_category_text: _, ...publicProduct} = product;
  return {
    ...publicProduct,
    look_id: requirement.look_id,
    category: requirement.category,
    gender: requirement.gender,
    search_keyword: normalizeWhitespace(searchKeyword),
    relevance_score: Math.min(score, 100),
  };
}

function productQualityBlock(product, requirement = {}) {
  const evidence = normalizeText([
    product?.title,
    product?._category_text,
    product?.category,
  ].filter(Boolean).join(" "));
  if (!evidence || explicitlyRequestsLowValueProduct(requirement)) return null;
  for (const group of LOW_VALUE_PRODUCT_GROUPS) {
    const blockedKeyword = group.terms.find((term) => evidence.includes(normalizeText(term)));
    if (blockedKeyword) {
      return {
        blocked_category: group.category,
        blocked_keyword: blockedKeyword,
      };
    }
  }
  return null;
}

function explicitlyRequestsLowValueProduct(requirement = {}) {
  if (requirement.explicit_user_search !== true) return false;
  const keyword = normalizeText(
    requirement.user_search_keyword || requirement.keyword || "",
  );
  return LOW_VALUE_PRODUCT_GROUPS.some((group) =>
    group.terms.some((term) => keyword.includes(normalizeText(term))));
}

function categoryPriority(category) {
  return PRODUCT_CATEGORY_PRIORITY[normalizeProductCategory(category) || normalizeText(category)] || 0;
}

function categoryPriorityScore(category) {
  const priority = categoryPriority(category);
  if (priority >= 60) return 5;
  if (priority <= 20) return -5;
  return 0;
}

function sortProductsByCategoryPriority(products) {
  return [...(Array.isArray(products) ? products : [])].sort((left, right) =>
    categoryPriority(right?.category) - categoryPriority(left?.category) ||
    Number(right?.final_score || right?.relevance_score || 0) -
      Number(left?.final_score || left?.relevance_score || 0));
}

function containsNegativeKeyword(title, requirement) {
  const unisex = containsAny(title, UNISEX_TERMS);
  return requirement.negative_keywords.some((term) => {
    const normalized = normalizeText(term);
    if (!normalized) return false;
    if (unisex && ["女", "女士", "女装", "女款", "女鞋", "男", "男士", "男装", "男款", "男鞋"].includes(normalized)) {
      return false;
    }
    return title.includes(normalized);
  });
}

function matchesTargetCategory(evidence, category) {
  if (containsAny(evidence, CATEGORY_CONFLICTS[category] || [])) return false;
  return containsAny(evidence, CATEGORY_TERMS[category] || []);
}

function matchesGender(title, gender) {
  if (gender === "unisex") return containsAny(title, UNISEX_TERMS);
  return containsAny(title, GENDER_TERMS[gender] || []);
}

function matchesColor(title, color) {
  const normalized = normalizeText(color).replace(/色$/u, "");
  return Boolean(normalized) && title.includes(normalized);
}

function matchesStyle(title, style, fit) {
  const values = [style, fit].flatMap((value) => styleTerms(value));
  return containsAny(title, values);
}

function matchesSeason(title, season) {
  return containsAny(title, SEASON_TERMS[season] || []);
}

function keywordOverlapScore(title, keyword, requirement) {
  const ignored = new Set([
    "男士", "女士", "男装", "女装", "男款", "女款", "夏季", "春季", "秋季", "冬季",
    ...CATEGORY_TERMS[requirement.category],
  ]);
  const terms = tokenize(keyword).filter((term) => term.length >= 2 && !ignored.has(term));
  return uniqueStrings(terms).reduce((score, term) => score + (title.includes(term) ? 5 : 0), 0);
}

function makeKeywordPrecise(keyword, requirement) {
  const normalized = normalizeWhitespace(keyword);
  const parts = [];
  const gender = GENDER_SEARCH_TERM[requirement.gender];
  if (gender && !containsAny(normalized, [...GENDER_TERMS.male, ...GENDER_TERMS.female])) {
    parts.push(gender);
  }
  const color = requirement.color;
  const hasColor = color &&
    normalizeText(normalized).includes(normalizeText(color).replace(/色$/u, ""));
  const hasStyle = containsAny(normalized, styleTerms(requirement.style));
  if (color && !hasColor && !hasStyle) {
    parts.push(color);
  }
  if (!containsAny(normalized, CATEGORY_TERMS[requirement.category]) &&
      !normalizeText(normalized).includes(normalizeText(requirement.item_name))) {
    parts.push(requirement.item_name);
  }
  parts.push(normalized);
  return normalizeWhitespace(parts.filter(Boolean).join(" "));
}

function normalizeSeason(value) {
  const normalized = normalizeText(value);
  if (/summer|夏/.test(normalized)) return "summer";
  if (/spring|春/.test(normalized)) return "spring";
  if (/autumn|fall|秋/.test(normalized)) return "autumn";
  if (/winter|冬/.test(normalized)) return "winter";
  return normalized ? "all" : "";
}

function seasonLabel(season) {
  return ({spring: "春季", summer: "夏季", autumn: "秋季", winter: "冬季", all: "四季"})[season] || "";
}

function styleTerms(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const aliases = Object.entries(STYLE_ALIASES)
    .filter(([key]) => normalized.includes(key))
    .flatMap(([, values]) => values);
  return uniqueStrings([...aliases, ...tokenize(normalized)]);
}

function tokenize(value) {
  return normalizeText(value).split(/[\s,，、/|+-]+/u).filter(Boolean);
}

function containsAny(value, terms) {
  const normalized = normalizeText(value);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function normalizeStringList(value, field, limit) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  if (value.length > limit) throw new TypeError(`${field} has too many entries`);
  return uniqueStrings(value.map((entry) => safeText(entry, field)));
}

function safeText(value, field) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) {
    throw new TypeError(`${field} must be a non-empty string of at most 160 characters`);
  }
  return normalizeWhitespace(value);
}

function optionalText(value, field) {
  if (value == null || value === "") return "";
  return safeText(value, field);
}

function optionalLooseText(value) {
  if (value == null || value === "") return "";
  return normalizeWhitespace(String(value)).slice(0, 160);
}

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeText(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function uniqueStrings(values) {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))];
}

module.exports = {
  CATEGORY_TERMS,
  LOW_VALUE_PRODUCT_GROUPS,
  PRODUCT_CATEGORY_PRIORITY,
  SUPPORTED_PRODUCT_CATEGORIES,
  buildSearchKeywords,
  categoryPriority,
  matchesTargetCategory,
  normalizeGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  productQualityBlock,
  rankProducts,
  scoreProduct,
  sortProductsByCategoryPriority,
};
