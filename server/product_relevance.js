const {resolveIntentPriorityScore} = require("./intent_priority");

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

const LOW_QUALITY_TITLE_TERMS = Object.freeze([
  "厂家", "批发", "清仓", "爆款", "地摊", "学生党", "高仿", "仿款", "仿",
]);

const CATEGORY_TERMS = Object.freeze({
  top: ["polo", "top", "shirt", "t恤", "衬衫", "针织衫", "毛衣", "卫衣", "上衣", "背心", "短袖", "长袖"],
  bottom: ["bottom", "pants", "trousers", "skirt", "休闲裤", "西裤", "阔腿裤", "牛仔裤", "长裤", "短裤", "九分裤", "半身裙", "裙裤", "裤"],
  dress: ["dress", "连衣裙", "礼服裙", "长裙", "短裙", "裙装"],
  shoes: ["shoe", "shoes", "sneaker", "loafer", "boot", "德训鞋", "玛丽珍", "乐福鞋", "皮鞋", "运动鞋", "跑鞋", "板鞋", "鞋", "靴"],
  outerwear: ["outerwear", "coat", "jacket", "blazer", "外套", "西装", "夹克", "大衣", "风衣", "防晒衣"],
  bag: [
    "手提包", "斜挎包", "托特包", "单肩包", "双肩包", "腋下包", "水桶包",
    "邮差包", "公文包", "女包", "男包", "包包", "箱包", "handbag", "tote",
    "shoulder bag", "crossbody bag", "backpack",
  ],
  hat: ["hat", "cap", "棒球帽", "渔夫帽", "贝雷帽", "遮阳帽", "帽"],
  accessory: ["accessory", "jewelry", "项链", "耳环", "耳饰", "手链", "腰带", "领带", "围巾", "手表", "配饰"],
});

const ACCESSORY_SUBCATEGORY_TERMS = Object.freeze({
  bag: Object.freeze([
    "手提包", "斜挎包", "腋下包", "托特包", "单肩包", "双肩包", "水桶包",
    "邮差包", "公文包", "女包", "男包", "包包", "箱包", "handbag", "tote",
    "shoulder bag", "crossbody bag", "backpack",
  ]),
  hat: Object.freeze([
    "帽子", "棒球帽", "渔夫帽", "贝雷帽", "遮阳帽", "针织帽", "礼帽", "hat", "cap",
  ]),
  jewelry: Object.freeze([
    "耳环", "耳饰", "耳钉", "项链", "手链", "戒指", "胸针", "珠宝", "首饰",
    "jewelry", "earring", "necklace", "bracelet", "ring", "brooch",
  ]),
  belt: Object.freeze(["腰带", "皮带", "belt"]),
  scarf: Object.freeze(["丝巾", "围巾", "披肩", "scarf"]),
  glasses: Object.freeze(["眼镜", "墨镜", "太阳镜", "glasses", "sunglasses"]),
  watch: Object.freeze(["手表", "腕表", "watch"]),
  socks: Object.freeze([
    "袜子", "丝袜", "长袜", "短袜", "连裤袜", "过膝袜", "stocking", "socks", "hosiery",
  ]),
});

const NON_FASHION_PRODUCT_TERMS = Object.freeze([
  "面包", "蛋糕", "饼干", "零食", "食品", "饮料", "牛奶", "咖啡", "茶叶",
  "抽纸", "纸巾", "卷纸", "湿巾", "卫生纸", "厨房纸", "洗衣液", "洗洁精",
  "清洁剂", "垃圾袋", "母婴", "奶粉", "尿不湿", "宠物", "猫粮", "狗粮",
  "手机", "耳机", "充电器", "数据线", "数码", "家居", "家具", "收纳箱",
  "口红", "粉底", "面膜", "护肤", "美妆", "日用品", "生活用品",
  "除湿帽", "干发帽", "蒸发帽", "焗油帽", "染发帽", "浴帽", "洗头帽",
  "防尘帽", "无尘帽", "工作帽", "一次性帽", "一次性头套", "医用帽",
  "孕妇", "产妇", "月子", "孕产", "防风帽", "睡帽", "厨师帽", "医疗帽",
  "安全帽", "头套", "护耳罩", "工具包", "保温包", "收纳包", "收纳袋",
  "防水袋", "妈咪包", "护理用品", "家居用品",
]);

const CORE_OUTFIT_CATEGORIES = Object.freeze([
  "top", "bottom", "dress", "shoes", "outerwear",
]);

const SEARCH_SUBCATEGORY_LABELS = Object.freeze({
  bag: "手提包",
  hat: "帽子",
  jewelry: "耳饰",
  belt: "腰带",
  scarf: "丝巾",
  glasses: "眼镜",
  watch: "腕表",
  socks: "袜子",
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

const TAOBAO_SEARCH_CATEGORY_TERMS = Object.freeze({
  top: Object.freeze([
    "针织衫", "polo", "衬衫", "t恤", "毛衣", "卫衣", "背心", "上衣",
  ]),
  bottom: Object.freeze([
    "高腰阔腿裤", "阔腿裤", "休闲裤", "牛仔裤", "九分裤", "西裤", "短裤",
    "半身裙", "裤子", "下装",
  ]),
  dress: Object.freeze(["连衣裙", "礼服裙", "裙装"]),
  shoes: Object.freeze([
    "玛丽珍鞋", "德训鞋", "乐福鞋", "运动鞋", "高跟鞋", "皮鞋", "短靴",
    "长靴", "鞋子",
  ]),
  outerwear: Object.freeze(["西装外套", "风衣", "大衣", "夹克", "西装", "外套"]),
  bag: Object.freeze(["手提包", "斜挎包", "腋下包", "托特包", "单肩包", "双肩包", "包包"]),
  hat: Object.freeze(["棒球帽", "渔夫帽", "贝雷帽", "遮阳帽", "帽子"]),
  accessory: Object.freeze([
    "珍珠耳饰", "耳饰", "耳环", "项链", "手链", "戒指", "胸针", "腰带",
    "皮带", "丝巾", "围巾", "眼镜", "墨镜", "腕表", "手表",
  ]),
});

const TAOBAO_SEARCH_COLORS = Object.freeze([
  "天蓝色", "米白色", "象牙白", "藏青色", "深蓝色", "浅蓝色", "墨绿色",
  "军绿色", "咖啡色", "卡其色", "浅灰色", "深灰色", "酒红色", "砖红色",
  "雾霾蓝", "奶油色", "杏色", "米色", "白色", "黑色", "棕色", "蓝色",
  "灰色", "绿色", "红色", "粉色", "紫色", "黄色", "橙色",
]);

const TAOBAO_SEARCH_STYLES = Object.freeze([
  "clean fit", "smart casual", "法式", "韩系", "日系", "美式", "复古",
  "通勤", "轻商务", "简约", "优雅", "休闲", "街头",
]);

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

function normalizeCandidateGender(value) {
  const normalized = normalizeText(value);
  if (/^(male|man|men)$/.test(normalized) || /男性|男士|男生|^男$/.test(normalized)) {
    return "male";
  }
  if (/^(female|woman|women)$/.test(normalized) || /女性|女士|女生|^女$/.test(normalized)) {
    return "female";
  }
  if (/^(unisex|neutral)$/.test(normalized) || /中性|男女同款|男女款|男女可穿/.test(normalized)) {
    return "unisex";
  }
  return "unknown";
}

function authoritativeProductGender(product = {}) {
  const explicit = normalizeCandidateGender(
    product.original_gender ?? product.originalGender ?? product.gender,
  );
  if (explicit !== "unknown") return explicit;
  const evidence = normalizeText([
    product.title,
    product.name,
    product._category_text,
    product.category,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" "));
  const male = containsAny(evidence, GENDER_TERMS.male);
  const female = containsAny(evidence, GENDER_TERMS.female) ||
    containsAny(evidence, ["连衣裙", "半身裙", "女式", "女性版型"]);
  const explicitlyUnisex = containsAny(evidence, [
    "中性", "男女同款", "男女款", "男女可穿",
  ]);
  if (explicitlyUnisex) return "unisex";
  // “情侣”本身可以表示 unisex，但不能抹掉标题中明确的单一性别。
  if (containsAny(evidence, ["情侣"]) && !male && !female) return "unisex";
  if (male && !female) return "male";
  if (female && !male) return "female";
  return "unknown";
}

function normalizeProductCategory(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (containsAny(normalized, NON_FASHION_PRODUCT_TERMS)) return "";
  if (/袜|丝袜|连裤袜|(^|[^a-z])(socks?|stockings?|hosiery)([^a-z]|$)/.test(normalized)) {
    return "accessory";
  }
  if (/连衣裙|礼服裙|裙装|(^|[^a-z])dress([^a-z]|$)/.test(normalized)) return "dress";
  if (containsAny(normalized, ACCESSORY_SUBCATEGORY_TERMS.bag) ||
      /(^|[^a-z])(bag|handbag|tote|backpack)([^a-z]|$)/.test(normalized)) return "bag";
  if (/帽|(^|[^a-z])(hat|cap)([^a-z]|$)/.test(normalized)) return "hat";
  if (/眼镜|墨镜|太阳镜|珠宝|首饰|项链|耳环|耳饰|手链|戒指|腰带|皮带|领带|丝巾|围巾|手表|腕表|配饰/.test(normalized) ||
      /(^|[^a-z])(accessory|accessories|glasses|sunglasses|jewelry|necklace|earrings?|scarf|watch|belt|tie)([^a-z]|$)/.test(normalized)) {
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
  if (/裤|下装|半身裙|裙裤|裙/.test(normalized) ||
      /(^|[^a-z])(pants|trousers|trouser|skirt|bottom)([^a-z]|$)/.test(normalized)) {
    return "bottom";
  }
  if (/polo|t恤|短袖|长袖|衬衫|针织衫|毛衣|卫衣|上衣|上装|背心/.test(normalized) ||
      /(^|[^a-z])(t-?shirt|tshirt|shirt|tee|upper|top|polo)([^a-z]|$)/.test(normalized)) {
    return "top";
  }
  return SUPPORTED_PRODUCT_CATEGORIES.includes(normalized) ? normalized : "";
}

function normalizeSearchSubcategory(value, itemName = "", category = "") {
  const normalizedCategory = normalizeProductCategory(category);
  if (normalizedCategory === "bag" || normalizedCategory === "hat") {
    return normalizedCategory;
  }
  const evidence = normalizeText(`${value || ""} ${itemName || ""}`);
  for (const subcategory of [
    "bag", "hat", "jewelry", "belt", "scarf", "glasses", "watch", "socks",
  ]) {
    if (containsAny(evidence, ACCESSORY_SUBCATEGORY_TERMS[subcategory])) {
      return subcategory;
    }
  }
  return "";
}

function normalizeProductRequirement(input = {}, context = {}) {
  const category = normalizeProductCategory(input.category || context.category);
  if (!category) throw new TypeError("category is not supported");
  const gender = normalizeGender(input.gender || context.gender);
  const itemName = safeText(
    input.item_name || input.itemName || input.keyword || CATEGORY_LABELS[category],
    "item_name",
  );
  const searchSubcategory = normalizeSearchSubcategory(
    input.search_subcategory || input.searchSubcategory ||
      input.accessory_type || input.accessoryType || input.category,
    itemName,
    category,
  );
  const searchKeywords = normalizeStringList(
    input.search_keywords || input.searchKeywords || (input.keyword ? [input.keyword] : []),
    "search_keywords",
    4,
  );
  const negativeKeywords = normalizeStringList(
    input.negative_keywords || input.negativeKeywords || [],
    "negative_keywords",
    30,
  );
  const sourceElements = normalizeStringList(
    input.source_elements || input.sourceElements || [],
    "source_elements",
    20,
  );
  const translatedQueries = normalizeTranslatedQueries(
    input.translated_queries || input.translatedQueries,
  );
  const commerceQueryPlan = normalizeCommerceQueryPlan(
    input.commerce_query_plan || input.commerceQueryPlan,
  );
  const colors = normalizeStringList(
    input.colors || (input.color ? [input.color] : []),
    "colors",
    10,
  );
  const materials = normalizeStringList(
    input.materials || (input.material ? [input.material] : []),
    "materials",
    10,
  );
  const designElements = normalizeStringList(
    input.design_elements || input.designElements || [],
    "design_elements",
    20,
  );
  const requiredAttributes = normalizeStringList(
    input.required_attributes || input.requiredAttributes || [],
    "required_attributes",
    20,
  );
  const preferredAttributes = normalizeStringList(
    input.preferred_attributes || input.preferredAttributes || [],
    "preferred_attributes",
    20,
  );
  const avoidAttributes = normalizeStringList(
    input.avoid_attributes || input.avoidAttributes || [],
    "avoid_attributes",
    20,
  );
  const bodyFitSoftSignals = normalizeStringList(
    input.body_fit_soft_signals || input.bodyFitSoftSignals || [],
    "body_fit_soft_signals",
    20,
  );
  const marketSoftSignals = normalizeStringList(
    input.market_soft_signals || input.marketSoftSignals || [],
    "market_soft_signals",
    12,
  );
  return {
    request_id: optionalText(
      input.request_id || input.requestId || context.request_id || context.requestId,
      "request_id",
    ),
    look_id: optionalText(input.look_id || input.lookId || context.look_id || context.lookId, "look_id"),
    concept_id: optionalText(
      input.concept_id || input.conceptId || context.concept_id || context.conceptId,
      "concept_id",
    ),
    slot_key: optionalText(
      input.slot_key || input.slotKey || context.slot_key || context.slotKey,
      "slot_key",
    ),
    category,
    search_subcategory: searchSubcategory,
    gender,
    intent_priority_score: resolveIntentPriorityScore(
      input.style_profile || input.styleProfile ||
      context.style_profile || context.styleProfile ||
      context.recommendation_context?.style_profile || {},
      input.style || context.style,
    ),
    blueprint_required: input.blueprint_required === true ||
      context.blueprint_required === true,
    product_type: optionalText(
      input.product_type || input.productType || itemName,
      "product_type",
    ),
    product_family: optionalText(
      input.product_family || input.productFamily,
      "product_family",
    ),
    item_name: itemName,
    style_role: optionalLooseText(
      input.style_role || input.styleRole || context.style_role,
    ),
    colors,
    materials,
    design_elements: designElements,
    required_attributes: requiredAttributes,
    preferred_attributes: preferredAttributes,
    avoid_attributes: avoidAttributes,
    body_fit_soft_signals: bodyFitSoftSignals,
    market_soft_signals: marketSoftSignals,
    market_influence_cap: Math.max(0, Math.min(
      0.08,
      Number(input.market_influence_cap || input.marketInfluenceCap || 0) || 0,
    )),
    color: optionalText(colors[0] || input.color || context.color, "color"),
    material: optionalText(
      materials[0] || input.material || context.material,
      "material",
    ),
    style: optionalText(input.style || context.style, "style"),
    season: normalizeSeason(input.season || context.season),
    scene: optionalText(input.scene || context.scene, "scene"),
    fit: optionalText(input.fit || context.fit, "fit"),
    search_keywords: searchKeywords,
    query_plan_version: optionalLooseText(
      input.query_plan_version || input.queryPlanVersion ||
      commerceQueryPlan?.version,
    ),
    commerce_query_plan: commerceQueryPlan,
    negative_keywords: uniqueStrings([
      ...negativeKeywords,
      ...(gender === "male" ? MALE_NEGATIVE_TERMS : []),
      ...(gender === "female" ? FEMALE_NEGATIVE_TERMS : []),
    ]),
    query_reason: optionalLooseText(
      input.query_reason || input.queryReason || context.query_reason,
    ),
    source_elements: sourceElements,
    translated_queries: translatedQueries,
    explicit_user_search: input.explicit_user_search === true ||
      context.explicit_user_search === true,
    user_search_keyword: optionalLooseText(
      input.user_search_keyword || context.user_search_keyword,
    ),
  };
}

function normalizeTranslatedQueries(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("translated_queries must be an array");
  }
  return value.slice(0, 4).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("translated_queries entries must be objects");
    }
    return {
      category: optionalLooseText(entry.category),
      query: optionalLooseText(entry.query),
      source_elements: normalizeStringList(
        entry.source_elements || entry.sourceElements || [],
        "translated_queries.source_elements",
        12,
      ),
      query_reason: optionalLooseText(entry.query_reason || entry.queryReason),
    };
  }).filter((entry) => entry.query);
}

function normalizeCommerceQueryPlan(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("commerce_query_plan must be an object");
  }
  const candidates = Array.isArray(value.query_candidates)
    ? value.query_candidates.slice(0, 4)
      .map((entry, index) => normalizeCommerceQueryEntry(entry, index))
      .filter(({query}) => query)
    : [];
  const fallbackQuery = value.fallback_query == null
    ? null
    : normalizeCommerceQueryEntry(value.fallback_query, candidates.length);
  return {
    version: optionalLooseText(value.version),
    concept_id: optionalLooseText(value.concept_id),
    slot: optionalLooseText(value.slot),
    gender: normalizeGender(value.gender),
    scene: optionalLooseText(value.scene),
    query_candidates: candidates,
    fallback_query: fallbackQuery?.query ? fallbackQuery : null,
    commerce_negatives: normalizeStringList(
      value.commerce_negatives || [],
      "commerce_query_plan.commerce_negatives",
      20,
    ),
    hard_gate_negatives: normalizeStringList(
      value.hard_gate_negatives || [],
      "commerce_query_plan.hard_gate_negatives",
      20,
    ),
    contextual_negatives: normalizeStringList(
      value.contextual_negatives || [],
      "commerce_query_plan.contextual_negatives",
      20,
    ),
  };
}

function normalizeCommerceQueryEntry(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("commerce_query_plan candidates must be objects");
  }
  const budget = entry.searchable_signal_budget;
  return {
    rank: Number.isInteger(Number(entry.rank)) ? Number(entry.rank) : index + 1,
    query_id: optionalLooseText(entry.query_id),
    query_type: optionalLooseText(entry.query_type),
    execution: optionalLooseText(entry.execution),
    query: optionalLooseText(entry.query),
    core_category: optionalLooseText(entry.core_category),
    aesthetic_signal: optionalLooseText(entry.aesthetic_signal),
    searchable_signal_budget: budget && typeof budget === "object" &&
        !Array.isArray(budget)
      ? {
        core_category_terms: Math.max(0, Number(budget.core_category_terms) || 0),
        aesthetic_terms: Math.max(0, Number(budget.aesthetic_terms) || 0),
        max_aesthetic_terms: Math.max(0, Number(budget.max_aesthetic_terms) || 0),
      }
      : null,
    fallback_level: Math.max(0, Number(entry.fallback_level) || 0),
    fallback_reason: optionalLooseText(entry.fallback_reason),
    reason_codes: normalizeStringList(
      entry.reason_codes || [],
      "commerce_query_plan.reason_codes",
      12,
    ),
    source_elements: normalizeStringList(
      entry.source_elements || [],
      "commerce_query_plan.source_elements",
      20,
    ),
  };
}

function buildSearchKeywords(input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  const gender = GENDER_SEARCH_TERM[requirement.gender];
  const category = categorySearchLabel(requirement);
  if (requirement.category === "accessory" && !requirement.search_subcategory) {
    return [];
  }
  const supplied = requirement.search_keywords
    .filter((keyword) => !isGenericAccessorySearch(keyword, requirement))
    .map((keyword) => makeKeywordPrecise(keyword, requirement));
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

function normalizeTaobaoSearchKeyword(keyword, input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  if (requirement.category === "accessory" && !requirement.search_subcategory) {
    return [];
  }
  const original = normalizeWhitespace(keyword || requirement.search_keywords[0] || requirement.item_name);
  const evidence = normalizeText([
    original,
    requirement.item_name,
    requirement.color,
    requirement.style,
  ].filter(Boolean).join(" "));
  const audience = GENDER_SEARCH_TERM[requirement.gender];
  const category = specificTaobaoCategoryLabel(requirement, evidence);
  const colors = extractTaobaoSearchColors(evidence);
  const style = firstTaobaoSearchStyle(requirement.style, evidence);
  const colorVariants = colors.length > 0 ? colors.slice(0, 2) : [""];
  return uniqueStrings(colorVariants.map((color) => normalizeWhitespace([
    audience,
    style,
    color,
    category,
  ].filter(Boolean).join(" ")))).filter((query) =>
    query && hasSpecificTaobaoCategory(query, requirement));
}

function buildTaobaoSearchPlan(input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  if (requirement.category === "accessory" && !requirement.search_subcategory) {
    return {original_keyword: "", exact: "", fallbacks: []};
  }
  const originals = requirement.search_keywords.length > 0
    ? requirement.search_keywords
    : buildSearchKeywords(requirement);
  const originalKeyword = originals[0] || requirement.item_name;
  const normalizedVariants = uniqueStrings(originals.flatMap((keyword) =>
    normalizeTaobaoSearchKeyword(keyword, requirement)));
  const exact = normalizedVariants[0] ||
    normalizeTaobaoSearchKeyword(requirement.item_name, requirement)[0] || "";
  const evidence = normalizeText([
    originalKeyword,
    requirement.item_name,
    requirement.color,
    requirement.style,
  ].filter(Boolean).join(" "));
  const audience = GENDER_SEARCH_TERM[requirement.gender];
  const category = specificTaobaoCategoryLabel(requirement, evidence);
  const colors = extractTaobaoSearchColors(evidence);
  const style = firstTaobaoSearchStyle(requirement.style, evidence);
  const categorySpecificFallbacks = [
    normalizeWhitespace([audience, colors[0], category].filter(Boolean).join(" ")),
    normalizeWhitespace([audience, style, category].filter(Boolean).join(" ")),
    normalizeWhitespace([audience, category].filter(Boolean).join(" ")),
  ];
  const fallbacks = uniqueStrings([
    ...normalizedVariants.slice(1),
    ...categorySpecificFallbacks,
  ]).filter((query) => query !== exact && hasSpecificTaobaoCategory(query, requirement))
    .slice(0, 2);
  return {
    original_keyword: originalKeyword,
    exact,
    fallbacks,
  };
}

function specificTaobaoCategoryLabel(requirement, evidence = "") {
  const terms = TAOBAO_SEARCH_CATEGORY_TERMS[requirement.category] || [];
  const normalizedEvidence = normalizeText(evidence);
  const matchedTerm = terms.find((term) => normalizedEvidence.includes(normalizeText(term)));
  if (matchedTerm) return matchedTerm;
  const subcategoryLabel = SEARCH_SUBCATEGORY_LABELS[requirement.search_subcategory];
  return subcategoryLabel ||
    CATEGORY_LABELS[requirement.category];
}

function extractTaobaoSearchColors(evidence) {
  const normalized = normalizeText(evidence).replace(/[／/]/g, " ");
  const occupied = [];
  const matches = [];
  for (const color of TAOBAO_SEARCH_COLORS) {
    const normalizedColor = normalizeText(color);
    let index = normalized.indexOf(normalizedColor);
    while (index >= 0) {
      const end = index + normalizedColor.length;
      const nestedInLongerColor = occupied.some(([start, occupiedEnd]) =>
        index >= start && end <= occupiedEnd);
      if (!nestedInLongerColor) {
        matches.push({color, index});
        occupied.push([index, end]);
      }
      index = normalized.indexOf(normalizedColor, index + 1);
    }
  }
  return uniqueStrings(matches.sort((left, right) => left.index - right.index)
    .map((match) => match.color));
}

function firstTaobaoSearchStyle(style, evidence) {
  const normalizedStyle = normalizeText(style);
  const normalizedEvidence = normalizeText(evidence);
  const knownStyle = TAOBAO_SEARCH_STYLES.find((term) =>
    normalizedStyle.includes(normalizeText(term))) ||
    TAOBAO_SEARCH_STYLES.find((term) => normalizedEvidence.includes(normalizeText(term)));
  if (knownStyle) return knownStyle;

  // Unknown and newly coined style descriptions are valid. Keep a compact
  // user-provided style signal in the exact Taobao query without turning the
  // codebase into a style-name dictionary. Category-only fallbacks remain in
  // buildTaobaoSearchPlan when this exact query has no result.
  return normalizeWhitespace(style)
    .split(/[，,。；;：:|/]/u, 1)[0]
    .replace(/(?:穿搭|搭配|风格)$/u, "")
    .trim()
    .slice(0, 12);
}

function hasSpecificTaobaoCategory(query, requirement) {
  const normalized = normalizeText(query);
  const label = specificTaobaoCategoryLabel(requirement, normalized);
  if (!label || !normalized.includes(normalizeText(label))) return false;
  const withoutAudience = normalized
    .replace(/男士|女士|男装|女装|男款|女款/g, "")
    .replace(/\s+/g, "");
  return !/^(?:accessory|accessories|配饰|服饰|fashion)$/.test(withoutAudience);
}

function categorySearchLabel(requirement) {
  return SEARCH_SUBCATEGORY_LABELS[requirement.search_subcategory] ||
    CATEGORY_LABELS[requirement.category];
}

function isGenericAccessorySearch(keyword, requirement) {
  if (requirement.category !== "accessory") return false;
  const normalized = normalizeText(keyword);
  if (!normalized) return true;
  const withoutAudience = normalized
    .replace(/男士|女士|男装|女装|男款|女款/g, "")
    .replace(/\s+/g, "")
    .replace(/fashion/g, "");
  return /^(?:accessory|accessories|配饰|饰品)$/.test(withoutAudience);
}

function buildRelaxedCategoryKeyword(input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  if (!CORE_OUTFIT_CATEGORIES.includes(requirement.category)) return "";
  return normalizeWhitespace([
    GENDER_SEARCH_TERM[requirement.gender],
    requirement.style,
    categorySearchLabel(requirement),
  ].filter(Boolean).join(" "));
}

function rankProducts(products, input = {}, searchKeyword = "", options = {}) {
  const requirement = normalizeProductRequirement(input);
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Number(options.minimumScore)
    : requirement.gender === "unisex" ? 0 : 50;
  return (Array.isArray(products) ? products : [])
    .map((product) => scoreProduct(
      product,
      requirement,
      product?.search_keyword || searchKeyword,
    ))
    .filter(Boolean)
    .map((product) => ({
      ...product,
      relevance_below_preferred_threshold: product.relevance_score < minimumScore,
    }))
    .sort((left, right) => right.relevance_score - left.relevance_score ||
      String(left.product_id).localeCompare(String(right.product_id)));
}

function scoreProduct(product, requirement, searchKeyword = "") {
  const title = normalizeText(product?.title);
  if (!title || !semanticCategoryMatch(product, requirement)) return null;
  const negativeKeywordConflict = containsNegativeKeyword(title, requirement);
  const qualityBlock = productQualityBlock(product, requirement);

  const originalGender = authoritativeProductGender(product);
  const rawOriginalCategory = normalizeText(
    product?.original_category || product?.category,
  );
  const originalCategory = rawOriginalCategory === "socks"
    ? "socks"
    : normalizeProductCategory(rawOriginalCategory) || requirement.category;
  const structuredEvidence = normalizeText([
    title,
    product?.style,
    product?.color,
    product?.color_label,
    product?.season,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ].filter(Boolean).join(" "));
  let score = 35;
  if (originalGender === requirement.gender) score += 20;
  else if (originalGender === "unisex") score += 10;
  else if (matchesGender(title, requirement.gender)) score += 20;
  if (matchesColor(structuredEvidence, requirement.color)) score += 15;
  if (matchesStyle(structuredEvidence, requirement.style, requirement.fit)) score += 10;
  if (matchesSeason(structuredEvidence, requirement.season)) score += 5;
  score += Math.min(keywordOverlapScore(title, searchKeyword, requirement), 15);
  score += categoryPriorityScore(requirement.category);
  if (title.includes("同款")) score -= 10;

  const {_category_text: _, ...publicProduct} = product;
  return {
    ...publicProduct,
    look_id: requirement.look_id,
    category: originalCategory,
    original_category: originalCategory,
    search_subcategory: requirement.search_subcategory,
    semantic_match: true,
    gender: originalGender,
    original_gender: originalGender,
    requested_gender: requirement.gender,
    search_keyword: normalizeWhitespace(searchKeyword),
    relevance_score: Math.min(score, 100),
    relevance_negative_conflict: negativeKeywordConflict,
    product_quality_warning: qualityBlock,
  };
}

function productQualityBlock(product, requirement = {}) {
  const evidence = normalizeText([
    product?.title,
    product?._category_text,
    product?.category,
  ].filter(Boolean).join(" "));
  if (!evidence) return null;
  const lowQualityKeyword = LOW_QUALITY_TITLE_TERMS.find((term) =>
    evidence.includes(normalizeText(term)));
  if (lowQualityKeyword) {
    return {
      blocked_category: "low_quality_merchandising",
      blocked_keyword: lowQualityKeyword,
    };
  }
  if (explicitlyRequestsLowValueProduct(requirement) ||
      (requirement.blueprint_required === true &&
       requirement.search_subcategory === "socks")) return null;
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

function semanticCategoryMatch(product, input = {}) {
  const requirement = normalizeProductRequirement(input);
  const evidence = normalizeText([
    product?.title,
    product?._category_text,
  ].filter(Boolean).join(" "));
  if (!evidence || containsAny(evidence, NON_FASHION_PRODUCT_TERMS)) return false;
  if (requirement.search_subcategory) {
    return containsAny(
      evidence,
      ACCESSORY_SUBCATEGORY_TERMS[requirement.search_subcategory] || [],
    );
  }
  return matchesTargetCategory(evidence, requirement.category);
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
  LOW_QUALITY_TITLE_TERMS,
  LOW_VALUE_PRODUCT_GROUPS,
  PRODUCT_CATEGORY_PRIORITY,
  SUPPORTED_PRODUCT_CATEGORIES,
  ACCESSORY_SUBCATEGORY_TERMS,
  CORE_OUTFIT_CATEGORIES,
  NON_FASHION_PRODUCT_TERMS,
  buildRelaxedCategoryKeyword,
  buildSearchKeywords,
  buildTaobaoSearchPlan,
  categoryPriority,
  matchesTargetCategory,
  normalizeGender,
  normalizeCandidateGender,
  authoritativeProductGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  normalizeSearchSubcategory,
  normalizeTaobaoSearchKeyword,
  productQualityBlock,
  rankProducts,
  scoreProduct,
  semanticCategoryMatch,
  sortProductsByCategoryPriority,
};
