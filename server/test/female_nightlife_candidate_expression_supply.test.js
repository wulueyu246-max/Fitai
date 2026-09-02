"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  resolveFemaleNightlifeCandidateExpression,
  selectExpressionCandidateSupply,
} = require("../female_nightlife_candidate_expression_supply");
const {
  planConceptSearchQueries,
} = require("../concept_search_query_planner");
const golden = require(
  "../evaluation/golden/female_nightlife_youthful_social_energy_v1.json"
);
const {
  evaluateFemaleNightlifeYouthfulSocialEnergy,
} = require("../evaluation/female_nightlife_youthful_social_energy_contract");

const directions = Object.freeze({
  polished: {
    top: "clean_or_gently_defined",
    bottom: "structured_with_clear_line",
    shoes: "refined_low_visual_noise_footwear",
  },
  relaxed: {
    top: "relaxed_with_visible_structure",
    bottom: "easy_line_with_controlled_length",
    shoes: "lightweight_relaxed_footwear",
  },
  expressive: {
    top: "defined_focal_shape",
    bottom: "supporting_shape_with_clear_proportion",
    shoes: "design_led_but_wearable_footwear",
  },
});

function context(gender = "female", scene = "nightlife") {
  return {
    user_truth: {gender, scene},
    intent: {user_intent_brain: {
      desired_impression: {value: ["年轻", "有设计感"]},
      scene_intent: {value: scene},
      statement_level: {value: "medium"},
    }},
  };
}

function concept(name, slot) {
  return {
    concept_id: `concept-${name}`,
    scene_fit: "nightlife",
    silhouette_direction: {
      top: directions[name].top,
      bottom: directions[name].bottom,
    },
    footwear_direction: {preference: directions[name].shoes},
    statement_level: name === "expressive" ? "medium_to_high" : "medium",
  };
}

test("candidate expression supply activates only for female nightlife", () => {
  const active = resolveFemaleNightlifeCandidateExpression({
    gender: "female", scene: "nightlife", slot: "top",
    direction: directions.polished.top, availableSignals: ["年轻", "设计感"],
  });
  assert.equal(active.enabled, true);
  for (const input of [
    {gender: "female", scene: "casual_social"},
    {gender: "female", scene: "elevated_social"},
    {gender: "male", scene: "casual_social"},
    {gender: "male", scene: "date_social"},
    {gender: "male", scene: "nightlife"},
  ]) {
    assert.equal(resolveFemaleNightlifeCandidateExpression({
      ...input, slot: "top", direction: directions.polished.top,
    }).enabled, false);
  }
});

test("female nightlife Q1 stays high recall and Q2 carries one expression", () => {
  const expectedSignals = {
    polished: {top: "设计感", bottom: "高腰", shoes: "时髦"},
    relaxed: {top: "设计感", bottom: "垂感", shoes: "设计感"},
    expressive: {top: "设计感", bottom: "高腰", shoes: "设计感"},
  };
  for (const name of Object.keys(directions)) {
    for (const slot of ["top", "bottom", "shoes"]) {
      const plan = planConceptSearchQueries({
        decisionContext: context(),
        lookConcept: concept(name, slot),
        slot,
      });
      const [q1, q2] = plan.query_candidates;
      assert.equal(q1.searchable_signal_budget.aesthetic_terms, 0);
      assert.equal(q2.aesthetic_signal, expectedSignals[name][slot]);
      assert.equal(q2.searchable_signal_budget.aesthetic_terms, 1);
      assert.equal(q2.searchable_signal_budget.max_aesthetic_terms, 1);
      assert.equal(q2.query, `${q1.query} ${q2.aesthetic_signal}`);
      assert.equal(plan.trace.candidate_expression_supply.enabled, true);
    }
  }
});

test("pending scenes retain the general query planner behavior", () => {
  const plan = planConceptSearchQueries({
    decisionContext: context("female", "casual_social"),
    lookConcept: {...concept("polished", "top"), scene_fit: "casual_social"},
    slot: "top",
  });
  assert.equal(plan.trace.candidate_expression_supply.enabled, false);
  assert.equal(plan.query_candidates[0].query, "女 短袖上衣");
  assert.equal(plan.query_candidates[1].query, "女 短袖上衣 年轻");
});

test("sufficient intent supply is preferred without bypassing downstream gates", () => {
  const contract = resolveFemaleNightlifeCandidateExpression({
    gender: "female", scene: "nightlife", slot: "top",
    direction: directions.polished.top, availableSignals: ["设计感"],
  });
  const highRecall = [{id: "broad-1"}, {id: "broad-2"}];
  const intent = [1, 2, 3, 4].map((id) => ({id: `intent-${id}`}));
  const result = selectExpressionCandidateSupply({
    contract,
    highRecallCandidates: highRecall,
    intentCandidates: intent,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.candidates, intent);
  assert.equal(result.reason, "EXPRESSION_SUPPLY_SUFFICIENT");
});

test("insufficient expression supply retains high-recall candidates", () => {
  const contract = resolveFemaleNightlifeCandidateExpression({
    gender: "female", scene: "nightlife", slot: "shoes",
    direction: directions.expressive.shoes, availableSignals: ["设计感"],
  });
  const highRecall = [{id: "broad"}];
  const intent = [{id: "intent-1"}, {id: "intent-2"}];
  const result = selectExpressionCandidateSupply({
    contract,
    highRecallCandidates: highRecall,
    intentCandidates: intent,
  });
  assert.equal(result.applied, false);
  assert.deepEqual(result.candidates, [...intent, ...highRecall]);
  assert.equal(result.reason, "EXPRESSION_SUPPLY_BELOW_MINIMUM");
});

test("old human-rejected nightlife looks remain non-PASS", () => {
  const rejected = golden.samples.filter(({sample_id}) =>
    sample_id !== golden.positive_sample_id);
  assert.equal(rejected.length, 3);
  assert.equal(rejected.some((sample) =>
    evaluateFemaleNightlifeYouthfulSocialEnergy(sample).status === "PASS"),
  false);
});

test("runtime supply adapter has no item or prescribed-product hardcode", () => {
  const source = fs.readFileSync(path.join(__dirname, "..",
    "female_nightlife_candidate_expression_supply.js"), "utf8");
  assert.doesNotMatch(source,
    /黑丝|玛丽珍|厚底鞋|黑色规则|product_id|candidate_id|title/iu);
});
