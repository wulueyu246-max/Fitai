const assert = require("node:assert/strict");
const test = require("node:test");

const {
  expandBlueprintSearchPlan,
} = require("../blueprint_search_expansion");
const {
  buildTaobaoSearchPlan,
  normalizeProductRequirement,
} = require("../product_relevance");

function expand(requirementValue, blueprint) {
  const requirement = normalizeProductRequirement(requirementValue);
  return expandBlueprintSearchPlan(
    requirement,
    blueprint,
    buildTaobaoSearchPlan(requirement),
  );
}

test("expands an abstract sweet shoe query into three concrete marketplace levels", () => {
  const plan = expand({
    category: "shoes",
    gender: "female",
    item_name: "甜美穿搭风格鞋履",
    search_keywords: ["甜美穿搭风格鞋履"],
  }, {
    core_elements: ["蝴蝶结", "女性化", "复古甜美"],
    must_have_items: {shoes: ["圆头低跟玛丽珍皮鞋"]},
  });

  assert.deepEqual(plan.expanded_queries, [
    "女士 蝴蝶结 玛丽珍鞋",
    "女士 玛丽珍鞋",
    "女士 单鞋",
  ]);
  assert.equal(plan.fallbacks.length, 2);
  assert.ok(plan.expanded_queries.every((query) =>
    !query.includes("甜美穿搭风格鞋履")));
});

test("expands a mature Blueprint using concrete material and garment evidence", () => {
  const plan = expand({
    category: "top",
    gender: "female",
    item_name: "高级成熟上衣",
    search_keywords: ["高级成熟上衣"],
  }, {
    core_elements: ["结构感"],
    material_direction: ["真丝", "醋酸"],
    must_have_items: {top: ["真丝垂坠衬衫"]},
  });

  assert.equal(plan.exact, "女士 真丝 衬衫");
  assert.equal(plan.fallbacks[0], "女士 衬衫");
  assert.equal(plan.fallbacks[1], "女士 上衣");
});

test("expands a material-led classic shoe Blueprint to loafers and a basic shoe fallback", () => {
  const plan = expand({
    category: "shoes",
    gender: "female",
    item_name: "经典鞋履",
    search_keywords: ["经典鞋履"],
  }, {
    core_elements: ["低Logo", "经典轮廓"],
    material_direction: ["真皮", "羊绒"],
    must_have_items: {shoes: ["真皮乐福鞋"]},
  });

  assert.match(plan.exact, /乐福鞋/);
  assert.match(plan.fallbacks[0], /乐福鞋/);
  assert.equal(plan.fallbacks[1], "女士 单鞋");
});

test("an unknown natural-language Blueprint still reaches a concrete category fallback", () => {
  const plan = expand({
    category: "dress",
    gender: "female",
    item_name: "夜间艺术展造型",
    search_keywords: ["凌晨巴黎私人艺术展后的冷感女性穿搭"],
  }, {
    core_elements: ["不对称结构"],
    must_have_items: {dress: ["不对称立体剪裁连衣裙"]},
  });

  assert.match(plan.exact, /连衣裙/);
  assert.ok(plan.expanded_queries.length >= 2);
  assert.ok(plan.expanded_queries.every((query) => /连衣裙/.test(query)));
});

test("accessory expansion keeps its concrete subcategory through every level", () => {
  const plan = expand({
    category: "accessory",
    gender: "female",
    item_name: "细腰带",
    search_subcategory: "belt",
    search_keywords: ["女士 精致 配饰"],
  }, {
    core_elements: ["强调腰线"],
    must_have_items: {belt: ["细皮质腰带"]},
  });

  assert.ok(plan.expanded_queries.length > 0);
  assert.ok(plan.expanded_queries.every((query) => /腰带|皮带/.test(query)));
  assert.ok(plan.expanded_queries.every((query) => !/耳饰|项链|配饰/.test(query)));
});
