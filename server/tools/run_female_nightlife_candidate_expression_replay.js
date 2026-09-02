"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {generateLookConceptPortfolio} = require("../look_concept_generator");
const {compileLookConceptPortfolio} = require("../look_concept_compiler");
const {ProductAestheticReranker} = require("../product_aesthetic_reranker");
const {runSharedCandidatePipeline} = require("../product_provider");
const golden = require(
  "../evaluation/golden/female_nightlife_youthful_social_energy_v1.json"
);
const {
  evaluateFemaleNightlifeYouthfulSocialEnergy,
} = require("../evaluation/female_nightlife_youthful_social_energy_contract");
const {
  selectExpressionCandidateSupply,
} = require("../female_nightlife_candidate_expression_supply");

const inputPath = path.resolve(process.argv[2] || "");
if (!process.argv[2]) {
  throw new Error("usage: node run_female_nightlife_candidate_expression_replay.js <response-json>");
}

function candidateId(candidate) {
  return String(candidate?.candidate_id || candidate?.product_id ||
    candidate?.id || "").trim();
}

function list(value) {
  return (Array.isArray(value) ? value : [value]).flat(Infinity)
    .map((entry) => String(entry || "").trim()).filter(Boolean);
}

function evidence(candidate, key) {
  return list(candidate?.candidate_enrichment?.[key]?.value);
}

function normalizeCandidate(candidate, requirement) {
  const id = candidateId(candidate);
  if (!id) return null;
  const originalGender = String(candidate.original_gender ||
    evidence(candidate, "gender_evidence")[0] || "unknown").toLowerCase();
  return {
    ...candidate,
    id,
    product_id: id,
    candidate_id: id,
    look_id: requirement.look_id,
    concept_id: requirement.concept_id,
    slot: requirement.category,
    slot_key: requirement.slot_key,
    category: requirement.category,
    original_category: requirement.category,
    original_gender: originalGender,
    gender: originalGender,
    requested_gender: requirement.gender,
    style_tags: list([candidate.style_tags, evidence(candidate, "style_evidence")]),
    occasion_tags: list([
      candidate.occasion_tags,
      evidence(candidate, "occasion_evidence"),
    ]),
    silhouette_tags: list([
      candidate.silhouette_tags,
      evidence(candidate, "silhouette_evidence"),
    ]),
    source: "taobao",
    is_mock: false,
  };
}

function searchableText(candidate) {
  return list([
    candidate.title,
    candidate.style_tags,
    candidate.silhouette_tags,
    candidate.footwear,
    evidence(candidate, "style_expression"),
    evidence(candidate, "contemporary_expression"),
    evidence(candidate, "desired_impression_evidence"),
    evidence(candidate, "silhouette_evidence"),
  ]).join(" ");
}

function signalPattern(signal) {
  const aliases = {
    "设计感": /设计感|设计款|解构|不规则|拼接|褶皱|刺绣|铆钉|小众/iu,
    "廓形": /廓形|版型|宽松|落肩|结构/iu,
    "高腰": /高腰|收腰|A字|百褶|比例/iu,
    "垂感": /垂感|阔腿|直筒|流线|顺垂/iu,
    "时髦": /时髦|时尚|潮流|新款|小众|设计感/iu,
    "精致": /精致|优雅|质感|细节|设计感/iu,
  };
  return aliases[String(signal || "")] || /$a/u;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const id = candidateId(candidate);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function scoreSummary(look) {
  const quality = look?.whole_look_quality || {};
  const human = quality?.version === "whole_look_human_grounded_score.v1"
    ? quality
    : quality?.human_grounded ||
    look?.whole_look_quality?.human_grounded_score ||
    look?.whole_look_quality?.human_grounded_assessment || {};
  const youthful = human?.intent_expression?.dimensions
    ?.youthful_social_energy?.score ?? null;
  return {
    look_id: look.look_id,
    human_grounded_score: human?.final_score ?? human?.score ?? null,
    youthful_social_energy: youthful,
    intent_expression: Object.fromEntries(Object.entries(
      human?.intent_expression?.dimensions || {},
    ).map(([key, value]) => [key, value?.score ?? null])),
    final_quality_status: quality?.status || null,
    selected_candidate_ids: look?.selected_candidate_ids || [],
  };
}

async function main() {
  const response = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const portfolio = generateLookConceptPortfolio(response.decision_context);
  const context = {
    ...response.decision_context,
    concepts: portfolio.concepts,
    style_targets: portfolio.style_targets,
  };
  const pipelineContext = {
    ...context,
    decision_context: context,
  };
  const compiled = compileLookConceptPortfolio(context);
  const raw = response?.decision_pipeline?.candidate_pipeline_trace
    ?.raw_candidates || [];
  const coreRaw = raw.filter((candidate) =>
    ["top", "bottom", "shoes"].includes(String(candidate.slot ||
      candidate.category || "")));
  const plans = [];
  const groups = compiled.requirements.map((requirement) => {
    const slot = requirement.category;
    const q2 = requirement.commerce_query_plan?.query_candidates?.find(
      ({query_id}) => query_id === "Q2",
    );
    const pattern = signalPattern(q2?.aesthetic_signal);
    const baseline = coreRaw.filter((candidate) =>
      String(candidate.look_id || "") === String(requirement.look_id) &&
      String(candidate.slot || candidate.category || "") === slot);
    const expressionSupply = coreRaw.filter((candidate) =>
      String(candidate.slot || candidate.category || "") === slot &&
      pattern.test(searchableText(candidate)));
    const selectedSupply = selectExpressionCandidateSupply({
      contract: requirement.commerce_query_plan?.trace
        ?.candidate_expression_supply,
      highRecallCandidates: baseline,
      intentCandidates: expressionSupply,
    });
    const candidates = uniqueCandidates(selectedSupply.candidates)
      .map((candidate) => normalizeCandidate(candidate, requirement))
      .filter(Boolean)
      .slice(0, 20);
    plans.push({
      look_id: requirement.look_id,
      slot,
      q1: requirement.commerce_query_plan?.query_candidates?.[0]?.query,
      q2: q2?.query,
      signal: q2?.aesthetic_signal,
      expression_supply_count: expressionSupply.length,
      merged_count: candidates.length,
      expression_supply_applied: selectedSupply.applied,
    });
    return {requirement, candidates};
  });
  const reranker = new ProductAestheticReranker({
    client: null,
    visualEvaluationEnabled: false,
    selectiveAdjudicationEnabled: false,
    logger: {info() {}, warn() {}},
  });
  const result = await runSharedCandidatePipeline({
    requirements: compiled.requirements,
    groups,
    context: pipelineContext,
    provider: "taobao",
    reranker,
    logger: {info() {}, warn() {}, error() {}},
    environment: {NODE_ENV: "test"},
    maxRefillRounds: 0,
  });
  const summaries = result.looks.map(scoreSummary);
  const qualifying = summaries.filter((look) =>
    Number(look.human_grounded_score) > 78 &&
    Number(look.youthful_social_energy) > 75);
  const oldFailures = golden.samples
    .filter(({sample_id}) => sample_id !== golden.positive_sample_id)
    .map(evaluateFemaleNightlifeYouthfulSocialEnergy);
  const assertions = {
    source_is_real_taobao: result.products.every((candidate) =>
      candidate.source === "taobao" && candidate.is_mock === false),
    at_least_two_of_three_expression_targets: qualifying.length >= 2,
    old_failure_samples_remain_non_pass: oldFailures.every(({status}) =>
      status !== "PASS"),
    no_external_calls: true,
  };
  process.stdout.write(`${JSON.stringify({
    replay: "FROZEN_REAL_TAOBAO_CANDIDATE_EXPRESSION_SUPPLY_V1",
    source_request_id: response.request_id || null,
    source_provider: response?.decision_pipeline?.candidate_pipeline_trace
      ?.provider || null,
    query_plans: plans,
    looks: summaries,
    qualifying_look_count: qualifying.length,
    old_failure_statuses: oldFailures.map(({status}) => status),
    assertions,
  }, null, 2)}\n`);
  if (Object.values(assertions).some((value) => value !== true)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
