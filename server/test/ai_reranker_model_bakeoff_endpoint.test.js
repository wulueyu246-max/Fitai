"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS,
  AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS,
  AI_RERANKER_MODEL_BAKEOFF_MODELS,
  AI_RERANKER_MODEL_BAKEOFF_PATH,
  QUALITY_CONTRACTS,
  aiRerankerModelBakeoffEnabled,
  createAiRerankerModelBakeoffHandler,
  executeAiRerankerModelBakeoff,
} = require("../ai_reranker_model_bakeoff_endpoint");

const TOKEN = "model-bakeoff-probe-token-at-least-32-characters";
const API_SECRET = "dashscope-secret-never-returned-or-logged";
const BASE_ENVIRONMENT = Object.freeze({
  RENDER: "true",
  ENABLE_AI_RERANKER_MODEL_BAKEOFF: "true",
  INTERNAL_PROBE_TOKEN: TOKEN,
  OPENAI_API_KEY: API_SECRET,
});
const silentLogger = Object.freeze({info() {}, warn() {}, error() {}});

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    writableEnded: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.writableEnded = true;
      return this;
    },
  };
}

function request({token = TOKEN, body = {}} = {}) {
  return {
    headers: token === null ? {} : {authorization: `Bearer ${token}`},
    body,
  };
}

function fakeClock() {
  let current = Date.UTC(2026, 7, 30, 0, 0, 0);
  const clock = () => current;
  clock.advance = (milliseconds) => { current += milliseconds; };
  return clock;
}

function judgment(candidateId) {
  const values = {
    "q4-a": ["PASS", "PASS", "PASS", "PASS", "PASS", "KEEP"],
    "q5-a": ["PASS", "MIXED", "PASS", "PASS", "PASS", "KEEP"],
    "q6-a": ["PASS", "MIXED", "FAIL", "FAIL", "MIXED", "REJECT"],
    "q1-a": ["PASS", "PASS", "PASS", "PASS", "PASS", "KEEP"],
    "q1-b": ["MIXED", "MIXED", "MIXED", "FAIL", "MIXED", "KEEP"],
    "q2-a": ["PASS", "PASS", "PASS", "PASS", "PASS", "KEEP"],
    "q2-b": ["MIXED", "MIXED", "MIXED", "FAIL", "MIXED", "KEEP"],
    "q3-a": ["PASS", "PASS", "PASS", "PASS", "PASS", "KEEP"],
    "q3-b": ["FAIL", "PASS", "FAIL", "FAIL", "MIXED", "REJECT"],
  };
  const fallback = ["PASS", "PASS", "PASS", "PASS", "PASS", "KEEP"];
  const [
    audience_fit,
    contemporary_fit,
    occasion_fit,
    desired_impression_fit,
    visual_quality,
    decision,
  ] = values[candidateId] || fallback;
  return {
    candidate_id: candidateId,
    audience_fit,
    contemporary_fit,
    occasion_fit,
    desired_impression_fit,
    visual_quality,
    decision,
    short_reason: "Evidence aligned.",
  };
}

function fakeClient(clock, {
  unavailableModel = null,
  transientFailureModel = null,
  degradeContract = false,
} = {}) {
  const calls = [];
  const client = {
    chat: {
      completions: {
        async create(payload, options) {
          const userPayload = JSON.parse(payload.messages[1].content);
          const ids = userPayload.candidates.map(({candidate_id: id}) => id);
          calls.push({payload, options, ids});
          if (payload.model === unavailableModel &&
              calls.filter(({payload: call}) => call.model === unavailableModel)
                .length === 1) {
            const error = new Error("not exposed");
            error.status = 404;
            throw error;
          }
          if (payload.model === transientFailureModel &&
              calls.filter(({payload: call}) =>
                call.model === transientFailureModel).length === 1) {
            throw new Error("transient upstream failure");
          }
          const modelOffset = AI_RERANKER_MODEL_BAKEOFF_MODELS
            .indexOf(payload.model) * 100;
          clock.advance(400 + ids.length * 100 + modelOffset);
          const evaluations = ids.map((id) => judgment(id));
          if (degradeContract && ids.includes("q1-b")) {
            const weak = evaluations.find(({candidate_id: id}) => id === "q1-b");
            weak.audience_fit = "PASS";
            weak.contemporary_fit = "PASS";
            weak.occasion_fit = "PASS";
            weak.desired_impression_fit = "PASS";
          }
          return {
            choices: [{
              finish_reason: "stop",
              message: {content: JSON.stringify({evaluations})},
            }],
            usage: {completion_tokens: 20 + ids.length * 12},
          };
        },
      },
    },
  };
  return {client, calls};
}

test("bakeoff model list, contracts, path, and hard request limit are fixed", () => {
  assert.equal(
    AI_RERANKER_MODEL_BAKEOFF_PATH,
    "/internal/probes/ai-reranker-model-bakeoff-v1",
  );
  assert.deepEqual(AI_RERANKER_MODEL_BAKEOFF_MODELS, [
    "qwen3.7-flash",
    "qwen3.6-flash",
    "qwen3.5-flash",
  ]);
  assert.equal(QUALITY_CONTRACTS.length, 6);
  assert.deepEqual(
    QUALITY_CONTRACTS.map(({candidates}) => candidates.length),
    [1, 1, 1, 2, 2, 2],
  );
  assert.equal(AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS, 21);
  assert.equal(AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS, 256);
  for (const contract of QUALITY_CONTRACTS) {
    for (const candidate of contract.candidates) {
      assert.match(candidate.candidate_id, /^q[1-6]-[ab]$/);
    }
  }
});

test("bakeoff stays hidden unless flag, Render, and independent token are valid", async () => {
  let calls = 0;
  const client = {chat: {completions: {async create() { calls += 1; }}}};
  const environments = [
    {...BASE_ENVIRONMENT, ENABLE_AI_RERANKER_MODEL_BAKEOFF: "false"},
    {...BASE_ENVIRONMENT, RENDER: "false"},
    {...BASE_ENVIRONMENT, INTERNAL_PROBE_TOKEN: "short"},
    {...BASE_ENVIRONMENT, INTERNAL_PROBE_TOKEN: API_SECRET},
  ];
  for (const environment of environments) {
    const handler = createAiRerankerModelBakeoffHandler({
      environment,
      client,
      provider: "dashscope",
      logger: silentLogger,
    });
    const response = responseRecorder();
    await handler(request(), response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {error: "NOT_FOUND"});
  }
  assert.equal(calls, 0);
  assert.equal(aiRerankerModelBakeoffEnabled(BASE_ENVIRONMENT), true);
});

test("enabled endpoint rejects wrong auth and any caller supplied input", async () => {
  let calls = 0;
  const handler = createAiRerankerModelBakeoffHandler({
    environment: BASE_ENVIRONMENT,
    client: {chat: {completions: {async create() { calls += 1; }}}},
    provider: "dashscope",
    logger: silentLogger,
  });
  for (const token of [null, "wrong-token"]) {
    const response = responseRecorder();
    await handler(request({token}), response);
    assert.equal(response.statusCode, 403);
  }
  const response = responseRecorder();
  await handler(request({body: {model: "caller-controlled"}}), response);
  assert.equal(response.statusCode, 400);
  assert.equal(
    response.body.error_code,
    "AI_RERANKER_MODEL_BAKEOFF_FIXED_INPUT_ONLY",
  );
  assert.equal(calls, 0);
});

test("successful bakeoff makes 18 fixed quality-latency calls plus eligible optional calls", async () => {
  const clock = fakeClock();
  const {client, calls} = fakeClient(clock);
  const result = await executeAiRerankerModelBakeoff({
    client,
    provider: "dashscope",
    logger: silentLogger,
    clock,
  });

  assert.equal(result.probe_status, "SUCCESS");
  assert.equal(result.limits.actual_model_requests, 21);
  assert.equal(result.limits.model_request_limit, 21);
  assert.equal(result.limits.taobao_calls, 0);
  assert.equal(result.limits.outfit_calls, 0);
  assert.equal(result.configuration.max_tokens, 256);
  assert.equal(result.configuration.streaming, false);
  assert.equal(calls.length, 21);
  assert.deepEqual(
    calls.slice(0, 6).map(({payload}) => payload.model),
    [
      "qwen3.7-flash",
      "qwen3.6-flash",
      "qwen3.5-flash",
      "qwen3.6-flash",
      "qwen3.5-flash",
      "qwen3.7-flash",
    ],
  );
  for (const model of AI_RERANKER_MODEL_BAKEOFF_MODELS) {
    const modelCalls = calls.filter(({payload}) => payload.model === model);
    assert.equal(modelCalls.length, 7);
    assert.deepEqual(modelCalls.map(({ids}) => ids.length), [1, 1, 1, 2, 2, 2, 4]);
    for (const call of modelCalls) {
      assert.equal(call.payload.max_tokens, 256);
      assert.equal(call.payload.temperature, 0.2);
      assert.equal(call.payload.stream, false);
      assert.deepEqual(call.payload.response_format, {type: "json_object"});
      assert.equal(call.options.maxRetries, 0);
    }
  }
  for (const report of result.reports) {
    assert.equal(report.actual_availability, true);
    assert.equal(report.availability_status, "AVAILABLE");
    assert.equal(report.quality.executed_count, 6);
    assert.equal(report.quality.pass_count, 6);
    assert.equal(report.quality.pass_rate, 1);
    assert.equal(report.parse_success_rate, 1);
    assert.equal(
      report.latency_distribution_scope,
      "SUCCESSFUL_PARSED_REQUESTS_ONLY",
    );
    assert.equal(report.meets_minimum_p95_3500, true);
    assert.equal(report.eligible_for_product_reranker_experiment, true);
    assert.ok(report.predicted_reranker_latency_ms.six_slots > 0);
    assert.ok(report.predicted_reranker_latency_ms.nine_slots > 0);
    assert.equal(report.latency.find(({candidate_count: count}) => count === 1).sample_count, 3);
    assert.equal(report.latency.find(({candidate_count: count}) => count === 2).sample_count, 3);
    assert.equal(report.latency.find(({candidate_count: count}) => count === 4).sample_count, 1);
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(API_SECRET), false);
  assert.equal(serialized.includes("messages"), false);
  assert.equal(serialized.includes("authorization"), false);
});

test("first actual call is an availability canary and failed models are skipped", async () => {
  const clock = fakeClock();
  const unavailableModel = "qwen3.6-flash";
  const {client, calls} = fakeClient(clock, {unavailableModel});
  const result = await executeAiRerankerModelBakeoff({
    client,
    provider: "dashscope",
    logger: silentLogger,
    clock,
  });
  const unavailable = result.reports.find(({model}) => model === unavailableModel);
  assert.equal(unavailable.actual_availability, false);
  assert.equal(unavailable.availability_status, "UNAVAILABLE");
  assert.equal(unavailable.availability_reason, "MODEL_NOT_AVAILABLE");
  assert.equal(
    calls.filter(({payload}) => payload.model === unavailableModel).length,
    1,
  );
  assert.equal(result.limits.actual_model_requests, 15);
});

test("a transient canary failure does not masquerade as account model unavailability", async () => {
  const clock = fakeClock();
  const transientFailureModel = "qwen3.6-flash";
  const {client, calls} = fakeClient(clock, {transientFailureModel});
  const result = await executeAiRerankerModelBakeoff({
    client,
    provider: "dashscope",
    logger: silentLogger,
    clock,
  });
  const report = result.reports.find(({model}) => model === transientFailureModel);
  assert.equal(report.actual_availability, true);
  assert.equal(report.availability_status, "AVAILABLE");
  assert.equal(report.availability_reason, "COMPLETE_REAL_MODEL_RESPONSE");
  assert.equal(report.quality.executed_count, 6);
  assert.equal(report.quality.pass_count, 5);
  assert.equal(report.eligible_for_product_reranker_experiment, false);
  assert.equal(
    calls.filter(({payload}) => payload.model === transientFailureModel).length,
    7,
  );
});

test("quality eligibility requires every contract field assertion, not parse alone", async () => {
  const clock = fakeClock();
  const {client} = fakeClient(clock, {degradeContract: true});
  const result = await executeAiRerankerModelBakeoff({
    client,
    provider: "dashscope",
    logger: silentLogger,
    clock,
  });
  for (const report of result.reports) {
    assert.equal(report.parse_success_rate, 1);
    assert.equal(report.quality.pass_count, 5);
    assert.equal(report.eligible_for_product_reranker_experiment, false);
    const failed = report.quality.contracts.find(
      ({contract_id: id}) => id ===
        "YOUNG_MALE_DATE_MODERN_OVER_TRADITIONAL",
    );
    assert.equal(failed.success, true);
    assert.equal(failed.pass, false);
    assert.equal(failed.relation_assertions[0].pass, false);
  }
});

test("safe logger never receives prompts, outputs, tokens, or provider errors", async () => {
  const clock = fakeClock();
  const {client} = fakeClient(clock);
  const logs = [];
  const logger = {
    info(message, details) { logs.push({message, details}); },
    warn(message, details) { logs.push({message, details}); },
    error(message, details) { logs.push({message, details}); },
  };
  await executeAiRerankerModelBakeoff({client, provider: "dashscope", logger, clock});
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.includes(API_SECRET), false);
  assert.equal(serialized.includes("prompt"), false);
  assert.equal(serialized.includes("output"), false);
  assert.equal(serialized.includes("title"), false);
  for (const {details} of logs) {
    assert.deepEqual(
      Object.keys(details).sort(),
      [
        "candidate_count",
        "failure_reason",
        "model",
        "scenario_id",
        "success",
        "total_latency_ms",
      ].filter((key) => details[key] !== undefined).sort(),
    );
  }
});
