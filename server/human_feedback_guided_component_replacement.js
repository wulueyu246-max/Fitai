"use strict";

const REPLACEMENT_VERSION = "human_feedback_guided_component_replacement.v1";
const PIPELINE_STAGES = Object.freeze([
  "RETRIEVAL",
  "ENRICHMENT",
  "RELEVANCE",
  "ACCEPTANCE_GATE",
  "RERANKER",
]);
const RELATIONSHIP_FLOOR = 60;
const MATERIAL_IMPROVEMENT = 10;
const MAX_CANDIDATES_PER_SLOT = 6;
const MAX_COMBINATIONS = 36;

async function replaceLookComponents({
  originalLook,
  feedback,
  retrieveCandidates,
  runCandidatePipeline,
  assessCombination,
} = {}) {
  validateDependencies({retrieveCandidates, runCandidatePipeline, assessCombination});
  const original = normalizeLook(originalLook);
  const decisions = feedback?.components || {};
  const lockedSlots = Object.keys(original.components).filter((slot) =>
    normalizeVerdict(decisions[slot]?.verdict) === "ACCEPT");
  const replacementSlots = Object.keys(original.components).filter((slot) =>
    normalizeVerdict(decisions[slot]?.verdict) === "FAIL");
  if (replacementSlots.length === 0) {
    return frozenResult("NO_REPLACEMENT_REQUIRED", original, lockedSlots, []);
  }

  const lockedComponents = Object.fromEntries(lockedSlots.map((slot) => [
    slot,
    lockComponent(original.components[slot]),
  ]));
  const pipelineTrace = [];
  const candidatesBySlot = {};

  for (const slot of replacementSlots) {
    const retrieval = await retrieveCandidates({
      slot,
      locked_components: lockedComponents,
      replacement_goals: replacementGoals(slot),
      rejected_component: original.components[slot],
      feedback: decisions[slot] || null,
    });
    const rawCandidates = array(retrieval?.candidates).filter((candidate) =>
      candidate?.source === "taobao" && candidate?.is_mock === false &&
      normalizeSlot(candidate.slot || candidate.category) === slot);
    const processed = await runCandidatePipeline({
      slot,
      candidates: rawCandidates,
      locked_components: lockedComponents,
      replacement_goals: replacementGoals(slot),
    });
    const stages = unique(array(processed?.stages).map(normalizeStage));
    const missingStages = PIPELINE_STAGES.filter((stage) => !stages.includes(stage));
    if (missingStages.length > 0) {
      throw contractError("REPLACEMENT_PIPELINE_INCOMPLETE", {slot, missingStages});
    }
    const candidates = array(processed?.candidates).filter((candidate) =>
      candidate?.source === "taobao" && candidate?.is_mock === false &&
      normalizeSlot(candidate.slot || candidate.category) === slot &&
      !isRejected(candidate)).slice(0, MAX_CANDIDATES_PER_SLOT);
    candidatesBySlot[slot] = candidates;
    pipelineTrace.push(Object.freeze({
      slot,
      query_plan: array(retrieval?.queries),
      raw_count: rawCandidates.length,
      stages: Object.freeze(stages),
      keep_count: candidates.length,
    }));
  }

  if (replacementSlots.some((slot) => candidatesBySlot[slot].length === 0)) {
    return frozenResult(
      "INSUFFICIENT_QUALITY_REPLACEMENT_CANDIDATES",
      original,
      lockedSlots,
      pipelineTrace,
    );
  }

  const combinations = boundedProduct(
    replacementSlots.map((slot) => candidatesBySlot[slot]),
    MAX_COMBINATIONS,
  );
  const evaluated = [];
  for (const replacements of combinations) {
    const components = {...lockedComponents};
    replacementSlots.forEach((slot, index) => {
      components[slot] = freezeCandidate(replacements[index]);
    });
    const assessment = normalizeCombinationAssessment(await assessCombination({
      components,
      original_look: original,
      feedback,
    }));
    const checks = replacementChecks({assessment, original, lockedComponents});
    evaluated.push(Object.freeze({
      components: deepFreeze(components),
      assessment,
      checks,
      passed: Object.values(checks).every(Boolean),
    }));
  }
  evaluated.sort((left, right) =>
    (right.assessment.final_human_grounded_score || 0) -
    (left.assessment.final_human_grounded_score || 0));
  const selected = evaluated.find(({passed}) => passed) || null;

  return deepFreeze({
    version: REPLACEMENT_VERSION,
    status: selected ? "PASS" : "FAIL",
    core_component_locked: true,
    locked_slots: lockedSlots,
    replacement_slots: replacementSlots,
    original_score: original.final_human_grounded_score,
    selected_look: selected,
    evaluated_combination_count: evaluated.length,
    pipeline_trace: pipelineTrace,
    rejection_reasons: selected ? [] : rejectionReasons(evaluated[0]),
  });
}

function replacementGoals(slot) {
  if (slot === "top") return Object.freeze([
    "top_bottom_harmony",
    "color_story",
    "style_language_coherence",
    "scene_expression",
    "design_interest",
  ]);
  if (slot === "shoes") return Object.freeze([
    "personal_aesthetic_fit",
    "bottom_shoes_harmony",
    "footwear_contribution",
    "contemporary_expression",
    "scene_fit",
  ]);
  return Object.freeze(["component_relationship_fit"]);
}

function replacementChecks({assessment, original, lockedComponents}) {
  const originalRelationships = original.relationships;
  return Object.freeze({
    locked_components_unchanged: Object.entries(lockedComponents).every(
      ([slot, component]) => identity(component) === identity(original.components[slot]),
    ),
    top_bottom_harmony_pass:
      assessment.top_bottom_harmony >= RELATIONSHIP_FLOOR,
    color_story_pass_or_improved:
      passOrImproved(assessment.color_story, originalRelationships.color_story),
    style_language_coherence_pass_or_improved:
      passOrImproved(
        assessment.style_language_coherence,
        originalRelationships.style_language_coherence,
      ),
    shoes_personal_aesthetic_improved:
      assessment.personal_aesthetic_fit > originalRelationships.personal_aesthetic_fit,
    final_human_grounded_score_improved:
      assessment.final_human_grounded_score > original.final_human_grounded_score,
    real_taobao_only: Object.values(assessment.components).every((component) =>
      component.source === "taobao" && component.is_mock === false),
  });
}

function passOrImproved(value, originalValue) {
  return value >= RELATIONSHIP_FLOOR || value >= Number(originalValue) + MATERIAL_IMPROVEMENT;
}

function normalizeCombinationAssessment(value) {
  const source = value && typeof value === "object" ? value : {};
  return deepFreeze({
    components: source.components || {},
    top_bottom_harmony: finite(source.top_bottom_harmony),
    bottom_shoes_harmony: finite(source.bottom_shoes_harmony),
    top_shoes_harmony: finite(source.top_shoes_harmony),
    color_story: finite(source.color_story),
    style_language_coherence: finite(source.style_language_coherence),
    scene_expression: finite(source.scene_expression),
    design_interest: finite(source.design_interest),
    personal_aesthetic_fit: finite(source.personal_aesthetic_fit),
    footwear_contribution: finite(source.footwear_contribution),
    contemporary_expression: finite(source.contemporary_expression),
    scene_fit: finite(source.scene_fit),
    final_human_grounded_score: finite(source.final_human_grounded_score),
    evidence: deepFreeze(source.evidence || {}),
  });
}

function normalizeLook(value) {
  const source = value && typeof value === "object" ? value : {};
  const components = source.components && typeof source.components === "object"
    ? source.components : {};
  return deepFreeze({
    look_id: String(source.look_id || "replacement-look"),
    components: deepFreeze({...components}),
    final_human_grounded_score: finite(source.final_human_grounded_score),
    relationships: deepFreeze({...source.relationships}),
  });
}

function lockComponent(component) {
  return deepFreeze({...component, core_component_locked: true});
}

function freezeCandidate(candidate) {
  return deepFreeze({...candidate, core_component_locked: false});
}

function frozenResult(status, original, lockedSlots, trace) {
  return deepFreeze({
    version: REPLACEMENT_VERSION,
    status,
    core_component_locked: true,
    locked_slots: lockedSlots,
    replacement_slots: [],
    original_score: original.final_human_grounded_score,
    selected_look: null,
    evaluated_combination_count: 0,
    pipeline_trace: trace,
    rejection_reasons: [status],
  });
}

function boundedProduct(groups, limit) {
  let combinations = [[]];
  for (const group of groups) {
    const next = [];
    for (const combination of combinations) {
      for (const candidate of group) {
        next.push([...combination, candidate]);
        if (next.length >= limit) break;
      }
      if (next.length >= limit) break;
    }
    combinations = next;
  }
  return combinations;
}

function rejectionReasons(evaluation) {
  if (!evaluation) return ["NO_REPLACEMENT_COMBINATION"];
  return Object.entries(evaluation.checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key.toUpperCase());
}

function isRejected(candidate) {
  return candidate.product_acceptance_result === "HARD_REJECT" ||
    candidate.product_acceptance_result === "SOFT_REJECT" ||
    candidate.gate_pass === false;
}

function identity(component = {}) {
  return String(component.product_id || component.candidate_id || component.id || "");
}

function normalizeVerdict(value) {
  return String(value || "UNKNOWN").trim().toUpperCase();
}

function normalizeSlot(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStage(value) {
  return String(value || "").trim().toUpperCase();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function validateDependencies(dependencies) {
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== "function") throw contractError("DEPENDENCY_REQUIRED", {name});
  }
}

function contractError(code, details) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  MAX_CANDIDATES_PER_SLOT,
  MAX_COMBINATIONS,
  PIPELINE_STAGES,
  REPLACEMENT_VERSION,
  replaceLookComponents,
  replacementGoals,
};
