const assert = require("node:assert/strict");
const test = require("node:test");

const {
  translateBlueprintSearchRequirement,
} = require("../blueprint_search_translator");
const {normalizeOutfitBlueprint} = require("../outfit_blueprint");
const {normalizeProductRequirement} = require("../product_relevance");

function translate(blueprintValue, requirement) {
  const blueprint = normalizeOutfitBlueprint(blueprintValue);
  return translateBlueprintSearchRequirement(
    normalizeProductRequirement(requirement),
    blueprint,
  );
}

test("translates a sweet Blueprint into concrete marketplace language", () => {
  const blueprint = {
    style_identity: "甜妹",
    visual_keywords: ["少女", "浪漫", "甜美", "精致"],
    core_elements: ["蝴蝶结", "蕾丝", "白丝袜"],
    silhouette_strategy: ["高腰", "A字裙摆"],
    material_direction: ["蕾丝"],
    must_have_items: {
      top: ["蕾丝荷叶边蝴蝶结上衣"],
      bottom: ["高腰百褶A字裙"],
      socks: ["白丝袜"],
      shoes: ["圆头低跟玛丽珍皮鞋"],
    },
    avoid_items: ["运动鞋", "跑鞋", "篮球鞋"],
  };
  const shoes = translate(blueprint, {
    category: "shoes",
    gender: "female",
    item_name: "鞋",
    search_keywords: [],
    negative_keywords: [],
  });
  const top = translate(blueprint, {
    category: "top",
    gender: "female",
    item_name: "上衣",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(shoes.search_keywords[0], /^女士 /);
  assert.match(shoes.search_keywords[0], /玛丽珍/);
  assert.doesNotMatch(shoes.search_keywords[0], /甜妹鞋|少女鞋|女生鞋/);
  assert.doesNotMatch(shoes.search_keywords.join(" "), /运动鞋|跑鞋|篮球鞋/);
  assert.match(top.search_keywords[0], /蕾丝荷叶边蝴蝶结上衣/);
  assert.ok(shoes.query_reason.includes("穿搭蓝图"));
  assert.ok(shoes.source_elements.includes("圆头低跟玛丽珍皮鞋"));
  assert.ok(!shoes.search_keywords.some((query) => query.includes("甜妹")));
});

test("translates a mature structured Blueprint without casual sports terms", () => {
  const result = translate({
    style_identity: "御姐",
    visual_keywords: ["成熟", "利落"],
    core_elements: ["结构感", "明确腰线"],
    material_direction: ["真丝", "精纺羊毛"],
    must_have_items: {
      top: ["真丝垂坠衬衫"],
      bottom: ["高腰西装裤"],
      shoes: ["尖头低跟皮鞋"],
    },
    avoid_items: ["休闲运动", "跑步鞋"],
  }, {
    category: "bottom",
    gender: "female",
    item_name: "裤子",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(result.search_keywords[0], /西装裤/);
  assert.match(result.search_keywords[0], /真丝|羊毛|结构感/);
  assert.doesNotMatch(result.search_keywords.join(" "), /休闲运动|跑步鞋|御姐/);
});

test("translates a material-led classic Blueprint without logo sports language", () => {
  const result = translate({
    style_identity: "老钱风",
    visual_keywords: ["经典", "克制"],
    core_elements: ["低Logo", "经典轮廓"],
    material_direction: ["真皮", "羊绒", "羊毛"],
    must_have_items: {
      top: ["羊绒针织衫"],
      bottom: ["羊毛直筒裤"],
      shoes: ["真皮乐福鞋"],
    },
    avoid_items: ["大Logo运动", "训练装备"],
  }, {
    category: "shoes",
    gender: "female",
    item_name: "鞋",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(result.search_keywords[0], /真皮乐福鞋/);
  assert.doesNotMatch(result.search_keywords.join(" "), /老钱风|大Logo运动|训练装备/);
});

test("an unknown natural-language Blueprint still produces a concrete query", () => {
  const result = translate({
    style_identity: "月球植物学家参加夜间画廊开幕",
    visual_keywords: ["未来感", "有机线条"],
    core_elements: ["不对称结构"],
    color_palette: ["银灰色"],
    material_direction: ["金属光泽面料"],
    must_have_items: {
      dress: ["不对称立体剪裁连衣裙"],
      shoes: ["银灰色尖头鞋"],
    },
    avoid_items: ["普通运动套装"],
  }, {
    category: "dress",
    gender: "female",
    item_name: "连衣裙",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(result.search_keywords[0], /不对称立体剪裁连衣裙/);
  assert.doesNotMatch(result.search_keywords.join(" "), /月球植物学家/);
  assert.ok(result.translated_queries.every((entry) =>
    entry.query_reason && entry.source_elements.length > 0));
});
