"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assessPortfolioDiversity,
  validateLookConceptPortfolio,
} = require("../look_concept_generator");
const {createOutfitDecisionContext} = require("../index");

function request(overrides = {}) {
  return {
    requestId: `concept-${Math.random().toString(16).slice(2)}`,
    rawUserInput: "帮我搭几套",
    gender: "female",
    scene: "daily",
    itemBudget: "200-500",
    outfitBudget: "800-1500",
    explicitStyle: "",
    explicitRequirements: [],
    explicitAvoid: [],
    explicitPreferences: [],
    height: 165,
    weight: 52,
    structuredBodyProfile: {
      shoulder_relation: "normal",
      leg_length_relation: "short",
    },
    ...overrides,
  };
}

function context(overrides = {}) {
  return createOutfitDecisionContext(request(overrides), {
    provider: "mock",
    timestamp: "2026-08-27T14:00:00.000Z",
  });
}

test("Case A: Cityboy date keeps one anchor with real internal variation", () => {
  const result = context({
    gender: "male",
    scene: "date",
    rawUserInput: "我要Cityboy去约会",
    explicitStyle: "cityboy",
    height: 178,
    weight: 68,
  });

  assert.ok(result.concepts.length >= 2 && result.concepts.length <= 4);
  assert.equal(result.concepts.every(({style_anchor: anchor}) =>
    anchor.value === "cityboy"), true);
  assert.equal(new Set(result.concepts.map(({silhouette_direction: item}) =>
    item.overall_proportion)).size, result.concepts.length);
  assert.equal(new Set(result.concepts.map(({statement_level: item}) =>
    item)).size >= 2, true);
  assert.equal(result.concept_diversity.status, "PASS");
});

test("Case B: vague nightlife input creates three non-style-locked directions", () => {
  const result = context({
    scene: "nightlife",
    rawUserInput: "今晚喝酒，帮我搭几套",
  });

  assert.ok(result.concepts.length >= 3 && result.concepts.length <= 4);
  assert.equal(result.concepts.every(({style_anchor: anchor}) =>
    anchor.role === "open_scene_direction"), true);
  assert.equal(result.concepts.every(({market_evidence: market}) =>
    market.status === "NOT_CONNECTED" && market.signals_used.length === 0), true);
  assert.equal(result.concept_diversity.minimum_pairwise_difference_count >= 3,
    true);
});

test("Case C: open three-look request preserves high portfolio diversity", () => {
  const result = context({
    scene: "travel",
    rawUserInput: "明天出去玩，随便搭三套",
  });
  const brain = result.intent.user_intent_brain;

  assert.equal(brain.creative_freedom.value, "high");
  assert.equal(brain.portfolio_diversity_preference.value, "high");
  assert.equal(result.concepts.length, 3);
  assert.equal(result.concept_diversity.status, "PASS");
});

test("high creative freedom expands an unspecified portfolio to four concepts", () => {
  const result = context({
    scene: "travel",
    rawUserInput: "明天出去玩，随便帮我搭几套",
  });
  const brain = result.intent.user_intent_brain;

  assert.equal(brain.creative_freedom.value, "high");
  assert.equal(brain.portfolio_diversity_preference.value, "high");
  assert.equal(result.concepts.length, 4);
  assert.equal(result.concept_diversity.status, "PASS");
});

test("Case D: Korean preference anchors one concept and permits alternatives", () => {
  const result = context({
    rawUserInput: "韩系一点，也可以试别的",
    explicitStyle: "korean",
  });

  assert.equal(result.concepts[0].style_flexibility,
    "preferred_anchor_with_compatible_variation");
  assert.equal(result.concepts[0].style_anchor.value, "korean");
  assert.equal(result.concepts.slice(1).every(({style_anchor: anchor}) =>
    anchor.role === "compatible_exploration" &&
      anchor.compatible_with === "korean"), true);
});

test("Case E: elevated but non-office concepts preserve both instructions", () => {
  const result = context({
    scene: "date",
    rawUserInput: "正式一点，但是不要像上班",
    explicitAvoid: ["不要像上班"],
  });

  assert.equal(result.concepts.every(({formality}) =>
    ["elevated", "formal"].includes(formality)), true);
  assert.equal(result.concepts.every(({avoid}) =>
    avoid.includes("overly_corporate") && avoid.includes("office_like")), true);
});

test("Case F: niche request raises experimentation without unusable extremes", () => {
  const result = context({
    rawUserInput: "小众一点，不要烂大街",
  });

  assert.equal(result.intent.user_intent_brain.experimentation_level.value,
    "high");
  assert.ok(result.concepts.some((concept) =>
    concept.mainstream_vs_niche === "niche" &&
      concept.statement_level === "medium_to_high"));
  assert.equal(JSON.stringify(result.concepts).includes("unwearable"), false);
});

test("Case G: equal body facts adapt differently to clean-fit and street", () => {
  const shared = {
    gender: "male",
    scene: "daily",
    height: 176,
    weight: 66,
    structuredBodyProfile: {
      shoulder_relation: "normal",
      leg_length_relation: "short",
    },
  };
  const clean = context({
    ...shared,
    rawUserInput: "clean_fit穿搭",
    explicitStyle: "clean_fit",
  });
  const street = context({
    ...shared,
    rawUserInput: "street穿搭",
    explicitStyle: "street",
  });

  assert.deepEqual(clean.body_fit_profile.body_facts,
    street.body_fit_profile.body_facts);
  assert.notDeepEqual(clean.concepts[0].body_fit_strategy,
    street.concepts[0].body_fit_strategy);
  assert.equal(clean.concepts[0].body_fit_strategy.source, "body_fit_profile");
  assert.equal(street.concepts[0].body_fit_strategy.source, "body_fit_profile");
});

test("Case H: leather-shoe avoid applies to every concept", () => {
  const result = context({
    gender: "male",
    scene: "date",
    rawUserInput: "Cityboy约会，但不要皮鞋",
    explicitStyle: "cityboy",
    explicitAvoid: ["不要皮鞋"],
  });

  assert.equal(result.concepts.every((concept) =>
    concept.avoid.includes("leather_shoes") &&
      !/leather.*dress|dress.*leather/iu.test(
        concept.footwear_direction.preference,
      )), true);
});

test("PortfolioValidator rejects cosmetic-only duplicates and product IDs", () => {
  const result = context({
    gender: "male",
    rawUserInput: "Cityboy穿搭",
    explicitStyle: "cityboy",
  });
  const duplicated = structuredClone(result.concepts);
  duplicated[1] = {
    ...structuredClone(duplicated[0]),
    concept_id: "cosmetic-copy",
    color_direction: {
      ...structuredClone(duplicated[0].color_direction),
      palette: "different_color_only",
    },
    product_id: "forbidden-product",
  };
  const diversity = assessPortfolioDiversity(duplicated);
  const validation = validateLookConceptPortfolio({
    context: result,
    concepts: duplicated,
    diversity,
  });

  assert.equal(diversity.status, "FAIL");
  assert.equal(validation.status, "FAIL");
  assert.ok(validation.errors.includes("PORTFOLIO_NOT_DIVERSE"));
  assert.ok(validation.errors.includes(
    "PRODUCT_IDENTITY_FORBIDDEN:cosmetic-copy",
  ));
});
