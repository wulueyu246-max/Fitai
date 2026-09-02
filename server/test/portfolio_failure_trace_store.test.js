"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PORTFOLIO_FAILURE_TRACE_VERSION,
  PortfolioFailureTraceStore,
  buildPortfolioFailureTrace,
} = require("../portfolio_failure_trace_store");
const {
  persistPortfolioFailureTrace,
} = require("../new_decision_pipeline");

function validationFixture() {
  return {
    validation_trace: {
      validator_input_look_count: 3,
      quality_valid_look_count: 2,
      pass_count: 0,
      reject_count: 3,
      final_portfolio_failure_reason: "CONCEPT_DIVERSITY_FAILED",
      looks: [{
        concept_id: "concept-1-polished",
        quality_score: 72.41,
        human_grounded_score: 72.41,
        scene_score: 68,
        intent_scores: {
          scene_expression_strength: 68,
          desired_impression_coverage: 70,
          design_interest: 74,
          styling_distinction: 66,
          youthful_social_energy: 77,
        },
        baseline_score: 81,
        portfolio_pass: false,
        first_reject_reason: "CONCEPT_DIVERSITY_FAILED",
        all_reject_reasons: ["CONCEPT_DIVERSITY_FAILED"],
        coreValidation: {errors: ["CONCEPT_DIVERSITY_FAILED"]},
        validator_rules: {
          FINAL_QUALITY: {status: "PASS", actual: {score: 72.41}},
          CONCEPT_DIVERSITY: {status: "FAIL", actual: "FAIL"},
        },
      }],
    },
    api_key: "must-not-survive",
    image_url: "https://example.invalid/private.jpg?diagnostic=discarded",
    raw_user_input: "private user input",
  };
}

test("Portfolio failure trace contract retains only allowlisted diagnostics", () => {
  const trace = buildPortfolioFailureTrace({
    requestId: "542396bb-95e8-48c7-bf68-40deec8d93dc",
    timestamp: "2026-09-02T00:00:00.000Z",
    commitVersion: "52416791fcce6bbf44bea46519393ef5f91cf3ef",
    failureCode: "NEW_DECISION_PORTFOLIO_INVALID",
    validation: validationFixture(),
    token: "must-not-survive",
  });

  assert.equal(trace.trace_version, PORTFOLIO_FAILURE_TRACE_VERSION);
  assert.equal(trace.look_count, 3);
  assert.equal(trace.looks[0].quality_score, 72.41);
  assert.equal(trace.looks[0].human_grounded_score, 72.41);
  assert.equal(trace.looks[0].scene_score, 68);
  assert.equal(trace.looks[0].baseline_score, 81);
  assert.equal(trace.looks[0].intent_scores.design_interest, 74);
  assert.equal(trace.looks[0].intent_scores.color_story, null);
  assert.equal(trace.looks[0].portfolio_validation.status, "FAIL");
  assert.equal(trace.looks[0].portfolio_validation
    .validator_rules.FINAL_QUALITY.status, "PASS");
  assert.equal(trace.looks[0].portfolio_validation
    .validator_rules.CONCEPT_DIVERSITY.status, "FAIL");
  assert.equal(trace.final_portfolio_failure_reason, "CONCEPT_DIVERSITY_FAILED");
  assert.equal(Object.isFrozen(trace), true);
  assert.doesNotMatch(JSON.stringify(trace),
    /must-not-survive|private user input|https?:|image_url|api_key/iu);
});

test("enabled store persists a bounded trace and disabled store changes nothing", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fitai-portfolio-trace-"));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filePath = path.join(directory, "portfolio-failures.json");
  const logEntries = [];
  const logger = {
    error(event, payload) { logEntries.push([event, payload]); },
    warn() {},
  };
  const store = new PortfolioFailureTraceStore({
    enabled: true,
    filePath,
    retentionLimit: 1,
    logger,
  });
  const input = {
    requestId: "542396bb-95e8-48c7-bf68-40deec8d93dc",
    timestamp: "2026-09-02T00:00:00.000Z",
    commitVersion: "52416791fcce6bbf44bea46519393ef5f91cf3ef",
    failureCode: "NEW_DECISION_PORTFOLIO_INVALID",
    validation: validationFixture(),
  };

  assert.equal(await store.persist(input), true);
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].request_id, input.requestId);
  assert.deepEqual(await store.readByRequestId(input.requestId), persisted[0]);
  assert.equal((await store.latest()).commit_version, input.commitVersion);
  assert.equal(logEntries[0][0], "portfolio_failure_trace_persisted");
  assert.doesNotMatch(logEntries[0][1], /token|secret|https?:/iu);

  assert.equal(await store.persist({...input, requestId: "newer-request"}), true);
  const retained = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.deepEqual(retained.map((trace) => trace.request_id), ["newer-request"]);

  const disabledPath = path.join(directory, "disabled.json");
  const disabled = new PortfolioFailureTraceStore({
    enabled: false,
    filePath: disabledPath,
    logger,
  });
  assert.equal(await disabled.persist(input), false);
  await assert.rejects(fs.access(disabledPath), {code: "ENOENT"});
});

test("pipeline failure hook persists once and never turns trace failure into business failure", async () => {
  const calls = [];
  const decisionContext = {request_id: "trace-hook-request"};
  const validation = validationFixture();
  const persisted = await persistPortfolioFailureTrace({
    store: {async persist(input) { calls.push(input); return true; }},
    decisionContext,
    validation,
    failureCode: "NEW_DECISION_PORTFOLIO_INVALID",
    commitVersion: "trace-hook-commit",
    logger: {warn() {}},
  });
  assert.equal(persisted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, decisionContext.request_id);
  assert.equal(calls[0].validation, validation);

  const warnings = [];
  const failed = await persistPortfolioFailureTrace({
    store: {async persist() { throw Object.assign(new Error("disk"), {
      code: "EIO",
    }); }},
    decisionContext,
    validation,
    failureCode: "NEW_DECISION_PORTFOLIO_INVALID",
    commitVersion: "trace-hook-commit",
    logger: {warn(event, value) { warnings.push([event, value]); }},
  });
  assert.equal(failed, false);
  assert.equal(warnings[0][1].error_code, "EIO");
});
