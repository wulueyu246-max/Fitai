"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require(
  "../evaluation/golden/human_feedback_component_replacement_v1.json"
);
const {
  PIPELINE_STAGES,
  replaceLookComponents,
  replacementGoals,
} = require("../human_feedback_guided_component_replacement");

async function runFixture(overrides = {}) {
  const retrievalCalls = [];
  const result = await replaceLookComponents({
    originalLook: fixture.original_look,
    feedback: fixture.feedback,
    retrieveCandidates: async ({slot, ...request}) => {
      retrievalCalls.push({slot, ...request});
      return {
        queries: [{query: `frozen-${slot}-replacement`}],
        candidates: structuredClone(fixture.retrieval[slot] || []),
      };
    },
    runCandidatePipeline: overrides.runCandidatePipeline || (async ({candidates}) => ({
      stages: PIPELINE_STAGES,
      candidates,
    })),
    assessCombination: async ({components}) => {
      const key = `${components.top.product_id}|${components.shoes.product_id}`;
      return {...fixture.assessments[key], components};
    },
  });
  return {result, retrievalCalls};
}

test("accepted bottom and headwear are locked while only top and shoes retrieve", async () => {
  const {result, retrievalCalls} = await runFixture();

  assert.equal(result.core_component_locked, true);
  assert.deepEqual([...result.locked_slots].sort(), ["bottom", "headwear"]);
  assert.deepEqual([...result.replacement_slots].sort(), ["shoes", "top"]);
  assert.deepEqual(retrievalCalls.map(({slot}) => slot).sort(), ["shoes", "top"]);
  assert.equal(result.selected_look.components.bottom.product_id,
    fixture.original_look.components.bottom.product_id);
  assert.equal(result.selected_look.components.headwear.product_id,
    fixture.original_look.components.headwear.product_id);
  assert.equal(result.selected_look.components.bottom.core_component_locked, true);
  assert.equal(result.selected_look.components.headwear.core_component_locked, true);
});

test("replacement goals score component relationships rather than isolated items", () => {
  assert.deepEqual(replacementGoals("top"), [
    "top_bottom_harmony", "color_story", "style_language_coherence",
    "scene_expression", "design_interest",
  ]);
  assert.deepEqual(replacementGoals("shoes"), [
    "personal_aesthetic_fit", "bottom_shoes_harmony", "footwear_contribution",
    "contemporary_expression", "scene_fit",
  ]);
});

test("frozen real-Taobao replacement improves all required human-grounded checks", async () => {
  const {result} = await runFixture();
  const selected = result.selected_look;

  assert.equal(result.status, "PASS");
  assert.equal(selected.assessment.top_bottom_harmony >= 60, true);
  assert.equal(selected.assessment.color_story >= 60, true);
  assert.equal(selected.assessment.style_language_coherence >= 60, true);
  assert.ok(selected.assessment.personal_aesthetic_fit >
    fixture.original_look.relationships.personal_aesthetic_fit);
  assert.ok(selected.assessment.final_human_grounded_score > 73.89);
  assert.equal(selected.assessment.final_human_grounded_score, 81.42);
  assert.equal(Object.values(selected.components).every((component) =>
    component.source === "taobao" && component.is_mock === false), true);
});

test("soft-rejected candidates are never restored to fill replacement supply", async () => {
  const {result} = await runFixture();
  const selectedIds = Object.values(result.selected_look.components)
    .map(({product_id}) => product_id);

  assert.equal(selectedIds.includes(
    "Y0mD5jasptXKwRrRRPU7B2C2t6-88aGpnNaF5pJkaKZjHb",
  ), false);
  assert.equal(result.pipeline_trace.find(({slot}) => slot === "shoes").keep_count, 1);
});

test("replacement requires the complete original candidate pipeline", async () => {
  await assert.rejects(runFixture({
    runCandidatePipeline: async ({candidates}) => ({
      stages: ["RETRIEVAL", "ENRICHMENT", "RELEVANCE", "RERANKER"],
      candidates,
    }),
  }), (error) => {
    assert.equal(error.code, "REPLACEMENT_PIPELINE_INCOMPLETE");
    assert.deepEqual(error.details.missingStages, ["ACCEPTANCE_GATE"]);
    return true;
  });
});

test("a relationship-valid but non-improving combination is not accepted", async () => {
  const original = structuredClone(fixture.original_look);
  original.final_human_grounded_score = 90;
  const result = await replaceLookComponents({
    originalLook: original,
    feedback: fixture.feedback,
    retrieveCandidates: async ({slot}) => ({
      queries: [], candidates: structuredClone(fixture.retrieval[slot] || []),
    }),
    runCandidatePipeline: async ({candidates}) => ({
      stages: PIPELINE_STAGES, candidates,
    }),
    assessCombination: async ({components}) => ({
      ...fixture.assessments[
        `${components.top.product_id}|${components.shoes.product_id}`
      ],
      components,
    }),
  });

  assert.equal(result.status, "FAIL");
  assert.ok(result.rejection_reasons.includes(
    "FINAL_HUMAN_GROUNDED_SCORE_IMPROVED",
  ));
});
