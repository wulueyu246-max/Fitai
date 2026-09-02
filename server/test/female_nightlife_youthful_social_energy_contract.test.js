"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const fixture = require(
  "../evaluation/golden/female_nightlife_youthful_social_energy_v1.json"
);
const {
  ENERGY_COMPONENTS,
  INTENT_EXPRESSION_SCHEMA,
  evaluateFemaleNightlifeYouthfulSocialEnergy,
  evaluatePairwise,
} = require("../evaluation/female_nightlife_youthful_social_energy_contract");

const samples = new Map(fixture.samples.map((sample) => [sample.sample_id, sample]));
const positive = samples.get(fixture.positive_sample_id);
const comparisons = fixture.comparison_sample_ids.map((id) => samples.get(id));

test("youthful social energy is a non-age intent-expression dimension", () => {
  assert.ok(INTENT_EXPRESSION_SCHEMA.some(({key}) =>
    key === "youthful_social_energy"));
  assert.deepEqual(ENERGY_COMPONENTS, [
    "vitality", "focal_point", "memorability", "social_presence",
  ]);
  const prohibitedAgeDimensions = new Set([
    "age", "age_fit", "adult_fit", "age_expression",
  ]);
  assert.equal(INTENT_EXPRESSION_SCHEMA.some(({key}) =>
    prohibitedAgeDimensions.has(key)), false);
});

test("human positive passes while current online looks remain low/medium/low", () => {
  const positiveResult = evaluateFemaleNightlifeYouthfulSocialEnergy(positive);
  const results = comparisons.map(evaluateFemaleNightlifeYouthfulSocialEnergy);
  assert.equal(positiveResult.status, "PASS");
  assert.deepEqual(results.map(({status}) => status), ["FAIL", "MEDIUM", "FAIL"]);
  assert.ok(positiveResult.dimensions.youthful_social_energy.score >= 80);
});

test("the human positive outranks all three current nightlife looks", () => {
  const pairwise = comparisons.map((sample) => evaluatePairwise(positive, sample));
  assert.equal(pairwise.length, 3);
  assert.equal(pairwise.every(({passed}) => passed), true);
  assert.equal(pairwise.every(({win_basis}) =>
    win_basis === "HUMAN_GROUNDED_INTENT_EXPRESSION"), true);
});

test("UNKNOWN energy evidence cannot become a match", () => {
  const modified = structuredClone(positive);
  modified.intent_expression.youthful_social_energy.components.focal_point = {
    status: "UNKNOWN", score: null, source: "evidence_missing",
    confidence: 0, evidence: [],
  };
  const result = evaluateFemaleNightlifeYouthfulSocialEnergy(modified);
  assert.equal(result.status, "FAIL");
  assert.equal(result.score, null);
  assert.ok(result.reason_codes.includes(
    "REQUIRED_EVIDENCE_MISSING:YOUTHFUL_SOCIAL_ENERGY"));
});

test("femininity and footwear category do not proxy footwear statement", () => {
  const sameCategory = comparisons.find(({sample_id}) =>
    sample_id === "online-nightlife-look-2-medium");
  assert.equal(positive.footwear_family, sameCategory.footwear_family);
  const winner = evaluateFemaleNightlifeYouthfulSocialEnergy(positive);
  const other = evaluateFemaleNightlifeYouthfulSocialEnergy(sameCategory);
  assert.ok(winner.dimensions.footwear_statement.score >
    other.dimensions.footwear_statement.score);

  const missing = structuredClone(positive);
  missing.presentation = "feminine";
  missing.intent_expression.footwear_statement = {
    status: "UNKNOWN", score: null, source: "evidence_missing",
    confidence: 0, evidence: [],
  };
  const result = evaluateFemaleNightlifeYouthfulSocialEnergy(missing);
  assert.equal(result.status, "FAIL");
  assert.equal(result.footwear_category_used_as_statement_proxy, false);
});

test("runtime contract contains no product or item-specific rejection rules", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "evaluation",
    "female_nightlife_youthful_social_energy_contract.js"), "utf8");
  assert.doesNotMatch(source, /黑丝|玛丽珍|妈妈|product_id|candidate_id/iu);
});
