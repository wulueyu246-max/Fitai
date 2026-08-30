"use strict";

const crypto = require("node:crypto");

const {
  PROBE_CANDIDATES,
  PROBE_CONTEXT,
  percentile,
} = require("./ai_reranker_latency_probe_endpoint");

const AI_RERANKER_MODEL_BAKEOFF_PATH =
  "/internal/probes/ai-reranker-model-bakeoff-v1";
const AI_RERANKER_MODEL_BAKEOFF_MODELS = Object.freeze([
  "qwen3.7-flash",
  "qwen3.6-flash",
  "qwen3.5-flash",
]);
const AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS = 256;
const AI_RERANKER_MODEL_BAKEOFF_TEMPERATURE = 0.2;
const AI_RERANKER_MODEL_BAKEOFF_RUNS_PER_SIZE = 3;
const AI_RERANKER_MODEL_BAKEOFF_OPTIONAL_FOUR_RUNS = 1;
const AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS = 15_000;
const AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS = 300_000;
const AI_RERANKER_MODEL_BAKEOFF_CONCURRENCY = 1;
const AI_RERANKER_MODEL_BAKEOFF_MIN_P95_MS = 3_500;
const AI_RERANKER_MODEL_BAKEOFF_TARGET_P95_MS = 2_500;
const INTERNAL_PROBE_TOKEN_MIN_LENGTH = 32;
const FIT_VALUES = Object.freeze(["PASS", "MIXED", "FAIL"]);
const DECISION_VALUES = Object.freeze(["KEEP", "REJECT"]);
const SHORT_REASON_MAX_CHARACTERS = 24;

const QUALITY_CONTRACTS = Object.freeze([
  Object.freeze({
    contract_id: "FORMAL_USER_BUSINESS_SHOE_LEGAL",
    context: Object.freeze({
      scene: "formal_business_event",
      desired_impression: Object.freeze(["formal", "polished", "professional"]),
      explicit_avoid: Object.freeze([]),
      concept_summary: "A polished formal business look.",
      slot: "shoes",
    }),
    candidates: Object.freeze([
      qualityCandidate("q4-a", {
        audience: "adult",
        title: "Polished leather business Oxford shoe",
        style: "formal business",
        occasion: "formal business event",
        silhouette: "structured refined profile",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q4-a", {
          audience_fit: ["PASS"],
          contemporary_fit: ["PASS", "MIXED"],
          occasion_fit: ["PASS"],
          desired_impression_fit: ["PASS"],
          visual_quality: ["PASS", "MIXED"],
          decision: ["KEEP"],
        }),
      ]),
    }),
  }),
  Object.freeze({
    contract_id: "TRADITIONAL_USER_TRADITIONAL_SHOE_LEGAL",
    context: Object.freeze({
      scene: "cultural_daily",
      desired_impression: Object.freeze(["traditional", "heritage", "relaxed"]),
      explicit_avoid: Object.freeze([]),
      concept_summary: "A relaxed heritage-inspired traditional look.",
      slot: "shoes",
    }),
    candidates: Object.freeze([
      qualityCandidate("q5-a", {
        audience: "adult traditional-style wearer",
        title: "Handcrafted heritage cloth shoe",
        style: "traditional heritage",
        occasion: "cultural daily wear",
        silhouette: "classic rounded profile",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q5-a", {
          audience_fit: ["PASS"],
          contemporary_fit: ["PASS", "MIXED", "FAIL"],
          occasion_fit: ["PASS"],
          desired_impression_fit: ["PASS"],
          visual_quality: ["PASS", "MIXED"],
          decision: ["KEEP"],
        }),
      ]),
    }),
  }),
  Object.freeze({
    contract_id: "WORK_SHOE_CONFLICTS_WITH_NOT_OFFICE",
    context: Object.freeze({
      scene: "weekend_date",
      desired_impression: Object.freeze(["clean", "fashionable", "relaxed"]),
      explicit_avoid: Object.freeze(["office_like", "workwear_uniform"]),
      concept_summary: "A clean fashionable weekend date look that must not feel like work.",
      slot: "shoes",
    }),
    candidates: Object.freeze([
      qualityCandidate("q6-a", {
        audience: "adult office worker",
        title: "Uniform-style office work shoe",
        style: "corporate work uniform",
        occasion: "office and work duty",
        silhouette: "conservative structured profile",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q6-a", {
          audience_fit: ["PASS", "MIXED"],
          contemporary_fit: ["PASS", "MIXED", "FAIL"],
          occasion_fit: ["FAIL"],
          desired_impression_fit: ["FAIL"],
          visual_quality: ["PASS", "MIXED", "FAIL"],
          decision: ["REJECT"],
        }),
      ]),
    }),
  }),
  Object.freeze({
    contract_id: "YOUNG_MALE_DATE_MODERN_OVER_TRADITIONAL",
    context: Object.freeze({
      scene: "date",
      desired_impression: Object.freeze(["young", "clean", "contemporary"]),
      explicit_avoid: Object.freeze(["mature_traditional_expression"]),
      concept_summary: "A clean contemporary date look for a young adult man.",
      slot: "shoes",
    }),
    candidates: Object.freeze([
      qualityCandidate("q1-a", {
        audience: "young adult men",
        title: "Minimal modern casual lace-up shoe",
        style: "clean contemporary casual",
        occasion: "date and daily social",
        silhouette: "streamlined low profile",
      }),
      qualityCandidate("q1-b", {
        audience: "mature traditional men",
        title: "Traditional comfort cloth slip-on shoe",
        style: "mature traditional comfort",
        occasion: "relaxed home and neighborhood errands",
        silhouette: "rounded roomy profile",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q1-a", {
          audience_fit: ["PASS"],
          contemporary_fit: ["PASS", "MIXED"],
          occasion_fit: ["PASS", "MIXED"],
          desired_impression_fit: ["PASS", "MIXED"],
          visual_quality: ["PASS", "MIXED"],
          decision: ["KEEP"],
        }),
      ]),
      relations: Object.freeze([
        qualityRelation("q1-a", "q1-b", [
          "audience_fit",
          "contemporary_fit",
          "occasion_fit",
          "desired_impression_fit",
        ]),
      ]),
    }),
  }),
  Object.freeze({
    contract_id: "YOUNG_FEMALE_NIGHTLIFE_MODERN_OVER_MATURE",
    context: Object.freeze({
      scene: "nightlife_social",
      desired_impression: Object.freeze(["young", "designed", "contemporary"]),
      explicit_avoid: Object.freeze(["mature_commute_expression"]),
      concept_summary: "A youthful lightly designed nightlife look for an adult woman.",
      slot: "shoes",
    }),
    candidates: Object.freeze([
      qualityCandidate("q2-a", {
        audience: "young adult women",
        title: "Sculpted low-heel modern shoe",
        style: "contemporary feminine design",
        occasion: "nightlife social and date",
        silhouette: "refined angular profile",
      }),
      qualityCandidate("q2-b", {
        audience: "mature adult women",
        title: "Comfort-focused mature commute shoe",
        style: "conservative mature commute",
        occasion: "routine commute and office",
        silhouette: "rounded comfort profile",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q2-a", {
          audience_fit: ["PASS"],
          contemporary_fit: ["PASS", "MIXED"],
          occasion_fit: ["PASS", "MIXED"],
          desired_impression_fit: ["PASS", "MIXED"],
          visual_quality: ["PASS", "MIXED"],
          decision: ["KEEP"],
        }),
      ]),
      relations: Object.freeze([
        qualityRelation("q2-a", "q2-b", [
          "audience_fit",
          "contemporary_fit",
          "occasion_fit",
          "desired_impression_fit",
        ]),
      ]),
    }),
  }),
  Object.freeze({
    contract_id: "ADULT_OVER_CHILD",
    context: Object.freeze({
      scene: "adult_weekend_date",
      desired_impression: Object.freeze(["adult", "clean", "current"]),
      explicit_avoid: Object.freeze(["child_product"]),
      concept_summary: "A current casual look for an adult user.",
      slot: "top",
    }),
    candidates: Object.freeze([
      qualityCandidate("q3-a", {
        category: "top",
        audience: "adult",
        title: "Adult regular-fit cotton overshirt",
        style: "clean contemporary",
        occasion: "adult casual social",
        silhouette: "adult regular fit",
      }),
      qualityCandidate("q3-b", {
        category: "top",
        audience: "children ages 8 to 12",
        title: "Children's school-age graphic sweatshirt",
        style: "child playful",
        occasion: "children school and play",
        silhouette: "children sizing",
      }),
    ]),
    expected: Object.freeze({
      evaluations: Object.freeze([
        qualityExpectation("q3-a", {
          audience_fit: ["PASS"],
          contemporary_fit: ["PASS", "MIXED"],
          occasion_fit: ["PASS"],
          desired_impression_fit: ["PASS", "MIXED"],
          visual_quality: ["PASS", "MIXED"],
          decision: ["KEEP"],
        }),
        qualityExpectation("q3-b", {
          audience_fit: ["FAIL"],
          contemporary_fit: ["PASS", "MIXED", "FAIL"],
          occasion_fit: ["MIXED", "FAIL"],
          desired_impression_fit: ["MIXED", "FAIL"],
          visual_quality: ["PASS", "MIXED", "FAIL"],
          decision: ["REJECT"],
        }),
      ]),
    }),
  }),
]);

const AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS =
  AI_RERANKER_MODEL_BAKEOFF_MODELS.length * (
    QUALITY_CONTRACTS.length + AI_RERANKER_MODEL_BAKEOFF_OPTIONAL_FOUR_RUNS
  );

function qualityCandidate(candidateId, {
  category = "shoes",
  audience,
  title,
  style,
  occasion,
  silhouette,
}) {
  return Object.freeze({
    candidate_id: candidateId,
    category,
    title,
    color: "neutral",
    material: "unspecified",
    silhouette,
    price_band: "mid",
    enrichment_evidence: Object.freeze({
      audience,
      style,
      occasion,
      silhouette,
    }),
    acceptance_evidence: Object.freeze({
      product_identity_confidence: "HIGH",
      source: "STRUCTURED_PRODUCT_METADATA",
    }),
  });
}

function qualityExpectation(candidateId, fields) {
  return Object.freeze({
    candidate_id: candidateId,
    fields: Object.freeze(Object.fromEntries(Object.entries(fields).map(
      ([field, values]) => [field, Object.freeze([...values])],
    ))),
  });
}

function qualityRelation(betterCandidateId, worseCandidateId, fields) {
  return Object.freeze({
    better_candidate_id: betterCandidateId,
    worse_candidate_id: worseCandidateId,
    fields: Object.freeze([...fields]),
    rule: "BETTER_NOT_LOWER_ON_ANY_FIELD_AND_STRICTLY_HIGHER_ON_AT_LEAST_ONE",
  });
}

function createAiRerankerModelBakeoffHandler({
  environment = process.env,
  client = null,
  provider = "unconfigured",
  logger = console,
  clock = () => Date.now(),
  requestTimeoutMs = AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS,
  totalBudgetMs = AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS,
} = {}) {
  let running = false;
  return async function aiRerankerModelBakeoffHandler(req, res) {
    const currentEnvironment = typeof environment === "function"
      ? environment()
      : environment;
    if (!aiRerankerModelBakeoffEnabled(currentEnvironment)) {
      return res.status(404).json({error: "NOT_FOUND"});
    }
    if (!authorized(req, currentEnvironment.INTERNAL_PROBE_TOKEN)) {
      return res.status(403).json({error: "FORBIDDEN"});
    }
    if (!emptyProbeBody(req?.body)) {
      return res.status(400).json({
        probe_status: "REJECTED",
        error_code: "AI_RERANKER_MODEL_BAKEOFF_FIXED_INPUT_ONLY",
      });
    }
    if (running) {
      return res.status(409).json({
        probe_status: "REJECTED",
        error_code: "AI_RERANKER_MODEL_BAKEOFF_ALREADY_RUNNING",
      });
    }
    if (!client?.chat?.completions?.create) {
      return res.status(503).json({
        probe_status: "FAILED",
        error_code: "AI_RERANKER_PROVIDER_UNAVAILABLE",
      });
    }

    running = true;
    const disconnectController = new AbortController();
    const detachDisconnect = bindClientDisconnect(
      req,
      res,
      disconnectController,
    );
    try {
      const result = await executeAiRerankerModelBakeoff({
        client,
        provider,
        logger: createSafeLogger(logger),
        clock,
        requestTimeoutMs,
        totalBudgetMs,
        signal: disconnectController.signal,
      });
      if (disconnectController.signal.aborted) return undefined;
      return res.status(result.probe_status === "SUCCESS" ? 200 : 502)
        .json(result);
    } catch (error) {
      logger.error?.("ai_reranker_model_bakeoff_failed", {
        error_code: classifyFailure(error),
      });
      if (disconnectController.signal.aborted) return undefined;
      return res.status(502).json({
        probe_status: "FAILED",
        error_code: "AI_RERANKER_MODEL_BAKEOFF_FAILED",
      });
    } finally {
      detachDisconnect();
      running = false;
    }
  };
}

async function executeAiRerankerModelBakeoff({
  client,
  provider = "unconfigured",
  logger = console,
  clock = () => Date.now(),
  requestTimeoutMs = AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS,
  totalBudgetMs = AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS,
  signal = null,
} = {}) {
  if (!client?.chat?.completions?.create) {
    throw probeError("AI_RERANKER_PROVIDER_UNAVAILABLE");
  }
  const startedAt = Number(clock());
  const deadlineAt = startedAt + boundedTotalBudget(totalBudgetMs);
  const requestCounter = {started: 0};
  const modelStates = new Map(AI_RERANKER_MODEL_BAKEOFF_MODELS.map((model) => [
    model,
    {
      samples: [],
      qualityResults: [],
      explicitlyUnavailable: false,
      availabilityReason: null,
    },
  ]));

  for (let contractIndex = 0;
    contractIndex < QUALITY_CONTRACTS.length;
    contractIndex += 1) {
    const contract = QUALITY_CONTRACTS[contractIndex];
    for (const model of rotatedModelOrder(contractIndex)) {
      if (signal?.aborted) break;
      const state = modelStates.get(model);
      if (state.explicitlyUnavailable) continue;
      const sample = await executeFixedSample({
        client,
        model,
        kind: "QUALITY_LATENCY",
        scenarioId: contract.contract_id,
        repetition: 1,
        context: contract.context,
        candidates: contract.candidates,
        clock,
        requestTimeoutMs,
        deadlineAt,
        signal,
        requestCounter,
      });
      state.samples.push(sample);
      state.qualityResults.push(evaluateQualityContract(contract, sample));
      logger.info?.("ai_reranker_model_bakeoff_sample", safeSampleLog(model, sample));
      if (contractIndex === 0 && !sample.success &&
          explicitModelUnavailability(sample.failure_reason)) {
        state.explicitlyUnavailable = true;
        state.availabilityReason = sample.failure_reason;
      }
    }
  }

  for (const model of rotatedModelOrder(QUALITY_CONTRACTS.length)) {
    const state = modelStates.get(model);
    if (signal?.aborted || state.explicitlyUnavailable) continue;
    const twoCandidateSummary = summarizeLatency(
      state.samples.filter(({candidate_count: count}) => count === 2),
    );
    if (twoCandidateSummary.success_count === 3 &&
        twoCandidateSummary.total_latency_ms.p95 <=
          AI_RERANKER_MODEL_BAKEOFF_MIN_P95_MS) {
      const sample = await executeFixedSample({
        client,
        model,
        kind: "OPTIONAL_LATENCY",
        scenarioId: "LATENCY_4_CANDIDATES_OPTIONAL",
        repetition: 1,
        context: PROBE_CONTEXT,
        candidates: PROBE_CANDIDATES.slice(0, 4),
        clock,
        requestTimeoutMs,
        deadlineAt,
        signal,
        requestCounter,
      });
      state.samples.push(sample);
      logger.info?.("ai_reranker_model_bakeoff_sample", safeSampleLog(model, sample));
    }
  }

  const reports = AI_RERANKER_MODEL_BAKEOFF_MODELS.map((model) => {
    const state = modelStates.get(model);
    return buildModelReport({
      model,
      samples: state.samples,
      qualityResults: state.qualityResults,
      availabilityReason: state.availabilityReason,
    });
  });

  const actualRequests = requestCounter.started;
  const probeStatus = reports.some(({actual_availability: available}) => available)
    ? "SUCCESS"
    : "FAILED";
  return Object.freeze({
    probe_version: "ai_reranker_model_bakeoff_v1",
    probe_status: probeStatus,
    provider: safeIdentifier(provider, "unconfigured"),
    endpoint_type: "openai_compatible_chat_completions",
    fixed_model_candidates: AI_RERANKER_MODEL_BAKEOFF_MODELS,
    model_selection_source: "FIXED_LOW_LATENCY_EXPERIMENT_CANDIDATES",
    model_availability_basis: "SUCCESSFUL_REAL_MODEL_CALL",
    configuration: Object.freeze({
      streaming: false,
      max_tokens: AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS,
      temperature: AI_RERANKER_MODEL_BAKEOFF_TEMPERATURE,
      concurrency: AI_RERANKER_MODEL_BAKEOFF_CONCURRENCY,
      request_timeout_ms: boundedRequestTimeout(requestTimeoutMs),
      total_budget_ms: boundedTotalBudget(totalBudgetMs),
      retries: 0,
    }),
    limits: Object.freeze({
      model_request_limit: AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS,
      actual_model_requests: actualRequests,
      taobao_calls: 0,
      outfit_calls: 0,
      images: 0,
      caller_supplied_input: false,
    }),
    quality_contract_count: QUALITY_CONTRACTS.length,
    reports: Object.freeze(reports),
  });
}

async function executeFixedSample({
  client,
  model,
  kind,
  scenarioId,
  repetition,
  context,
  candidates,
  clock,
  requestTimeoutMs,
  deadlineAt,
  signal,
  requestCounter,
}) {
  const messages = buildBakeoffMessages({context, candidates});
  const promptBytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
  if (signal?.aborted) {
    return skippedSample({
      kind,
      scenarioId,
      repetition,
      candidates,
      promptBytes,
      failureReason: "SKIPPED_CLIENT_DISCONNECT",
    });
  }
  const remainingBudgetMs = deadlineAt - Number(clock());
  if (remainingBudgetMs <= 0 ||
      requestCounter.started >= AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS) {
    return skippedSample({
      kind,
      scenarioId,
      repetition,
      candidates,
      promptBytes,
      failureReason: remainingBudgetMs <= 0
        ? "SKIPPED_TOTAL_BUDGET"
        : "SKIPPED_REQUEST_LIMIT",
    });
  }
  const timeoutMs = Math.max(1, Math.min(
    boundedRequestTimeout(requestTimeoutMs),
    remainingBudgetMs,
  ));
  const startedMs = Number(clock());
  const controller = new AbortController();
  const timeoutReason = probeError("MODEL_REQUEST_TIMEOUT");
  const abortFromParent = () => controller.abort(
    signal?.reason instanceof Error
      ? signal.reason
      : probeError("CLIENT_DISCONNECT"),
  );
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener?.("abort", abortFromParent, {once: true});
  const timer = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  timer.unref?.();
  requestCounter.started += 1;
  let responseCompleteMs = null;
  let parseCompleteMs = null;
  let outputTokens = null;
  let outputBytes = 0;
  try {
    const response = await client.chat.completions.create({
      model,
      response_format: {type: "json_object"},
      enable_thinking: false,
      temperature: AI_RERANKER_MODEL_BAKEOFF_TEMPERATURE,
      max_tokens: AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS,
      stream: false,
      messages,
    }, {
      timeout: timeoutMs,
      maxRetries: 0,
      signal: controller.signal,
    });
    responseCompleteMs = Number(clock());
    const finishReason = safeIdentifier(
      response?.choices?.[0]?.finish_reason,
      "unknown",
    );
    if (finishReason === "length") throw probeError("OUTPUT_TRUNCATED");
    if (finishReason === "content_filter") throw probeError("OUTPUT_FILTERED");
    const content = completionText(response);
    outputBytes = Buffer.byteLength(content, "utf8");
    outputTokens = completionTokens(response?.usage);
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(content));
      validateBakeoffPayload(parsed, candidates);
    } catch {
      throw probeError("RESPONSE_PARSE_FAILED");
    } finally {
      parseCompleteMs = Number(clock());
    }
    return freezeSample({
      kind,
      scenarioId,
      repetition,
      candidates,
      promptBytes,
      startedMs,
      responseCompleteMs,
      parseCompleteMs,
      outputTokens,
      outputBytes,
      success: true,
      failureReason: null,
      evaluations: parsed.evaluations,
    });
  } catch (error) {
    const endedMs = Number(clock());
    return freezeSample({
      kind,
      scenarioId,
      repetition,
      candidates,
      promptBytes,
      startedMs,
      responseCompleteMs,
      parseCompleteMs,
      outputTokens,
      outputBytes,
      failureAt: endedMs,
      success: false,
      failureReason: controller.signal.aborted
        ? classifyFailure(controller.signal.reason)
        : classifyFailure(error),
      evaluations: [],
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abortFromParent);
  }
}

function buildBakeoffMessages({context, candidates}) {
  const payload = {
    scene: context.scene,
    desired_impression: [...(context.desired_impression || [])],
    explicit_avoid: [...(context.explicit_avoid || [])],
    concept_summary: context.concept_summary,
    slot: context.slot,
    candidates: candidates.map((candidate) => ({...candidate})),
  };
  return Object.freeze([
    Object.freeze({
      role: "system",
      content: [
        "Evaluate only the supplied ecommerce candidates for the supplied styling context.",
        "Return one JSON object whose only key is evaluations.",
        "evaluations must contain exactly one item per candidate in the same order.",
        `audience_fit, contemporary_fit, occasion_fit, desired_impression_fit, and visual_quality must be one of: ${FIT_VALUES.join(", ")}.`,
        `decision must be one of: ${DECISION_VALUES.join(", ")}.`,
        `short_reason must be plain text with at most ${SHORT_REASON_MAX_CHARACTERS} Unicode characters.`,
        "Use product evidence, not price or brand prestige, for severe fit decisions.",
        "Each evaluation may contain only candidate_id, audience_fit, contemporary_fit, occasion_fit, desired_impression_fit, visual_quality, decision, short_reason.",
        "Do not add markdown or commentary.",
      ].join("\n"),
    }),
    Object.freeze({role: "user", content: JSON.stringify(payload)}),
  ]);
}

function validateBakeoffPayload(payload, candidates) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Array.isArray(payload.evaluations) ||
      payload.evaluations.length !== candidates.length) {
    throw probeError("RESPONSE_PARSE_FAILED");
  }
  const allowedKeys = [
    "candidate_id",
    "audience_fit",
    "contemporary_fit",
    "occasion_fit",
    "desired_impression_fit",
    "visual_quality",
    "decision",
    "short_reason",
  ];
  payload.evaluations.forEach((evaluation, index) => {
    if (!evaluation || typeof evaluation !== "object" ||
        Array.isArray(evaluation) ||
        Object.keys(evaluation).length !== allowedKeys.length ||
        !allowedKeys.every((key) => Object.hasOwn(evaluation, key)) ||
        evaluation.candidate_id !== candidates[index].candidate_id ||
        !FIT_VALUES.includes(evaluation.audience_fit) ||
        !FIT_VALUES.includes(evaluation.contemporary_fit) ||
        !FIT_VALUES.includes(evaluation.occasion_fit) ||
        !FIT_VALUES.includes(evaluation.desired_impression_fit) ||
        !FIT_VALUES.includes(evaluation.visual_quality) ||
        !DECISION_VALUES.includes(evaluation.decision) ||
        typeof evaluation.short_reason !== "string" ||
        [...evaluation.short_reason].length === 0 ||
        [...evaluation.short_reason].length > SHORT_REASON_MAX_CHARACTERS) {
      throw probeError("RESPONSE_PARSE_FAILED");
    }
  });
  return payload;
}

function buildModelReport({
  model,
  samples,
  qualityResults,
  availabilityReason = null,
}) {
  const availabilityStatus = resolveAvailabilityStatus(
    samples,
    availabilityReason,
  );
  const available = availabilityStatus === "AVAILABLE";
  const latencySamples = samples;
  const latencyByCount = [1, 2, 4].map((candidateCount) => summarizeLatency(
    latencySamples.filter(({candidate_count: value}) => value === candidateCount),
    candidateCount,
  ));
  const twoCandidate = latencyByCount.find(
    ({candidate_count: value}) => value === 2,
  );
  const qualityPassCount = qualityResults.filter(({pass}) => pass).length;
  const qualityComplete = qualityResults.length === QUALITY_CONTRACTS.length;
  const reliableTwoCandidateLatency = twoCandidate?.sample_count === 3 &&
    twoCandidate.started_count === 3 &&
    twoCandidate.success_count === 3 &&
    twoCandidate.parse_success_rate === 1 &&
    Number.isFinite(twoCandidate.total_latency_ms.p95);
  const meetsMinimumLatency = reliableTwoCandidateLatency &&
    twoCandidate.total_latency_ms.p95 <= AI_RERANKER_MODEL_BAKEOFF_MIN_P95_MS;
  const measuredP95 = twoCandidate?.total_latency_ms?.p95;
  const p95 = reliableTwoCandidateLatency ? measuredP95 : null;
  return Object.freeze({
    model,
    actual_availability: available,
    availability_status: availabilityStatus,
    availability_reason: available ? "COMPLETE_REAL_MODEL_RESPONSE" :
      availabilityReason || "MODEL_AVAILABILITY_INCONCLUSIVE",
    latency: Object.freeze(latencyByCount),
    latency_distribution_scope: "SUCCESSFUL_PARSED_REQUESTS_ONLY",
    success_rate: rate(
      latencySamples.filter(({model_request_started: started, success}) =>
        started && success).length,
      latencySamples.filter(({model_request_started: started}) => started).length,
    ),
    parse_success_rate: rate(
      latencySamples.filter(({parse_success: value}) => value).length,
      latencySamples.filter(({model_request_started: started}) => started).length,
    ),
    quality: Object.freeze({
      contract_count: QUALITY_CONTRACTS.length,
      executed_count: qualityResults.length,
      pass_count: qualityPassCount,
      pass_rate: rate(qualityPassCount, qualityResults.length),
      contracts: Object.freeze(qualityResults),
    }),
    predicted_reranker_latency_ms: Object.freeze({
      basis: "two_candidate_p95_concurrency_2",
      six_slots: Number.isFinite(p95) ? roundedMs(Math.ceil(6 / 2) * p95) : null,
      nine_slots: Number.isFinite(p95) ? roundedMs(Math.ceil(9 / 2) * p95) : null,
    }),
    meets_target_p95_2500: Boolean(
      Number.isFinite(p95) && p95 <= AI_RERANKER_MODEL_BAKEOFF_TARGET_P95_MS,
    ),
    meets_minimum_p95_3500: meetsMinimumLatency,
    eligible_for_product_reranker_experiment:
      available && meetsMinimumLatency && qualityComplete &&
      qualityPassCount === QUALITY_CONTRACTS.length,
  });
}

function explicitModelUnavailability(reason) {
  return reason === "MODEL_NOT_AVAILABLE" ||
    reason === "MODEL_PERMISSION_FAILED";
}

function resolveAvailabilityStatus(samples, explicitReason) {
  if (explicitModelUnavailability(explicitReason)) return "UNAVAILABLE";
  if (samples.some(({response_complete: value}) => value != null)) {
    return "AVAILABLE";
  }
  return "INCONCLUSIVE";
}

function rotatedModelOrder(round) {
  const offset = Math.abs(Number(round) || 0) %
    AI_RERANKER_MODEL_BAKEOFF_MODELS.length;
  return Object.freeze([
    ...AI_RERANKER_MODEL_BAKEOFF_MODELS.slice(offset),
    ...AI_RERANKER_MODEL_BAKEOFF_MODELS.slice(0, offset),
  ]);
}

function summarizeLatency(samples, candidateCount = samples[0]?.candidate_count) {
  const started = samples.filter(({model_request_started: value}) => value);
  const successful = started.filter(({success}) => success);
  const parseSuccessful = started.filter(({parse_success: value}) => value);
  const latencies = successful.map(({total_latency_ms: value}) => value)
    .filter(Number.isFinite).sort((left, right) => left - right);
  const tokens = successful.map(({output_tokens: value}) => value)
    .filter(Number.isFinite).sort((left, right) => left - right);
  return Object.freeze({
    candidate_count: candidateCount ?? null,
    sample_count: samples.length,
    started_count: started.length,
    success_count: successful.length,
    failure_count: samples.length - successful.length,
    success_rate: rate(successful.length, started.length),
    parse_success_rate: rate(parseSuccessful.length, started.length),
    total_latency_ms: distribution(latencies),
    output_tokens: distribution(tokens),
    failures: failureCounts(samples),
  });
}

function evaluateQualityContract(contract, sample) {
  const evaluations = sample.success ? sample.evaluations : [];
  const byId = new Map(evaluations.map((evaluation) => [
    evaluation.candidate_id,
    evaluation,
  ]));
  const fieldResults = (contract.expected.evaluations || []).flatMap(
    (expectation) => Object.entries(expectation.fields).map(
      ([field, acceptedValues]) => {
        const actual = byId.get(expectation.candidate_id)?.[field] ?? null;
        return Object.freeze({
          candidate_id: expectation.candidate_id,
          field,
          accepted_values: acceptedValues,
          actual,
          pass: acceptedValues.includes(actual),
        });
      },
    ),
  );
  const relationResults = (contract.expected.relations || []).map((relation) => {
    const better = byId.get(relation.better_candidate_id);
    const worse = byId.get(relation.worse_candidate_id);
    const comparisons = relation.fields.map((field) => {
      const betterRank = fitRank(better?.[field]);
      const worseRank = fitRank(worse?.[field]);
      return Object.freeze({
        field,
        better: better?.[field] ?? null,
        worse: worse?.[field] ?? null,
        not_lower: betterRank >= worseRank,
        strictly_higher: betterRank > worseRank,
      });
    });
    return Object.freeze({
      ...relation,
      comparisons: Object.freeze(comparisons),
      pass: comparisons.every(({not_lower}) => not_lower) &&
        comparisons.some(({strictly_higher}) => strictly_higher),
    });
  });
  const assertionsPass = fieldResults.every(({pass}) => pass) &&
    relationResults.every(({pass}) => pass);
  return Object.freeze({
    contract_id: contract.contract_id,
    success: sample.success,
    failure_reason: sample.failure_reason,
    pass: sample.success && assertionsPass,
    expected: contract.expected,
    field_assertions: Object.freeze(fieldResults),
    relation_assertions: Object.freeze(relationResults),
    machine_judgment: Object.freeze(evaluations.map((evaluation) => ({
      candidate_id: evaluation.candidate_id,
      audience_fit: evaluation.audience_fit,
      contemporary_fit: evaluation.contemporary_fit,
      occasion_fit: evaluation.occasion_fit,
      desired_impression_fit: evaluation.desired_impression_fit,
      visual_quality: evaluation.visual_quality,
      decision: evaluation.decision,
      short_reason: evaluation.short_reason,
    }))),
    latency_ms: sample.total_latency_ms,
    prompt_bytes: sample.prompt_bytes,
  });
}

function fitRank(value) {
  if (value === "PASS") return 2;
  if (value === "MIXED") return 1;
  if (value === "FAIL") return 0;
  return -1;
}

function freezeSample({
  kind,
  scenarioId,
  repetition,
  candidates,
  promptBytes,
  startedMs,
  responseCompleteMs,
  parseCompleteMs,
  outputTokens,
  outputBytes,
  failureAt = null,
  success,
  failureReason,
  evaluations,
}) {
  const endedMs = parseCompleteMs ?? responseCompleteMs ?? failureAt ?? startedMs;
  return Object.freeze({
    kind,
    scenario_id: scenarioId,
    repetition,
    candidate_count: candidates.length,
    prompt_bytes: promptBytes,
    image_count: 0,
    streaming: false,
    model_request_started: true,
    request_start: timestamp(startedMs),
    first_byte: Object.freeze({
      status: "UNAVAILABLE",
      latency_ms: null,
      reason: "RAW_FIRST_BYTE_NOT_EXPOSED_BY_SDK",
    }),
    first_token: Object.freeze({
      status: "UNAVAILABLE",
      latency_ms: null,
      reason: "NON_STREAMING_SDK",
    }),
    response_complete: responseCompleteMs == null
      ? null : timestamp(responseCompleteMs),
    parse_complete: parseCompleteMs == null ? null : timestamp(parseCompleteMs),
    response_latency_ms: responseCompleteMs == null
      ? null : roundedMs(responseCompleteMs - startedMs),
    parse_latency_ms: responseCompleteMs == null || parseCompleteMs == null
      ? null : roundedMs(parseCompleteMs - responseCompleteMs),
    total_latency_ms: roundedMs(endedMs - startedMs),
    output_tokens: outputTokens,
    output_tokens_status: outputTokens == null ? "UNAVAILABLE" : "AVAILABLE",
    output_bytes: outputBytes,
    success,
    parse_success: success,
    failure_reason: failureReason,
    evaluations: Object.freeze(evaluations),
  });
}

function skippedSample({
  kind,
  scenarioId,
  repetition,
  candidates,
  promptBytes,
  failureReason,
}) {
  return Object.freeze({
    kind,
    scenario_id: scenarioId,
    repetition,
    candidate_count: candidates.length,
    prompt_bytes: promptBytes,
    image_count: 0,
    streaming: false,
    model_request_started: false,
    request_start: null,
    first_byte: Object.freeze({
      status: "UNAVAILABLE",
      latency_ms: null,
      reason: "MODEL_REQUEST_NOT_STARTED",
    }),
    first_token: Object.freeze({
      status: "UNAVAILABLE",
      latency_ms: null,
      reason: "MODEL_REQUEST_NOT_STARTED",
    }),
    response_complete: null,
    parse_complete: null,
    response_latency_ms: null,
    parse_latency_ms: null,
    total_latency_ms: null,
    output_tokens: null,
    output_tokens_status: "UNAVAILABLE",
    output_bytes: 0,
    success: false,
    parse_success: false,
    failure_reason: failureReason,
    evaluations: Object.freeze([]),
  });
}

function aiRerankerModelBakeoffEnabled(environment = {}) {
  const enabled = String(environment.ENABLE_AI_RERANKER_MODEL_BAKEOFF || "")
    .trim().toLowerCase() === "true";
  const renderRuntime = String(environment.RENDER || "")
    .trim().toLowerCase() === "true";
  const token = String(environment.INTERNAL_PROBE_TOKEN || "");
  const modelSecrets = [
    environment.OPENAI_API_KEY,
    environment.DASHSCOPE_API_KEY,
  ].map((value) => String(value || "")).filter(Boolean);
  return enabled && renderRuntime &&
    token.length >= INTERNAL_PROBE_TOKEN_MIN_LENGTH &&
    !modelSecrets.includes(token);
}

function authorized(req, expectedToken) {
  const header = String(req?.headers?.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(String(expectedToken || ""), "utf8");
  return actual.length === expected.length && actual.length > 0 &&
    crypto.timingSafeEqual(actual, expected);
}

function emptyProbeBody(body) {
  return body === undefined || body === null ||
    (typeof body === "object" && !Array.isArray(body) &&
      Object.keys(body).length === 0);
}

function bindClientDisconnect(req, res, controller) {
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(probeError("CLIENT_DISCONNECT"));
  };
  const onRequestAborted = () => abort();
  const onRequestClose = () => {
    if (req?.aborted === true || req?.complete === false) abort();
  };
  const onResponseClose = () => {
    if (res?.writableEnded !== true) abort();
  };
  req?.once?.("aborted", onRequestAborted);
  req?.once?.("close", onRequestClose);
  res?.once?.("close", onResponseClose);
  return () => {
    req?.off?.("aborted", onRequestAborted);
    req?.off?.("close", onRequestClose);
    res?.off?.("close", onResponseClose);
  };
}

function classifyFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  if (code === "CLIENT_DISCONNECT") return "CLIENT_DISCONNECT";
  if (code === "MODEL_REQUEST_TIMEOUT" || code === "ABORT_ERR" ||
      error?.name === "AbortError") return "MODEL_REQUEST_TIMEOUT";
  if (code === "RESPONSE_PARSE_FAILED") return "RESPONSE_PARSE_FAILED";
  if (code === "OUTPUT_TRUNCATED") return "OUTPUT_TRUNCATED";
  if (code === "OUTPUT_FILTERED") return "OUTPUT_FILTERED";
  if (status === 404 || /MODEL.*(NOT.*FOUND|UNAVAILABLE)/.test(code)) {
    return "MODEL_NOT_AVAILABLE";
  }
  if (status === 401) return "MODEL_AUTH_FAILED";
  if (status === 403) return "MODEL_PERMISSION_FAILED";
  if (status === 429) return "MODEL_RATE_LIMITED";
  if (status >= 500) return "MODEL_UPSTREAM_UNAVAILABLE";
  return "MODEL_REQUEST_FAILED";
}

function completionText(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function completionTokens(usage) {
  const value = Number(usage?.completion_tokens);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function stripJsonFence(value) {
  return String(value || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function distribution(values) {
  const numbers = values.filter(Number.isFinite).sort((left, right) => left - right);
  return Object.freeze({
    sample_count: numbers.length,
    min: numbers.length ? numbers[0] : null,
    p50: numbers.length ? percentile(numbers, 0.5) : null,
    p95: numbers.length ? percentile(numbers, 0.95) : null,
    max: numbers.length ? numbers[numbers.length - 1] : null,
  });
}

function rate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function failureCounts(samples) {
  const counts = {};
  for (const sample of samples) {
    if (!sample.failure_reason) continue;
    counts[sample.failure_reason] = (counts[sample.failure_reason] || 0) + 1;
  }
  return Object.freeze(counts);
}

function timestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function roundedMs(value) {
  return Number(Math.max(0, Number(value) || 0).toFixed(3));
}

function boundedRequestTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS;
  }
  return Math.min(Math.round(parsed), AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS);
}

function boundedTotalBudget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS;
  }
  return Math.min(Math.round(parsed), AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS);
}

function safeIdentifier(value, fallback) {
  const sanitized = String(value || "").trim()
    .replace(/[^a-zA-Z0-9._:/+-]/g, "")
    .slice(0, 100);
  return sanitized || fallback;
}

function createSafeLogger(logger = console) {
  const write = (level, message, details) => logger[level]?.(
    message,
    safeLogDetails(details),
  );
  return {
    info(message, details) { write("info", message, details); },
    warn(message, details) { write("warn", message, details); },
    error(message, details) { write("error", message, details); },
  };
}

function safeSampleLog(model, sample) {
  return {
    model: safeIdentifier(model, "unknown"),
    scenario_id: safeIdentifier(sample.scenario_id, "unknown"),
    candidate_count: sample.candidate_count,
    success: sample.success,
    failure_reason: sample.failure_reason,
    total_latency_ms: sample.total_latency_ms,
  };
}

function safeLogDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const allowed = [
    "model",
    "scenario_id",
    "candidate_count",
    "success",
    "failure_reason",
    "total_latency_ms",
    "error_code",
  ];
  return Object.fromEntries(allowed
    .filter((key) => details[key] !== undefined)
    .map((key) => [key, details[key]]));
}

function probeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

module.exports = {
  AI_RERANKER_MODEL_BAKEOFF_MAX_REQUESTS,
  AI_RERANKER_MODEL_BAKEOFF_MAX_TOKENS,
  AI_RERANKER_MODEL_BAKEOFF_MODELS,
  AI_RERANKER_MODEL_BAKEOFF_PATH,
  AI_RERANKER_MODEL_BAKEOFF_REQUEST_TIMEOUT_MS,
  AI_RERANKER_MODEL_BAKEOFF_TOTAL_BUDGET_MS,
  QUALITY_CONTRACTS,
  aiRerankerModelBakeoffEnabled,
  buildBakeoffMessages,
  createAiRerankerModelBakeoffHandler,
  evaluateQualityContract,
  executeAiRerankerModelBakeoff,
  summarizeLatency,
  validateBakeoffPayload,
};
