const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildProductSearchTokens,
  translateBlueprintSearchRequirement,
} = require("../blueprint_search_translator");
const {normalizeOutfitBlueprint} = require("../outfit_blueprint");
const {normalizeProductRequirement} = require("../product_relevance");
const {
  normalizeExecutableProductRequirement,
} = require("../executable_product_requirement");

function translate(blueprintValue, requirement) {
  const blueprint = normalizeOutfitBlueprint(blueprintValue);
  const boundRequirement = {
    request_id: requirement.request_id || "translator-test",
    look_id: requirement.look_id || "look-1",
    slot_key: requirement.slot_key ||
      `translator-test:look-1:${requirement.category}:0`,
    ...requirement,
  };
  const normalized = normalizeProductRequirement(boundRequirement);
  const executable = normalizeExecutableProductRequirement(normalized, {
    originalRequirement: normalized,
    blueprint,
  });
  return translateBlueprintSearchRequirement(
    executable,
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
  assert.ok(shoes.query_reason.includes("可执行商品合同"));
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
    material: "精纺羊毛",
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

test("keeps Look-specific bottom requirements bound after translation", () => {
  const blueprint = normalizeOutfitBlueprint({
    style_identity: "显高约会风",
    core_elements: ["提高腰线"],
    must_have_items: {
      top: ["短款修身上衣"],
      bottom: ["高腰A字裙", "高腰直筒九分裤"],
      shoes: ["尖头浅口单鞋"],
    },
  });
  const lookA = translate(blueprint, {
      category: "bottom",
      gender: "female",
      item_name: "高腰A字裙",
      fit: "高腰A字",
      search_keywords: [],
      negative_keywords: [],
    });
  const lookB = translate(blueprint, {
      category: "bottom",
      gender: "female",
      item_name: "高腰直筒九分裤",
      fit: "高腰直筒九分",
      search_keywords: [],
      negative_keywords: [],
    });

  assert.equal(lookA.item_name, "高腰A字裙");
  assert.equal(lookB.item_name, "高腰直筒九分裤");
});

test("excludes internal English proportion strategy from marketplace queries", () => {
  const result = translate({
    style_identity: "显高约会风",
    core_elements: ["Raise waistline to improve leg proportion", "提高腰线"],
    silhouette_strategy: ["Maintain clean vertical lines from shoulder to hem"],
    material_direction: ["轻盈雪纺 (Light Chiffon)"],
    color_palette: ["奶油白 (Cream White)"],
    must_have_items: {
      top: ["短款修身上衣"],
      bottom: ["高腰A字裙"],
      shoes: ["尖头浅口单鞋"],
    },
  }, {
    category: "bottom",
    gender: "female",
    item_name: "高腰A字裙",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(result.search_keywords[0], /女士/u);
  assert.match(result.search_keywords[0], /高腰A字裙/u);
  assert.doesNotMatch(
    result.search_keywords.join(" "),
    /Raise waistline|improve leg proportion|Maintain clean vertical lines/iu,
  );
});

test("builds Taobao tokens only from structured product attributes", () => {
  const tokens = buildProductSearchTokens({
    requirement: {
      category: "bottom",
      gender: "female",
      color: "奶油白",
      material: "垂坠面料",
    },
    blueprint: {
      silhouette_strategy: ["上短下长：强制将腰线提升至肋骨下方"],
      visual_goals: ["Raise waistline to improve leg proportion"],
    },
    itemName: "高腰A字半身裙",
  });

  assert.deepEqual(tokens, ["女士", "奶油白", "垂坠面料", "高腰A字半身裙"]);
});

test("excludes Chinese internal styling strategy from marketplace queries", () => {
  const result = translate({
    style_identity: "显高约会",
    core_elements: ["提高腰线"],
    silhouette_strategy: ["上短下长：强制将腰线提升至肋骨下方"],
    visual_keywords: ["缩短上半身视觉长度"],
    material_direction: ["垂坠面料"],
    must_have_items: {
      bottom: ["高腰A字半身裙"],
    },
  }, {
    category: "bottom",
    gender: "female",
    item_name: "高腰A字半身裙",
    search_keywords: [],
    negative_keywords: [],
  });

  assert.match(result.search_keywords[0], /女士/u);
  assert.match(result.search_keywords[0], /高腰A字半身裙/u);
  assert.doesNotMatch(
    result.search_keywords.join(" "),
    /上短下长|强制将腰线|Raise waistline|缩短上半身/u,
  );
});
