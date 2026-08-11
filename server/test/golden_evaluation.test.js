const assert = require("node:assert/strict");
const test = require("node:test");

const golden = require("../evaluation/golden/sweet_girl_v1.json");
const {
  blueprintHasCoreItems,
  blueprintMatchAssessment,
  blueprintMatchPassesHardGate,
  normalizeOutfitBlueprint,
} = require("../outfit_blueprint");
const {
  translateBlueprintSearchRequirement,
} = require("../blueprint_search_translator");
const {
  normalizeExecutableProductRequirement,
} = require("../executable_product_requirement");

const obviousStyleConflicts = ["跑鞋", "训练鞋", "工装裤", "运动训练"];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test("sweet_girl_v1 golden record keeps the complete evaluation contract", () => {
  assert.equal(golden.case_id, "sweet_girl_v1");
  assert.equal(golden.user_input.requested_style, "甜妹穿搭");
  assert.equal(golden.user_input.gender, "female");

  for (const field of [
    "fashion_brain_context",
    "blueprint",
    "search_queries",
    "final_products",
    "blueprint_match_score",
    "body_strategy_match_score",
    "total_duration",
  ]) {
    assert.ok(golden[field], `${field} must be recorded`);
  }

  assert.ok(golden.fashion_brain_context.item_hits.includes("蕾丝"));
  assert.ok(golden.fashion_brain_context.item_hits.includes("百褶裙"));
  assert.ok(golden.fashion_brain_context.item_hits.includes("玛丽珍鞋"));
  assert.ok(golden.total_duration.milliseconds > 0);
  assert.ok(
    golden.total_duration.milliseconds <=
      golden.total_duration.maximum_regression_milliseconds,
  );
});

test("sweet_girl_v1 Blueprint and marketplace queries stay concrete", () => {
  const blueprint = normalizeOutfitBlueprint(golden.blueprint, {
    styleProfile: {source_text: golden.user_input.requested_style},
  });
  assert.equal(blueprint.blueprint_source, "ai_generated");
  assert.equal(blueprintHasCoreItems(blueprint), true);

  for (const element of ["蕾丝", "蝴蝶结", "百褶裙", "玛丽珍"]) {
    assert.ok(blueprint.core_elements.includes(element));
  }

  for (const recorded of golden.search_queries) {
    const itemName = blueprint.must_have_items[recorded.category]?.[0];
    assert.ok(itemName, `${recorded.category} must have a concrete Blueprint item`);
    const requirement = {
      request_id: "sweet-girl-v1",
      look_id: "golden-look-1",
      category: recorded.category,
      slot_key: `sweet-girl-v1:golden-look-1:${recorded.category}:0`,
      gender: golden.user_input.gender,
      item_name: itemName,
      fit: itemName,
      search_keywords: [],
    };
    const executable = normalizeExecutableProductRequirement(requirement, {
      originalRequirement: requirement,
      blueprint,
    });
    const translated = translateBlueprintSearchRequirement(executable);
    assert.ok(translated.search_keywords.length > 0);
    assert.match(translated.search_keywords[0], /女士/u);
    assert.ok(
      translated.source_elements.some((value) =>
        recorded.source_elements.includes(value)),
      `${recorded.category} query must remain traceable to the golden Blueprint`,
    );
    assert.doesNotMatch(
      translated.search_keywords[0],
      /甜美风格上衣|甜美鞋履/u,
    );
  }
});

test("sweet_girl_v1 final products pass Blueprint and body score gates", () => {
  const blueprint = normalizeOutfitBlueprint(golden.blueprint);
  const blueprintScores = [];
  const bodyScores = [];

  for (const product of golden.final_products) {
    assert.equal(product.source, "taobao");
    assert.equal(product.is_mock, false);
    assert.ok(!obviousStyleConflicts.some((term) => product.title.includes(term)));
    assert.ok(Number.isFinite(product.blueprint_match_score));
    assert.ok(Number.isFinite(product.body_strategy_match_score));
    assert.ok(product.body_strategy_match_score >= 0 &&
      product.body_strategy_match_score <= 100);

    const requirement = {
      category: product.category,
      item_name: blueprint.must_have_items[product.category]?.[0] || "",
    };
    const assessment = blueprintMatchAssessment(product, requirement, blueprint);
    assert.equal(assessment.allowed, true, product.title);
    assert.equal(
      blueprintMatchPassesHardGate(
        {...assessment, score: product.blueprint_match_score},
        90,
      ),
      true,
      product.title,
    );
    blueprintScores.push(product.blueprint_match_score);
    bodyScores.push(product.body_strategy_match_score);
  }

  assert.ok(
    average(blueprintScores) >=
      golden.blueprint_match_score.golden_average_minimum,
  );
  assert.ok(
    average(bodyScores) >=
      golden.body_strategy_match_score.golden_average_minimum,
  );
});
