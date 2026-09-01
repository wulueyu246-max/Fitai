"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attachTargetFitAssessment,
  buildTargetFitAssessment,
} = require("../target_fit_assessment");
const {scoreProduct} = require("../product_relevance");
const {evaluateProductAcceptance} = require("../product_acceptance_gate");

function evidence(value, confidence = 0.9, source = "explicit_text_evidence") {
  const values = Array.isArray(value) ? value : [value];
  return {
    value,
    confidence,
    source,
    evidence: values.map((entry) => `product_text:${entry}`),
  };
}

function product(overrides = {}) {
  return {
    id: "taobao-target-fit-1",
    product_id: "taobao-target-fit-1",
    title: "不规则拼接设计感短款女上衣",
    category: "top",
    gender: "female",
    original_gender: "female",
    source: "taobao",
    is_mock: false,
    candidate_enrichment: {
      gender_evidence: evidence("female", 0.98),
      style_evidence: evidence(["design_expression"]),
      style_expression: evidence(["design_expression"]),
      contemporary_expression: evidence(["contemporary"]),
      occasion_expression: evidence(["nightlife_social"]),
      occasion_evidence: evidence(["party"]),
      desired_impression_evidence: evidence(["design_led", "youthful"]),
      silhouette_evidence: evidence(["cropped", "fitted"]),
      color_evidence: evidence(["white"]),
      material_evidence: evidence(["cotton_mention"]),
      quality_evidence: evidence(["立体剪裁"]),
      audience_expression: evidence(["youthful"]),
      footwear_evidence: evidence([]),
    },
    ...overrides,
  };
}

function requirement(overrides = {}) {
  return {
    look_id: "look-1",
    category: "top",
    gender: "female",
    scene: "nightlife",
    desired_impression: ["年轻", "有设计感"],
    color: "white",
    negative_keywords: [],
    avoid_attributes: [],
    required_attributes: [],
    preferred_attributes: [],
    aesthetic_target_profile: {
      version: "aesthetic_target_profile_v1",
      style_targets: [],
      compatible_styles: [],
      conflicting_styles: [],
      dimensions: {design_interest: 0.8, youthfulness: 0.8, color_intensity: 0.25},
      silhouette_targets: {structure: 0.55, waist_emphasis: 0.8, volume: 0.35, verticality: 0.66},
      color_targets: {intensity: 0.25},
      quality_target: 0.58,
      footwear_targets: {formality: 0.4, sportiness: 0.3, toe_refinement: 0.6, material_quality: 0.5},
      weights: {style_coherence: 1},
    },
    ...overrides,
  };
}

test("materializes product evidence into canonical target fit", () => {
  const assessment = buildTargetFitAssessment(product(), requirement());
  assert.equal(assessment.version, "target_fit_assessment_v1");
  assert.ok(assessment.style_fit.score > 80);
  assert.ok(assessment.contemporary_fit.score > 80);
  assert.ok(assessment.occasion_fit.score > 70);
  assert.ok(assessment.desired_impression_fit.score > 80);
  assert.match(assessment.style_fit.source, /explicit_text_evidence/);
});

test("missing evidence remains unknown neutral", () => {
  const assessment = buildTargetFitAssessment({category: "top"}, requirement());
  assert.equal(assessment.style_fit.status, "UNKNOWN");
  assert.equal(assessment.style_fit.score, 50);
  assert.equal(assessment.style_fit.confidence, 0);
});

test("relevance consumes canonical target fit instead of title regex", () => {
  const assessed = attachTargetFitAssessment(product(), requirement());
  const ranked = scoreProduct(assessed, requirement(), "女上衣 设计感");
  assert.ok(ranked.target_fit_relevance_score > 70);
  assert.ok(ranked.relevance_score > 35);
});

test("acceptance gate consumes the same canonical evidence", () => {
  const assessed = attachTargetFitAssessment(product(), requirement());
  const result = evaluateProductAcceptance(assessed, requirement());
  assert.equal(result.product.target_fit_assessment.version,
    "target_fit_assessment_v1");
  assert.ok(result.product.product_acceptance_evidence.desired_impression_fit
    .target_fit_score > 80);
});

test("high-confidence product evidence is not overwritten by stale defaults", () => {
  const assessed = attachTargetFitAssessment(product({
    style_fit_score: 40,
    desired_impression_fit_score: 40,
    occasion_fit_score: 35,
  }), requirement());
  assert.ok(assessed.target_fit_assessment.style_fit.score > 80);
  assert.ok(assessed.target_fit_assessment.desired_impression_fit.score > 80);
  assert.ok(assessed.target_fit_assessment.occasion_fit.score > 70);
});

test("raw title evidence remains product-authored", () => {
  const assessed = attachTargetFitAssessment(product(), requirement());
  const allEvidence = JSON.stringify(assessed.target_fit_assessment);
  assert.match(allEvidence, /product_text/);
  assert.doesNotMatch(allEvidence, /requirement_as_product_fact/);
});
