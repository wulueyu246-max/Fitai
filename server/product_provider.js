const {ProductCatalog, canonicalCategory} = require("./product_catalog");
const {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiClient,
  TaobaoApiError,
  signTaobaoRequest,
} = require("./taobao_client");
const {
  STYLING_COMPLETION_AUTHORITY,
  SUPPORTED_PRODUCT_CATEGORIES,
  authoritativeProductGender,
  buildTaobaoSearchPlan,
  categoryPriority,
  normalizeGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  normalizeSearchSubcategory,
  productQualityBlock,
  rankProducts,
  sortProductsByCategoryPriority,
} = require("./product_relevance");
const {
  evaluateStyleGate,
  hasActionableStyleConstraints,
  intentDebugSummary,
  resolveIntentPriorityScore,
  shouldRejectForStyle,
  styleMatchScore,
} = require("./intent_priority");
const {
  blueprintMatchAssessment,
  blueprintMatchPassesHardGate,
} = require("./outfit_blueprint");
const {
  expandBlueprintSearchPlan,
} = require("./blueprint_search_expansion");
const {
  bodyStrategyMatchAssessment,
} = require("./body_strategy_match");
const {
  NO_PRODUCT_MEETS_CORE_SPEC,
  SPEC_CONSISTENCY_STATUS,
  compilePurchaseSpecification,
  evaluateCandidateAgainstSpecification,
  gateCandidates,
} = require("./purchase_specification");
const {
  compareProductPurchaseAesthetic,
  scoreAndSortProducts,
} = require("./product_aesthetic_match");
const {
  ProductAestheticReranker,
} = require("./product_aesthetic_reranker");
const {
  DEFAULT_MAX_CANDIDATES_PER_SLOT,
} = require("./visual_product_verification");
const {
  candidateHardGate,
  composeOutfitCandidates,
} = require("./outfit_aesthetic_strategy");
const {isProductionRuntime} = require("./decision_context");
const {
  attachEnrichmentToCandidate,
  buildRawTaobaoProduct,
  enrichTaobaoCandidate,
} = require("./taobao_candidate_enrichment");
const {
  canonicalProductIdentity,
  evaluateProductAcceptance,
} = require("./product_acceptance_gate");
const {
  buildDeficitRefillQuery,
  diagnoseQualityDeficit,
} = require("./quality_deficit_refill");
const {attachTargetFitAssessment} = require("./target_fit_assessment");

const PRODUCT_CATEGORIES = SUPPORTED_PRODUCT_CATEGORIES;
const DEFAULT_SAMPLE_MATERIAL_ID = "28029";
const PRODUCT_PIPELINE_BUDGET_MS = 45_000;
const TAOBAO_STAGE_BUDGET_MS = 15_000;
const PRODUCT_RERANK_BUDGET_MS = 20_000;
const PRODUCT_VISUAL_VERIFICATION_BUDGET_MS = 20_000;
const MAX_VISUAL_CANDIDATES_PER_SLOT = 12;
const DEFAULT_RELEVANCE_POOL_PER_REQUIREMENT = 20;
const DEFAULT_STRATEGY_CANDIDATE_BREADTH = 6;
const DEFAULT_STRATEGY_BEAM_WIDTH = 72;
const DEFAULT_GATE_PASS_TARGET_PER_CORE_SLOT = 4;
const DEFAULT_MINIMUM_COMPLETE_LOOKS = 1;
const DEFAULT_MAX_REFILL_ROUNDS = 2;
const DEFAULT_REFILL_CONCURRENCY = 3;
const DEFAULT_REFILL_QUERY_LIMIT = 8;
const RERANKER_OUTER_GRACE_MS = 750;
const DEFAULT_RECOMMENDATION_CACHE_TTL_MS = 7 * 60 * 1000;
const DEFAULT_RECOMMENDATION_CACHE_ENTRIES = 150;

class ProductProviderError extends Error {
  constructor(message, {
    status = 502,
    code = "PRODUCT_PROVIDER_FAILED",
    cause,
    details,
  } = {}) {
    super(message, {cause});
    this.name = "ProductProviderError";
    this.status = status;
    this.code = code;
    if (details != null) this.details = details;
  }
}

function postProcessOutfitCandidates({
  requirements = [],
  products = [],
  context = {},
  provider = "unknown",
  logger = console,
  strategy = composeOutfitCandidates,
} = {}) {
  const safeRequirements = Array.isArray(requirements) ? requirements : [];
  const safeProducts = Array.isArray(products) ? products : [];
  const expectedSelections = expectedOutfitSelections(safeRequirements);
  if (expectedSelections.length === 0) {
    logger.info?.("outfit_aesthetic_strategy_skipped", {
      request_id: context.requestId || undefined,
      provider,
      reason: "NO_COMPOSABLE_LOOK",
      candidate_count: safeProducts.length,
    });
    return Object.freeze({
      applied: false,
      products: safeProducts,
      looks: Object.freeze([]),
      version: null,
    });
  }

  let composition;
  try {
    composition = strategy({
      requirements: safeRequirements,
      products: safeProducts,
      context,
      topPerRequirement: DEFAULT_STRATEGY_CANDIDATE_BREADTH,
      beamWidth: DEFAULT_STRATEGY_BEAM_WIDTH,
    });
  } catch (error) {
    logger.error?.("outfit_aesthetic_strategy_failed", {
      request_id: context.requestId || undefined,
      provider,
      error_code: safeProviderCode(error),
    });
    throw new ProductProviderError("整套穿搭联合选择失败", {
      status: 502,
      code: "OUTFIT_AESTHETIC_STRATEGY_FAILED",
      cause: error,
    });
  }

  const qualityPassLooks = (Array.isArray(composition?.looks)
    ? composition.looks : []).filter((look) =>
    look?.whole_look_quality?.status === "PASS");
  const qualityByLook = new Map(qualityPassLooks.map((look) => [
    String(look.look_id || ""),
    look.whole_look_quality,
  ]));
  const selectedProducts = Array.isArray(composition?.products)
    ? composition.products.map((product) => annotateOutfitStrategySelection(
      product,
      qualityByLook.get(String(product?.look_id || "")),
    )).filter((product) => product.whole_look_quality_status === "PASS")
    : [];
  const selectedKeys = new Set(selectedProducts.map(outfitSelectionKey));
  const qualityPassLookIds = new Set(qualityPassLooks.map((look) =>
    String(look.look_id || "")));
  const missingSelections = expectedSelections.filter((selection) =>
    qualityPassLookIds.has(selection.lookId) &&
    !selectedKeys.has(selection.key));
  if (composition?.applied !== true || missingSelections.length > 0 ||
      (qualityPassLooks.length > 0 && selectedProducts.length === 0)) {
    logger.error?.("outfit_aesthetic_strategy_incomplete", {
      request_id: context.requestId || undefined,
      provider,
      expected_selection_count: expectedSelections.length,
      selected_count: selectedProducts.length,
      missing: missingSelections.map(({lookId, slot}) => ({
        look_id: lookId,
        slot,
      })),
    });
    throw new ProductProviderError("整套穿搭联合选择未覆盖全部需求槽位", {
      status: 422,
      code: "OUTFIT_AESTHETIC_STRATEGY_INCOMPLETE",
      details: {
        missing: missingSelections.map(({lookId, slot}) => ({
          look_id: lookId,
          slot,
        })),
      },
    });
  }

  const result = Object.freeze({
    ...composition,
    looks: Object.freeze(qualityPassLooks),
    products: Object.freeze(selectedProducts),
  });
  logger.info?.("outfit_aesthetic_strategy_summary", {
    request_id: context.requestId || undefined,
    provider,
    version: result.version,
    look_count: result.looks.length,
    selected_count: result.products.length,
    rejected_look_count: Array.isArray(result.rejected_looks)
      ? result.rejected_looks.length : 0,
    looks: result.looks.map((look) => ({
      look_id: look.look_id,
      final_score: look.final_score,
      duplicate_penalty: look.duplicate_penalty,
      selected_candidate_ids: look.selected_candidate_ids,
      candidate_breadth: look.candidate_breadth,
    })),
  });
  return result;
}

async function runSharedCandidatePipeline({
  requirements = [],
  groups = [],
  context = {},
  provider = "unknown",
  logger = console,
  environment = process.env,
  reranker = null,
  outfitPostProcessor = postProcessOutfitCandidates,
  rerankTimeoutMs = PRODUCT_RERANK_BUDGET_MS,
  deadlineAt = 0,
  refillCandidates = null,
  gatePassTargetPerCoreSlot = DEFAULT_GATE_PASS_TARGET_PER_CORE_SLOT,
  maxRefillRounds = DEFAULT_MAX_REFILL_ROUNDS,
  minimumCompleteLooks = DEFAULT_MINIMUM_COMPLETE_LOOKS,
  wholeLookAIAdjudicator = null,
} = {}) {
  const safeRequirements = (Array.isArray(requirements) ? requirements : [])
    .map((requirement) => normalizeProductRequirement(
      {...context, ...requirement},
      context,
    ));
  const requirementsByKey = new Map(safeRequirements.map((requirement) => [
    requirementPipelineKey(requirement),
    requirement,
  ]));
  const rawGroups = (Array.isArray(groups) ? groups : []).map((group) => {
    const normalized = normalizeProductRequirement(
      {...context, ...(group?.requirement || {})},
      context,
    );
    const requirement = requirementsByKey.get(requirementPipelineKey(normalized)) ||
      normalized;
    return {
      requirement,
      candidates: (Array.isArray(group?.candidates) ? group.candidates : [])
        .map((product) => preserveCandidateContract(product, requirement)),
    };
  });
  const rawUserInput =
    context.decision_context?.raw_user_input ||
    context.recommendation_context?.decision_context?.raw_user_input || null;
  const includeRawUserInput = !isProductionRuntime(environment);
  const trace = {
    request_id: context.requestId || context.request_id || null,
    decision_context_id:
      context.decision_context?.decision_context_id ||
      context.recommendation_context?.decision_context_id ||
      context.decision_context_id || null,
    ...(includeRawUserInput ? {raw_user_input: rawUserInput} : {}),
    provider,
    raw_candidates: rawGroups.flatMap((group) => group.candidates.map((product) =>
      candidateTraceRecord(product, group.requirement, "RAW"))),
    relevance_pass: [],
    gate_pass: [],
    gate_reject: [],
    reranker_keep: [],
    strategy_selected: [],
    relevance_executed: true,
    reranker_executed: false,
    strategy_executed: false,
    reranker_status: "NOT_RUN",
    reranker_fallback_reasons: [],
    reranker_timing: null,
    refill_trigger_count: 0,
    refill_slot_attempt_count: 0,
    refill_network_query_count: 0,
    refill_max_rounds_used: 0,
    refill_rounds: [],
    quality_deficit_diagnoses: [],
    slot_outcomes: [],
    requested_looks: [...new Set(safeRequirements.map((requirement) =>
      String(requirement?.look_id || "")).filter(Boolean))].length,
    candidate_complete_looks: 0,
    whole_look_quality_valid_looks: 0,
    rejected: [],
    whole_look_ai_adjudication: [],
    query_plans: safeRequirements.map((requirement) => Object.freeze({
      look_id: requirement.look_id,
      concept_id: requirement.concept_id,
      slot: outfitRequirementSlot(requirement),
      query_plan_version: requirement.query_plan_version || null,
      commerce_queries: Object.freeze(requirementSearchKeywords(requirement)),
      commerce_negatives: Object.freeze([
        ...(requirement.commerce_query_plan?.commerce_negatives || []),
      ]),
    })),
  };

  const processedGroups = rawGroups.map((group) => processCandidateGroup({
    group,
    context,
    trace,
    stagePrefix: "",
  }));
  let gateGroups = processedGroups.map(({requirement, gateCandidates}) => ({
    requirement,
    candidates: gateCandidates,
  }));
  const hasComposableContract = expectedOutfitSelections(safeRequirements).length > 0;
  const configuredGateTarget = Math.max(1, Math.min(
    DEFAULT_STRATEGY_CANDIDATE_BREADTH,
    positiveInteger(
      gatePassTargetPerCoreSlot,
      DEFAULT_GATE_PASS_TARGET_PER_CORE_SLOT,
    ),
  ));
  const effectiveGateTarget = typeof refillCandidates === "function"
    ? configuredGateTarget : 1;
  const activeReranker = reranker || new ProductAestheticReranker({
    client: null,
    visualEvaluationEnabled: false,
    logger,
  });
  if (!hasComposableContract) {
    const refillResult = await refillGateDeficientGroups({
      groups: gateGroups,
      context,
      trace,
      refillCandidates,
      targetPerCoreSlot: effectiveGateTarget,
      maxRounds: Math.min(
        DEFAULT_MAX_REFILL_ROUNDS,
        positiveInteger(maxRefillRounds, DEFAULT_MAX_REFILL_ROUNDS),
      ),
    });
    gateGroups = refillResult.groups;
    trace.slot_outcomes = refillResult.slotOutcomes;
    return finalizeNonComposableCandidatePipeline({
      requirements: safeRequirements,
      gateGroups,
      context,
      provider,
      logger,
      trace,
      activeReranker,
      outfitPostProcessor,
      rerankTimeoutMs,
      deadlineAt,
    });
  }

  // Whole-look refill is quality-triggered: first evaluate every complete
  // combination already available, then retrieve only for rejected Looks.
  const requestedLookIds = new Set(safeRequirements.map((requirement) =>
    String(requirement?.look_id || "")).filter(Boolean));
  const seenByGroup = buildSeenCandidatesByGroup(trace.raw_candidates);
  const boundedRefillRounds = Math.min(
    DEFAULT_MAX_REFILL_ROUNDS,
    positiveInteger(maxRefillRounds, DEFAULT_MAX_REFILL_ROUNDS),
  );
  let selection = emptyWholeLookSelection();
  for (let round = 0; round <= boundedRefillRounds; round += 1) {
    const completeLookIds = completeLookIdsForGroups(
      safeRequirements,
      gateGroups,
      1,
    );
    trace.candidate_complete_looks = completeLookIds.size;
    const activeRequirements = safeRequirements.filter((requirement) =>
      completeLookIds.has(String(requirement?.look_id || "")));
    const activeGroups = gateGroups.filter((group) => completeLookIds.has(String(
      group?.requirement?.look_id || "",
    )));
    selection = activeGroups.length > 0
      ? await executeCandidateSelectionAttempt({
        requirements: activeRequirements,
        gateGroups: activeGroups,
        context,
        provider,
        logger,
        trace,
        activeReranker,
        outfitPostProcessor,
        rerankTimeoutMs,
        deadlineAt,
      })
      : emptyWholeLookSelection();

    const passLookIds = new Set(selection.looks.map((look) =>
      String(look?.look_id || "")).filter(Boolean));
    trace.whole_look_quality_valid_looks = passLookIds.size;
    const rejectedLookIds = new Set([...requestedLookIds].filter((lookId) =>
      !passLookIds.has(lookId)));
    trace.rejected = buildRejectedLookTrace({
      requestedLookIds,
      completeLookIds,
      composition: selection,
    });
    if (rejectedLookIds.size === 0 || round === boundedRefillRounds ||
        typeof refillCandidates !== "function") break;
    gateGroups = await refillWholeLookFailures({
      groups: gateGroups,
      rejectedLookIds,
      composition: selection,
      context,
      trace,
      refillCandidates,
      round: round + 1,
      seenByGroup,
    });
  }

  trace.slot_outcomes = buildSlotOutcomes(gateGroups, 1, trace);
  if (selection.looks.length < 1) {
    emitCandidatePipelineTrace(logger, trace);
    throw new ProductProviderError("没有通过整套质量判定的穿搭", {
      status: 422,
      code: "INSUFFICIENT_QUALITY_LOOKS",
      details: {trace: freezeCandidatePipelineTrace(trace)},
    });
  }
  if (wholeLookAIAdjudicator?.adjudicate) {
    selection = await applyWholeLookAIAdjudication({
      composition: selection,
      candidatePool: selection.candidate_pool,
      context,
      adjudicator: wholeLookAIAdjudicator,
      logger,
      requestId: trace.request_id,
    });
    trace.whole_look_ai_adjudication = selection.whole_look_ai_adjudication || [];
    trace.whole_look_quality_valid_looks = selection.looks.length;
    trace.rejected = buildRejectedLookTrace({
      requestedLookIds,
      completeLookIds: completeLookIdsForGroups(safeRequirements, gateGroups, 1),
      composition: selection,
    });
    if (selection.looks.length === 0) {
      emitCandidatePipelineTrace(logger, trace);
      throw new ProductProviderError("整套裁决后没有质量合格穿搭", {
        status: 422,
        code: "INSUFFICIENT_QUALITY_LOOKS",
        details: {trace: freezeCandidatePipelineTrace(trace)},
      });
    }
  }
  trace.strategy_selected = selection.products.map((product) =>
    candidateTraceRecord(product, findRequirementForProduct(
      safeRequirements,
      product,
    ), "STRATEGY_SELECTED"));
  emitCandidatePipelineTrace(logger, trace);
  const {candidate_pool: _candidatePool, ...publicSelection} = selection;
  return Object.freeze({
    ...publicSelection,
    products: Object.freeze(selection.products),
    looks: Object.freeze(selection.looks),
    rejected_looks: Object.freeze(selection.rejected_looks || []),
    trace: freezeCandidatePipelineTrace(trace),
  });
}

function emptyWholeLookSelection() {
  return {
    applied: true,
    products: [],
    looks: [],
    rejected_looks: [],
    version: null,
  };
}

async function finalizeNonComposableCandidatePipeline({
  requirements,
  gateGroups,
  context,
  provider,
  logger,
  trace,
  activeReranker,
  outfitPostProcessor,
  rerankTimeoutMs,
  deadlineAt,
}) {
  if (gateGroups.flatMap((group) => group.candidates).length === 0) {
    emitCandidatePipelineTrace(logger, trace);
    return Object.freeze({
      applied: false,
      products: Object.freeze([]),
      looks: Object.freeze([]),
      version: null,
      trace: freezeCandidatePipelineTrace(trace),
    });
  }
  const result = await executeCandidateSelectionAttempt({
    requirements,
    gateGroups,
    context,
    provider,
    logger,
    trace,
    activeReranker,
    outfitPostProcessor,
    rerankTimeoutMs,
    deadlineAt,
    requireWholeLookQuality: false,
  });
  emitCandidatePipelineTrace(logger, trace);
  return Object.freeze({
    ...result,
    products: Object.freeze(result.products),
    trace: freezeCandidatePipelineTrace(trace),
  });
}

async function executeCandidateSelectionAttempt({
  requirements,
  gateGroups,
  context,
  provider,
  logger,
  trace,
  activeReranker,
  outfitPostProcessor,
  rerankTimeoutMs,
  deadlineAt,
  requireWholeLookQuality = true,
  wholeLookAIAdjudicator = null,
}) {
  const gateCandidatesFlat = gateGroups.flatMap((group) => group.candidates);
  if (gateCandidatesFlat.length === 0) return emptyWholeLookSelection();
  trace.reranker_executed = true;
  let reranked;
  try {
    const timeoutMs = deadlineAt > 0
      ? Math.max(1, Math.min(rerankTimeoutMs, deadlineAt - Date.now()))
      : rerankTimeoutMs;
    const outerTimeoutMs = deadlineAt > 0
      ? Math.max(1, Math.min(
        timeoutMs + RERANKER_OUTER_GRACE_MS,
        deadlineAt - Date.now(),
      ))
      : timeoutMs + RERANKER_OUTER_GRACE_MS;
    reranked = await withTimeBudget(activeReranker.rerank({
      groups: gateGroups,
      context,
      requestId: trace.request_id || "",
      selectionLimit: DEFAULT_STRATEGY_CANDIDATE_BREADTH,
    }), outerTimeoutMs, "AI_RERANK_TIMEOUT");
    trace.reranker_status = reranked.some((product) =>
      product?.ai_rerank_fallback === true) ? "FALLBACK" : "SUCCESS";
    trace.reranker_fallback_reasons = [...new Set([
      ...(trace.reranker_fallback_reasons || []),
      ...reranked.map((product) => product?.ai_rerank_fallback_reason)
        .filter(Boolean),
    ])];
    trace.reranker_timing = activeReranker.getTraceForRequest?.(
      trace.request_id || "",
    ) || activeReranker.getStats?.().last_trace || null;
  } catch (error) {
    trace.reranker_status = "FAILED_FALLBACK";
    trace.reranker_fallback_reason = safeProviderCode(error);
    trace.reranker_fallback_reasons = [...new Set([
      ...(trace.reranker_fallback_reasons || []),
      trace.reranker_fallback_reason,
    ])];
    trace.reranker_timing = activeReranker.getTraceForRequest?.(
      trace.request_id || "",
    ) || activeReranker.getStats?.().last_trace || null;
    logger.warn?.("candidate_pipeline_reranker_failed", {
      request_id: trace.request_id || undefined,
      provider,
      error_code: safeProviderCode(error),
    });
    reranked = gateGroups.flatMap((group) => markRerankFallback(
      group.candidates.slice(0, DEFAULT_STRATEGY_CANDIDATE_BREADTH),
      trace.reranker_fallback_reason,
    ));
  }
  const sourceCandidates = new Map(gateCandidatesFlat.map((product) => [
    candidatePipelineKey(product),
    product,
  ]));
  const rerankerProducts = limitProductsPerRequirement(
    (Array.isArray(reranked) ? reranked : [])
      .map((product) => restoreCandidateContract(product, sourceCandidates))
      .filter(Boolean),
    requirements,
    DEFAULT_STRATEGY_CANDIDATE_BREADTH,
  );
  trace.reranker_keep.push(...rerankerProducts.map((product) =>
    candidateTraceRecord(product, findRequirementForProduct(
      requirements,
      product,
    ), "RERANKER_KEEP")));
  if (rerankerProducts.length === 0) return emptyWholeLookSelection();

  let composition;
  try {
    composition = outfitPostProcessor({
      requirements,
      products: rerankerProducts,
      context,
      provider,
      logger,
    });
  } catch (error) {
    emitCandidatePipelineTrace(logger, trace);
    throw error;
  }
  trace.strategy_executed = composition?.applied === true;
  const adjudicated = requireWholeLookQuality
    ? normalizeQualityPassingComposition(composition)
    : composition;
  const selectedProducts = (Array.isArray(adjudicated?.products)
    ? adjudicated.products : []).map((product) =>
    restoreCandidateContract(product, sourceCandidates) || product);
  return {
    ...adjudicated,
    products: selectedProducts,
    looks: Array.isArray(adjudicated?.looks) ? adjudicated.looks : [],
    rejected_looks: Array.isArray(adjudicated?.rejected_looks)
      ? adjudicated.rejected_looks : [],
    candidate_pool: rerankerProducts,
  };
}

function normalizeQualityPassingComposition(composition) {
  const looks = (Array.isArray(composition?.looks) ? composition.looks : [])
    .filter((look) => look?.whole_look_quality?.status === "PASS");
  const rejected = [
    ...(Array.isArray(composition?.rejected_looks)
      ? composition.rejected_looks : []),
    ...(Array.isArray(composition?.looks) ? composition.looks : [])
      .filter((look) => look?.whole_look_quality?.status !== "PASS"),
  ];
  const acceptedById = new Map(looks.map((look) => [
    String(look.look_id || ""),
    look.whole_look_quality,
  ]));
  return {
    ...composition,
    looks,
    rejected_looks: rejected,
    products: (composition?.products || []).filter((product) =>
      acceptedById.has(String(product?.look_id || ""))).map((product) => ({
      ...product,
      whole_look_quality_status: "PASS",
      whole_look_quality: acceptedById.get(String(product.look_id || "")),
    })),
  };
}

async function applyWholeLookAIAdjudication({
  composition,
  candidatePool = [],
  context = {},
  adjudicator,
  logger = console,
  requestId = null,
}) {
  const looks = Array.isArray(composition?.looks) ? composition.looks : [];
  if (looks.length === 0 || !adjudicator?.adjudicate) return composition;
  const session = typeof adjudicator.createSession === "function"
    ? adjudicator.createSession() : null;
  const preparedByLook = looks.map((look) => ({
    look,
    candidates: prepareWholeLookAdjudicationCandidates(
      look,
      candidatePool,
      context,
    ),
  }));
  const decisions = await Promise.all(preparedByLook.map(async ({look, candidates}) => {
    try {
      const decision = await adjudicator.adjudicate({
        candidates,
        context,
        requestId,
        lookId: look.look_id,
        session,
      });
      return {look, candidates, decision};
    } catch (error) {
      logger.warn?.("whole_look_ai_adjudication_failed", {
        request_id: requestId || undefined,
        look_id: look.look_id || undefined,
        error_code: safeWholeLookAdjudicationCode(error),
      });
      return {
        look,
        candidates,
        decision: {
          winner_look_candidate_id: candidates[0]?.look_candidate_id || null,
          winner: candidates[0] || null,
          source: "DETERMINISTIC",
          fallback: true,
          fallback_reason: safeWholeLookAdjudicationCode(error),
          trace: Object.freeze({
            version: "whole_look_ai_adjudicator.v1",
            look_id: look.look_id || null,
            status: "AI_FALLBACK",
            decision_mode: "DETERMINISTIC_FALLBACK",
            fallback_reason: safeWholeLookAdjudicationCode(error),
          }),
        },
      };
    }
  }));

  const selectedProducts = [];
  const selectedLooks = [];
  const traces = [];
  const usedProductKeys = new Set();
  for (const {look, candidates, decision} of decisions) {
    let winner = candidates.find((candidate) =>
      candidate.look_candidate_id === decision?.winner_look_candidate_id) ||
      candidates[0] || null;
    let duplicateGuardApplied = false;
    if (winner && candidateRepeatsUsedProduct(winner, usedProductKeys)) {
      const nonDuplicate = candidates.find((candidate) =>
        !candidateRepeatsUsedProduct(candidate, usedProductKeys));
      if (nonDuplicate) {
        winner = nonDuplicate;
        duplicateGuardApplied = true;
      }
    }
    const deterministicProducts = (composition.products || []).filter((product) =>
      String(product?.look_id || "") === String(look?.look_id || ""));
    const products = winner?.whole_look_quality?.status === "PASS"
      ? materializeWholeLookWinnerProducts(winner, look)
      : deterministicProducts;
    if (products.length === 0 || look?.whole_look_quality?.status !== "PASS") {
      continue;
    }
    products.forEach((product) => {
      const identity = productIdentity(product);
      if (identity) usedProductKeys.add(identity);
      selectedProducts.push(product);
    });
    const adjudicationTrace = Object.freeze({
      ...(decision?.trace || {}),
      status: winner ? decision?.trace?.status : "AI_FALLBACK",
      decision_mode: winner
        ? decision?.trace?.decision_mode : "DETERMINISTIC_FALLBACK",
      fallback_reason: winner
        ? decision?.trace?.fallback_reason : "AI_CANDIDATE_PREPARATION_FAILED",
      applied_winner_look_candidate_id: winner?.look_candidate_id ||
        look.look_candidate_id,
      duplicate_guard_applied: duplicateGuardApplied,
    });
    traces.push(adjudicationTrace);
    selectedLooks.push(Object.freeze({
      ...look,
      look_candidate_id: winner?.look_candidate_id || look.look_candidate_id,
      final_score: winner?.adjusted_score ?? look.final_score,
      base_score: winner?.base_score ?? look.base_score,
      duplicate_penalty: winner?.cross_look_duplicate_penalty ??
        look.duplicate_penalty,
      selected_candidate_ids: Object.freeze([...(winner?.candidate_ids ||
        look.selected_candidate_ids || [])]),
      strategy_trace: winner?.strategy_trace || look.strategy_trace,
      whole_look_quality: winner?.whole_look_quality || look.whole_look_quality,
      quality: winner?.whole_look_quality || look.whole_look_quality,
      quality_status: (winner?.whole_look_quality || look.whole_look_quality).status,
      whole_look_ai_adjudication: adjudicationTrace,
    }));
  }
  return {
    ...composition,
    products: selectedProducts,
    looks: selectedLooks,
    whole_look_ai_adjudication: Object.freeze(traces),
  };
}

function prepareWholeLookAdjudicationCandidates(look, candidatePool, context = {}) {
  const alternatives = Array.isArray(look?.quality_valid_alternatives)
    ? look.quality_valid_alternatives : [];
  const concept = (context?.outfit_plan?.looks || []).find((entry) =>
    String(entry?.look_id || entry?.lookId || "") === String(look?.look_id || "")) ||
    {};
  return alternatives.slice(0, 3).map((alternative) => {
    const products = (alternative.candidate_ids || []).map((candidateId) =>
      findCandidateForLook(candidatePool, look.look_id, candidateId))
      .filter(Boolean);
    return Object.freeze({
      ...alternative,
      look_id: look.look_id,
      concept_summary: concept.concept_summary || concept.summary ||
        concept.concept_name || concept.name || null,
      style_direction: concept.style_target || concept.style_direction ||
        concept.style || null,
      scene: concept.scene || context.scene || null,
      silhouette: concept.silhouette || concept.body_fit_strategy || null,
      palette: concept.palette || concept.color_target || null,
      selected_products: Object.freeze(products),
      whole_look_quality: alternative.whole_look_quality || alternative.quality,
    });
  }).filter((candidate) =>
    candidate.whole_look_quality?.status === "PASS" &&
    candidate.selected_products.length === candidate.candidate_ids.length);
}

function findCandidateForLook(candidatePool, lookId, candidateId) {
  const expectedLookId = String(lookId || "");
  const expectedCandidateId = String(candidateId || "");
  return (candidatePool || []).find((candidate) =>
    String(candidate?.look_id || "") === expectedLookId &&
    candidateProductId(candidate) === expectedCandidateId) || null;
}

function candidateProductId(product = {}) {
  return String(product?.candidate_id || product?.product_id || product?.id || "");
}

function productIdentity(product = {}) {
  return String(product?.canonical_product_identity ||
    canonicalProductIdentity(product) || candidateProductId(product));
}

function candidateRepeatsUsedProduct(candidate, usedProductKeys) {
  return (candidate?.selected_products || []).some((product) => {
    const identity = productIdentity(product);
    return identity && usedProductKeys.has(identity);
  });
}

function materializeWholeLookWinnerProducts(winner, look) {
  const trace = winner.strategy_trace || {};
  const quality = winner.whole_look_quality;
  return winner.selected_products.map((product) => ({
    ...product,
    look_id: look.look_id,
    outfit_selected: true,
    outfit_strategy_score: winner.adjusted_score,
    outfit_duplicate_penalty: winner.cross_look_duplicate_penalty,
    outfit_strategy_trace: trace,
    outfit_strategy_breakdown: Object.freeze({
      style_coherence: trace.styleCoherence,
      occasion_fit: trace.occasionFormalityFit,
      formality: trace.formality,
      silhouette: trace.silhouetteCoherence,
      body_proportion: trace.bodyProportion,
      color_harmony: trace.colorHarmony,
      footwear_compatibility: trace.footwearCompatibility,
      brand_quality_value: trace.brandQualityValueCoherence,
      focal_hierarchy: trace.focalHierarchy,
      market_alignment: trace.marketAlignment,
    }),
    outfit_quality_status: quality.status,
    outfit_quality_reason_codes: quality.reason_codes,
    outfit_quality_trace: quality,
    whole_look_quality_status: quality.status,
    whole_look_quality: quality,
  }));
}

function buildSeenCandidatesByGroup(rawCandidates = []) {
  const seenByGroup = new Map();
  for (const record of rawCandidates || []) {
    const key = `${record.look_id}:${record.slot}`;
    const seen = seenByGroup.get(key) || new Set();
    if (record.underlying_product_key) {
      seen.add(`identity:${record.underlying_product_key}`);
    }
    if (record.candidate_id) seen.add(`id:${record.candidate_id}`);
    seenByGroup.set(key, seen);
  }
  return seenByGroup;
}

async function refillWholeLookFailures({
  groups,
  rejectedLookIds,
  composition,
  context,
  trace,
  refillCandidates,
  round,
  seenByGroup,
}) {
  const working = groups.map((group) => ({
    requirement: group.requirement,
    candidates: dedupeCandidates(group.candidates),
  }));
  const rejectedById = new Map((composition?.rejected_looks || []).map((look) => [
    String(look?.look_id || ""),
    look,
  ]));
  const diagnoses = new Map([...rejectedLookIds].map((lookId) => {
    const lookGroups = working.filter((group) =>
      String(group?.requirement?.look_id || "") === lookId);
    const diagnosis = diagnoseQualityDeficit({
      rejectedLook: rejectedById.get(lookId) || {look_id: lookId},
      groups: lookGroups,
      round,
      context,
    });
    trace.quality_deficit_diagnoses.push(diagnosis);
    return [lookId, diagnosis];
  }));
  const targets = working.map((group, index) => ({
    group,
    index,
    diagnosis: diagnoses.get(String(group?.requirement?.look_id || "")),
  })).filter(({group, diagnosis}) =>
    rejectedLookIds.has(String(group?.requirement?.look_id || "")) &&
    (!diagnosis?.failing_slots?.length || diagnosis.failing_slots.includes(
      outfitRequirementSlot(group.requirement),
    )));
  trace.refill_trigger_count += new Set(targets.map(({group}) =>
    requirementPipelineKey(group.requirement))).size;
  trace.refill_slot_attempt_count += targets.length;
  trace.refill_max_rounds_used = Math.max(trace.refill_max_rounds_used, round);
  const settled = await mapSettledWithConcurrency(
    targets,
    DEFAULT_REFILL_CONCURRENCY,
    async ({group, index, diagnosis}) => ({
      index,
      response: await refillCandidates({
        requirement: group.requirement,
        round,
        originalCount: group.candidates.length,
        currentCount: group.candidates.length,
        reason: diagnosis?.refill_reason || "WHOLE_LOOK_QUALITY_REJECTED",
        qualityDeficit: diagnosis || null,
      }),
    }),
  );
  for (let resultIndex = 0; resultIndex < settled.length; resultIndex += 1) {
    const result = settled[resultIndex];
    const target = targets[resultIndex];
    const group = working[target.index];
    const requirement = group.requirement;
    const groupKey = requirementPipelineKey(requirement);
    const beforeCount = group.candidates.length;
    if (result.status === "rejected") {
      const failed = result.reason?.refillAttemptTrace || {};
      const queries = Array.isArray(failed.queries) ? failed.queries : [];
      trace.refill_network_query_count += Number(
        failed.network_query_count || queries.length || 0,
      );
      trace.refill_rounds.push(Object.freeze({
        look_id: requirement.look_id || null,
        slot: outfitRequirementSlot(requirement),
        round,
        refill_reason: "WHOLE_LOOK_QUALITY_REJECTED",
        weakest_dimensions: target.diagnosis?.weakest_dimensions || [],
        failing_slots: target.diagnosis?.failing_slots || [],
        deficit_dimension: target.diagnosis?.focus_dimension || null,
        before_count: beforeCount,
        query: Object.freeze([...queries]),
        returned_count: 0,
        unique_added: 0,
        accepted_count: 0,
        after_count: beforeCount,
        status: "FAILED",
        failure_reason: safeProviderCode(result.reason),
      }));
      continue;
    }
    const response = result.value?.response;
    const returned = Array.isArray(response)
      ? response
      : Array.isArray(response?.candidates) ? response.candidates : [];
    trace.refill_network_query_count += Array.isArray(response?.queries)
      ? response.queries.length : 0;
    const seen = seenByGroup.get(groupKey) || new Set();
    const uniqueRaw = [];
    for (const rawProduct of returned) {
      const product = prepareRefillCandidate(rawProduct, requirement);
      if (!product) continue;
      const keys = candidateDedupeKeys(product);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      uniqueRaw.push(product);
    }
    seenByGroup.set(groupKey, seen);
    trace.raw_candidates.push(...uniqueRaw.map((product) =>
      candidateTraceRecord(product, requirement, "QUALITY_REFILL_RAW")));
    const processed = processCandidateGroup({
      group: {requirement, candidates: uniqueRaw},
      context,
      trace,
      stagePrefix: "QUALITY_REFILL_",
    });
    // The existing pool has already failed every complete combination. Give
    // newly gated candidates a real chance to enter the bounded reranker pool
    // instead of appending them behind a full 20-item slice.
    group.candidates = dedupeCandidates([
      ...processed.gateCandidates,
      ...group.candidates,
    ]).slice(0, DEFAULT_RELEVANCE_POOL_PER_REQUIREMENT);
    trace.refill_rounds.push(Object.freeze({
      look_id: requirement.look_id || null,
      slot: outfitRequirementSlot(requirement),
      round,
      refill_reason: "WHOLE_LOOK_QUALITY_REJECTED",
      weakest_dimensions: target.diagnosis?.weakest_dimensions || [],
      failing_slots: target.diagnosis?.failing_slots || [],
      deficit_dimension: target.diagnosis?.focus_dimension || null,
      before_count: beforeCount,
      query: Object.freeze([...(response?.queries || [])]),
      returned_count: Number(response?.returned_count ?? returned.length),
      unique_added: uniqueRaw.length,
      relevance_pass: processed.relevanceCandidates.length,
      accepted_count: processed.gateCandidates.length,
      after_count: group.candidates.length,
      status: processed.gateCandidates.length > 0
        ? "CANDIDATES_ADDED" : "NO_QUALITY_CANDIDATES_ADDED",
    }));
  }
  return working;
}

function buildRejectedLookTrace({
  requestedLookIds,
  completeLookIds,
  composition,
}) {
  const selected = new Set((composition?.looks || []).map((look) =>
    String(look?.look_id || "")));
  const reported = new Map((composition?.rejected_looks || []).map((look) => [
    String(look?.look_id || ""),
    look,
  ]));
  return Object.freeze([...requestedLookIds].filter((lookId) =>
    !selected.has(lookId)).map((lookId) => {
    const rejection = reported.get(lookId);
    return Object.freeze({
      look_id: lookId,
      reason: completeLookIds.has(lookId)
        ? rejection?.whole_look_quality?.reason ||
          rejection?.whole_look_quality?.reason_code ||
          "WHOLE_LOOK_QUALITY_REJECTED"
        : "CANDIDATE_INCOMPLETE",
      whole_look_quality: rejection?.whole_look_quality || null,
    });
  }));
}

function buildSlotOutcomes(groups, targetPerCoreSlot, trace) {
  return (groups || []).map((group) => {
    const key = requirementPipelineKey(group.requirement);
    const target = candidateTargetForRequirement(
      group.requirement,
      targetPerCoreSlot,
    );
    const attempts = (trace.refill_rounds || []).filter((entry) =>
      `${entry.look_id || ""}:${entry.slot || ""}` === key);
    return Object.freeze({
      look_id: group.requirement.look_id || null,
      slot: outfitRequirementSlot(group.requirement),
      target_count: target,
      final_gate_pass: group.candidates.length,
      refill_round_count: attempts.length,
      status: group.candidates.length >= target
        ? "READY" : "INSUFFICIENT_QUALITY_CANDIDATES",
    });
  });
}

function processCandidateGroup({group, context, trace, stagePrefix = ""}) {
  const requirement = group?.requirement || {};
  const keyword = requirementSearchKeywords(requirement).join(" ") ||
    requirement.item_name || "";
  const relevanceCandidates = rankProducts(
    (Array.isArray(group?.candidates) ? group.candidates : []).map((product) =>
      product?.candidate_enrichment || product?.target_fit_assessment
        ? attachTargetFitAssessment(product, requirement, context)
        : product),
    requirement,
    keyword,
    {minimumScore: 35},
  ).slice(0, DEFAULT_RELEVANCE_POOL_PER_REQUIREMENT).map((product) =>
    preserveCandidateContract(product, requirement));
  trace.relevance_pass.push(...relevanceCandidates.map((product) =>
    candidateTraceRecord(
      product,
      requirement,
      `${stagePrefix}RELEVANCE_PASS`,
    )));
  const gateCandidates = [];
  for (const product of relevanceCandidates) {
    const gate = sharedCandidateGate(product, requirement, context);
    if (!gate.allowed) {
      trace.gate_reject.push(candidateTraceRecord(
        gate.product || product,
        requirement,
        `${stagePrefix}GATE_REJECT`,
        gate.reason,
      ));
      continue;
    }
    if (gate.product?.source === "taobao" &&
        gate.product?.product_acceptance_result === "SOFT_REJECT") {
      trace.gate_reject.push(candidateTraceRecord(
        gate.product,
        requirement,
        `${stagePrefix}GATE_REJECT`,
        "PRODUCT_ACCEPTANCE_SOFT_REJECT",
      ));
      continue;
    }
    const candidate = preserveCandidateContract({
      ...gate.product,
      candidate_gate_result: "PASS",
      candidate_gate_state: "PASS",
      candidate_gate_reason: "PASS",
    }, requirement);
    gateCandidates.push(candidate);
    trace.gate_pass.push(candidateTraceRecord(
      candidate,
      requirement,
      `${stagePrefix}GATE_PASS`,
    ));
  }
  return {requirement, relevanceCandidates, gateCandidates};
}

async function refillGateDeficientGroups({
  groups,
  context,
  trace,
  refillCandidates,
  targetPerCoreSlot,
  maxRounds,
} = {}) {
  const working = (Array.isArray(groups) ? groups : []).map((group) => ({
    requirement: group.requirement,
    candidates: dedupeCandidates(group.candidates),
  }));
  const initialCounts = new Map(working.map((group) => [
    requirementPipelineKey(group.requirement),
    group.candidates.length,
  ]));
  const seenByGroup = new Map();
  const triggeredKeys = new Set();
  for (const record of trace.raw_candidates || []) {
    const key = `${record.look_id}:${record.slot}`;
    const seen = seenByGroup.get(key) || new Set();
    if (record.underlying_product_key) {
      seen.add(`identity:${record.underlying_product_key}`);
    }
    if (record.candidate_id) seen.add(`id:${record.candidate_id}`);
    seenByGroup.set(key, seen);
  }

  if (typeof refillCandidates === "function") {
    for (let round = 1; round <= maxRounds; round += 1) {
      const deficient = working.map((group, index) => ({group, index}))
        .filter(({group}) => group.candidates.length <
          candidateTargetForRequirement(group.requirement, targetPerCoreSlot));
      if (deficient.length === 0) break;
      deficient.forEach(({group}) => triggeredKeys.add(
        requirementPipelineKey(group.requirement),
      ));
      trace.refill_slot_attempt_count += deficient.length;
      trace.refill_max_rounds_used = Math.max(trace.refill_max_rounds_used, round);
      const settled = await mapSettledWithConcurrency(
        deficient,
        DEFAULT_REFILL_CONCURRENCY,
        async ({group, index}) => ({
          index,
          response: await refillCandidates({
            requirement: group.requirement,
            round,
            originalCount: initialCounts.get(
              requirementPipelineKey(group.requirement),
            ) || 0,
            currentCount: group.candidates.length,
          }),
        }),
      );
      for (let resultIndex = 0; resultIndex < settled.length; resultIndex += 1) {
        const settledResult = settled[resultIndex];
        const deficientEntry = deficient[resultIndex];
        const group = working[deficientEntry.index];
        const requirement = group.requirement;
        const groupKey = requirementPipelineKey(requirement);
        const beforeCount = group.candidates.length;
        if (settledResult.status === "rejected") {
          const failedAttempt = settledResult.reason?.refillAttemptTrace || {};
          const attemptedQueries = Array.isArray(failedAttempt.queries)
            ? failedAttempt.queries : [];
          trace.refill_network_query_count += Number(
            failedAttempt.network_query_count || attemptedQueries.length || 0,
          );
          trace.refill_rounds.push(Object.freeze({
            look_id: requirement.look_id || null,
            slot: outfitRequirementSlot(requirement),
            round,
            refill_reason: "GATE_PASS_BELOW_TARGET",
            original_count: initialCounts.get(groupKey) || 0,
            before_count: beforeCount,
            query: Object.freeze([...attemptedQueries]),
            returned_count: 0,
            unique_added: 0,
            accepted_count: 0,
            after_count: beforeCount,
            status: "FAILED",
            failure_reason: safeProviderCode(settledResult.reason),
          }));
          continue;
        }
        const response = settledResult.value?.response;
        const returned = Array.isArray(response)
          ? response
          : Array.isArray(response?.candidates) ? response.candidates : [];
        trace.refill_network_query_count += Array.isArray(response?.queries)
          ? response.queries.length : 0;
        const seen = seenByGroup.get(groupKey) || new Set();
        const uniqueRaw = [];
        for (const rawProduct of returned) {
          const product = preserveCandidateContract(rawProduct, requirement);
          const keys = candidateDedupeKeys(product);
          if (keys.some((key) => seen.has(key))) continue;
          keys.forEach((key) => seen.add(key));
          uniqueRaw.push(product);
        }
        seenByGroup.set(groupKey, seen);
        trace.raw_candidates.push(...uniqueRaw.map((product) =>
          candidateTraceRecord(product, requirement, "REFILL_RAW")));
        const processed = processCandidateGroup({
          group: {requirement, candidates: uniqueRaw},
          context,
          trace,
          stagePrefix: "REFILL_",
        });
        group.candidates = dedupeCandidates([
          ...group.candidates,
          ...processed.gateCandidates,
        ]).slice(0, DEFAULT_RELEVANCE_POOL_PER_REQUIREMENT);
        trace.refill_rounds.push(Object.freeze({
          look_id: requirement.look_id || null,
          slot: outfitRequirementSlot(requirement),
          round,
          refill_reason: "GATE_PASS_BELOW_TARGET",
          original_count: initialCounts.get(groupKey) || 0,
          before_count: beforeCount,
          query: Object.freeze([...(response?.queries || [])]),
          returned_count: Number(response?.returned_count ?? returned.length),
          unique_added: uniqueRaw.length,
          relevance_pass: processed.relevanceCandidates.length,
          accepted_count: processed.gateCandidates.length,
          after_count: group.candidates.length,
          status: group.candidates.length >= candidateTargetForRequirement(
            requirement,
            targetPerCoreSlot,
          ) ? "TARGET_REACHED" : "STILL_DEFICIENT",
        }));
      }
    }
  }

  const slotOutcomes = working.map((group) => {
    const key = requirementPipelineKey(group.requirement);
    const target = candidateTargetForRequirement(
      group.requirement,
      targetPerCoreSlot,
    );
    const attempts = trace.refill_rounds.filter((entry) =>
      `${entry.look_id || ""}:${entry.slot || ""}` === key);
    return Object.freeze({
      look_id: group.requirement.look_id || null,
      slot: outfitRequirementSlot(group.requirement),
      target_count: target,
      initial_gate_pass: initialCounts.get(key) || 0,
      final_gate_pass: group.candidates.length,
      refill_round_count: attempts.length,
      status: group.candidates.length >= target
        ? "READY" : "INSUFFICIENT_QUALITY_CANDIDATES",
    });
  });
  trace.refill_trigger_count = triggeredKeys.size;
  return {groups: working, slotOutcomes};
}

function candidateTargetForRequirement(requirement, targetPerCoreSlot) {
  return ["top", "bottom", "dress", "shoes", "outerwear"].includes(
    outfitRequirementSlot(requirement),
  ) ? targetPerCoreSlot : 1;
}

function candidateDedupeKeys(product = {}) {
  const id = String(product?.candidate_id || product?.product_id || product?.id || "");
  const identity = String(
    product?.canonical_product_identity || canonicalProductIdentity(product) || "",
  );
  return [identity ? `identity:${identity}` : "", id ? `id:${id}` : ""]
    .filter(Boolean);
}

function dedupeCandidates(products = []) {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).filter((product) => {
    const keys = candidateDedupeKeys(product);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function completeLookIdsForGroups(requirements, groups, targetPerCoreSlot) {
  const counts = new Map((Array.isArray(groups) ? groups : []).map((group) => [
    requirementPipelineKey(group.requirement),
    group.candidates.length,
  ]));
  const expected = expectedOutfitSelections(requirements);
  const byLook = new Map();
  for (const selection of expected) {
    const values = byLook.get(selection.lookId) || [];
    values.push(selection);
    byLook.set(selection.lookId, values);
  }
  return new Set([...byLook.entries()]
    .filter(([, selections]) => selections.every((selection) =>
      Number(counts.get(`${selection.lookId}:${selection.slot}`) || 0) >=
        candidateTargetForRequirement(
          {category: selection.slot},
          targetPerCoreSlot,
        )))
    .map(([lookId]) => lookId));
}

async function mapSettledWithConcurrency(values, concurrency, mapper) {
  const items = Array.isArray(values) ? values : [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length: Math.min(
    Math.max(1, positiveInteger(concurrency, 1)),
    Math.max(1, items.length),
  )}, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await mapper(items[index], index),
        };
      } catch (reason) {
        results[index] = {status: "rejected", reason};
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function limitProductsPerRequirement(products, requirements, limit) {
  const counts = new Map();
  return products.filter((product) => {
    const requirement = findRequirementForProduct(requirements, product);
    const key = requirementPipelineKey(requirement || product);
    const count = counts.get(key) || 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
}

function sharedCandidateGate(product, requirement, context) {
  const gateRequirement = {
    ...requirement,
    category: outfitRequirementSlot(requirement),
  };
  const acceptance = evaluateProductAcceptance(product, requirement, context);
  const hardGate = candidateHardGate(
    acceptance.product,
    gateRequirement,
    context,
  );
  if (!hardGate.allowed) return {...hardGate, product: acceptance.product};
  if (!acceptance.allowed) {
    return {
      allowed: false,
      reason: `PRODUCT_ACCEPTANCE_${acceptance.reason}`,
      product: acceptance.product,
    };
  }
  const acceptedProduct = acceptance.product;
  const qualityBlock = productQualityBlock(acceptedProduct, requirement);
  if (qualityBlock) {
    return {
      allowed: false,
      reason: `QUALITY_${qualityBlock.blocked_category}`,
      product: acceptedProduct,
    };
  }
  const purchaseSpecification = compilePurchaseSpecification(requirement, context);
  const productSlot = outfitRequirementSlot(acceptedProduct);
  const purchaseGateProduct = productSlot !== requirement.category
    ? {...acceptedProduct, category: requirement.category}
    : acceptedProduct;
  // The legacy Purchase Specification taxonomy represents hosiery as an
  // accessory. The shared slot gate above already validates the true `socks`
  // slot, so do not turn that taxonomy bridge into a false category conflict.
  if (productSlot !== "socks" &&
    gateCandidates([purchaseGateProduct], purchaseSpecification).length === 0) {
    return {
      allowed: false,
      reason: "PURCHASE_SPECIFICATION_CONFLICT",
      product: acceptedProduct,
    };
  }
  const outfitBlueprint = context.outfit_blueprint || context.outfitBlueprint ||
    context.recommendation_context?.outfit_blueprint || {};
  const styleProfile = context.style_profile || context.styleProfile ||
    context.recommendation_context?.style_profile || {};
  const intentPriorityScore = resolveIntentPriorityScore(styleProfile);
  const blueprint = blueprintMatchAssessment(
    acceptedProduct,
    requirement,
    outfitBlueprint,
  );
  if (!blueprintMatchPassesHardGate(blueprint, intentPriorityScore)) {
    return {
      allowed: false,
      reason: "BLUEPRINT_HARD_GATE_CONFLICT",
      product: acceptedProduct,
    };
  }
  const body = bodyStrategyMatchAssessment(
    acceptedProduct,
    requirement,
    outfitBlueprint,
    context,
  );
  if (!context.body_fit_soft_only && body.configured && body.score < 40) {
    return {
      allowed: false,
      reason: "BODY_STRATEGY_CONFLICT",
      product: acceptedProduct,
    };
  }
  const marketSoftMatchScore = marketSoftSignalAssessment(
    acceptedProduct,
    requirement,
  );
  const styleGate = evaluateStyleGate(
    acceptedProduct,
    styleProfile,
    intentPriorityScore,
  );
  if (!styleGate.allowed) {
    return {
      allowed: false,
      reason: "STYLE_GATE_CONFLICT",
      product: acceptedProduct,
    };
  }
  return {
    allowed: true,
    reason: "PASS",
    product: {
      ...acceptedProduct,
      blueprint_match_score: blueprint.score,
      body_strategy_match_score: body.score,
      body_strategy_configured: body.configured,
      market_soft_match_score: marketSoftMatchScore,
      market_soft_signal_applied:
        Array.isArray(requirement.market_soft_signals) &&
        requirement.market_soft_signals.length > 0,
      matched_elements: product.matched_elements || blueprint.matched_elements,
      conflict_elements: product.conflict_elements || blueprint.conflict_elements,
    },
  };
}

function marketSoftSignalAssessment(product, requirement = {}) {
  const signals = (Array.isArray(requirement.market_soft_signals)
    ? requirement.market_soft_signals : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (signals.length === 0) return 60;
  const evidence = [
    product?.title,
    product?.name,
    product?.style,
    product?.style_tags,
    product?.aesthetic_tags,
    product?.silhouette_tags,
    product?.detail_tags,
    product?.occasion_tags,
    product?.color,
    product?.material,
  ].flat(Infinity).filter(Boolean).join(" ").toLowerCase()
    .replace(/[\s-]+/gu, "_");
  const matches = signals.filter((signal) => {
    const normalized = signal.replace(/[\s-]+/gu, "_");
    return evidence.includes(normalized) ||
      normalized.split("_").filter((token) => token.length > 2)
        .some((token) => evidence.includes(token));
  }).length;
  return Math.max(40, Math.min(100, Math.round(
    52 + (matches / signals.length) * 48,
  )));
}

function preserveCandidateContract(product, requirement = {}) {
  const originalGender = authoritativeProductGender(product);
  const requestedGender = normalizeGender(
    requirement.gender || product?.requested_gender || "unisex",
  );
  const originalCategory = product?.original_category || product?.category || "";
  const lookId = String(
    requirement?.look_id || requirement?.lookId || product?.look_id || "",
  );
  const conceptId = String(
    requirement?.concept_id || requirement?.conceptId ||
      product?.concept_id || "",
  );
  const slotKey = String(
    requirement?.slot_key || requirement?.slotKey || product?.slot_key || "",
  );
  const candidateId = String(
    product?.candidate_id || product?.product_id || product?.id || "",
  );
  return {
    ...product,
    ...(lookId ? {look_id: lookId} : {}),
    ...(conceptId ? {concept_id: conceptId} : {}),
    ...(slotKey ? {slot_key: slotKey} : {}),
    ...(candidateId ? {candidate_id: candidateId} : {}),
    original_gender: originalGender,
    gender: originalGender,
    requested_gender: requestedGender,
    original_category: originalCategory,
    style_tags: Object.freeze([...(product?.style_tags || product?.tags || [])]),
    occasion_tags: Object.freeze([
      ...(product?.occasion_tags || product?.occasions ||
        (product?.occasion ? [product.occasion] : [])),
    ]),
    source: String(product?.source || "unknown"),
  };
}

function prepareRefillCandidate(product, requirement = {}) {
  const preserved = preserveCandidateContract(product, requirement);
  if (preserved.source !== "taobao" || hasSemanticEnrichment(
    preserved.candidate_enrichment,
  )) {
    return preserved;
  }
  try {
    const fullRaw = preserved.raw_product &&
      preserved.raw_product.schema_version === "raw_taobao_product_v1"
      ? preserved.raw_product : null;
    const observedRaw = fullRaw || buildRawTaobaoProduct({
      item_id: preserved.product_id || preserved.id,
      title: preserved.raw_title || preserved.full_title ||
        preserved.title || preserved.name,
      short_title: preserved.short_title,
      category_id: preserved.category_id,
      category_name: preserved.category_name,
      level_one_category_id: preserved.level_one_category_id,
      level_one_category_name: preserved.level_one_category_name,
      zk_final_price: preserved.price,
      reserve_price: preserved.original_price,
      annual_vol: preserved.annual_vol,
      volume: preserved.volume,
      tk_total_sales: preserved.tk_total_sales,
      white_image: preserved.white_image,
      pict_url: preserved.pict_url || preserved.image_url,
      item_url: preserved.item_url || preserved.purchase_url,
      shop_title: preserved.shop_title || preserved.shop_name,
      seller_nick: preserved.seller_nick,
      brand_name: preserved.brand_name || preserved.brand,
      coupon_amount: preserved.coupon_amount,
      commission_rate: preserved.commission_rate,
    }, {
      query: preserved.search_keyword || "",
    });
    const enrichment = enrichTaobaoCandidate(observedRaw);
    return preserveCandidateContract({
      ...attachEnrichmentToCandidate(preserved, observedRaw, enrichment),
      refill_enrichment_status: "ENRICHED_FROM_PRODUCT_FACTS",
    }, requirement);
  } catch (_) {
    return null;
  }
}

function hasSemanticEnrichment(enrichment) {
  return Boolean(enrichment && [
    "style_expression",
    "contemporary_expression",
    "occasion_expression",
    "desired_impression_evidence",
    "audience_expression",
  ].every((field) => enrichment[field] && typeof enrichment[field] === "object"));
}

function restoreCandidateContract(product, sourceCandidates) {
  const source = sourceCandidates.get(candidatePipelineKey(product));
  if (!source) return null;
  return preserveCandidateContract({...product,
    original_gender: source.original_gender,
    gender: source.original_gender,
    requested_gender: source.requested_gender,
    original_category: source.original_category,
    source: source.source,
    style_tags: source.style_tags,
    occasion_tags: source.occasion_tags,
  }, {gender: source.requested_gender});
}

function candidateTraceRecord(product, requirement = {}, stage, reason = "") {
  return Object.freeze({
    stage,
    reason: reason || undefined,
    look_id: String(product?.look_id || requirement?.look_id || ""),
    slot: outfitRequirementSlot(product) || outfitRequirementSlot(requirement),
    candidate_id: String(
      product?.candidate_id || product?.product_id || product?.id || "",
    ),
    underlying_product_key:
      product?.canonical_product_identity || canonicalProductIdentity(product),
    title: String(product?.title || product?.name || "").slice(0, 240),
    price: Number.isFinite(Number(product?.price)) ? Number(product.price) : null,
    brand: String(product?.brand || product?.brand_name || "").slice(0, 120),
    original_gender: authoritativeProductGender(product),
    requested_gender: normalizeGender(
      requirement?.gender || product?.requested_gender || "unisex",
    ),
    category: String(product?.category || ""),
    style_tags: Object.freeze([...(product?.style_tags || product?.tags || [])]),
    occasion_tags: Object.freeze([
      ...(product?.occasion_tags || product?.occasions ||
        (product?.occasion ? [product.occasion] : [])),
    ]),
    source: String(product?.source || "unknown"),
    search_keyword: String(product?.search_keyword || ""),
    commerce_queries: Object.freeze(requirementSearchKeywords(requirement)),
    relevance_score: Number.isFinite(Number(product?.relevance_score))
      ? Number(product.relevance_score) : null,
    relevance_negative_conflict: product?.relevance_negative_conflict === true,
    product_acceptance_result: product?.product_acceptance_result || null,
    product_acceptance_penalty: Number.isFinite(
      Number(product?.product_acceptance_penalty),
    ) ? Number(product.product_acceptance_penalty) : null,
    product_acceptance_evidence: product?.product_acceptance_evidence || null,
    product_acceptance_trace: safeProductAcceptanceTrace(product),
    ai_rerank_fallback: product?.ai_rerank_fallback === true,
    ai_rerank_fallback_reason: product?.ai_rerank_fallback_reason || null,
    reranker_score: Number.isFinite(Number(
      product?.final_score ?? product?.ai_match_score,
    )) ? Number(product?.final_score ?? product?.ai_match_score) : null,
    reranker_score_trace: product?.reranker_score_trace || null,
    outfit_strategy_score: Number.isFinite(Number(
      product?.outfit_strategy_score,
    )) ? Number(product.outfit_strategy_score) : null,
    outfit_strategy_breakdown: product?.outfit_strategy_breakdown || null,
    raw_product_ref: product?.raw_product_ref || null,
    candidate_enrichment: product?.candidate_enrichment || null,
    target_fit_assessment: product?.target_fit_assessment || null,
  });
}

// Candidate pipeline traces are persisted and may be returned to diagnostics.
// Keep the useful acceptance decision and evidence while excluding the richer
// product object (including URLs, raw payloads, or any future secret-bearing
// fields) that may have been attached to the candidate.
function safeProductAcceptanceTrace(product = {}) {
  const trace = product?.product_acceptance_trace;
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return null;
  const evidence = trace.evidence && typeof trace.evidence === "object" &&
      !Array.isArray(trace.evidence)
    ? Object.fromEntries(Object.entries(trace.evidence).map(([key, item]) => [
      String(key).slice(0, 80),
      Object.freeze({
        value: redactTraceText(item?.value, 80),
        source: redactTraceText(item?.source || "unknown", 80),
        confidence: Number.isFinite(Number(item?.confidence))
          ? Math.max(0, Math.min(1, Number(item.confidence))) : 0,
        evidence: Object.freeze((Array.isArray(item?.evidence)
          ? item.evidence : []).map((entry) => redactTraceText(entry, 240))),
        applicability: redactTraceText(item?.applicability, 80),
      }),
    ]))
    : {};
  return Object.freeze({
    version: redactTraceText(trace.version, 80) || null,
    result: redactTraceText(trace.result, 80) || null,
    hard_reasons: Object.freeze((Array.isArray(trace.hard_reasons)
      ? trace.hard_reasons : []).map((entry) => redactTraceText(entry, 120))),
    soft_reasons: Object.freeze((Array.isArray(trace.soft_reasons)
      ? trace.soft_reasons : []).map((entry) => redactTraceText(entry, 120))),
    penalty: Number.isFinite(Number(trace.penalty)) ? Number(trace.penalty) : null,
    evidence: Object.freeze(evidence),
  });
}

function redactTraceText(value, limit) {
  return String(value || "")
    .replace(/(?:https?:)?\/\/\S+/giu, "[URL_REDACTED]")
    .slice(0, limit);
}

function requirementPipelineKey(requirement = {}) {
  return `${String(requirement.look_id || requirement.lookId || "")}:` +
    `${outfitRequirementSlot(requirement)}`;
}

function candidatePipelineKey(product = {}) {
  return `${String(product.look_id || product.lookId || "")}:` +
    `${outfitRequirementSlot(product)}:` +
    `${String(product.candidate_id || product.product_id || product.id || "")}`;
}

function findRequirementForProduct(requirements, product) {
  return requirements.find((requirement) =>
    requirementPipelineKey(requirement) ===
      `${String(product?.look_id || product?.lookId || "")}:` +
      `${outfitRequirementSlot(product)}`) || {};
}

function freezeCandidatePipelineTrace(trace) {
  return Object.freeze({...trace,
    raw_candidates: Object.freeze([...trace.raw_candidates]),
    relevance_pass: Object.freeze([...trace.relevance_pass]),
    gate_pass: Object.freeze([...trace.gate_pass]),
    gate_reject: Object.freeze([...trace.gate_reject]),
    reranker_keep: Object.freeze([...trace.reranker_keep]),
    strategy_selected: Object.freeze([...trace.strategy_selected]),
    refill_rounds: Object.freeze([...(trace.refill_rounds || [])]),
    quality_deficit_diagnoses: Object.freeze([
      ...(trace.quality_deficit_diagnoses || []),
    ]),
    slot_outcomes: Object.freeze([...(trace.slot_outcomes || [])]),
    rejected: Object.freeze([...(trace.rejected || [])]),
    whole_look_ai_adjudication: Object.freeze([
      ...(trace.whole_look_ai_adjudication || []),
    ]),
    query_plans: Object.freeze([...(trace.query_plans || [])]),
    reranker_fallback_reasons: Object.freeze([
      ...(trace.reranker_fallback_reasons || []),
    ]),
  });
}

function emitCandidatePipelineTrace(logger, trace) {
  logger.info?.("product_candidate_pipeline_trace", freezeCandidatePipelineTrace(trace));
}

function expectedOutfitSelections(requirements) {
  const grouped = new Map();
  for (const requirement of requirements) {
    const lookId = String(requirement?.look_id || requirement?.lookId || "").trim();
    const slot = outfitRequirementSlot(requirement);
    if (!lookId || !slot) continue;
    const group = grouped.get(lookId) || new Map();
    group.set(slot, {lookId, slot, key: `${lookId}:${slot}`});
    grouped.set(lookId, group);
  }
  return [...grouped.values()].flatMap((group) => {
    const slots = new Set(group.keys());
    const dressBased = slots.has("dress") && slots.has("shoes");
    const separates = slots.has("bottom") && slots.has("shoes") &&
      (slots.has("top") || slots.has("outerwear"));
    const invalid = slots.has("dress") &&
      (slots.has("top") || slots.has("bottom"));
    return dressBased || separates || invalid ? [...group.values()] : [];
  });
}

function annotateOutfitStrategySelection(product, wholeLookQuality = null) {
  const candidateId = String(
    product?.candidate_id || product?.product_id || product?.id || "",
  ).trim();
  return {
    ...product,
    outfit_selected_candidate_id: candidateId,
    whole_look_quality_status: wholeLookQuality?.status || null,
    whole_look_quality: wholeLookQuality || null,
    outfit_strategy_breakdown: Object.freeze({
      style_coherence: product?.outfit_style_coherence_score ?? null,
      occasion_formality_fit: product?.outfit_occasion_formality_score ?? null,
      silhouette_coherence: product?.outfit_silhouette_score ?? null,
      body_proportion: product?.outfit_body_proportion_score ?? null,
      color_harmony: product?.outfit_color_harmony_score ?? null,
      footwear_compatibility: product?.outfit_footwear_compatibility_score ?? null,
      femininity_expression: product?.outfit_femininity_expression_score ?? null,
      brand_quality_value_coherence:
        product?.outfit_brand_quality_value_score ?? null,
      legwear_compatibility: product?.outfit_legwear_compatibility_score ?? null,
      market_alignment: product?.outfit_market_alignment_score ?? null,
      product_acceptance_penalty:
        product?.outfit_product_acceptance_penalty ?? null,
    }),
  };
}

function outfitSelectionKey(product) {
  const lookId = String(product?.look_id || product?.lookId || "").trim();
  return `${lookId}:${outfitRequirementSlot(product)}`;
}

function outfitRequirementSlot(value = {}) {
  const rawCategory = String(value?.category || value || "").trim().toLowerCase();
  const subcategory = String(
    value?.search_subcategory || value?.searchSubcategory ||
      value?.subcategory || "",
  ).trim().toLowerCase();
  if (rawCategory === "socks" || subcategory === "socks") return "socks";
  if (rawCategory === "skirt") return "bottom";
  return normalizeProductCategory(rawCategory);
}

function mockCandidateForRequirement(product, requirement) {
  const slot = outfitRequirementSlot(requirement);
  const subcategory = mockRequirementSubcategory(requirement);
  return preserveCandidateContract({
    ...product,
    look_id: String(requirement.look_id || requirement.lookId || ""),
    category: slot,
    slot,
    ...(subcategory ? {
      subcategory,
      search_subcategory: subcategory,
    } : {}),
  }, requirement);
}

function mockCandidateMatchesRequirement(product, requirement) {
  const slot = outfitRequirementSlot(requirement);
  const requiredSubcategory = mockRequirementSubcategory(requirement);
  const evidence = [
    product?.title,
    product?.name,
    product?.category,
    ...(Array.isArray(product?.tags) ? product.tags : []),
  ].filter(Boolean).join(" ");
  const explicitCandidateSubcategory = String(
    product?.search_subcategory || product?.subcategory || "",
  ).trim().toLowerCase();
  const candidateSubcategory = explicitCandidateSubcategory === "skirt"
    ? "skirt"
    : normalizeSearchSubcategory(
      explicitCandidateSubcategory,
    evidence,
    product?.category || "",
    );
  if (slot === "socks") {
    return candidateSubcategory === "socks" ||
      outfitRequirementSlot(product) === "socks";
  }
  if (slot === "bag") return candidateSubcategory === "bag";
  if (slot === "accessory") {
    if (requiredSubcategory) return candidateSubcategory === requiredSubcategory;
    return outfitRequirementSlot(product) === "accessory" &&
      !["bag", "socks"].includes(candidateSubcategory);
  }
  if (slot === "bottom" && requiredSubcategory === "skirt") {
    return candidateSubcategory === "skirt" || /裙|skirt/iu.test(evidence);
  }
  return outfitRequirementSlot(product) === slot;
}

function mockRequirementSubcategory(requirement) {
  const explicit = String(
    requirement?.search_subcategory || requirement?.searchSubcategory ||
      requirement?.subcategory || "",
  ).trim().toLowerCase();
  if (explicit) return explicit;
  const evidence = [
    requirement?.item_name,
    requirement?.itemName,
    ...(Array.isArray(requirement?.search_keywords)
      ? requirement.search_keywords : []),
  ].filter(Boolean).join(" ");
  if (outfitRequirementSlot(requirement) === "bottom" && /裙|skirt/iu.test(evidence)) {
    return "skirt";
  }
  return "";
}

class ProductProvider {
  async recommend() {
    throw new ProductProviderError("商品 Provider 未实现");
  }

  async recommendForQueries(queries, context = {}) {
    const batches = await Promise.all((Array.isArray(queries) ? queries : []).map(
      (query) => this.recommend({...context, ...query, limit: 2}),
    ));
    return uniqueProducts(batches.flat()).slice(0, 12);
  }

  async searchShoppingAgentCandidates() {
    throw new ProductProviderError(
      "当前商品 Provider 不支持 Shopping Agent 真实候选召回",
      {status: 503, code: "SHOPPING_AGENT_SEARCH_UNAVAILABLE"},
    );
  }
}

class MockProductProvider extends ProductProvider {
  constructor({
    catalog = new ProductCatalog(),
    logger = console,
    reranker = null,
    outfitPostProcessor = postProcessOutfitCandidates,
    candidatePipeline = runSharedCandidatePipeline,
    wholeLookAIAdjudicator = null,
  } = {}) {
    super();
    this.catalog = catalog;
    this.logger = logger;
    this.reranker = reranker || new ProductAestheticReranker({
      client: null,
      visualEvaluationEnabled: false,
      logger,
    });
    this.outfitPostProcessor = outfitPostProcessor;
    this.candidatePipeline = candidatePipeline;
    this.wholeLookAIAdjudicator = wholeLookAIAdjudicator;
    this.lastPipelineTrace = null;
    this.name = "mock";
    this.configured = false;
    this.status = "mock";
  }

  async recommend(filters = {}) {
    return this.catalog.recommend(filters);
  }

  async recommendForQueries(queries, context = {}) {
    const values = Array.isArray(queries) ? queries : [];
    const groups = await Promise.all(values.map(async (query) => {
      const requirement = normalizeProductRequirement({...context, ...query}, context);
      const catalogQuery = outfitRequirementSlot(requirement) === "socks"
        ? {...query, category: "socks"}
        : query;
      const plannedQueries = requirementSearchKeywords(requirement);
      const batches = typeof this.catalog.recommend === "function"
        ? await Promise.all(plannedQueries.map(async (keyword) =>
          (await this.catalog.recommend({
            category: catalogQuery.category,
            style: catalogQuery.style || context.style,
            color: catalogQuery.color || context.color,
            bodyType: context.bodyType,
            scene: catalogQuery.scene || context.scene,
            gender: catalogQuery.gender || context.gender,
            fit: context.fit,
            budget: context.item_budget || context.itemBudget || context.budget,
            keyword,
            limit: 12,
          })).map((product) => ({...product, search_keyword: keyword}))))
        : [await this.catalog.recommendForQueries([catalogQuery], context)];
      const candidates = uniqueProducts(batches.flat());
      return candidates
        .filter((product) => mockCandidateMatchesRequirement(product, requirement))
        .map((product) => mockCandidateForRequirement(product, requirement));
    }));
    const result = await this.candidatePipeline({
      requirements: values,
      groups: values.map((query, index) => ({
        requirement: normalizeProductRequirement({...context, ...query}, context),
        candidates: groups[index],
      })),
      context,
      provider: "mock",
      logger: this.logger,
      reranker: this.reranker,
      outfitPostProcessor: this.outfitPostProcessor,
      wholeLookAIAdjudicator: this.wholeLookAIAdjudicator,
    });
    this.lastPipelineTrace = result.trace;
    return result.products;
  }
}

class UnavailableProductProvider extends ProductProvider {
  constructor({
    missingVariables = [],
    message = "淘宝商品 Provider 配置不完整",
    code = "PRODUCT_PROVIDER_NOT_CONFIGURED",
  } = {}) {
    super();
    this.name = "taobao";
    this.configured = false;
    this.status = "unconfigured";
    this.missingVariables = [...missingVariables];
    this.message = message;
    this.code = code;
  }

  async recommend() {
    throw new ProductProviderError(this.message, {
      status: 503,
      code: this.code,
    });
  }
}

class TaobaoProductProvider extends ProductProvider {
  constructor({
    appKey,
    appSecret,
    pid,
    adzoneId,
    client,
    catalog = new ProductCatalog(),
    endpoint,
    fetchImpl,
    connectTimeoutMs,
    timeoutMs,
    maxRetries,
    sampleMaterialId = DEFAULT_SAMPLE_MATERIAL_ID,
    reranker = null,
    visualVerifier = null,
    visualVerificationBudgetMs = PRODUCT_VISUAL_VERIFICATION_BUDGET_MS,
    visualCandidateLimit = DEFAULT_MAX_CANDIDATES_PER_SLOT,
    recommendationCacheTtlMs = DEFAULT_RECOMMENDATION_CACHE_TTL_MS,
    recommendationCacheEntries = DEFAULT_RECOMMENDATION_CACHE_ENTRIES,
    pipelineBudgetMs = PRODUCT_PIPELINE_BUDGET_MS,
    taobaoStageBudgetMs = TAOBAO_STAGE_BUDGET_MS,
    rerankBudgetMs = PRODUCT_RERANK_BUDGET_MS,
    outfitPostProcessor = postProcessOutfitCandidates,
    candidatePipeline = runSharedCandidatePipeline,
    wholeLookAIAdjudicator = null,
    rawCapture = null,
    logger = console,
  }) {
    super();
    this.pid = requireConfig(pid, "TAOBAO_PID");
    const placement = parseTaobaoPlacement(this.pid, adzoneId);
    this.siteId = placement.siteId;
    this.adzoneId = placement.adzoneId;
    this.sampleMaterialId = String(sampleMaterialId || DEFAULT_SAMPLE_MATERIAL_ID);
    this.legacyReranker = reranker;
    this.reranker = reranker || new ProductAestheticReranker({
      client: null,
      visualEvaluationEnabled: false,
      logger,
    });
    this.visualVerifier = visualVerifier;
    this.visualVerificationBudgetMs = Math.min(
      positiveInteger(
        visualVerificationBudgetMs,
        PRODUCT_VISUAL_VERIFICATION_BUDGET_MS,
      ),
      PRODUCT_VISUAL_VERIFICATION_BUDGET_MS,
    );
    this.visualCandidateLimit = Math.min(
      positiveInteger(visualCandidateLimit, DEFAULT_MAX_CANDIDATES_PER_SLOT),
      MAX_VISUAL_CANDIDATES_PER_SLOT,
    );
    this.outfitPostProcessor = outfitPostProcessor;
    this.candidatePipeline = candidatePipeline;
    this.wholeLookAIAdjudicator = wholeLookAIAdjudicator;
    this.rawCapture = typeof rawCapture === "function" ? rawCapture : null;
    this.lastPipelineTrace = null;
    this.logger = logger;
    this.recommendationCacheTtlMs = positiveInteger(
      recommendationCacheTtlMs,
      DEFAULT_RECOMMENDATION_CACHE_TTL_MS,
    );
    this.recommendationCacheEntries = positiveInteger(
      recommendationCacheEntries,
      DEFAULT_RECOMMENDATION_CACHE_ENTRIES,
    );
    this.pipelineBudgetMs = Math.min(
      positiveInteger(pipelineBudgetMs, PRODUCT_PIPELINE_BUDGET_MS),
      PRODUCT_PIPELINE_BUDGET_MS,
    );
    this.taobaoStageBudgetMs = Math.min(
      positiveInteger(taobaoStageBudgetMs, TAOBAO_STAGE_BUDGET_MS),
      TAOBAO_STAGE_BUDGET_MS,
    );
    this.rerankBudgetMs = Math.min(
      positiveInteger(rerankBudgetMs, PRODUCT_RERANK_BUDGET_MS),
      PRODUCT_RERANK_BUDGET_MS,
    );
    this.recommendationCache = new Map();
    this.inflightRecommendations = new Map();
    this.client = client || new TaobaoApiClient({
      appKey,
      appSecret,
      endpoint,
      fetchImpl,
      connectTimeoutMs,
      totalTimeoutMs: timeoutMs,
      maxRetries,
      logger,
    });
    this.name = "taobao";
    this.configured = true;
    this.status = "taobao";
  }

  async healthCheck() {
    await this.#search(normalizeFilters({category: "top", keyword: "上衣", limit: 1}));
    return true;
  }

  async searchShoppingAgentCandidates({
    query,
    category,
    gender,
    requestId,
    limit = 30,
    signal,
    onAttempt,
  } = {}) {
    const searchKeyword = String(query || "").trim();
    const normalizedCategory = normalizeProductCategory(category);
    if (!searchKeyword || searchKeyword.length > 80) {
      throw new ProductProviderError("Shopping Agent 搜索词无效", {
        status: 400,
        code: "INVALID_SHOPPING_AGENT_QUERY",
      });
    }
    if (!normalizedCategory || !["top", "bottom", "shoes"].includes(
      normalizedCategory,
    )) {
      throw new ProductProviderError("Shopping Agent 仅支持 top、bottom、shoes", {
        status: 400,
        code: "INVALID_SHOPPING_AGENT_CATEGORY",
      });
    }
    const metrics = {taobaoCount: 0, semanticPassCount: 0};
    const products = await this.#search({
      category: normalizedCategory,
      gender: normalizeGender(gender),
      requestId: String(requestId || "").trim(),
      originalKeyword: searchKeyword,
      searchKeyword,
      fallbackLevel: 0,
      pageNo: 1,
      limit: Math.min(positiveInteger(limit, 30), 50),
      shoppingAgentRaw: true,
      signal,
      onAttempt,
    }, metrics);
    return {
      products,
      raw_count: metrics.taobaoCount,
      valid_count: metrics.semanticPassCount,
      attempts: metrics.attempts,
      zero_result_recall: metrics.zeroResultRecall === true ||
        (Number(metrics.taobaoCount || 0) === 0 && products.length === 0),
      recall_error_code: metrics.zeroResultRecall === true
        ? "ZERO_RESULT_RECALL" : null,
    };
  }

  async recommend(filters = {}) {
    const normalized = normalizeFilters(filters);
    if (!normalized.category && normalized.keyword) {
      try {
        const products = await this.#search({
          ...normalized,
          searchKeyword: normalized.keyword,
        });
        this.status = "taobao";
        return products.slice(0, normalized.limit);
      } catch (error) {
        this.status = "error";
        throw asProductProviderError(error);
      }
    }
    const categories = normalized.category
      ? [normalized.category]
      : PRODUCT_CATEGORIES;
    try {
      const settled = await Promise.all(categories.map((category) =>
        this.#recommendRequirement({
          ...normalized,
          category,
          item_name: normalized.itemName || normalized.keyword || category,
          search_keywords: normalized.searchKeywords,
          negative_keywords: normalized.negativeKeywords,
        })));
      this.status = "taobao";
      return uniqueProducts(settled.flat()).slice(0, normalized.category
        ? Math.min(normalized.limit, 3)
        : 18);
    } catch (error) {
      this.status = "error";
      this.logger.warn?.("淘宝商品推荐失败", {
        requestId: normalized.requestId || undefined,
        provider: "taobao",
        search_keyword: normalized.searchKeywords[0] || normalized.keyword || undefined,
        gender: normalized.gender,
        category: normalized.category || undefined,
        errorCode: safeProviderCode(error),
      });
      throw asProductProviderError(error);
    }
  }

  async recommendForQueries(queries, context = {}) {
    const values = Array.isArray(queries) ? queries : [];
    if (values.length === 0) return [];
    if (values.length > 24) {
      throw new ProductProviderError("商品需求不能超过 8 项", {
        status: 400,
        code: "INVALID_PRODUCT_REQUIREMENTS",
      });
    }
    const cacheKey = recommendationCacheKey(values, context);
    const cached = this.#readRecommendationCache(cacheKey);
    if (cached) {
      this.logger.info?.("product_pipeline_summary", {
        request_id: context.requestId || undefined,
        taobao_count: cached.length,
        semantic_pass_count: cached.length,
        rule_rank_count: cached.length,
        ai_rerank_success: !cached.some((product) =>
          product.ai_rerank_fallback === true),
        fallback_used: cached.some((product) =>
          product.ai_rerank_fallback === true),
        cache_hit: true,
        total_ms: 0,
      });
      logProductBlueprintSummaries(
        this.logger,
        cached,
        context.requestId || undefined,
      );
      return cloneProductArray(cached);
    }
    const inflight = this.inflightRecommendations.get(cacheKey);
    if (inflight) return cloneProductArray(await inflight);

    const work = this.#recommendForQueriesUncached(values, context);
    this.inflightRecommendations.set(cacheKey, work);
    try {
      const products = await work;
      const cacheComplete = values.every((requirement) => {
        const category = normalizeProductCategory(requirement.category);
        const lookId = String(requirement.look_id || requirement.lookId || "");
        return products.some((product) =>
          String(product.look_id || "") === lookId &&
          product.category === category);
      });
      if (cacheComplete) this.#writeRecommendationCache(cacheKey, products);
      return cloneProductArray(products);
    } finally {
      this.inflightRecommendations.delete(cacheKey);
    }
  }

  async #recommendForQueriesUncached(values, context) {
    const pipelineStartedAt = Date.now();
    const pipelineDeadline = pipelineStartedAt + this.pipelineBudgetMs;
    const useNewDecisionPipeline = context.decision_pipeline ===
      "new_decision_pipeline.v1";
    try {
      const groupOutcomes = await Promise.all(values.map(async (query) => {
        const requirement = normalizeProductRequirement({...context, ...query}, context);
        const metrics = {taobaoCount: 0, semanticPassCount: 0};
        try {
          const candidates = await withTimeBudget(
            this.#candidatePool({
              ...context,
              ...query,
              ...requirement,
              commerce_query_plan:
                query.commerce_query_plan || requirement.commerce_query_plan,
              deferCandidatePipeline: useNewDecisionPipeline,
              limit: 20,
            }, metrics),
            Math.max(1, Math.min(
              this.taobaoStageBudgetMs,
              pipelineDeadline - Date.now(),
            )),
            "TAOBAO_STAGE_TIMEOUT",
          );
          return {
            requirement,
            prefilterCount: candidates.length,
            // The new decision pipeline performs its shared Relevance/Gate pass
            // after retrieval, so preserve the full bounded reserve even when a
            // legacy visual verifier is configured on the provider instance.
            candidates: candidates.slice(0, useNewDecisionPipeline
              ? DEFAULT_RELEVANCE_POOL_PER_REQUIREMENT
              : this.visualVerifier ? this.visualCandidateLimit : 4),
            funnel: metrics.funnel,
            metrics,
            error: null,
          };
        } catch (error) {
          this.logger.warn?.("单个商品需求搜索失败，保留其他成功品类", {
            requestId: context.requestId || undefined,
            look_id: requirement.look_id || undefined,
            category: requirement.category,
            errorCode: safeProviderCode(error),
          });
          return {
            requirement,
            prefilterCount: 0,
            candidates: [],
            funnel: {
              ...metrics.funnel,
              ranked_count: 0,
              first_zero_stage: safeProviderCode(error) === "TAOBAO_STAGE_TIMEOUT"
                ? "taobao_timeout" : "taobao_error",
            },
            metrics,
            error,
          };
        }
      }));
      let groups = groupOutcomes.map(({error: _error, metrics: _metrics, ...group}) =>
        group);
      const taobaoMs = Date.now() - pipelineStartedAt;
      const taobaoCount = groupOutcomes.reduce(
        (total, group) => total + group.metrics.taobaoCount,
        0,
      );
      const semanticPassCount = groupOutcomes.reduce(
        (total, group) => total + group.metrics.semanticPassCount,
        0,
      );
      const ruleStartedAt = Date.now();
      let visualVerificationSummary = null;
      // The new decision pipeline owns Relevance -> Gate -> Reranker -> Strategy.
      // Running the legacy visual verifier before that shared pipeline would make
      // its fallback inspect gate state before the gate has produced one, which
      // can erase an otherwise valid raw candidate pool.
      if (!useNewDecisionPipeline && this.visualVerifier &&
          groups.some((group) => group.candidates.length > 0)) {
        const verification = await this.visualVerifier.verifyGroups({
          groups,
          context,
          requestId: context.requestId || "",
          timeoutMs: Math.max(1, Math.min(
            this.visualVerificationBudgetMs,
            pipelineDeadline - Date.now(),
          )),
        });
        groups = verification.groups;
        visualVerificationSummary = verification.summary;
      }
      if (!useNewDecisionPipeline) {
        const baseProducts = uniqueProducts(sortProductsByCategoryPriority(
          groups.flatMap((group) => group.candidates.slice(0, 4)),
        )).slice(0, values.length * 4);
        const ruleRankMs = Date.now() - ruleStartedAt;
        const searchErrors = groupOutcomes
          .map((group) => group.error)
          .filter(Boolean);
        if (baseProducts.length === 0 && searchErrors.length > 0) {
          throw searchErrors[0];
        }

        let legacyProducts = baseProducts;
        let aiRerankSuccess = false;
        const visualFallbackUsed = visualVerificationSummary?.fallback_used === true;
        let fallbackUsed = baseProducts.length > 0;
        const productAiStartedAt = Date.now();
        if (this.legacyReranker && baseProducts.length > 0) {
          try {
            const reranked = await withTimeBudget(
              this.legacyReranker.rerank({
                groups,
                context,
                requestId: context.requestId || "",
                selectionLimit: 4,
              }),
              Math.max(1, Math.min(
                this.rerankBudgetMs,
                pipelineDeadline - Date.now(),
              )),
              "AI_RERANK_TIMEOUT",
            );
            if (reranked.length > 0) {
              legacyProducts = reranked;
              const rerankFallbackUsed = reranked.some((product) =>
                product.ai_rerank_fallback === true);
              fallbackUsed = visualFallbackUsed || rerankFallbackUsed;
              aiRerankSuccess = !rerankFallbackUsed;
            } else {
              legacyProducts = markRerankFallback(baseProducts);
              fallbackUsed = true;
            }
          } catch (error) {
            legacyProducts = markRerankFallback(baseProducts);
            fallbackUsed = true;
            this.logger.warn?.("AI 商品复选超时或失败，立即返回规则排序", {
              requestId: context.requestId || undefined,
              errorCode: safeProviderCode(error),
            });
          }
        } else if (baseProducts.length > 0) {
          legacyProducts = markRerankFallback(baseProducts);
        }
        const productAiMs = Date.now() - productAiStartedAt;
        this.logger.info?.("AI最终选择", {
          requestId: context.requestId || undefined,
          provider: "taobao",
          selectedCount: legacyProducts.length,
          looks: summarizeProductsByLook(legacyProducts),
        });
        this.status = "taobao";
        this.logger.info?.("product_pipeline_summary", {
          request_id: context.requestId || undefined,
          taobao_count: taobaoCount,
          semantic_pass_count: semanticPassCount,
          rule_rank_count: baseProducts.length,
          ai_rerank_success: aiRerankSuccess,
          fallback_used: fallbackUsed,
          taobao_ms: taobaoMs,
          rule_rank_ms: ruleRankMs,
          ai_rerank_ms: productAiMs,
          visual_candidate_count: visualVerificationSummary?.candidate_count || 0,
          visual_call_count: visualVerificationSummary?.visual_call_count || 0,
          visual_total_ms: visualVerificationSummary?.total_visual_ms || 0,
          visual_fallback_used: visualFallbackUsed,
          cache_hit: false,
          total_ms: Date.now() - pipelineStartedAt,
          result_status: legacyProducts.length > 0
            ? (fallbackUsed ? "fallback_success" : "success") : "empty",
        });
        const finalProducts = uniqueProducts(legacyProducts)
          .sort((left, right) =>
            compareProductPurchaseAesthetic(left, right) ||
            categoryPriority(right?.category) - categoryPriority(left?.category) ||
            Number(right?.final_score || right?.relevance_score || 0) -
              Number(left?.final_score || left?.relevance_score || 0))
          .slice(0, values.length * 4);
        for (const group of groups) {
          const funnel = group.funnel || {};
          const visual = group.visual_funnel || {};
          const finalCount = finalProducts.filter((product) =>
            String(product.look_id || "") ===
              String(group.requirement?.look_id || "") &&
            product.category === group.requirement?.category).length;
          const firstZeroStage = funnel.first_zero_stage ||
            (Number(funnel.ranked_count || 0) > 0 && group.candidates.length === 0
              ? "visual_verification"
              : Number(funnel.ranked_count || 0) > 0 && finalCount === 0
                ? "final_selection" : null);
          this.logger.info?.("product_slot_funnel", {
            request_id: context.requestId || undefined,
            look_id: group.requirement?.look_id || undefined,
            slot_key: group.requirement?.slot_key || undefined,
            category: group.requirement?.category,
            raw_count: Number(funnel.raw_count || 0),
            valid_count: Number(funnel.valid_count || 0),
            candidate_gate_pass: Number(funnel.candidate_gate_pass || 0),
            candidate_gate_unknown: Number(funnel.candidate_gate_unknown || 0),
            candidate_gate_fail: Number(funnel.candidate_gate_fail || 0),
            ranked_count: Number(funnel.ranked_count || 0),
            visual_candidate_count: Number(visual.candidate_count || 0),
            visual_pass: Number(visual.pass_count || 0),
            visual_uncertain: Number(visual.uncertain_count || 0),
            visual_fail: Number(visual.fail_count || 0),
            final_count: finalCount,
            first_zero_stage: firstZeroStage,
          });
        }
        logProductBlueprintSummaries(
          this.logger,
          finalProducts,
          context.requestId || undefined,
        );
        return finalProducts;
      }
      const rawProducts = uniqueProducts(groups.flatMap((group) =>
        group.candidates));
      const searchErrors = groupOutcomes
        .map((group) => group.error)
        .filter(Boolean);
      if (rawProducts.length === 0 && searchErrors.length > 0) {
        throw searchErrors[0];
      }
      const selectionStartedAt = Date.now();
      const visualFallbackUsed = visualVerificationSummary?.fallback_used === true;
      const refillExecutionKeys = new Set();
      const pipelineResult = await this.candidatePipeline({
        requirements: values,
        groups,
        context,
        provider: "taobao",
        logger: this.logger,
        reranker: this.reranker,
        outfitPostProcessor: this.outfitPostProcessor,
        wholeLookAIAdjudicator: this.wholeLookAIAdjudicator,
        rerankTimeoutMs: this.rerankBudgetMs,
        deadlineAt: pipelineDeadline,
        refillCandidates: async ({requirement, round, qualityDeficit}) => withTimeBudget(
          this.#refillCandidatePool({
            requirement,
            context,
            round,
            qualityDeficit,
            executed: refillExecutionKeys,
          }),
          Math.max(1, Math.min(
            this.taobaoStageBudgetMs,
            pipelineDeadline - Date.now(),
          )),
          "TAOBAO_REFILL_TIMEOUT",
        ),
      });
      this.lastPipelineTrace = pipelineResult.trace;
      const products = pipelineResult.products;
      const ruleRankMs = selectionStartedAt - ruleStartedAt;
      const productAiMs = Date.now() - selectionStartedAt;
      const aiRerankSuccess = pipelineResult.trace.reranker_status === "SUCCESS";
      const fallbackUsed = visualFallbackUsed ||
        pipelineResult.trace.reranker_status !== "SUCCESS";
      this.logger.info?.("AI最终选择", {
        requestId: context.requestId || undefined,
        provider: "taobao",
        selectedCount: products.length,
        looks: summarizeProductsByLook(products),
      });
      this.status = "taobao";
      this.logger.info?.("product_pipeline_summary", {
        request_id: context.requestId || undefined,
        taobao_count: taobaoCount,
        semantic_pass_count: semanticPassCount,
        rule_rank_count: pipelineResult.trace.relevance_pass.length,
        ai_rerank_success: aiRerankSuccess,
        fallback_used: fallbackUsed,
        taobao_ms: taobaoMs,
        rule_rank_ms: ruleRankMs,
        ai_rerank_ms: productAiMs,
        visual_candidate_count: visualVerificationSummary?.candidate_count || 0,
        visual_call_count: visualVerificationSummary?.visual_call_count || 0,
        visual_total_ms: visualVerificationSummary?.total_visual_ms || 0,
        visual_fallback_used: visualFallbackUsed,
        cache_hit: false,
        total_ms: Date.now() - pipelineStartedAt,
        result_status: products.length > 0
          ? (fallbackUsed ? "fallback_success" : "success")
          : "empty",
      });
      const finalProducts = uniqueProducts(products)
        .sort((left, right) =>
          compareProductPurchaseAesthetic(left, right) ||
          categoryPriority(right?.category) - categoryPriority(left?.category) ||
          Number(right?.final_score || right?.relevance_score || 0) -
            Number(left?.final_score || left?.relevance_score || 0))
        .slice(0, values.length * 4);
      logProductBlueprintSummaries(
        this.logger,
        finalProducts,
        context.requestId || undefined,
      );
      return finalProducts;
    } catch (error) {
      this.status = "error";
      throw asProductProviderError(error);
    }
  }

  #readRecommendationCache(key) {
    const entry = this.recommendationCache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.recommendationCache.delete(key);
      return null;
    }
    this.recommendationCache.delete(key);
    this.recommendationCache.set(key, entry);
    return entry.products;
  }

  #writeRecommendationCache(key, products) {
    this.recommendationCache.set(key, {
      expiresAt: Date.now() + this.recommendationCacheTtlMs,
      products: cloneProductArray(products),
    });
    while (this.recommendationCache.size > this.recommendationCacheEntries) {
      const oldestKey = this.recommendationCache.keys().next().value;
      this.recommendationCache.delete(oldestKey);
    }
  }

  async #recommendRequirement(filters) {
    const targetLimit = Math.min(positiveInteger(filters.limit, 3), 6);
    const products = await this.#candidatePool({...filters, limit: 20});
    return products.slice(0, targetLimit);
  }

  async #candidatePool(filters, metrics = null) {
    const requirement = normalizeProductRequirement(filters, filters);
    if (metrics && !metrics.funnel) metrics.funnel = {};
    const basePurchaseSpecification = compilePurchaseSpecification(requirement, filters);
    if (basePurchaseSpecification.spec_consistency_status !==
        SPEC_CONSISTENCY_STATUS.PASS) {
      this.logger.info?.("purchase_specification_inconsistent", {
        request_id: filters.requestId || undefined,
        look_id: requirement.look_id || undefined,
        slot_key: requirement.slot_key || undefined,
        category: requirement.category,
        spec_consistency_status: basePurchaseSpecification.spec_consistency_status,
        spec_conflicts: basePurchaseSpecification.spec_conflicts,
      });
      if (metrics) {
        metrics.funnel = {
          ...metrics.funnel,
          raw_count: 0,
          valid_count: 0,
          candidate_gate_pass: 0,
          candidate_gate_unknown: 0,
          candidate_gate_fail: 0,
          ranked_count: 0,
          first_zero_stage: "purchase_specification_consistency",
        };
      }
      return [];
    }
    const outfitBlueprint = filters.outfit_blueprint || filters.outfitBlueprint ||
      filters.recommendation_context?.outfit_blueprint || {};
    const commerceQueryPlan = filters.commerce_query_plan ||
      requirement.commerce_query_plan || {};
    const queryPlanVersion = String(requirement.query_plan_version ||
      commerceQueryPlan.version || "");
    const conceptQueryPlan = new Set([
      "concept_search_query_planner.v1",
      "concept_search_query_planner.v2",
    ]).has(queryPlanVersion);
    const stylingCompletionQueries = isTrustedStylingCompletionPlan(
      requirement,
      filters,
    ) ? stylingCompletionQueryTexts(commerceQueryPlan) : [];
    // The optional plan is trusted only when both typed entries are present.
    // This keeps malformed or untrusted plans on the normal Blueprint search
    // path and, importantly, never makes Q3 an unconditional fallback.
    const trustedStylingCompletionQueryPlan = stylingCompletionQueries.length === 2;
    const dynamicConceptQueries = conceptQueryPlan
      ? requirementSearchKeywords(requirement).slice(0, 4)
      : stylingCompletionQueries;
    const dynamicFallbackQuery = (queryPlanVersion ===
        "concept_search_query_planner.v2" || trustedStylingCompletionQueryPlan)
      ? String(commerceQueryPlan?.fallback_query?.query || "").trim()
      : "";
    const translatedSearchPlan = dynamicConceptQueries.length >= 2
      ? {
        original_keyword: dynamicConceptQueries[0],
        exact: dynamicConceptQueries[0],
        fallbacks: dynamicConceptQueries.slice(1),
        expanded_queries: dynamicConceptQueries,
        blueprint_element: requirement.item_name,
      }
      : expandBlueprintSearchPlan(
        requirement,
        outfitBlueprint,
        buildTaobaoSearchPlan(requirement),
      );
    // Translation happens once at the Purchase Specification boundary. Every
    // downstream search stage reads the frozen, executable query list.
    const purchaseSpecification = Object.freeze({
      ...basePurchaseSpecification,
      search_queries: Object.freeze([
        translatedSearchPlan.exact,
        ...translatedSearchPlan.fallbacks,
      ].filter(Boolean).slice(0, dynamicConceptQueries.length >= 2 ? 4 : 3)),
    });
    const searchPlan = {
      ...translatedSearchPlan,
      exact: purchaseSpecification.search_queries[0] || "",
      fallbacks: purchaseSpecification.search_queries.slice(
        1,
        dynamicConceptQueries.length >= 2 ? 4 : 3,
      ),
      expanded_queries: purchaseSpecification.search_queries,
    };
    this.logger.info?.("淘宝商品搜索需求", {
      requestId: filters.requestId || undefined,
      look_id: requirement.look_id || undefined,
      search_requirement_gender: requirement.gender,
      original_keyword: searchPlan.original_keyword,
      normalized_keyword: searchPlan.exact,
      fallback_keywords: searchPlan.fallbacks,
      category: requirement.category,
      search_subcategory: requirement.search_subcategory || undefined,
      item_name: requirement.item_name,
      query_reason: requirement.query_reason || undefined,
      source_elements: requirement.source_elements,
      query_plan_version: requirement.query_plan_version || undefined,
      commerce_query_count: dynamicConceptQueries.length || undefined,
      conditional_fallback_query: dynamicFallbackQuery || undefined,
      commerce_negatives:
        requirement.commerce_query_plan?.commerce_negatives || undefined,
      purchase_specification: purchaseSpecification,
    });
    const candidateLimit = Math.min(positiveInteger(filters.limit, 20), 20);
    let products = [];
    let successfulQuery = "";
    let queryFallbackLevel = 0;
    let queryFallbackReason = null;
    const executedQueries = [];
    const stylingCompletionQueryTrace = trustedStylingCompletionQueryPlan
      ? stylingCompletionQueries.map((query, index) => ({
        query_id: index === 0 ? "Q1" : "Q2",
        query,
        executed: false,
        result_count: 0,
      }))
      : null;
    if (dynamicConceptQueries.length >= 2) {
      const perQueryLimit = Math.max(5, Math.min(
        8,
        Math.ceil(24 / dynamicConceptQueries.length),
      ));
      const plannedBatches = await Promise.all(dynamicConceptQueries.map(
        (searchKeyword) => this.#search({
          ...filters,
          ...requirement,
          originalKeyword: searchPlan.original_keyword,
          searchKeyword,
          fallbackLevel: 0,
          pageNo: 1,
          minimumRelevanceScore: 35,
          limit: perQueryLimit,
        }, metrics),
      ));
      executedQueries.push(...dynamicConceptQueries);
      stylingCompletionQueryTrace?.forEach((entry, index) => {
        entry.executed = true;
        entry.result_count = plannedBatches[index].length;
      });
      const successfulQueries = dynamicConceptQueries.filter(
        (_query, index) => plannedBatches[index].length > 0,
      );
      successfulQuery = successfulQueries.join(" | ");
      products = uniqueProducts(plannedBatches.flat())
        .sort((left, right) =>
          Number(right.relevance_score || 0) - Number(left.relevance_score || 0));
      if (queryPlanVersion === "concept_search_query_planner.v2" ||
          trustedStylingCompletionQueryPlan) {
        const highRecallCount = plannedBatches[0]?.length || 0;
        const intentCount = plannedBatches[1]?.length || 0;
        if (intentCount === 0 && highRecallCount > 0) {
          queryFallbackLevel = 1;
          queryFallbackReason = "INTENT_QUERY_ZERO";
        }
        if (highRecallCount === 0 && intentCount === 0 && dynamicFallbackQuery) {
          const fallbackProducts = await this.#search({
            ...filters,
            ...requirement,
            originalKeyword: searchPlan.original_keyword,
            searchKeyword: dynamicFallbackQuery,
            fallbackLevel: 2,
            pageNo: 1,
            minimumRelevanceScore: 35,
            limit: perQueryLimit,
          }, metrics);
          executedQueries.push(dynamicFallbackQuery);
          queryFallbackLevel = 2;
          queryFallbackReason = "INTENT_AND_HIGH_RECALL_ZERO";
          if (fallbackProducts.length > 0) successfulQuery = dynamicFallbackQuery;
          products = uniqueProducts([...products, ...fallbackProducts])
            .sort((left, right) =>
              Number(right.relevance_score || 0) -
              Number(left.relevance_score || 0));
          if (stylingCompletionQueryTrace) {
            stylingCompletionQueryTrace.push({
              query_id: "Q3",
              query: dynamicFallbackQuery,
              executed: true,
              result_count: fallbackProducts.length,
            });
          }
        }
      }
      if (stylingCompletionQueryTrace && !stylingCompletionQueryTrace.some(
        (entry) => entry.query_id === "Q3",
      ) && dynamicFallbackQuery) {
        stylingCompletionQueryTrace.push({
          query_id: "Q3",
          query: dynamicFallbackQuery,
          executed: false,
          result_count: 0,
        });
      }
    } else if (searchPlan.exact) {
      products = await this.#search({
        ...filters,
        ...requirement,
        originalKeyword: searchPlan.original_keyword,
        searchKeyword: searchPlan.exact,
        fallbackLevel: 0,
        pageNo: 1,
        minimumRelevanceScore: 35,
        limit: 50,
      }, metrics);
      if (products.length > 0) successfulQuery = searchPlan.exact;
    }
    if (dynamicConceptQueries.length < 2 &&
        gateCandidates(products, purchaseSpecification).length === 0 &&
        searchPlan.fallbacks.length > 0) {
      const fallbackBatches = await Promise.all(searchPlan.fallbacks.map(
        (searchKeyword, index) => this.#search({
          ...filters,
          ...requirement,
          originalKeyword: searchPlan.original_keyword,
          searchKeyword,
          fallbackLevel: index + 1,
          pageNo: 1,
          minimumRelevanceScore: 35,
          limit: 50,
        }, metrics),
      ));
      const successfulIndex = fallbackBatches.findIndex((batch) => batch.length > 0);
      if (successfulIndex >= 0) {
        successfulQuery = searchPlan.fallbacks[successfulIndex];
      }
      products = uniqueProducts(fallbackBatches.flat())
        .sort((left, right) => right.relevance_score - left.relevance_score);
    }
    this.logger.info?.("search_expansion_summary", {
      request_id: filters.requestId || undefined,
      look_id: requirement.look_id || undefined,
      category: requirement.category,
      blueprint_element: searchPlan.blueprint_element || requirement.item_name,
      original_query: searchPlan.original_keyword,
      expanded_queries: searchPlan.expanded_queries || [
        searchPlan.exact,
        ...searchPlan.fallbacks,
      ].filter(Boolean),
      successful_query: successfulQuery || null,
      executed_queries: executedQueries,
      fallback_level: queryFallbackLevel,
      fallback_reason: queryFallbackReason,
      query_plan_version: queryPlanVersion || null,
      styling_completion_query_trace: stylingCompletionQueryTrace,
      candidate_count: products.length,
    });
    if (metrics) {
      metrics.funnel = metrics.funnel || {};
      metrics.funnel.query_fallback_level = queryFallbackLevel;
      metrics.funnel.query_fallback_reason = queryFallbackReason;
      metrics.funnel.executed_queries = executedQueries;
      metrics.funnel.styling_completion_query_trace =
        stylingCompletionQueryTrace;
      metrics.funnel.raw_count = Number(metrics.taobaoCount || 0);
      metrics.funnel.valid_count = products.length;
      const gateAssessments = products.map((product) =>
        evaluateCandidateAgainstSpecification(product, purchaseSpecification));
      metrics.funnel.candidate_gate_pass = gateAssessments.filter((assessment) =>
        assessment.state === "PASS").length;
      metrics.funnel.candidate_gate_unknown = gateAssessments.filter((assessment) =>
        assessment.state === "UNKNOWN").length;
      metrics.funnel.candidate_gate_fail = gateAssessments.filter((assessment) =>
        assessment.state === "FAIL").length;
    }
    if (filters.deferCandidatePipeline === true) {
      return products
        .map((product) => preserveCandidateContract(product, requirement))
        .slice(0, candidateLimit);
    }
    const gatedProducts = gateCandidates(products, purchaseSpecification);
    if (products.length > 0 && gatedProducts.length === 0) {
      this.logger.info?.("purchase_specification_no_match", {
        request_id: filters.requestId || undefined,
        look_id: requirement.look_id || undefined,
        slot_key: requirement.slot_key || undefined,
        category: requirement.category,
        reason: NO_PRODUCT_MEETS_CORE_SPEC,
        candidate_count: products.length,
      });
    }
    products = scoreAndSortProducts(gatedProducts, purchaseSpecification);
    const styleProfile = filters.style_profile || filters.styleProfile ||
      filters.recommendation_context?.style_profile || {};
    const styleSemantics = filters.style_semantics || filters.styleSemantics ||
      filters.recommendation_context?.style_semantics || {};
    const intentPriorityScore = resolveIntentPriorityScore(styleProfile);
    const enforceStyleThreshold = hasActionableStyleConstraints(styleProfile);
    const blueprintAssessedProducts = products.map((product) => {
      const assessment = blueprintMatchAssessment(
        product,
        requirement,
        outfitBlueprint,
      );
      return {
        ...product,
        blueprint_match_score: assessment.score,
        blueprint_ranking_allowed: blueprintMatchPassesHardGate(
          assessment,
          intentPriorityScore,
        ),
        matched_elements: assessment.matched_elements,
        conflict_elements: assessment.conflict_elements,
      };
    });
    const bodyAssessedProducts = blueprintAssessedProducts.map((product) => {
      const assessment = bodyStrategyMatchAssessment(
        product,
        requirement,
        outfitBlueprint,
        filters,
      );
      return {
        ...product,
        body_strategy_match_score: assessment.score,
        body_strategy_configured: assessment.configured,
        body_strategy_ranking_conflict: assessment.configured && assessment.score < 40,
      };
    });
    const styleAssessedProducts = bodyAssessedProducts.map((product) => {
      const gate = evaluateStyleGate(product, styleProfile, intentPriorityScore);
      return {
        ...product,
        style_gate_ranking_allowed: gate.allowed,
        style_gate_conflicts: gate.matched_negative_keywords,
      };
    });
    let budgetAssessed = styleAssessedProducts
      .map((product) => {
        const productStyleMatch = styleMatchScore({
          evidence: [
            product.title,
            product.brand,
            product.shop_name,
            product.material,
            product.style,
            product.color,
          ].filter(Boolean).join(" "),
          relevanceScore: product.relevance_score,
          styleProfile,
          styleSemantics,
        });
        return {
          ...product,
          ...budgetPreferenceAssessment(product, filters.budget),
          style_match_score: productStyleMatch,
          style_ranking_below_threshold: shouldRejectForStyle({
            intentPriorityScore,
            styleMatch: productStyleMatch,
            enforce: enforceStyleThreshold,
          }),
        };
      })
      .sort((left, right) =>
        compareProductPurchaseAesthetic(left, right) ||
        right.blueprint_match_score - left.blueprint_match_score ||
        right.body_strategy_match_score - left.body_strategy_match_score ||
        right.style_match_score - left.style_match_score ||
        right.budget_preference_score - left.budget_preference_score ||
        right.relevance_score - left.relevance_score);
    if (gatedProducts.length > 0 && budgetAssessed.length === 0) {
      const recovered = scoreAndSortProducts(
        gatedProducts,
        purchaseSpecification,
      ).slice(0, 1);
      this.logger.error?.("PRODUCT_PIPELINE_ILLEGAL_ZEROING", {
        request_id: filters.requestId || undefined,
        look_id: requirement.look_id || undefined,
        slot_key: requirement.slot_key || undefined,
        category: requirement.category,
        first_zero_stage: "ranking",
        candidate_gate_pass: metrics?.funnel?.candidate_gate_pass,
        candidate_gate_unknown: metrics?.funnel?.candidate_gate_unknown,
      });
      budgetAssessed = recovered;
    }
    if (metrics) {
      metrics.funnel.ranked_count = budgetAssessed.length;
      metrics.funnel.first_zero_stage = metrics.funnel.raw_count === 0
        ? "taobao_raw"
        : metrics.funnel.valid_count === 0
          ? "valid_mapping"
          : gatedProducts.length === 0
            ? "candidate_gate"
            : budgetAssessed.length === 0 ? "ranking" : null;
    }
    this.logger.info?.("user_intent_priority", intentDebugSummary({
      styleProfile,
      finalStyleScore: budgetAssessed.length > 0
        ? budgetAssessed.reduce((sum, product) =>
          sum + product.style_match_score, 0) / budgetAssessed.length
        : 0,
    }));
    this.logger.info?.("淘宝返回候选", {
      requestId: filters.requestId || undefined,
      look_id: requirement.look_id || undefined,
      original_keyword: searchPlan.original_keyword,
      normalized_keyword: searchPlan.exact,
      gender: requirement.gender,
      category: requirement.category,
      candidateCount: products.length,
      blueprintPassCount: blueprintAssessedProducts.filter((product) =>
        product.blueprint_ranking_allowed).length,
      budgetPreferredCount: budgetAssessed.filter((product) =>
        product.budget_preference_score >= 80).length,
    });
    return budgetAssessed.slice(0, candidateLimit);
  }

  async #refillCandidatePool({
    requirement,
    context,
    round,
    qualityDeficit,
    executed,
  }) {
    // Optional styling completion owns a strict Q1/Q2/Q3 ladder. Once its
    // bounded initial calls have run, the plan's Q3 may not be reissued by
    // generic Candidate Refill (which is allowed to broaden core searches).
    if (isTrustedStylingCompletionPlan(requirement, context)) {
      return {candidates: [], queries: [], returned_count: 0};
    }
    const planned = buildCandidateRefillQueries(
      requirement,
      round,
      qualityDeficit,
    )
      .filter((entry) => {
        const key = `${requirementPipelineKey(requirement)}:${entry.query}:` +
          `${entry.page_no}`;
        if (executed.has(key)) return false;
        executed.add(key);
        return true;
      });
    if (planned.length === 0) {
      return {candidates: [], queries: [], returned_count: 0};
    }
    let batches;
    try {
      batches = await Promise.all(planned.map((entry) => this.#search({
        ...context,
        ...requirement,
        requestId: context.requestId || context.request_id,
        originalKeyword: requirementSearchKeywords(requirement)[0] || entry.query,
        searchKeyword: entry.query,
        fallbackLevel: entry.fallback_level,
        pageNo: entry.page_no,
        minimumRelevanceScore: 35,
        limit: DEFAULT_REFILL_QUERY_LIMIT,
      })));
    } catch (error) {
      const failure = error instanceof Error
        ? error : new Error("Candidate refill retrieval failed");
      failure.refillAttemptTrace = Object.freeze({
        network_query_count: planned.length,
        queries: Object.freeze(planned.map((entry) => Object.freeze({
          query: entry.query,
          query_type: entry.query_type,
          page_no: entry.page_no,
        }))),
      });
      throw failure;
    }
    const candidates = uniqueProducts(batches.flat());
    const queries = planned.map((entry, index) => Object.freeze({
      query: entry.query,
      query_type: entry.query_type,
      page_no: entry.page_no,
      result_count: batches[index].length,
    }));
    this.logger.info?.("candidate_refill_retrieval", {
      request_id: context.requestId || context.request_id || undefined,
      look_id: requirement.look_id || undefined,
      slot: outfitRequirementSlot(requirement),
      round,
      queries,
      returned_count: candidates.length,
    });
    return {
      candidates,
      queries,
      returned_count: candidates.length,
    };
  }

  async #search(filters, metrics = null) {
    let payload;
    try {
      payload = await this.client.call(TAOBAO_MATERIAL_SEARCH_METHOD, {
        adzone_id: this.adzoneId,
        q: filters.searchKeyword || buildSearchKeyword(filters),
        page_no: String(filters.pageNo || 1),
        page_size: String(filters.limit),
        platform: "2",
      }, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        siteId: this.siteId,
        signal: filters.signal,
        onAttempt: (attempt) => {
          if (metrics) metrics.attempts = Number(metrics.attempts || 0) + 1;
          filters.onAttempt?.(attempt);
        },
      });
    } catch (error) {
      if (isEmptyTaobaoResult(error)) {
        if (metrics) {
          metrics.zeroResultRecall = true;
          metrics.recallErrorCode = "ZERO_RESULT_RECALL";
        }
        this.rawCapture?.({
          query: filters.searchKeyword || buildSearchKeyword(filters),
          origin: "search",
          products: [],
          responseSummary: {empty: true, requestId: null},
        });
        this.logger.info?.("淘宝商品搜索无结果", {
          requestId: filters.requestId || undefined,
          provider: "taobao",
          result_status: "empty",
          original_keyword: filters.originalKeyword || filters.searchKeyword || buildSearchKeyword(filters),
          normalized_keyword: filters.searchKeyword || buildSearchKeyword(filters),
          fallback_level: Number(filters.fallbackLevel || 0),
          gender: normalizeGender(filters.gender),
          category: filters.category || undefined,
          errorCode: safeProviderCode(error),
          candidate_count: 0,
          semantic_filtered_count: 0,
          final_count: 0,
        });
        return [];
      }
      this.logger.warn?.("淘宝商品搜索失败", {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        search_keyword: filters.searchKeyword || buildSearchKeyword(filters),
        gender: normalizeGender(filters.gender),
        category: filters.category || undefined,
        errorCode: safeProviderCode(error),
      });
      throw error;
    }
    let mappingDetails = {};
    const products = mapPayload(payload, filters, this.pid, "search", (details) => {
      mappingDetails = details;
      logMappingDiagnostics(this.logger, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        method: TAOBAO_MATERIAL_SEARCH_METHOD,
        ...details,
      });
    }, this.rawCapture);
    if (metrics) {
      metrics.taobaoCount += Number(mappingDetails.rawCount || 0);
      metrics.semanticPassCount += products.length;
    }
    this.logger.info?.("淘宝商品搜索结果", {
      requestId: filters.requestId || undefined,
      provider: "taobao",
      result_status: products.length > 0 ? "success" : "empty",
      category: filters.category || undefined,
      original_keyword: filters.originalKeyword || filters.searchKeyword || buildSearchKeyword(filters),
      normalized_keyword: filters.searchKeyword || buildSearchKeyword(filters),
      fallback_level: Number(filters.fallbackLevel || 0),
      candidate_count: Number(mappingDetails.rawCount || 0),
      semantic_filtered_count: Number(mappingDetails.categoryMismatchCount || 0),
      final_count: products.length,
    });
    return products;
  }

  async #sample(filters) {
    let payload;
    try {
      payload = await this.client.call(TAOBAO_MATERIAL_SAMPLE_METHOD, {
        adzone_id: this.adzoneId,
        material_id: this.sampleMaterialId,
        page_no: "1",
        page_size: String(filters.limit),
      }, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        siteId: this.siteId,
      });
    } catch (error) {
      if (isEmptyTaobaoResult(error)) return [];
      throw error;
    }
    return mapPayload(payload, filters, this.pid, "sample", (details) => {
      logMappingDiagnostics(this.logger, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        method: TAOBAO_MATERIAL_SAMPLE_METHOD,
        ...details,
      });
    }, this.rawCapture);
  }
}

class AutoProductProvider extends ProductProvider {
  constructor({
    taobao,
    mock = new MockProductProvider(),
    logger = console,
    allowMockFallback = true,
  }) {
    super();
    this.taobao = taobao;
    this.mock = mock;
    this.logger = logger;
    this.allowMockFallback = allowMockFallback;
    this.name = "auto";
    this.configured = true;
    this.status = "checking";
    this.health = null;
    this.lastPipelineTrace = null;
  }

  async recommend(filters = {}) {
    try {
      const products = await this.taobao.recommend(filters);
      this.health = true;
      this.status = "taobao";
      return products;
    } catch (error) {
      this.health = false;
      this.#logFallback(error, filters);
      if (!this.allowMockFallback) {
        this.status = "error";
        throw asProductProviderError(error);
      }
      this.status = "mock";
      return this.mock.recommend({
        ...filters,
        category: mockCompatibleCategory(filters.category),
      });
    }
  }

  async recommendForQueries(queries, context = {}) {
    try {
      const products = await this.taobao.recommendForQueries(queries, context);
      this.lastPipelineTrace = this.taobao.lastPipelineTrace || null;
      this.health = true;
      this.status = "taobao";
      return products;
    } catch (error) {
      this.health = false;
      const first = Array.isArray(queries) ? queries[0] || {} : {};
      this.#logFallback(error, {...context, ...first});
      if ([
        "INSUFFICIENT_QUALITY_CANDIDATES",
        "INSUFFICIENT_QUALITY_LOOKS",
      ].includes(error?.code)) {
        this.status = error.code.toLowerCase();
        throw asProductProviderError(error);
      }
      if (!this.allowMockFallback) {
        this.status = "error";
        throw asProductProviderError(error);
      }
      this.status = "mock";
      const fallbackQueries = (Array.isArray(queries) ? queries : []).map((query) => ({
        ...query,
        keyword: query?.search_keywords?.[0] || query?.item_name || query?.keyword,
      }));
      const products = await this.mock.recommendForQueries(fallbackQueries, context);
      this.lastPipelineTrace = this.mock.lastPipelineTrace || null;
      return products;
    }
  }

  async searchShoppingAgentCandidates(input = {}) {
    // Shopping Agent evidence must remain real Taobao data. Never route this
    // diagnostic/search contract through AutoProvider's Mock fallback.
    const result = await this.taobao.searchShoppingAgentCandidates(input);
    this.health = true;
    this.status = "taobao";
    return result;
  }

  #logFallback(error, filters = {}) {
    let searchKeyword = filters.search_keyword || filters.keyword;
    try {
      searchKeyword ||= buildSearchKeywords(filters)[0];
    } catch (_) {
      // Invalid filters are reported by the Mock provider after the safe log.
    }
    this.logger.warn?.(
      this.allowMockFallback ? "淘宝 Provider 降级 Mock" : "淘宝 Provider 请求失败",
      {
      requestId: filters.requestId || undefined,
      provider: "auto",
      search_keyword: searchKeyword || undefined,
      gender: normalizeGender(filters.gender),
      category: normalizeProductCategory(filters.category) || undefined,
      errorCode: safeProviderCode(error),
      },
    );
  }
}

function createProductProvider({
  environment = process.env,
  catalog,
  logger = console,
  client,
  reranker = null,
  visualVerifier = null,
  outfitPostProcessor = postProcessOutfitCandidates,
  candidatePipeline = runSharedCandidatePipeline,
  wholeLookAIAdjudicator = null,
  rawCapture = null,
} = {}) {
  const mode = String(environment.PRODUCT_PROVIDER || "auto").trim().toLowerCase();
  if (!new Set(["mock", "taobao", "auto"]).has(mode)) {
    throw new ProductProviderError("PRODUCT_PROVIDER 必须为 mock、taobao 或 auto", {
      status: 500,
      code: "INVALID_PRODUCT_PROVIDER_MODE",
    });
  }
  const productCatalog = catalog || new ProductCatalog();
  const values = {
    appKey: String(environment.TAOBAO_APP_KEY || "").trim(),
    appSecret: String(environment.TAOBAO_APP_SECRET || "").trim(),
    pid: String(environment.TAOBAO_PID || "").trim(),
    adzoneId: String(environment.TAOBAO_ADZONE_ID || "").trim(),
  };
  const requiredVariables = {
    TAOBAO_APP_KEY: values.appKey,
    TAOBAO_APP_SECRET: values.appSecret,
    TAOBAO_PID: values.pid,
  };
  const missingVariables = Object.entries(requiredVariables)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const configured = missingVariables.length === 0;
  const nodeEnvironment = String(
    environment.NODE_ENV || (environment.RENDER ? "production" : "development"),
  ).trim().toLowerCase();
  const allowMock = ["development", "test"].includes(nodeEnvironment) ||
    String(environment.MOCK_MODE || "").trim().toLowerCase() === "true";
  logger.info?.("淘宝 Provider 配置状态", {configured, mode});
  if (mode === "mock") {
    if (!allowMock) {
      logger.error?.("生产环境禁止 Mock 商品 Provider", {configured, mode});
      return new UnavailableProductProvider({
        message: "生产环境已禁用 Mock 商品数据",
        code: "PRODUCT_MOCK_DISABLED_IN_PRODUCTION",
      });
    }
    return new MockProductProvider({
      catalog: productCatalog,
      logger,
      reranker,
      outfitPostProcessor,
      candidatePipeline,
      wholeLookAIAdjudicator,
    });
  }
  if (!configured) {
    logger.warn?.("淘宝 Provider 未完整配置", {
      configured: false,
      missingVariables,
    });
    return new UnavailableProductProvider({missingVariables});
  }
  let taobao;
  try {
    taobao = new TaobaoProductProvider({
      ...values,
      client,
      catalog: productCatalog,
      endpoint: environment.TAOBAO_API_URL,
      connectTimeoutMs: positiveInteger(environment.TAOBAO_CONNECT_TIMEOUT_MS, 5_000),
      timeoutMs: positiveInteger(environment.PRODUCT_PROVIDER_TIMEOUT_MS, 12_000),
      maxRetries: positiveInteger(environment.TAOBAO_MAX_RETRIES, 1),
      sampleMaterialId: environment.TAOBAO_SAMPLE_MATERIAL_ID || DEFAULT_SAMPLE_MATERIAL_ID,
      reranker,
      visualVerifier,
      visualVerificationBudgetMs: positiveInteger(
        environment.PRODUCT_VISUAL_VERIFICATION_TIMEOUT_MS,
        PRODUCT_VISUAL_VERIFICATION_BUDGET_MS,
      ),
      visualCandidateLimit: positiveInteger(
        environment.PRODUCT_VISUAL_MAX_CANDIDATES_PER_SLOT,
        visualVerifier?.maxCandidatesPerSlot || DEFAULT_MAX_CANDIDATES_PER_SLOT,
      ),
      outfitPostProcessor,
      candidatePipeline,
      wholeLookAIAdjudicator,
      rawCapture,
      recommendationCacheTtlMs: positiveInteger(
        environment.PRODUCT_RECOMMENDATION_CACHE_TTL_MS,
        DEFAULT_RECOMMENDATION_CACHE_TTL_MS,
      ),
      logger,
    });
  } catch (error) {
    logger.error?.("淘宝推广位配置无效", {
      configured: true,
      errorCode: error instanceof ProductProviderError
        ? error.code
        : "TAOBAO_INVALID_PLACEMENT",
    });
    throw error;
  }
  if (mode === "taobao") return taobao;
  return new AutoProductProvider({
    taobao,
    mock: new MockProductProvider({
      catalog: productCatalog,
      logger,
      reranker,
      outfitPostProcessor,
      candidatePipeline,
      wholeLookAIAdjudicator,
    }),
    logger,
    allowMockFallback: allowMock,
  });
}

function normalizeFilters(filters = {}) {
  const text = (value, field) => {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || value.trim().length > 100) {
      throw new ProductProviderError(`${field} 参数无效`, {status: 400, code: "INVALID_PRODUCT_FILTER"});
    }
    return value.trim();
  };
  const requestedLimit = Number(filters.limit);
  return {
    category: canonicalCategory(text(filters.category, "category")) ||
      normalizeProductCategory(text(filters.category, "category")),
    style: text(filters.style, "style"),
    color: text(filters.color, "color"),
    bodyType: text(filters.bodyType, "bodyType"),
    scene: text(filters.scene, "scene"),
    gender: normalizeGender(text(filters.gender, "gender")),
    fit: text(filters.fit, "fit"),
    season: text(filters.season, "season"),
    requestId: text(filters.requestId, "requestId"),
    lookId: text(filters.look_id ?? filters.lookId, "look_id"),
    budget: optionalNumber(filters.budget) || 0,
    keyword: text(filters.keyword, "keyword"),
    explicit_user_search: filters.explicit_user_search === true,
    user_search_keyword: text(
      filters.user_search_keyword ?? filters.userSearchKeyword,
      "user_search_keyword",
    ),
    itemName: text(filters.item_name ?? filters.itemName, "item_name"),
    material: text(filters.material, "material"),
    searchKeywords: normalizeFilterList(
      filters.search_keywords ?? filters.searchKeywords,
      "search_keywords",
      4,
    ),
    negativeKeywords: normalizeFilterList(
      filters.negative_keywords ?? filters.negativeKeywords,
      "negative_keywords",
      30,
    ),
    limit: Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 2,
  };
}

function buildSearchKeyword(filters) {
  const categoryNames = {
    top: "上衣", bottom: "裤子 裙子", shoes: "鞋", outerwear: "外套", accessories: "配饰",
  };
  return [filters.gender, filters.scene, filters.style, categoryNames[filters.category],
    filters.color, filters.season, filters.fit, filters.keyword].filter(Boolean).join(" ") || "服饰";
}

function normalizeFilterList(value, field, limit) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw new ProductProviderError(`${field} 参数无效`, {
      status: 400,
      code: "INVALID_PRODUCT_FILTER",
    });
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 160) {
      throw new ProductProviderError(`${field} 参数无效`, {
        status: 400,
        code: "INVALID_PRODUCT_FILTER",
      });
    }
    return entry.trim();
  });
}

function mockCompatibleCategory(value) {
  const category = normalizeProductCategory(value) || canonicalCategory(value);
  if (["bag", "hat", "accessory"].includes(category)) return "accessories";
  if (category === "dress") return "top";
  return category;
}

function extractTaobaoItems(payload) {
  const response = payload?.tbk_dg_material_optional_upgrade_response ||
    payload?.tbkDgMaterialOptionalUpgradeResponse ||
    payload?.tbk_dg_material_optional_response ||
    payload?.tbkDgMaterialOptionalResponse ||
    payload?.tbk_dg_material_recommend_response ||
    payload?.tbkDgMaterialRecommendResponse || {};
  const resultList = response.result_list || response.resultList || response.results || {};
  const raw = resultList.map_data || resultList.mapData || resultList.items ||
    response.map_data || response.mapData || [];
  return Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
}

function mapPayload(payload, filters, pid, origin, onDiagnostics, onRawProducts) {
  const rawItems = extractTaobaoItems(payload);
  const query = filters.searchKeyword || filters.keyword || buildSearchKeyword(filters);
  const observedAt = new Date().toISOString();
  const rawProducts = rawItems.map((item) => buildRawTaobaoProduct(item, {
    query,
    observedAt,
  }));
  onRawProducts?.({
    query,
    origin,
    products: rawProducts,
    responseSummary: safeTaobaoResponseShape(payload),
  });
  const mapped = rawItems.map((item, index) => {
    try {
      const product = mapTaobaoProduct(item, {
        pid,
        fallbackCategory: filters.category,
        filters,
        origin,
      });
      const enriched = enrichTaobaoCandidate(rawProducts[index]);
      return attachEnrichmentToCandidate(product, rawProducts[index], enriched);
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
  const usable = mapped.filter(isUsableTaobaoProduct);
  const qualityBlocks = usable
    .map((product) => productQualityBlock(product, filters))
    .filter(Boolean);
  const qualitySafe = usable.filter((product) => !productQualityBlock(product, filters));
  const products = filters.deferCandidatePipeline === true
    ? usable.map((product) => preserveCandidateContract({
      ...product,
      search_keyword: filters.searchKeyword || filters.keyword || "",
    }, filters))
    : filters.category
      ? rankProducts(
        qualitySafe,
        filters,
        filters.searchKeyword || filters.keyword,
        {minimumScore: filters.minimumRelevanceScore},
      )
      : qualitySafe.map((product) => {
      const {_category_text: _, ...publicProduct} = product;
      const originalGender = authoritativeProductGender(publicProduct);
      return {
        ...publicProduct,
        original_gender: originalGender,
        gender: originalGender,
        requested_gender: normalizeGender(filters.gender),
        search_keyword: filters.searchKeyword || filters.keyword || "",
        relevance_score: 0,
      };
      });
  onDiagnostics?.({
    origin,
    ...safeTaobaoResponseShape(payload),
    rawCount: rawItems.length,
    mappedCount: mapped.length,
    usableCount: products.length,
    missingImageCount: mapped.filter((product) => !normalizePublicImageUrl(product.image_url)).length,
    missingPriceCount: mapped.filter((product) => !(Number(product.price) > 0)).length,
    missingPromotionUrlCount: mapped.filter(
      (product) => !normalizeHttpsUrl(product.purchase_url),
    ).length,
    blocked_category: [...new Set(qualityBlocks.map((item) => item.blocked_category))],
    blocked_keyword: [...new Set(qualityBlocks.map((item) => item.blocked_keyword))],
    lowValueBlockedCount: qualityBlocks.length,
    categoryMismatchCount: Math.max(qualitySafe.length - products.length, 0),
  });
  return products;
}

function safeTaobaoResponseShape(payload) {
  const rootKey = Object.keys(payload || {}).find((key) => /response$/i.test(key)) || "";
  const response = rootKey && payload[rootKey] && typeof payload[rootKey] === "object"
    ? payload[rootKey]
    : {};
  const resultList = response.result_list || response.resultList || response.results;
  return {
    responseRoot: rootKey,
    responseKeys: Object.keys(response).sort().slice(0, 20),
    resultListType: Array.isArray(resultList) ? "array" : typeof resultList,
    resultListKeys: resultList && typeof resultList === "object" && !Array.isArray(resultList)
      ? Object.keys(resultList).sort().slice(0, 20)
      : [],
    totalResults: firstNumber(response.total_results, response.totalResults) ?? null,
  };
}

function mapTaobaoProduct(item, {pid, fallbackCategory = "", filters = {}, origin = "search"} = {}) {
  const basic = item.item_basic_info || item.itemBasicInfo || item;
  const priceInfo = item.price_promotion_info || item.pricePromotionInfo || item;
  const publish = item.publish_info || item.publishInfo || item;
  const income = publish.income_info || publish.incomeInfo || publish;
  const productId = firstText(basic.item_id, basic.itemId, item.item_id, item.itemId);
  if (!productId) throw new ProductProviderError("淘宝商品缺少 item_id");
  const title = firstText(basic.short_title, basic.title, item.short_title, item.title);
  if (!title) throw new ProductProviderError("淘宝商品缺少标题");
  const couponUrl = firstHttps(
    publish.coupon_share_url, publish.couponShareUrl,
    publish.coupon_click_url, publish.couponClickUrl,
    item.coupon_share_url, item.couponShareUrl,
    item.coupon_click_url, item.couponClickUrl,
  );
  const affiliateUrl = firstHttps(
    publish.click_url, publish.clickUrl,
    publish.item_url, publish.itemUrl,
    item.click_url, item.clickUrl,
    item.url,
    couponUrl,
  );
  const purchaseUrl = couponUrl || affiliateUrl;
  const rawCategory = firstText(
    basic.category_name, basic.level_one_category_name, item.category_name,
    item.level_one_category_name,
  );
  const category = normalizeProductCategory(`${rawCategory} ${title}`) ||
    normalizeProductCategory(fallbackCategory) ||
    canonicalCategory(`${rawCategory} ${title}`) ||
    canonicalCategory(fallbackCategory) ||
    "top";
  const price = firstNumber(
    priceInfo.final_promotion_price, priceInfo.price_after_coupon,
    item.final_promotion_price, item.price_after_coupon, basic.zk_final_price,
    item.zk_final_price, basic.reserve_price, item.reserve_price,
  ) ?? 0;
  const originalPrice = firstNumber(priceInfo.reserve_price, basic.reserve_price, item.reserve_price);
  const commissionRate = normalizeCommissionRate(firstNumber(income.commission_rate, item.commission_rate));
  const brandName = firstText(basic.brand_name, item.brand_name);
  const shopName = firstText(
    basic.shop_title,
    basic.seller_nick,
    item.shop_title,
    item.seller_nick,
  );
  const whiteImageUrl = firstPublicImageUrl(
    basic.white_image,
    item.white_image,
  );
  const primaryImageUrl = firstPublicImageUrl(
    basic.pict_url,
    item.pict_url,
  );
  const imageUrl = whiteImageUrl || primaryImageUrl;
  const originalGender = authoritativeProductGender({
    gender: firstText(
      basic.gender,
      basic.item_gender,
      item.gender,
      item.item_gender,
    ),
    title,
    _category_text: `${rawCategory} ${title}`.trim(),
    category,
  });
  return compact({
    product_id: productId,
    source: "taobao",
    title,
    _category_text: `${rawCategory} ${title}`.trim(),
    brand: brandName,
    category,
    original_gender: originalGender,
    gender: originalGender,
    price,
    image_url: imageUrl,
    image_quality_hint: inferImageQualityHint({
      whiteImageUrl,
      imageUrl,
      title,
      shopName,
    }),
    original_price: originalPrice != null && originalPrice > price ? originalPrice : null,
    coupon_amount: firstNumber(priceInfo.coupon_amount, item.coupon_amount) ?? null,
    shop_name: shopName,
    sales: firstText(
      basic.annual_vol,
      basic.volume,
      item.annual_vol,
      item.volume,
      item.tk_total_sales,
    ) || undefined,
    recommendation_reason: buildRecommendationReason(filters),
    match_explanation: buildMatchExplanation(filters),
    detail_url: firstHttps(basic.item_url, basic.itemUrl, item.item_url, item.itemUrl),
    purchase_url: purchaseUrl,
    platform: "taobao",
    commission_rate: commissionRate ?? null,
    affiliate_url: affiliateUrl,
    stock_status: "unknown",
    pid,
    coupon_url: couponUrl,
    is_mock: false,
    tags: [filters.style, filters.color, filters.keyword, origin].filter(Boolean),
  });
}

function buildRecommendationReason(filters = {}) {
  const values = [filters.style, filters.scene, filters.category].filter(Boolean);
  return values.length ? `根据本次${values.join("、")}穿搭方案匹配` : "根据当前 AI 穿搭方案匹配";
}

function buildMatchExplanation(filters = {}) {
  const values = [filters.gender, filters.color, filters.season, filters.fit, filters.keyword].filter(Boolean);
  return values.length ? `匹配需求：${values.join("、")}` : "匹配当前穿搭品类与风格";
}

function normalizeCommissionRate(value) {
  if (value == null) return undefined;
  if (value > 100) return Math.min(value / 10_000, 1);
  if (value > 1) return Math.min(value / 100, 1);
  return Math.min(Math.max(value, 0), 1);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== "" && value != null && Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function optionalNumber(value) {
  return firstNumber(value);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function firstHttps(...values) {
  for (const value of values) {
    const normalized = normalizeHttpsUrl(value);
    if (normalized) return normalized;
  }
  return "";
}

function firstPublicImageUrl(...values) {
  for (const value of values) {
    const normalized = normalizePublicImageUrl(value);
    if (normalized) return normalized;
  }
  return "";
}

function inferImageQualityHint({whiteImageUrl, imageUrl, title, shopName}) {
  if (whiteImageUrl) return "white_background";
  const evidence = `${title || ""} ${shopName || ""}`;
  if (/官方|旗舰店|品牌直营/.test(evidence)) return "official";
  const normalizedUrl = String(imageUrl || "").toLowerCase();
  if (/(?:promo|poster|banner|activity|marketing|campaign|sale)[-_/.]/.test(normalizedUrl)) {
    return "promotion_poster";
  }
  if (/(?:model|wear|lookbook|detail)[-_/.]/.test(normalizedUrl)) {
    return "model_display";
  }
  return "standard";
}

function normalizePublicImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || !isPublicHost(url.hostname)) {
      return "";
    }
    return url.toString();
  } catch (_) {
    return "";
  }
}

function isPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return false;
  }
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    const [first, second] = parts;
    return first !== 0 &&
      first !== 10 &&
      first !== 127 &&
      !(first === 169 && second === 254) &&
      !(first === 172 && second >= 16 && second <= 31) &&
      !(first === 192 && second === 168);
  }
  return true;
}

function normalizeHttpsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.host ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isUsableTaobaoProduct(product) {
  return product?.source === "taobao" &&
    product?.is_mock === false &&
    Boolean(product.product_id) &&
    Boolean(product.title) &&
    Number(product.price) > 0 &&
    Boolean(normalizePublicImageUrl(product.image_url)) &&
    Boolean(normalizeHttpsUrl(product.purchase_url));
}

function logMappingDiagnostics(logger, details) {
  logger.info?.(`淘宝商品映射诊断 ${JSON.stringify(details)}`);
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const id = product?.product_id || product?.id;
    const key = `${product?.look_id || ""}:${id || ""}`;
    if (!id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeProductsByLook(products) {
  const counts = {};
  for (const product of products) {
    const lookId = String(product?.look_id || "unbound");
    counts[lookId] = (counts[lookId] || 0) + 1;
  }
  return counts;
}

function logProductBlueprintSummaries(logger, products, requestId) {
  (Array.isArray(products) ? products : []).forEach((product, index) => {
    logger.info?.("product_blueprint_summary", {
      request_id: requestId,
      product_title: product.title,
      blueprint_score: Number(product.blueprint_match_score),
      body_strategy_match_score: Number(product.body_strategy_match_score),
      matched_elements: Array.isArray(product.matched_elements)
        ? product.matched_elements
        : [],
      conflict_elements: Array.isArray(product.conflict_elements)
        ? product.conflict_elements
        : [],
      final_rank: index + 1,
    });
  });
}

function recommendationCacheKey(queries, context = {}) {
  return JSON.stringify((Array.isArray(queries) ? queries : []).map((query) => ({
    request_id: String(context.requestId || query?.request_id || "").trim(),
    look_id: String(query?.look_id || query?.lookId || "").trim(),
    category: String(query?.category || "").trim().toLowerCase(),
    keywords: requirementSearchKeywords(query),
    fallback_keyword: String(
      query?.commerce_query_plan?.fallback_query?.query || "",
    ).trim(),
  })));
}

function requirementSearchKeywords(requirement = {}) {
  const supplied = [...new Set([
    ...(Array.isArray(requirement?.search_keywords)
      ? requirement.search_keywords : []),
    ...(Array.isArray(requirement?.searchKeywords)
      ? requirement.searchKeywords : []),
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  if (supplied.length > 0) return supplied.slice(0, 4);
  return [...new Set([
    requirement?.keyword,
    requirement?.item_name,
    requirement?.itemName,
  ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 1);
}

function stylingCompletionQueryTexts(queryPlan = {}) {
  const candidates = Array.isArray(queryPlan?.query_candidates)
    ? queryPlan.query_candidates : [];
  // Resolve by typed IDs, not array position. Do not deduplicate: Q1 and Q2
  // are independent bounded client calls even when their text is identical.
  return ["Q1", "Q2"].map((queryId) => {
    const entry = candidates.find((candidate) =>
      String(candidate?.query_id || "") === queryId);
    return typeof entry?.query === "string" ? entry.query : "";
  });
}

function isTrustedStylingCompletionPlan(requirement = {}, context = {}) {
  const plan = requirement?.commerce_query_plan ||
    context?.commerce_query_plan || {};
  const version = String(requirement?.query_plan_version || plan.version || "");
  return version === "styling_completion_query.v1" &&
    context?.[STYLING_COMPLETION_AUTHORITY] === true &&
    String(requirement?.style_role || requirement?.styleRole ||
      context?.style_role || "").trim().toLowerCase() === "styling_completion" &&
    stylingCompletionQueryTexts(plan).every(Boolean);
}

function buildCandidateRefillQueries(
  requirement = {},
  round = 1,
  qualityDeficit = null,
) {
  const normalizedRound = Number(round);
  if (!Number.isInteger(normalizedRound) || normalizedRound < 1 ||
      normalizedRound > DEFAULT_MAX_REFILL_ROUNDS) {
    return [];
  }
  const deficitQuery = buildDeficitRefillQuery(
    requirement,
    qualityDeficit,
    normalizedRound,
  );
  if (deficitQuery) return [deficitQuery];
  const plan = requirement?.commerce_query_plan || {};
  const candidates = Array.isArray(plan.query_candidates)
    ? plan.query_candidates : [];
  const q1 = candidates.find((entry) => entry?.query_id === "Q1") || candidates[0];
  const q3 = plan.fallback_query || null;
  const highRecall = String(
    q1?.query || requirementSearchKeywords(requirement)[0] || "",
  ).trim().slice(0, 80);
  const broad = String(q3?.query || "").trim();
  const q2 = candidates.find((entry) => entry?.query_id === "Q2") || candidates[1];
  const signal = String(q2?.aesthetic_signal || "").trim();
  const broadWithIntent = [...new Set([broad, signal].filter(Boolean))]
    .join(" ").trim().slice(0, 80);
  const hasBroaderCategory = Boolean(broad && broad !== highRecall);
  const hasBroadIntentVariant = Boolean(hasBroaderCategory && signal &&
    broadWithIntent !== broad);
  const values = normalizedRound === 1
    ? [{
      query: hasBroadIntentVariant ? broadWithIntent
        : (hasBroaderCategory ? broad : highRecall),
      query_type: hasBroadIntentVariant
        ? "Q3_BROADER_CATEGORY_WITH_CORE_INTENT"
        : (hasBroaderCategory
          ? "Q3_BROADER_CATEGORY"
          : "Q1_HIGH_RECALL_NEXT_PAGE"),
      page_no: hasBroaderCategory ? 1 : 2,
    }]
    : [{
      query: broad || highRecall,
      query_type: hasBroaderCategory
        ? (hasBroadIntentVariant
          ? "Q3_BROADER_CATEGORY"
          : "Q3_BROADER_CATEGORY_NEXT_PAGE")
        : "Q1_HIGH_RECALL_LATER_PAGE",
      page_no: hasBroaderCategory && !hasBroadIntentVariant ? 2
        : (hasBroaderCategory ? 1 : 3),
    }];
  return values.filter((entry) => entry.query).map((entry) => ({
    ...entry,
    fallback_level: normalizedRound + 2,
  }));
}

function markRerankFallback(products, reason = "AI_RERANK_FALLBACK") {
  return cloneProductArray(products).map((product) => ({
    ...product,
    ai_rerank_fallback: true,
    ai_rerank_fallback_reason: String(reason || "AI_RERANK_FALLBACK"),
    rerank_status: "fallback",
  }));
}

function cloneProductArray(products) {
  return (Array.isArray(products) ? products : []).map((product) => ({...product}));
}

async function withTimeBudget(promise, timeoutMs, code) {
  const budget = Math.max(1, Number(timeoutMs) || 1);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ProductProviderError(
          "商品处理阶段超过时间预算",
          {status: 504, code},
        )), budget);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function requireConfig(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new ProductProviderError(`${field} 未配置`, {status: 503, code: "PRODUCT_PROVIDER_NOT_CONFIGURED"});
  return text;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseTaobaoPlacement(pid, adzoneIdOverride = "") {
  const normalizedPid = requireConfig(pid, "TAOBAO_PID");
  const match = /^mm_(\d+)_(\d+)_(\d+)$/.exec(normalizedPid);
  if (!match) {
    throw new ProductProviderError(
      "TAOBAO_PID 格式无效，应为 mm_accountId_siteId_adzoneId",
      {status: 500, code: "TAOBAO_INVALID_PID"},
    );
  }
  const siteId = match[2];
  const pidAdzoneId = match[3];
  const override = String(adzoneIdOverride || "").trim();
  if (override && !/^\d+$/.test(override)) {
    throw new ProductProviderError("TAOBAO_ADZONE_ID 格式无效", {
      status: 500,
      code: "TAOBAO_INVALID_ADZONE_ID",
    });
  }
  if (override && override !== pidAdzoneId) {
    throw new ProductProviderError(
      "TAOBAO_ADZONE_ID 必须与 TAOBAO_PID 最后一段一致",
      {status: 500, code: "TAOBAO_PID_ADZONE_MISMATCH"},
    );
  }
  return {siteId, adzoneId: override || pidAdzoneId};
}

function safeProviderCode(error) {
  if (error instanceof TaobaoApiError || error instanceof ProductProviderError) return error.code;
  return "TAOBAO_UNKNOWN_ERROR";
}

function safeWholeLookAdjudicationCode(error) {
  const code = String(error?.code || "WHOLE_LOOK_AI_ADJUDICATION_FAILED").trim();
  return /^[A-Z0-9_.-]{3,80}$/u.test(code)
    ? code : "WHOLE_LOOK_AI_ADJUDICATION_FAILED";
}

function isEmptyTaobaoResult(error) {
  return error instanceof TaobaoApiError &&
    error.details?.taobao_error_code === "15" &&
    error.details?.taobao_sub_code === "50001";
}

function asProductProviderError(error) {
  if (error instanceof ProductProviderError) return error;
  return new ProductProviderError("淘宝商品接口请求失败", {
    status: 502,
    code: safeProviderCode(error),
    cause: error,
  });
}

function budgetPreferenceAssessment(product, preferredMaximum) {
  const price = Number(product?.price);
  const budget = Number(preferredMaximum);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(budget) || budget <= 0) {
    return {
      budget_preference_score: 70,
      budget_note: "",
    };
  }
  if (price <= budget) {
    return {
      budget_preference_score: 100,
      budget_note: "",
    };
  }
  const ratio = price / budget;
  if (ratio <= 1.2) {
    return {
      budget_preference_score: 80,
      budget_note: `价格略高于单品预算（约 ¥${Math.round(budget)}），但可因品质或搭配效果考虑。`,
    };
  }
  if (ratio <= 1.5) {
    return {
      budget_preference_score: 55,
      budget_note: `价格高于单品预算（约 ¥${Math.round(budget)}），建议确认材质、品牌与使用频率后再选择。`,
    };
  }
  return {
    budget_preference_score: 30,
    budget_note: `价格明显高于单品预算（约 ¥${Math.round(budget)}），仅在设计或品质优势明确时考虑。`,
  };
}

module.exports = {
  AutoProductProvider,
  MockProductProvider,
  ProductProvider,
  ProductProviderError,
  TaobaoProductProvider,
  UnavailableProductProvider,
  budgetPreferenceAssessment,
  buildCandidateRefillQueries,
  createProductProvider,
  extractTaobaoItems,
  mapTaobaoProduct,
  normalizeHttpsUrl,
  normalizePublicImageUrl,
  parseTaobaoPlacement,
  postProcessOutfitCandidates,
  runSharedCandidatePipeline,
  safeTaobaoResponseShape,
  signTaobaoRequest,
};
