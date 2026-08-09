const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyBlueprintToRequirement,
  blueprintHasCoreItems,
  blueprintMatchAssessment,
  normalizeOutfitBlueprint,
} = require("../outfit_blueprint");
const {buildSearchKeywords, normalizeProductRequirement} = require("../product_relevance");

const examples = Object.freeze([
  Object.freeze({
    requestedStyle: "甜妹",
    blueprint: {
      style_identity: "甜美少女风",
      character_impression: "浪漫、精致并具有少女感",
      visual_keywords: ["少女", "浪漫", "精致"],
      core_elements: ["蕾丝", "蝴蝶结", "白丝袜"],
      silhouette_strategy: ["明确腰线", "轻盈裙摆"],
      color_palette: ["奶白色", "浅粉色"],
      material_direction: ["蕾丝", "细腻针织"],
      must_have_items: {
        top: ["蕾丝荷叶边上衣"],
        bottom: ["高腰百褶裙"],
        socks: ["白丝袜"],
        shoes: ["玛丽珍皮鞋"],
      },
      avoid_items: ["运动鞋", "工装裤", "普通基础款"],
      occasion_strategy: "保持轻盈精致并适合日常活动",
    },
  }),
  Object.freeze({
    requestedStyle: "御姐",
    blueprint: {
      style_identity: "成熟利落女性风格",
      character_impression: "有气场、女性化且结构清晰",
      visual_keywords: ["成熟", "利落", "结构感"],
      core_elements: ["清晰肩线", "明确腰线"],
      silhouette_strategy: ["收束腰线", "纵向轮廓"],
      color_palette: ["黑色", "酒红色"],
      material_direction: ["垂坠西装料", "真丝"],
      must_have_items: {
        top: ["垂坠真丝衬衫"],
        bottom: ["高腰直筒西裤"],
        shoes: ["尖头低跟鞋"],
      },
      avoid_items: ["训练鞋", "校园运动外套"],
      occasion_strategy: "兼顾通勤与晚间社交",
    },
  }),
  Object.freeze({
    requestedStyle: "老钱风",
    blueprint: {
      style_identity: "低调经典的精致风格",
      character_impression: "克制、可靠并重视材质",
      visual_keywords: ["经典", "低标识", "精致"],
      core_elements: ["经典轮廓", "低Logo"],
      silhouette_strategy: ["合体直线轮廓"],
      color_palette: ["海军蓝", "燕麦色"],
      material_direction: ["羊毛", "羊绒", "真丝"],
      must_have_items: {
        top: ["羊绒针织衫"],
        bottom: ["羊毛直筒裤"],
        shoes: ["皮质乐福鞋"],
      },
      avoid_items: ["大Logo", "促销爆款"],
      occasion_strategy: "使用经典单品适配日常社交",
    },
  }),
]);

test("normalizes concrete Outfit Blueprints without a style-name whitelist", () => {
  for (const example of examples) {
    const blueprint = normalizeOutfitBlueprint(example.blueprint, {
      styleProfile: {source_text: example.requestedStyle},
    });
    assert.equal(blueprint.style_identity, example.blueprint.style_identity);
    assert.equal(blueprint.blueprint_source, "ai_generated");
    assert.equal(blueprintHasCoreItems(blueprint), true);
    assert.ok(blueprint.visual_keywords.length > 0);
    assert.ok(blueprint.avoid_items.length > 0);
  }

  const futureStyle = normalizeOutfitBlueprint({
    style_identity: "月球植物学家晚宴造型",
    visual_keywords: ["有机线条", "未来质感"],
    must_have_items: {
      dress: ["不对称立体剪裁连衣裙"],
      shoes: ["银灰色尖头鞋"],
    },
    avoid_items: ["普通运动套装"],
  });
  assert.equal(futureStyle.style_identity, "月球植物学家晚宴造型");
  assert.equal(blueprintHasCoreItems(futureStyle), true);
});

test("preserves the semantic fallback source marker", () => {
  const blueprint = normalizeOutfitBlueprint({
    blueprint_source: "semantic_fallback",
    style_identity: "用户原始自然语言风格",
    must_have_items: {
      top: ["具体上衣"],
      bottom: ["具体下装"],
      shoes: ["具体鞋履"],
    },
  });

  assert.equal(blueprint.blueprint_source, "semantic_fallback");
});

test("a concrete Blueprint creates item-first Taobao search keywords", () => {
  const blueprint = normalizeOutfitBlueprint(examples[0].blueprint);
  const generic = normalizeProductRequirement({
    category: "shoes",
    gender: "female",
    item_name: "鞋",
    style: "甜妹",
    search_keywords: ["女士 甜妹 鞋"],
    negative_keywords: [],
  });
  const requirement = normalizeProductRequirement(
    applyBlueprintToRequirement(generic, blueprint),
  );
  const keywords = buildSearchKeywords(requirement);

  assert.equal(requirement.item_name, "玛丽珍皮鞋");
  assert.equal(requirement.blueprint_required, true);
  assert.ok(keywords[0].includes("玛丽珍"));
  assert.ok(keywords[0].includes("女士"));
  assert.ok(!keywords.some((keyword) => /^女士\s*甜妹\s*鞋$/.test(keyword)));
});

test("Blueprint avoid items are a hard gate and matching items score higher", () => {
  const blueprint = normalizeOutfitBlueprint(examples[0].blueprint);
  const requirement = normalizeProductRequirement(
    applyBlueprintToRequirement({
      category: "shoes",
      gender: "female",
      item_name: "鞋",
      style: "甜妹",
      search_keywords: [],
      negative_keywords: [],
    }, blueprint),
  );
  const maryJane = blueprintMatchAssessment({
    title: "女士蝴蝶结玛丽珍皮鞋",
  }, requirement, blueprint);
  const runningShoe = blueprintMatchAssessment({
    title: "轻量运动鞋跑步训练鞋",
  }, requirement, blueprint);

  assert.equal(maryJane.allowed, true);
  assert.ok(maryJane.score >= 65);
  assert.ok(maryJane.matched_elements.length > 0);
  assert.deepEqual(maryJane.conflict_elements, []);
  assert.equal(runningShoe.allowed, false);
  assert.ok(runningShoe.matched_avoid.includes("运动鞋"));
  assert.ok(runningShoe.conflict_elements.includes("运动鞋"));
});

test("Blueprint-required socks remain a concrete accessory requirement", () => {
  const blueprint = normalizeOutfitBlueprint(examples[0].blueprint);
  const requirement = normalizeProductRequirement(
    applyBlueprintToRequirement({
      category: "socks",
      gender: "female",
      item_name: "袜子",
      style: "甜妹",
      search_keywords: [],
      negative_keywords: [],
    }, blueprint),
  );

  assert.equal(requirement.category, "accessory");
  assert.equal(requirement.search_subcategory, "socks");
  assert.equal(requirement.item_name, "白丝袜");
  assert.equal(requirement.blueprint_required, true);
  assert.ok(buildSearchKeywords(requirement).every((keyword) =>
    keyword.includes("袜") || keyword.includes("丝袜")));
});
