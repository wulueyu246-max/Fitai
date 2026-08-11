const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTaobaoSearchPlan,
  buildSearchKeywords,
  matchesTargetCategory,
  normalizeGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  normalizeSearchSubcategory,
  normalizeTaobaoSearchKeyword,
  productQualityBlock,
  rankProducts,
  semanticCategoryMatch,
  sortProductsByCategoryPriority,
} = require("../product_relevance");

test("product requirement normalization preserves Look binding fields", () => {
  const requirement = normalizeProductRequirement({
    request_id: "request-003",
    look_id: "look-2",
    slot_key: "request-003:look-2:shoes:0",
    category: "shoes",
    gender: "female",
    product_type: "尖头浅口低跟单鞋",
    product_family: "pointed_flat",
    item_name: "尖头浅口低跟单鞋",
    style_role: "延长腿部纵向线条",
    colors: ["裸色", "米白色"],
    materials: ["羊皮", "缎面"],
    design_elements: ["尖头", "浅口"],
  });

  assert.equal(requirement.request_id, "request-003");
  assert.equal(requirement.look_id, "look-2");
  assert.equal(requirement.slot_key, "request-003:look-2:shoes:0");
  assert.equal(requirement.product_type, "尖头浅口低跟单鞋");
  assert.equal(requirement.product_family, "pointed_flat");
  assert.equal(requirement.style_role, "延长腿部纵向线条");
  assert.deepEqual(requirement.colors, ["裸色", "米白色"]);
  assert.deepEqual(requirement.materials, ["羊皮", "缎面"]);
  assert.deepEqual(requirement.design_elements, ["尖头", "浅口"]);
});

test("Taobao keyword normalization removes duplicate gender and splits color alternatives", () => {
  const requirement = {
    category: "top",
    gender: "female",
    item_name: "天蓝色或白色法式衬衫",
    style: "法式",
    search_keywords: ["女士 天蓝色/白色 女 天蓝色 法式衬衫"],
  };
  const normalized = normalizeTaobaoSearchKeyword(
    requirement.search_keywords[0],
    requirement,
  );
  const plan = buildTaobaoSearchPlan(requirement);

  assert.deepEqual(normalized, [
    "女士 法式 天蓝色 衬衫",
    "女士 法式 白色 衬衫",
  ]);
  assert.equal(plan.original_keyword, "女士 天蓝色/白色 女 天蓝色 法式衬衫");
  assert.equal(plan.exact, "女士 法式 天蓝色 衬衫");
  assert.deepEqual(plan.fallbacks, [
    "女士 法式 白色 衬衫",
    "女士 天蓝色 衬衫",
  ]);
  assert.ok(![plan.exact, ...plan.fallbacks].some((query) =>
    query.includes("/") || /女士.*\s女(?:\s|$)/.test(query)));
});

test("unknown style wording remains in the exact query with a category-only fallback", () => {
  const plan = buildTaobaoSearchPlan({
    category: "top",
    gender: "female",
    item_name: "简洁合身上衣",
    style: "甜美穿搭",
    search_keywords: ["女士 甜美穿搭 简洁合身上衣"],
  });

  assert.equal(plan.exact, "女士 甜美 上衣");
  assert.ok(plan.fallbacks.includes("女士 上衣"));
  assert.ok([plan.exact, ...plan.fallbacks].every((query) => query.includes("上衣")));
});

test("Taobao fallback plans always retain a concrete category", () => {
  for (const requirement of [
    {
      category: "bag",
      gender: "female",
      item_name: "黑色手提包",
      style: "法式",
      search_keywords: ["女士 法式 黑色 手提包"],
    },
    {
      category: "accessory",
      search_subcategory: "jewelry",
      gender: "female",
      item_name: "珍珠耳饰",
      style: "法式",
      search_keywords: ["女士 法式 珍珠耳饰"],
    },
  ]) {
    const plan = buildTaobaoSearchPlan(requirement);
    assert.ok([plan.exact, ...plan.fallbacks].every((query) =>
      /手提包|珍珠耳饰|耳饰/.test(query)));
    assert.ok([plan.exact, ...plan.fallbacks].every((query) =>
      !/^(?:accessory|配饰|服饰|fashion)$/i.test(query)));
    assert.ok(plan.fallbacks.length <= 2);
  }
});

function product(id, title, categoryText = title) {
  return {
    product_id: id,
    title,
    _category_text: categoryText,
    source: "taobao",
    platform: "taobao",
    is_mock: false,
  };
}

test("query builder creates two to three precise male Polo keywords", () => {
  const keywords = buildSearchKeywords({
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    color: "浅灰色",
    style: "clean fit",
    season: "summer",
    scene: "date",
    search_keywords: ["男士 浅灰色 短袖 Polo"],
    negative_keywords: [],
  });

  assert.ok(keywords.length >= 2 && keywords.length <= 3);
  assert.equal(keywords[0], "男士 浅灰色 短袖 Polo");
  assert.ok(keywords.every((keyword) => keyword.includes("男士")));
  assert.ok(keywords.every((keyword) => /Polo|上衣/.test(keyword)));
});

test("gender and category aliases normalize for male female and unisex", () => {
  assert.equal(normalizeGender("男生"), "male");
  assert.equal(normalizeGender("女士"), "female");
  assert.equal(normalizeGender("情侣"), "unisex");
  assert.equal(normalizeProductCategory("玛丽珍鞋"), "shoes");
  assert.equal(normalizeProductCategory("法式连衣裙"), "dress");
  assert.equal(normalizeProductCategory("托特包"), "bag");
  assert.equal(normalizeProductCategory("高腰百褶裙"), "bottom");
  assert.equal(normalizeProductCategory("cap"), "hat");
  assert.equal(normalizeProductCategory("jewelry"), "accessory");
  assert.equal(normalizeProductCategory("belt"), "accessory");
  assert.equal(normalizeProductCategory("scarf"), "accessory");
  assert.equal(normalizeProductCategory("accessory"), "accessory");
});

test("query builder prefixes every genderless male French shirt keyword", () => {
  const keywords = buildSearchKeywords({
    category: "top",
    gender: "male",
    item_name: "法式衬衫",
    style: "法式",
    fit: "长袖",
    search_keywords: ["法式衬衫", "法式 长袖衬衫", "法式 上衣"],
    negative_keywords: [],
  });

  assert.deepEqual(keywords, [
    "男士 法式衬衫",
    "男士 法式 长袖衬衫",
    "男士 法式 上衣",
  ]);
});

test("male recommendations remove women products and category conflicts", () => {
  const requirement = normalizeProductRequirement({
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    color: "浅灰色",
    style: "clean fit",
    season: "summer",
    search_keywords: ["男士 浅灰色 短袖 Polo"],
    negative_keywords: ["吊带", "裙"],
  });
  const ranked = rankProducts([
    product("valid", "男士浅灰色短袖Polo夏季clean fit上衣"),
    product("female", "女士浅灰色吊带上衣"),
    product("pants", "男士浅灰色九分休闲裤"),
    product("weak-couple", "女款情侣基础短袖上衣"),
  ], requirement, requirement.search_keywords[0]);

  assert.deepEqual(ranked.map((item) => item.product_id), ["valid"]);
  assert.equal(ranked[0].gender, "male");
  assert.equal(ranked[0].category, "top");
  assert.ok(ranked[0].relevance_score >= 80);
});

test("female recommendations reject menswear but allow unisex products", () => {
  const requirement = normalizeProductRequirement({
    category: "shoes",
    gender: "female",
    item_name: "白色乐福鞋",
    color: "白色",
    search_keywords: ["女士 白色 乐福鞋"],
    negative_keywords: [],
  });
  const ranked = rankProducts([
    product("female", "女士白色乐福鞋"),
    product("unisex", "男女同款白色乐福鞋"),
    product("male", "男士商务男鞋乐福鞋"),
  ], requirement, requirement.search_keywords[0]);

  assert.deepEqual(
    new Set(ranked.map((item) => item.product_id)),
    new Set(["female", "unisex"]),
  );
});

test("category filters reject obvious cross-category products", () => {
  assert.equal(matchesTargetCategory("男士短袖polo上衣", "top"), true);
  assert.equal(matchesTargetCategory("男士休闲裤", "top"), false);
  assert.equal(matchesTargetCategory("女士高腰阔腿裤", "bottom"), true);
  assert.equal(matchesTargetCategory("女士针织衫", "bottom"), false);
  assert.equal(matchesTargetCategory("女士法式连衣裙", "dress"), true);
  assert.equal(matchesTargetCategory("女士玛丽珍鞋", "dress"), false);
  assert.equal(matchesTargetCategory("女士托特包", "bag"), true);
  assert.equal(matchesTargetCategory("女士针织衫", "bag"), false);
});

test("bag semantic hard gate rejects bread and tissues", () => {
  const requirement = normalizeProductRequirement({
    category: "bag",
    gender: "female",
    item_name: "法式手提包",
    search_keywords: ["女士 法式 简约 手提包"],
  });
  const candidates = [
    product("bag", "女士法式简约手提包", "服饰箱包"),
    product("bread", "奶狮面包早餐零食", "食品"),
    product("tissue", "家庭装抽纸纸巾", "日用品"),
  ];

  const ranked = rankProducts(candidates, requirement, "女士 法式 简约 手提包", {
    minimumScore: 0,
  });
  assert.deepEqual(ranked.map((item) => item.product_id), ["bag"]);
  assert.equal(ranked[0].semantic_match, true);
  assert.equal(semanticCategoryMatch(candidates[1], requirement), false);
});

test("jewelry semantic hard gate keeps only real jewelry", () => {
  const requirement = normalizeProductRequirement({
    category: "accessory",
    search_subcategory: "jewelry",
    gender: "female",
    item_name: "珍珠耳环",
    search_keywords: ["女士 法式 珍珠耳环"],
  });
  const ranked = rankProducts([
    product("earring", "女士淡水珍珠耳环", "珠宝首饰"),
    product("tissue", "柔软抽纸纸巾", "日用品"),
    product("snack", "坚果零食大礼包", "食品"),
  ], requirement, "女士 法式 珍珠耳环", {minimumScore: 0});

  assert.equal(requirement.search_subcategory, "jewelry");
  assert.equal(normalizeSearchSubcategory("jewelry"), "jewelry");
  assert.deepEqual(ranked.map((item) => item.product_id), ["earring"]);
});

test("specific accessory requirements never build generic accessory searches", () => {
  const keywords = buildSearchKeywords({
    category: "accessory",
    search_subcategory: "belt",
    gender: "female",
    style: "法式",
    item_name: "细腰带",
    search_keywords: ["accessory", "配饰", "女士 细腰带 皮带"],
  });

  assert.ok(keywords.length >= 2);
  assert.ok(keywords.every((keyword) => /腰带|皮带/.test(keyword)));
  assert.ok(keywords.every((keyword) => !/^(?:accessory|配饰)$/i.test(keyword)));
});

test("relevance score sorts the closest product first and strips internal fields", () => {
  const requirement = normalizeProductRequirement({
    category: "bottom",
    gender: "female",
    item_name: "米白色高腰阔腿裤",
    color: "米白色",
    style: "韩系",
    season: "summer",
    search_keywords: ["女士 米白色 高腰 阔腿裤"],
    negative_keywords: [],
  });
  const ranked = rankProducts([
    product("basic", "女士阔腿裤"),
    product("exact", "女士米白色韩系夏季高腰阔腿裤"),
  ], requirement, requirement.search_keywords[0]);

  assert.deepEqual(ranked.map((item) => item.product_id), ["exact", "basic"]);
  assert.ok(ranked[0].relevance_score > ranked[1].relevance_score);
  assert.equal("_category_text" in ranked[0], false);
});

test("AI candidate mode admits neutral low-score items without weakening hard filters", () => {
  const requirement = normalizeProductRequirement({
    category: "top",
    gender: "male",
    item_name: "短袖Polo",
    search_keywords: ["男士 短袖 Polo"],
    negative_keywords: ["女装", "吊带", "裙"],
  });
  const candidates = [
    product("neutral", "简约短袖Polo上衣"),
    product("female", "女士吊带短袖上衣"),
    product("wrong-category", "男士休闲裤"),
  ];

  assert.deepEqual(rankProducts(candidates, requirement).map((item) => item.product_id), []);
  assert.deepEqual(
    rankProducts(candidates, requirement, requirement.search_keywords[0], {
      minimumScore: 35,
    }).map((item) => item.product_id),
    ["neutral"],
  );
});

test("ranked candidates keep the AI Look identity and material requirement", () => {
  const ranked = rankProducts([
    product("look-polo", "男士浅灰色短袖Polo夏季上衣"),
  ], {
    look_id: "look-male-clean-1",
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    color: "浅灰色",
    fit: "合体",
    material: "珠地棉",
    style: "clean fit",
    season: "summer",
    search_keywords: ["男士 浅灰色 短袖 Polo"],
    negative_keywords: ["女装", "吊带"],
  }, "男士 浅灰色 短袖 Polo");

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].look_id, "look-male-clean-1");
  assert.equal(ranked[0].gender, "male");
});

test("homepage quality policy blocks underwear and other low-value products", () => {
  const requirement = normalizeProductRequirement({
    category: "top",
    gender: "male",
    item_name: "男士Polo",
    search_keywords: ["男士 Polo"],
    negative_keywords: [],
  });
  const blocked = productQualityBlock(
    product("underwear", "Tom Ford 男士内裤"),
    requirement,
  );

  assert.deepEqual(blocked, {
    blocked_category: "underwear",
    blocked_keyword: "内裤",
  });
  assert.equal(
    productQualityBlock(product("polo", "男士短袖Polo"), requirement),
    null,
  );
});

test("low-quality Taobao marketing titles are filtered before ranking", () => {
  const requirement = normalizeProductRequirement({
    category: "top",
    gender: "male",
    item_name: "男士白色T恤",
    search_keywords: ["男士 白色 T恤"],
    negative_keywords: [],
  });
  const keywords = ["厂家", "批发", "清仓", "爆款", "地摊", "学生党", "仿"];

  for (const keyword of keywords) {
    const blocked = productQualityBlock(
      product(`blocked-${keyword}`, `男士白色T恤 ${keyword}`),
      requirement,
    );
    assert.equal(blocked.blocked_category, "low_quality_merchandising");
    assert.ok(blocked.blocked_keyword);
  }
  assert.deepEqual(
    rankProducts([
      product("ordinary", "男士白色纯棉T恤"),
      product("wholesale", "厂家批发男士白色T恤"),
    ], requirement, "男士 白色 T恤").map((item) => item.product_id),
    ["ordinary"],
  );
});

test("low-value products are allowed only for an explicit matching search", () => {
  const productItem = product("underwear", "男士纯棉内裤");
  assert.equal(productQualityBlock(productItem, {
    explicit_user_search: true,
    user_search_keyword: "男士内裤",
  }), null);
  assert.ok(productQualityBlock(productItem, {
    explicit_user_search: false,
    user_search_keyword: "男士内裤",
  }));
});

test("primary outfit categories sort before accessories", () => {
  const sorted = sortProductsByCategoryPriority([
    {...product("watch", "简约手表"), category: "accessory", relevance_score: 95},
    {...product("shoe", "男士皮鞋"), category: "shoes", relevance_score: 70},
    {...product("top", "男士衬衫"), category: "top", relevance_score: 80},
  ]);

  assert.deepEqual(sorted.map((item) => item.product_id), ["top", "shoe", "watch"]);
});
