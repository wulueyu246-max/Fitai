const crypto = require("node:crypto");
const {
  categoryPriority,
  productQualityBlock,
  semanticCategoryMatch,
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
  resolveAestheticTargetProfile,
} = require("./style_intelligence");
const {
  DEFAULT_ADJUDICATION_MARGIN,
  MAX_ADJUDICATION_CALLS,
  buildAmbiguityPlan,
} = require("./product_reranker_ambiguity");
const {buildTargetFitAssessment} = require("./target_fit_assessment");

const DEFAULT_SELECTION_LIMIT = 6;
const MAX_SELECTION_LIMIT = 6;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_ENTRIES = 100;
const DEFAULT_VISUAL_CANDIDATES_PER_GROUP = 8;
const MAX_CANDIDATES_PER_LOOK = 48;
const MAX_PRODUCT_AI_MS = 20_000;
const MAX_VISUAL_IMAGES_PER_REQUEST = 6;
const MAX_VISUAL_STAGE_MS = 6_000;
const MAX_VISUAL_IMAGE_MS = 2_500;
const MAX_SELECTION_BATCH_MS = 7_500;
const MAX_SLOT_CANDIDATES = 6;
const MIN_SLOT_SELECTION = 2;
const MAX_SLOT_SELECTION = 3;
const DEFAULT_SELECTION_CONCURRENCY = 2;
const DEFAULT_VISUAL_CONCURRENCY = 3;
const DEFAULT_ADJUDICATION_TIMEOUT_MS = 5_500;
const DEFAULT_ADJUDICATION_TOTAL_BUDGET_MS = 10_000;
const MAX_ADJUDICATION_TIMEOUT_MS = 6_000;
const MAX_ADJUDICATION_TOTAL_BUDGET_MS = 10_000;
const MAX_ADJUDICATION_OUTPUT_TOKENS = 220;
const MODEL_TRANSPORT_TIMEOUT_GRACE_MS = 1_000;
const DEFAULT_REQUEST_TRACE_ENTRIES = 200;
const HIGH_QUALITY_BRAND_SCORE = 65;
const CALIBRATED_PRODUCT_WEIGHTS = Object.freeze({
  style_fit: 0.34,
  occasion_fit: 0.13,
  silhouette_fit: 0.09,
  color_fit: 0.06,
  footwear_fit: 0.08,
  quality_fit: 0.10,
  gender_fit: 0.06,
  relevance: 0.06,
  blueprint: 0.04,
  aesthetic: 0.02,
  visual: 0.01,
  body: 0.01,
});
const RERANKER_CALIBRATION_VERSION = "universal_aesthetic_reranker_v1";
const QUALITY_TIER_VALUE = Object.freeze({
  budget: 0.25,
  standard: 0.5,
  mid: 0.65,
  premium: 0.82,
  luxury: 1,
});
const SCENE_COMPATIBILITY = Object.freeze({
  date: Object.freeze(["daily", "party"]),
  daily: Object.freeze(["date", "travel", "commute"]),
  commute: Object.freeze(["work", "daily"]),
  work: Object.freeze(["commute", "daily"]),
  ktv: Object.freeze(["party", "date"]),
  party: Object.freeze(["ktv", "date"]),
  travel: Object.freeze(["daily"]),
  formal_event: Object.freeze(["party", "work"]),
});

const BRAND_TIERS = Object.freeze({
  S: Object.freeze([
    ["ralph lauren", "拉夫劳伦", "拉尔夫劳伦"],
    ["cos"],
    ["massimo dutti"],
    ["a.p.c.", "apc"],
    ["theory"],
    ["sandro"],
    ["maje"],
    ["acne studios"],
  ]),
  A: Object.freeze([
    ["uniqlo", "优衣库"],
    ["zara"],
    ["nike", "耐克"],
    ["adidas", "阿迪达斯"],
    ["new balance", "newbalance", "新百伦"],
    ["levi's", "levis", "李维斯"],
    ["tommy hilfiger", "tommyhilfiger"],
    ["lacoste", "鳄鱼"],
  ]),
});

const BRAND_SCORE = Object.freeze({S: 100, A: 85, B: 68, C: 25});
const POSITIVE_TITLE_QUALITY_TERMS = Object.freeze([
  "旗舰店", "官方", "品牌", "设计师", "系列",
]);
const NEGATIVE_TITLE_QUALITY_TERMS = Object.freeze([
  "清仓", "爆款", "地摊", "同款", "学生", "9.9", "秒杀", "促销",
]);
const STRONG_IMAGE_QUALITY_HINTS = new Set([
  "white_background", "model_display", "official",
]);
const FEMININE_DRESS_SCENE_PATTERN = /约会|甜美|高级|优雅|法式|浪漫|精致|date|sweet|elegant|premium|romantic/i;
const DRESS_DESIGN_DETAIL_PATTERN = /收腰|高腰|腰封|裹身|不对称|立体剪裁|褶裥|拼接|荷叶边|方领|v领|泡泡袖|开衩|鱼尾|a字|伞摆|百褶|提花|蕾丝|刺绣|廓形/i;
const BASIC_DRESS_PATTERN = /纯色|基础款|基本款|普通款|简约基础|通勤基础/i;

class ProductAestheticReranker {
  constructor({
    client,
    model,
    timeoutMs = MAX_PRODUCT_AI_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxCacheEntries = DEFAULT_CACHE_ENTRIES,
    visualEvaluationEnabled = true,
    selectiveAdjudicationEnabled = false,
    adjudicationMargin = DEFAULT_ADJUDICATION_MARGIN,
    adjudicationMaxCalls = MAX_ADJUDICATION_CALLS,
    adjudicationTimeoutMs = DEFAULT_ADJUDICATION_TIMEOUT_MS,
    adjudicationTotalBudgetMs = DEFAULT_ADJUDICATION_TOTAL_BUDGET_MS,
    selectionConcurrency = DEFAULT_SELECTION_CONCURRENCY,
    visualConcurrency = DEFAULT_VISUAL_CONCURRENCY,
    visualStageMs = MAX_VISUAL_STAGE_MS,
    visualImageTimeoutMs = MAX_VISUAL_IMAGE_MS,
    logger = console,
  } = {}) {
    this.client = client || null;
    this.model = String(model || "").trim();
    this.timeoutMs = Math.min(
      positiveInteger(timeoutMs, MAX_PRODUCT_AI_MS),
      MAX_PRODUCT_AI_MS,
    );
    this.cacheTtlMs = positiveInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maxCacheEntries = positiveInteger(maxCacheEntries, DEFAULT_CACHE_ENTRIES);
    this.visualEvaluationEnabled = visualEvaluationEnabled !== false;
    this.selectiveAdjudicationEnabled = selectiveAdjudicationEnabled === true;
    this.adjudicationMargin = positiveNumber(
      adjudicationMargin,
      DEFAULT_ADJUDICATION_MARGIN,
    );
    this.adjudicationMaxCalls = Math.min(
      MAX_ADJUDICATION_CALLS,
      positiveInteger(adjudicationMaxCalls, MAX_ADJUDICATION_CALLS),
    );
    this.adjudicationTimeoutMs = Math.min(
      positiveInteger(adjudicationTimeoutMs, DEFAULT_ADJUDICATION_TIMEOUT_MS),
      MAX_ADJUDICATION_TIMEOUT_MS,
    );
    this.adjudicationTotalBudgetMs = Math.min(
      positiveInteger(
        adjudicationTotalBudgetMs,
        DEFAULT_ADJUDICATION_TOTAL_BUDGET_MS,
      ),
      MAX_ADJUDICATION_TOTAL_BUDGET_MS,
    );
    this.selectionConcurrency = Math.min(
      positiveInteger(selectionConcurrency, DEFAULT_SELECTION_CONCURRENCY),
      DEFAULT_SELECTION_CONCURRENCY,
    );
    this.visualConcurrency = Math.min(
      positiveInteger(visualConcurrency, DEFAULT_VISUAL_CONCURRENCY),
      DEFAULT_VISUAL_CONCURRENCY,
    );
    this.visualStageMs = Math.min(
      positiveInteger(visualStageMs, MAX_VISUAL_STAGE_MS),
      MAX_VISUAL_STAGE_MS,
    );
    this.visualImageTimeoutMs = Math.min(
      positiveInteger(visualImageTimeoutMs, MAX_VISUAL_IMAGE_MS),
      MAX_VISUAL_IMAGE_MS,
    );
    this.logger = logger;
    this.cache = new Map();
    this.selectionHistory = new Map();
    this.requestTraces = new Map();
    this.metrics = {
      callCount: 0,
      cacheHits: 0,
      fallbackCount: 0,
      totalDurationMs: 0,
      lastDurationMs: null,
      visualCallCount: 0,
      visualFallbackCount: 0,
      visualTotalDurationMs: 0,
      visualLastDurationMs: null,
      lastFallbackReason: null,
      lastFallbackCategory: null,
      fallbackReasons: new Map(),
      modelRequestCount: 0,
      selectionBatchCount: 0,
      selectionBatchFallbackCount: 0,
      adjudicationRequiredCount: 0,
      adjudicationAttemptedCount: 0,
      adjudicationSuccessCount: 0,
      adjudicationTimeoutCount: 0,
      adjudicationFallbackCount: 0,
      adjudicationTotalLatencyMs: 0,
      lastTrace: null,
    };
  }

  get configured() {
    return Boolean(this.client && this.model);
  }

  getStats() {
    return {
      configured: this.configured,
      call_count: this.metrics.callCount,
      cache_hits: this.metrics.cacheHits,
      fallback_count: this.metrics.fallbackCount,
      average_duration_ms: this.metrics.callCount > 0
        ? Math.round(this.metrics.totalDurationMs / this.metrics.callCount)
        : 0,
      last_duration_ms: this.metrics.lastDurationMs,
      visual_call_count: this.metrics.visualCallCount,
      visual_fallback_count: this.metrics.visualFallbackCount,
      visual_average_duration_ms: this.metrics.visualCallCount > 0
        ? Math.round(this.metrics.visualTotalDurationMs / this.metrics.visualCallCount)
        : 0,
      visual_last_duration_ms: this.metrics.visualLastDurationMs,
      last_fallback_reason: this.metrics.lastFallbackReason,
      last_fallback_category: this.metrics.lastFallbackCategory,
      fallback_reasons: Object.fromEntries(this.metrics.fallbackReasons),
      model_request_count: this.metrics.modelRequestCount,
      selection_batch_count: this.metrics.selectionBatchCount,
      selection_batch_fallback_count: this.metrics.selectionBatchFallbackCount,
      selective_adjudication_enabled: this.selectiveAdjudicationEnabled,
      adjudication_margin: this.adjudicationMargin,
      adjudication_max_calls: this.adjudicationMaxCalls,
      adjudication_required_count: this.metrics.adjudicationRequiredCount,
      adjudication_attempted_count: this.metrics.adjudicationAttemptedCount,
      adjudication_success_count: this.metrics.adjudicationSuccessCount,
      adjudication_timeout_count: this.metrics.adjudicationTimeoutCount,
      adjudication_fallback_count: this.metrics.adjudicationFallbackCount,
      adjudication_total_latency_ms: this.metrics.adjudicationTotalLatencyMs,
      last_trace: this.metrics.lastTrace,
      cache_entries: this.cache.size,
    };
  }

  getTraceForRequest(requestId) {
    const key = String(requestId || "").trim();
    return key ? this.requestTraces.get(key) || null : null;
  }

  async rerank({groups, context = {}, requestId = "", selectionLimit = DEFAULT_SELECTION_LIMIT}) {
    const gateProfile = contextStyleProfile(context);
    const gatePriority = resolveIntentPriorityScore(gateProfile);
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const product of Array.isArray(group?.candidates) ? group.candidates : []) {
        const gate = evaluateStyleGate(product, gateProfile, gatePriority);
        if (!gate.allowed) {
          this.logger.info?.("Style Gate rejected candidate", {
            title: product.title,
            category: group?.requirement?.category || product.category,
            style_conflict: true,
            matched_negative_keywords: gate.matched_negative_keywords,
            intent_priority_score: gate.intent_priority_score,
          });
        }
      }
    }
    const qualityBlocks = collectQualityBlocks(groups);
    if (qualityBlocks.length > 0) {
      this.logger.warn?.("商品质量过滤", {
        requestId: requestId || undefined,
        stage: "ai_reranker",
        blocked_category: [...new Set(qualityBlocks.map((item) => item.blocked_category))],
        blocked_keyword: [...new Set(qualityBlocks.map((item) => item.blocked_keyword))],
        blockedCount: qualityBlocks.length,
      });
    }
    const prefilterCount = (Array.isArray(groups) ? groups : []).reduce(
      (total, group) => total + (Array.isArray(group?.candidates) ? group.candidates.length : 0),
      0,
    );
    const normalizedGroups = limitCandidatesPerLook(
      normalizeGroups(groups, selectionLimit, context),
    );
    let workingGroups = normalizedGroups;
    const candidateCount = normalizedGroups.reduce(
      (total, group) => total + group.candidates.length,
      0,
    );
    if (candidateCount === 0) {
      this.#setTrace(requestId, Object.freeze({
        request_id: requestId || null,
        configured_timeout_ms: this.timeoutMs,
        prefilter_candidate_count: prefilterCount,
        normalized_candidate_count: 0,
        group_count: normalizedGroups.length,
        total_ms: 0,
        cached: false,
        fallback: false,
        reason: "NO_ELIGIBLE_CANDIDATES",
      }));
      return [];
    }

    const cacheKey = buildCacheKey(normalizedGroups, context);
    const finalize = (products) => this.#diversify(
      cacheKey,
      products,
      workingGroups,
      selectionLimit,
      context,
    );
    const fallback = (reasonCode) => finalize(ruleFallback(
      workingGroups,
      selectionLimit,
      context,
    ).map((product) => ({
      ...product,
      ai_rerank_fallback: true,
      ai_rerank_fallback_reason: reasonCode || "AI_RERANK_FAILED",
    })));
    if (!this.configured) {
      if (this.selectiveAdjudicationEnabled) {
        const deterministicGroups = buildDeterministicGroups(
          normalizedGroups,
          selectionLimit,
          context,
        );
        const plan = buildAmbiguityPlan(deterministicGroups, {
          margin: this.adjudicationMargin,
          maxCalls: this.adjudicationMaxCalls,
        });
        const products = finalize(markSelectiveProducts(
          deterministicGroups,
          plan,
          new Map(),
          "AI_ADJUDICATION_NOT_CONFIGURED",
        ));
        if (plan.selected_count > 0) {
          this.metrics.fallbackCount += 1;
          this.metrics.adjudicationRequiredCount += plan.ambiguity_count;
          this.metrics.adjudicationFallbackCount += plan.selected_count;
          this.#recordFallback(
            "AI_ADJUDICATION_NOT_CONFIGURED",
            "ENVIRONMENT_CONFIGURATION",
          );
        }
        this.#setTrace(requestId, Object.freeze({
          request_id: requestId || null,
          configured_timeout_ms: this.timeoutMs,
          prefilter_candidate_count: prefilterCount,
          normalized_candidate_count: candidateCount,
          group_count: normalizedGroups.length,
          selection: selectiveTraceWithoutCalls(
            plan,
            "AI_ADJUDICATION_NOT_CONFIGURED",
            this.selectionConcurrency,
          ),
          total_ms: 0,
          cached: false,
          fallback: plan.selected_count > 0,
          failure_reason: plan.selected_count > 0
            ? "AI_ADJUDICATION_NOT_CONFIGURED" : null,
          failure_category: plan.selected_count > 0
            ? "ENVIRONMENT_CONFIGURATION" : null,
        }));
        return cloneProducts(products);
      }
      this.metrics.fallbackCount += 1;
      const reasonCode = "AI_RERANK_NOT_CONFIGURED";
      this.#recordFallback(reasonCode, "ENVIRONMENT_CONFIGURATION");
      const products = fallback(reasonCode);
      this.#setTrace(requestId, Object.freeze({
        request_id: requestId || null,
        configured_timeout_ms: this.timeoutMs,
        prefilter_candidate_count: prefilterCount,
        normalized_candidate_count: candidateCount,
        group_count: normalizedGroups.length,
        total_ms: 0,
        cached: false,
        fallback: true,
        failure_reason: reasonCode,
        failure_category: "ENVIRONMENT_CONFIGURATION",
      }));
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: products.length,
        brandFallback: products.some((product) => product.brand_fallback === true),
        durationMs: 0,
        cached: false,
        fallback: true,
        errorCode: "AI_RERANK_NOT_CONFIGURED",
        errorCategory: "ENVIRONMENT_CONFIGURATION",
      });
      return products;
    }

    const cachedEntry = this.#readCache(cacheKey);
    if (cachedEntry) {
      const cached = cachedEntry.products;
      this.metrics.cacheHits += 1;
      const cachedFallback = cached.some((product) => product.ai_rerank_fallback === true);
      const diversified = finalize(cached);
      const cachedSelection = this.selectiveAdjudicationEnabled
        ? buildCachedSelectiveTrace(cachedEntry.selectionTrace, cached)
        : cachedEntry.selectionTrace;
      this.#setTrace(requestId, Object.freeze({
        request_id: requestId || null,
        configured_timeout_ms: this.timeoutMs,
        prefilter_candidate_count: prefilterCount,
        normalized_candidate_count: candidateCount,
        group_count: normalizedGroups.length,
        selection: cachedSelection,
        total_ms: 0,
        cached: true,
        fallback: cachedFallback,
        failure_reason: cachedFallback ? "AI_RERANK_CACHED_FALLBACK" : null,
      }));
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: diversified.length,
        brandFallback: diversified.some((product) => product.brand_fallback === true),
        durationMs: 0,
        cached: true,
        fallback: cachedFallback,
        errorCode: cachedFallback ? "AI_RERANK_CACHED_FALLBACK" : undefined,
      });
      return cloneProducts(diversified);
    }

    const startedAt = Date.now();
    let visualTrace = null;
    try {
      const deadlineAt = startedAt + this.timeoutMs;
      const visualResult = await this.#assessVisuals(
        normalizedGroups,
        context,
        requestId,
        Math.min(MAX_VISUAL_STAGE_MS, remainingBudgetMs(deadlineAt)),
      );
      workingGroups = visualResult.groups;
      visualTrace = visualResult.trace;
      let selectionPayload;
      let selected;
      if (this.selectiveAdjudicationEnabled) {
        workingGroups = buildDeterministicGroups(
          workingGroups,
          selectionLimit,
          context,
        );
        const selectiveResult = await this.#selectSelective(
          workingGroups,
          context,
          remainingBudgetMs(deadlineAt),
        );
        selected = selectiveResult.products;
        selectionPayload = {
          _reranker_batch_trace: selectiveResult.trace,
        };
      } else {
        selectionPayload = await this.#select(
          workingGroups,
          context,
          remainingBudgetMs(deadlineAt),
        );
        selected = validateSelection(
          selectionPayload,
          workingGroups,
          selectionLimit,
          context,
        );
      }
      const incompleteGroups = groupsBelowMinimum(
        workingGroups,
        selected,
        this.selectiveAdjudicationEnabled ? 1 : MIN_SLOT_SELECTION,
      );
      const failedSelectionBatches = Number(
        selectionPayload?._reranker_batch_trace?.failed_batch_count || 0,
      );
      const failedBatchCategories = [...new Set(
        (selectionPayload?._reranker_batch_trace?.batches || [])
          .filter((batch) => batch.status !== "SUCCESS")
          .map((batch) => batch.category)
          .filter(Boolean),
      )];
      const partialFailureCategory = failedBatchCategories.length === 1
        ? failedBatchCategories[0]
        : failedBatchCategories.length > 1 ? "MULTIPLE" : "OTHER";
      let usedFallback = failedSelectionBatches > 0;
      if (incompleteGroups.length > 0) {
        usedFallback = true;
        selected = replaceGroupProducts(
          selected,
          ruleFallback(incompleteGroups, selectionLimit, context),
          incompleteGroups,
        );
      }
      const durationMs = Date.now() - startedAt;
      if (usedFallback) this.metrics.fallbackCount += 1;
      if (usedFallback) {
        const fallbackReason = failedSelectionBatches > 0
          ? (this.selectiveAdjudicationEnabled
            ? "AI_ADJUDICATION_PARTIAL_FALLBACK"
            : "AI_RERANK_PARTIAL_BATCH_FALLBACK")
          : "AI_RERANK_INCOMPLETE_SELECTION";
        this.#recordFallback(
          fallbackReason,
          failedSelectionBatches > 0
            ? partialFailureCategory : "RESPONSE_VALIDATION",
        );
        selected = selected.map((product) => product.ai_rerank_fallback === true
          ? {...product,
            ai_rerank_fallback_reason:
              product.ai_rerank_fallback_reason || fallbackReason}
          : product);
      }
      this.#setTrace(requestId, Object.freeze({
        request_id: requestId || null,
        configured_timeout_ms: this.timeoutMs,
        prefilter_candidate_count: prefilterCount,
        normalized_candidate_count: candidateCount,
        group_count: normalizedGroups.length,
        visual: Object.freeze({...visualResult.trace}),
        selection: Object.freeze({
          ...(selectionPayload?._reranker_batch_trace || {}),
        }),
        total_ms: durationMs,
        cached: false,
        fallback: usedFallback,
      }));
      this.#writeCache(
        cacheKey,
        selected,
        selectionPayload?._reranker_batch_trace || null,
      );
      const diversified = finalize(selected);
      this.#logResult({
        requestId,
        prefilterCount,
        candidateCount,
        selectedCount: diversified.length,
        brandFallback: diversified.some((product) => product.brand_fallback === true),
        durationMs,
        cached: false,
        fallback: usedFallback,
        errorCode: usedFallback
          ? (failedSelectionBatches > 0
            ? (this.selectiveAdjudicationEnabled
              ? "AI_ADJUDICATION_PARTIAL_FALLBACK"
              : "AI_RERANK_PARTIAL_BATCH_FALLBACK")
            : "AI_RERANK_INCOMPLETE_SELECTION")
          : undefined,
        errorCategory: usedFallback
          ? (failedSelectionBatches > 0
            ? partialFailureCategory : "RESPONSE_VALIDATION")
          : undefined,
      });
      return cloneProducts(diversified);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.metrics.fallbackCount += 1;
      const diagnosis = classifyRerankerFailure(error);
      const reasonCode = diagnosis.reasonCode;
      this.#recordFallback(reasonCode, diagnosis.category);
      const products = fallback(reasonCode);
      this.#setTrace(requestId, Object.freeze({
        request_id: requestId || null,
        configured_timeout_ms: this.timeoutMs,
        prefilter_candidate_count: prefilterCount,
        normalized_candidate_count: candidateCount,
        group_count: normalizedGroups.length,
        visual: visualTrace ? Object.freeze({...visualTrace}) : null,
        selection: error?.rerankerSelectionTrace || null,
        total_ms: durationMs,
        cached: false,
        fallback: true,
        failure_reason: reasonCode,
        failure_category: diagnosis.category,
      }));
      this.#logResult({
        requestId,
        prefilterCount,
        candidateCount,
        selectedCount: products.length,
        brandFallback: products.some((product) => product.brand_fallback === true),
        durationMs,
        cached: false,
        fallback: true,
        errorCode: reasonCode,
        errorCategory: diagnosis.category,
      });
      return products;
    }
  }

  #recordFallback(reasonCode, category = "OTHER") {
    const code = String(reasonCode || "AI_RERANK_FAILED");
    this.metrics.lastFallbackReason = code;
    this.metrics.lastFallbackCategory = String(category || "OTHER");
    this.metrics.fallbackReasons.set(
      code,
      (this.metrics.fallbackReasons.get(code) || 0) + 1,
    );
  }

  #setTrace(requestId, trace) {
    this.metrics.lastTrace = trace;
    const key = String(requestId || "").trim();
    if (!key) return;
    this.requestTraces.delete(key);
    this.requestTraces.set(key, trace);
    while (this.requestTraces.size > DEFAULT_REQUEST_TRACE_ENTRIES) {
      this.requestTraces.delete(this.requestTraces.keys().next().value);
    }
  }

  async #selectSelective(groups, context, timeoutMs = this.timeoutMs) {
    const startedAt = Date.now();
    const budgetMs = Math.max(1, Math.min(
      this.adjudicationTotalBudgetMs,
      timeoutMs,
      this.timeoutMs,
    ));
    const deadlineAt = startedAt + budgetMs;
    const plan = buildAmbiguityPlan(groups, {
      margin: this.adjudicationMargin,
      maxCalls: this.adjudicationMaxCalls,
    });
    const selectedSlots = plan.slots.filter((slot) =>
      slot.selected_for_adjudication);
    this.metrics.callCount += 1;
    this.metrics.selectionBatchCount += selectedSlots.length;
    this.metrics.adjudicationRequiredCount += plan.ambiguity_count;
    if (selectedSlots.length === 0) {
      const trace = buildSelectiveTrace({
        plan,
        settled: [],
        batches: [],
        startedAt,
        budgetMs,
        concurrency: this.selectionConcurrency,
      });
      return {
        products: markSelectiveProducts(groups, plan, new Map()),
        trace,
      };
    }

    const batches = [];
    const settled = await mapSettledWithConcurrency(
      selectedSlots,
      this.selectionConcurrency,
      async (slotPlan, batchIndex) => {
        const group = groups[slotPlan.group_index];
        const pair = (Array.isArray(group?.candidates) ? group.candidates : [])
          .slice(0, 2);
        const queuedAt = Date.now();
        const remaining = deadlineAt - queuedAt;
        const baseTrace = {
          batch_index: batchIndex,
          group_index: slotPlan.group_index,
          look_id: slotPlan.look_id,
          slot: slotPlan.slot,
          ambiguity_reasons: slotPlan.reasons,
          score_gap: slotPlan.score_gap,
          candidate_count: pair.length,
          candidate_ids: pair.map((candidate) => candidateId(candidate)),
          queue_wait_ms: queuedAt - startedAt,
          prompt_bytes: null,
          prompt_build_ms: null,
          timeout_ms: null,
        };
        if (remaining <= 0) {
          const error = new Error("AI adjudication total budget exhausted");
          error.code = "AI_ADJUDICATION_TOTAL_BUDGET_EXHAUSTED";
          error.rerankerBatchTrace = {
            ...baseTrace,
            status: "FAILED",
            reason_code: error.code,
            category: "TIMEOUT",
            model_request_ms: 0,
            response_parse_ms: null,
          };
          batches[batchIndex] = error.rerankerBatchTrace;
          throw error;
        }
        const modelStartedAt = Date.now();
        try {
          const promptStartedAt = Date.now();
          const messages = buildAdjudicationMessages(group, pair, context);
          baseTrace.prompt_build_ms = Date.now() - promptStartedAt;
          baseTrace.prompt_bytes = Buffer.byteLength(
            JSON.stringify(messages),
            "utf8",
          );
          baseTrace.timeout_ms = Math.max(1, Math.min(
            this.adjudicationTimeoutMs,
            deadlineAt - Date.now(),
          ));
          this.metrics.modelRequestCount += 1;
          this.metrics.adjudicationAttemptedCount += 1;
          const response = await abortableModelRequest(
            this.client,
            {
              model: this.model,
              response_format: {type: "json_object"},
              enable_thinking: false,
              temperature: 0.2,
              max_tokens: MAX_ADJUDICATION_OUTPUT_TOKENS,
              messages,
            },
            baseTrace.timeout_ms,
            "AI_ADJUDICATION_TIMEOUT",
          );
          const modelRequestMs = Date.now() - modelStartedAt;
          const parseStartedAt = Date.now();
          const payload = validateAdjudicationResponse(
            parseJsonResponse(extractText(response)),
            pair,
          );
          const responseParseMs = Date.now() - parseStartedAt;
          const value = {
            group_index: slotPlan.group_index,
            winner_candidate_id: payload.winner_candidate_id,
            payload,
            trace: {
              ...baseTrace,
              model_request_ms: modelRequestMs,
              response_parse_ms: responseParseMs,
              status: "SUCCESS",
              winner_candidate_id: payload.winner_candidate_id,
              confidence: payload.confidence,
            },
          };
          batches[batchIndex] = value.trace;
          return value;
        } catch (error) {
          const reasonCode = safeErrorCode(error);
          error.rerankerBatchTrace = {
            ...baseTrace,
            model_request_ms: Date.now() - modelStartedAt,
            response_parse_ms: null,
            status: "FAILED",
            reason_code: reasonCode,
            category: classifyRerankerFailure(error).category,
            timeout_owner: error?.timeout_owner || null,
          };
          batches[batchIndex] = error.rerankerBatchTrace;
          throw error;
        }
      },
    );

    const decisions = new Map();
    for (let index = 0; index < settled.length; index += 1) {
      const entry = settled[index];
      if (entry.status === "fulfilled") {
        decisions.set(entry.value.group_index, entry.value);
        continue;
      }
      decisions.set(selectedSlots[index].group_index, {
        group_index: selectedSlots[index].group_index,
        failure_reason: safeErrorCode(entry.reason),
      });
    }
    const failed = settled.filter((entry) => entry.status === "rejected");
    const successCount = settled.filter((entry) =>
      entry.status === "fulfilled").length;
    const timeoutCount = failed.filter((entry) =>
      classifyRerankerFailure(entry.reason).category === "TIMEOUT").length;
    const wallClockAiLatencyMs = Math.max(0, Date.now() - startedAt);
    this.metrics.selectionBatchFallbackCount += failed.length;
    this.metrics.adjudicationSuccessCount += successCount;
    this.metrics.adjudicationTimeoutCount += timeoutCount;
    this.metrics.adjudicationFallbackCount += failed.length;
    this.metrics.adjudicationTotalLatencyMs += wallClockAiLatencyMs;
    const trace = buildSelectiveTrace({
      plan,
      settled,
      batches,
      startedAt,
      budgetMs,
      concurrency: this.selectionConcurrency,
    });
    return {
      products: markSelectiveProducts(groups, plan, decisions),
      trace,
    };
  }

  async #select(groups, context, timeoutMs = this.timeoutMs) {
    const startedAt = Date.now();
    const slotTimeoutMs = Math.max(1, Math.min(
      MAX_SELECTION_BATCH_MS,
      timeoutMs,
      this.timeoutMs,
    ));
    const batches = buildSelectionBatches(groups);
    this.metrics.callCount += 1;
    this.metrics.selectionBatchCount += batches.length;
    try {
      const settled = await mapSettledWithConcurrency(
        batches,
        this.selectionConcurrency,
        async (batch, batchIndex) => {
          const modelStartedAt = Date.now();
          const baseTrace = {
            batch_index: batchIndex,
            look_ids: batch.lookIds,
            global_group_indexes: batch.globalGroupIndexes,
            group_count: batch.groups.length,
            candidate_count: batch.candidateCount,
            queue_wait_ms: Date.now() - startedAt,
            prompt_bytes: null,
            prompt_build_ms: null,
            timeout_ms: null,
          };
          try {
            const promptStartedAt = Date.now();
            const messages = buildSlotMessages(batch, context);
            baseTrace.prompt_build_ms = Date.now() - promptStartedAt;
            baseTrace.prompt_bytes = Buffer.byteLength(
              JSON.stringify(messages),
              "utf8",
            );
            baseTrace.timeout_ms = slotTimeoutMs;
            this.metrics.modelRequestCount += 1;
            const response = await abortableModelRequest(
              this.client,
              {
                model: this.model,
                response_format: {type: "json_object"},
                enable_thinking: false,
                temperature: 0.2,
                messages,
              },
              slotTimeoutMs,
              "AI_RERANK_SELECTION_BATCH_TIMEOUT",
            );
            const modelRequestMs = Date.now() - modelStartedAt;
            const parseStartedAt = Date.now();
            const parsed = parseJsonResponse(extractText(response));
            const remapped = remapBatchSelectionPayload(parsed, batch);
            const responseParseMs = Date.now() - parseStartedAt;
            return {
              payload: remapped,
              trace: {
                ...baseTrace,
                model_request_ms: modelRequestMs,
                response_parse_ms: responseParseMs,
                ...(remapped._batch_validation || {}),
                status: "SUCCESS",
              },
            };
          } catch (error) {
            const reasonCode = safeErrorCode(error);
            error.rerankerBatchTrace = {
              ...baseTrace,
              model_request_ms: Date.now() - modelStartedAt,
              response_parse_ms: null,
              status: "FAILED",
              reason_code: reasonCode,
              category: classifyRerankerFailure(error).category,
              timeout_owner: error?.timeout_owner || null,
            };
            throw error;
          }
        },
      );
      const successful = settled.filter((entry) => entry.status === "fulfilled");
      const failed = settled.filter((entry) => entry.status === "rejected");
      const batchTraces = settled.map((entry, batchIndex) =>
        entry.status === "fulfilled" ? entry.value.trace
          : entry.reason?.rerankerBatchTrace || ({
            batch_index: batchIndex,
            look_ids: batches[batchIndex]?.lookIds || [],
            global_group_indexes: batches[batchIndex]?.globalGroupIndexes || [],
            status: "FAILED",
            reason_code: safeErrorCode(entry.reason),
            category: classifyRerankerFailure(entry.reason).category,
          }));
      const deadlineSkippedBatchCount = batchTraces.filter((entry) =>
        entry.status === "SKIPPED_DEADLINE").length;
      this.metrics.selectionBatchFallbackCount += failed.length;
      if (successful.length === 0) {
        const error = failed[0]?.reason || Object.assign(
          new Error("All AI reranker batches failed"),
          {code: "AI_RERANK_ALL_BATCHES_FAILED"},
        );
        error.rerankerSelectionTrace = {
          batch_count: batches.length,
          successful_batch_count: 0,
          failed_batch_count: failed.length,
          deadline_skipped_batch_count: deadlineSkippedBatchCount,
          batches: batchTraces,
        };
        throw error;
      }
      return {
        selected_products: successful.flatMap((entry) =>
          Array.isArray(entry.value?.payload?.selected_products)
            ? entry.value.payload.selected_products : []),
        _reranker_batch_trace: {
          batch_count: batches.length,
          successful_batch_count: successful.length,
          failed_batch_count: failed.length,
          deadline_skipped_batch_count: deadlineSkippedBatchCount,
          batches: batchTraces,
        },
      };
    } finally {
      const durationMs = Date.now() - startedAt;
      this.metrics.totalDurationMs += durationMs;
      this.metrics.lastDurationMs = durationMs;
    }
  }

  async #assessVisuals(groups, context, requestId, timeoutMs = this.timeoutMs) {
    const inputImageCount = countCandidateImages(groups);
    if (!this.visualEvaluationEnabled) {
      return {
        groups,
        trace: {
          enabled: false,
          input_image_count: inputImageCount,
          evaluated_image_count: 0,
          failed_image_count: 0,
          image_download_ms: null,
          image_transport: "NOT_USED",
          reason: "VISUAL_EVALUATION_DISABLED",
          total_ms: 0,
        },
      };
    }
    const batch = buildVisualBatch(groups);
    if (batch.length === 0) {
      return {
        groups,
        trace: {
          enabled: true,
          input_image_count: inputImageCount,
          evaluated_image_count: 0,
          failed_image_count: 0,
          image_download_ms: null,
          image_transport: "REMOTE_MODEL_URL",
          reason: "NO_VALID_UNIQUE_HTTPS_IMAGE",
          total_ms: 0,
        },
      };
    }
    const startedAt = Date.now();
    const deadlineAt = startedAt + Math.max(1, Math.min(
      timeoutMs,
      this.visualStageMs,
    ));
    this.metrics.visualCallCount += 1;
    try {
      const settled = await mapSettledWithConcurrency(
        batch,
        this.visualConcurrency,
        async (entry) => {
          const imageStartedAt = Date.now();
          try {
            const messages = buildVisualQualityMessages(groups, context, [entry]);
            const remaining = deadlineAt - Date.now();
            if (remaining < this.visualImageTimeoutMs) {
              const error = new Error("AI visual evaluation skipped after deadline");
              error.code = "AI_VISUAL_DEADLINE_SKIPPED";
              throw error;
            }
            const requestTimeoutMs = this.visualImageTimeoutMs;
            this.metrics.modelRequestCount += 1;
            const response = await abortableModelRequest(
              this.client,
              {
                model: this.model,
                response_format: {type: "json_object"},
                enable_thinking: false,
                temperature: 0,
                messages,
              },
              requestTimeoutMs,
              "AI_VISUAL_IMAGE_TIMEOUT",
            );
            const payload = validateSingleVisualPayload(
              parseJsonResponse(extractText(response)),
              entry,
            );
            return {
              payload,
              trace: visualEntryTrace(entry, {
                status: "SUCCESS",
                durationMs: Date.now() - imageStartedAt,
              }),
            };
          } catch (error) {
            const reasonCode = safeErrorCode(error);
            error.visualEntryTrace = visualEntryTrace(entry, {
              status: reasonCode === "AI_VISUAL_DEADLINE_SKIPPED"
                ? "SKIPPED_DEADLINE" : "FAILED",
              durationMs: Date.now() - imageStartedAt,
              reasonCode,
              timeoutOwner: error?.timeout_owner || null,
            });
            throw error;
          }
        },
      );
      const successful = settled.filter((entry) => entry.status === "fulfilled");
      const rejected = settled.filter((entry) => entry.status === "rejected");
      const deadlineSkipped = rejected.filter((entry) =>
        safeErrorCode(entry.reason) === "AI_VISUAL_DEADLINE_SKIPPED");
      const failed = rejected.filter((entry) =>
        safeErrorCode(entry.reason) !== "AI_VISUAL_DEADLINE_SKIPPED");
      const badImageFailures = failed.filter((entry) =>
        isVisualProductEvidenceFailure(entry.reason));
      const infrastructureFailures = failed.filter((entry) =>
        !isVisualProductEvidenceFailure(entry.reason));
      if (rejected.length > 0) this.metrics.visualFallbackCount += 1;
      const imageAssessments = successful.flatMap((entry) =>
        Array.isArray(entry.value?.payload?.image_assessments)
          ? entry.value.payload.image_assessments
          : Array.isArray(entry.value?.payload?.products)
            ? entry.value.payload.products : []);
      const visuallyAssessed = imageAssessments.length > 0
        ? applyVisualAssessments(groups, {image_assessments: imageAssessments})
        : groups;
      const failedEntries = settled.map((entry, index) =>
        entry.status === "rejected" &&
        isVisualProductEvidenceFailure(entry.reason)
          ? {entry: batch[index], reason: entry.reason} : null).filter(Boolean);
      const infrastructureEntries = settled.map((entry, index) =>
        entry.status === "rejected" &&
        safeErrorCode(entry.reason) !== "AI_VISUAL_DEADLINE_SKIPPED" &&
        !isVisualProductEvidenceFailure(entry.reason)
          ? {entry: batch[index], reason: entry.reason} : null).filter(Boolean);
      const skippedEntries = settled.map((entry, index) =>
        entry.status === "rejected" &&
        safeErrorCode(entry.reason) === "AI_VISUAL_DEADLINE_SKIPPED"
          ? batch[index] : null).filter(Boolean);
      const degraded = applyVisualFailurePenalties(visuallyAssessed, failedEntries);
      const unassessed = applyVisualInfrastructureStatuses(
        degraded,
        infrastructureEntries,
      );
      const assessed = applyVisualDeadlineStatuses(unassessed, skippedEntries);
      const assessedCandidateCount = imageAssessments.length;
      const coveredCandidateCount = batch.reduce((total, entry) =>
        total + visualEntryTargets(entry).length, 0);
      const durationMs = Date.now() - startedAt;
      this.logger.info?.("商品图片视觉质量评估完成", {
        requestId: requestId || undefined,
        evaluatedCount: successful.length,
        failedCount: failed.length,
        deadlineSkippedCount: deadlineSkipped.length,
        retainedCount: assessed.reduce(
          (total, group) => total + group.candidates.length,
          0,
        ),
        visualDurationMs: durationMs,
      });
      return {
        groups: assessed,
        trace: {
          enabled: true,
          input_image_count: inputImageCount,
          unique_valid_image_count: batch.length,
          evaluated_image_count: successful.length,
          failed_image_count: failed.length,
          bad_image_failure_count: badImageFailures.length,
          infrastructure_failure_count: infrastructureFailures.length,
          deadline_skipped_image_count: deadlineSkipped.length,
          assessed_candidate_count: assessedCandidateCount,
          shared_image_candidate_count: Math.max(
            0,
            coveredCandidateCount - batch.length,
          ),
          skipped_image_count: Math.max(0, inputImageCount - coveredCandidateCount),
          failure_reasons: [...new Set(rejected.map((entry) =>
            safeErrorCode(entry.reason)))],
          images: Object.freeze(settled.map((entry, index) =>
            entry.status === "fulfilled"
              ? entry.value.trace
              : entry.reason?.visualEntryTrace).filter(Boolean)),
          image_download_ms: null,
          image_transport: "REMOTE_MODEL_URL",
          image_download_observability: "MODEL_PROVIDER_NOT_SEPARATELY_OBSERVABLE",
          concurrency: this.visualConcurrency,
          total_ms: durationMs,
        },
      };
    } finally {
      const durationMs = Date.now() - startedAt;
      this.metrics.visualTotalDurationMs += durationMs;
      this.metrics.visualLastDurationMs = durationMs;
    }
  }

  #readCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return {
      products: cloneProducts(entry.products),
      selectionTrace: cloneTrace(entry.selectionTrace),
    };
  }

  #writeCache(key, products, selectionTrace = null) {
    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      products: cloneProducts(products),
      selectionTrace: cloneTrace(selectionTrace),
    });
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.selectionHistory.delete(oldestKey);
    }
  }

  #diversify(key, products, groups, selectionLimit, context) {
    const recent = this.selectionHistory.get(key) || [];
    const result = applyDiversityScores(products, groups, {
      selectionLimit,
      recentSelections: recent.flat(),
      context,
    });
    this.selectionHistory.set(key, [
      result.primarySelections,
      ...recent,
    ].slice(0, 2));
    const styleProfile = contextStyleProfile(context);
    const averageStyleScore = result.products.length > 0
      ? result.products.reduce((sum, product) =>
        sum + boundedScore(product.style_match_score), 0) / result.products.length
      : 0;
    this.logger.info?.("user_intent_priority", intentDebugSummary({
      styleProfile,
      finalStyleScore: averageStyleScore,
    }));
    return result.products;
  }

  #logResult(details) {
    const message = details.fallback ? "AI 商品复选规则回退" : "AI 商品复选完成";
    const safeDetails = {
      requestId: details.requestId || undefined,
      candidateCount: details.candidateCount,
      productPrefilterCount: details.prefilterCount ?? details.candidateCount,
      aiProductCandidateCount: details.candidateCount,
      selectedCount: details.selectedCount,
      aiDurationMs: details.durationMs,
      cached: details.cached,
      ruleFallback: details.fallback,
      brand_fallback: details.brandFallback === true,
      errorCode: details.errorCode || undefined,
      errorCategory: details.errorCategory || undefined,
    };
    if (details.fallback) this.logger.warn?.(message, safeDetails);
    else this.logger.info?.(message, safeDetails);
  }
}

function buildDeterministicGroups(groups, selectionLimit, context = {}) {
  const safeLimit = Math.min(
    positiveInteger(selectionLimit, DEFAULT_SELECTION_LIMIT),
    MAX_SELECTION_LIMIT,
  );
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const eligibleGroup = {
      ...group,
      candidates: (Array.isArray(group?.candidates) ? group.candidates : [])
        .filter((candidate) => String(
          candidate?.product_acceptance_result || "PASS",
        ).trim().toUpperCase() !== "HARD_REJECT"),
    };
    const products = ruleFallback([eligibleGroup], safeLimit, context)
      .map((product) => ({
        ...product,
        deterministic_reranker_score: roundScore(Number(
          product.deterministic_reranker_score ?? product.final_score ??
          product.ai_match_score ?? 0,
        )),
        ai_rerank_fallback: false,
        ai_rerank_fallback_reason: null,
        ai_adjudication_status: "NOT_REQUIRED",
      }))
      .sort((left, right) =>
        Number(right.deterministic_reranker_score || 0) -
          Number(left.deterministic_reranker_score || 0) ||
        candidateId(left).localeCompare(candidateId(right)));
    return {
      ...group,
      candidates: products,
      selectionLimit: safeLimit,
    };
  });
}

function buildAdjudicationMessages(group = {}, pair = [], context = {}) {
  const requirement = group?.requirement || {};
  const candidates = (Array.isArray(pair) ? pair : [])
    .slice(0, 2)
    .map((candidate) => ({
      candidate_id: candidateId(candidate),
      deterministic_score: Number(
        candidate.deterministic_reranker_score ?? candidate.final_score ?? 0,
      ),
      ...compactSlotCandidate(candidate),
    }));
  const payload = {
    intent: compactSlotIntent(context, requirement),
    slot: slotForRequirement(requirement),
    concept: compactObject({
      concept_id: requirement.concept_id || requirement.conceptId,
      look_id: requirement.look_id || requirement.lookId,
      summary: requirement.concept_summary || requirement.styling_goal ||
        requirement.style_direction || requirement.style,
      scene: requirement.scene || context.scene,
    }),
    candidates,
  };
  return [
    {
      role: "system",
      content: [
        "你是 FitAI 商品歧义裁决器。只能比较输入中的两个同槽候选，不得编造、修改或复活其他商品。",
        "判断 audience fit、contemporary fit、occasion fit、desired impression fit 与 visual/style quality；严重错配不能被品牌、价格或销量补救。",
        "Acceptance evidence 是商品事实证据；用户意图只能作为适配目标，不能冒充商品事实。",
        "只返回严格 JSON，且只能包含：winner_candidate_id、confidence、audience_fit、contemporary_fit、occasion_fit、desired_impression_fit、short_reason。",
        "四个 fit 字段只能是 match、mixed、mismatch 或 unknown；confidence 为 0 到 1；short_reason 不超过80个字符。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
}

function validateAdjudicationResponse(payload, pair = []) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw adjudicationValidationError("AI adjudication response is not an object");
  }
  const allowedKeys = new Set([
    "winner_candidate_id",
    "confidence",
    "audience_fit",
    "contemporary_fit",
    "occasion_fit",
    "desired_impression_fit",
    "short_reason",
  ]);
  const keys = Object.keys(payload);
  if (keys.some((key) => !allowedKeys.has(key)) ||
      [...allowedKeys].some((key) => !keys.includes(key))) {
    throw adjudicationValidationError("AI adjudication response keys are invalid");
  }
  const ids = new Set((Array.isArray(pair) ? pair : [])
    .slice(0, 2).map(candidateId).filter(Boolean));
  const winner = String(payload.winner_candidate_id || "").trim();
  if (!winner || !ids.has(winner)) {
    throw adjudicationValidationError("AI adjudication winner is not a candidate");
  }
  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw adjudicationValidationError("AI adjudication confidence is invalid");
  }
  const fitValues = new Set(["match", "mixed", "mismatch", "unknown"]);
  for (const key of [
    "audience_fit",
    "contemporary_fit",
    "occasion_fit",
    "desired_impression_fit",
  ]) {
    if (!fitValues.has(String(payload[key] || "").trim().toLowerCase())) {
      throw adjudicationValidationError(`AI adjudication ${key} is invalid`);
    }
  }
  const shortReason = String(payload.short_reason || "").trim();
  if (!shortReason || [...shortReason].length > 80) {
    throw adjudicationValidationError("AI adjudication short_reason is invalid");
  }
  return Object.freeze({
    winner_candidate_id: winner,
    confidence,
    audience_fit: String(payload.audience_fit).trim().toLowerCase(),
    contemporary_fit: String(payload.contemporary_fit).trim().toLowerCase(),
    occasion_fit: String(payload.occasion_fit).trim().toLowerCase(),
    desired_impression_fit:
      String(payload.desired_impression_fit).trim().toLowerCase(),
    short_reason: shortReason,
  });
}

function adjudicationValidationError(message) {
  const error = new Error(message);
  error.code = "AI_ADJUDICATION_INVALID_RESPONSE";
  return error;
}

function markSelectiveProducts(
  groups,
  plan,
  decisions = new Map(),
  globalFailureReason = null,
) {
  const slotPlans = new Map((plan?.slots || []).map((slot) => [
    slot.group_index,
    slot,
  ]));
  return (Array.isArray(groups) ? groups : []).flatMap((group, groupIndex) => {
    const slotPlan = slotPlans.get(groupIndex) || {};
    const decision = decisions.get(groupIndex) || null;
    const candidates = Array.isArray(group?.candidates) ? group.candidates : [];
    let retained = candidates;
    let status = slotPlan.status || "DETERMINISTIC_MARGIN_CLEAR";
    let fallbackReason = null;

    if (decision?.winner_candidate_id) {
      const pairedIds = new Set(candidates.slice(0, 2).map(candidateId));
      retained = candidates.filter((candidate) =>
        !pairedIds.has(candidateId(candidate)) ||
        candidateId(candidate) === decision.winner_candidate_id);
      retained.sort((left, right) => {
        const leftWinner = candidateId(left) === decision.winner_candidate_id;
        const rightWinner = candidateId(right) === decision.winner_candidate_id;
        return Number(rightWinner) - Number(leftWinner) ||
          Number(right.deterministic_reranker_score || 0) -
            Number(left.deterministic_reranker_score || 0);
      });
      status = "AI_ADJUDICATION_SUCCESS";
    } else if (slotPlan.selected_for_adjudication) {
      fallbackReason = globalFailureReason || decision?.failure_reason ||
        slotPlan.fallback_reason ||
        "AI_ADJUDICATION_FAILED";
      status = "AI_ADJUDICATION_FALLBACK";
    }

    return retained.map((candidate, candidateIndex) => ({
      ...candidate,
      ai_adjudication_status: status,
      ai_adjudication_required: slotPlan.ai_adjudication_required === true,
      ai_adjudication_selected: decision?.winner_candidate_id
        ? candidateId(candidate) === decision.winner_candidate_id
        : candidateIndex === 0,
      ai_adjudication_confidence: decision?.payload?.confidence ?? null,
      ai_adjudication_reason: decision?.payload?.short_reason || null,
      ai_adjudication_evidence: decision?.payload || null,
      ai_rerank_fallback: Boolean(fallbackReason),
      ai_rerank_fallback_reason: fallbackReason,
    }));
  });
}

function buildSelectiveTrace({
  plan,
  settled = [],
  batches = [],
  startedAt = Date.now(),
  budgetMs = DEFAULT_ADJUDICATION_TOTAL_BUDGET_MS,
  concurrency = DEFAULT_SELECTION_CONCURRENCY,
} = {}) {
  const safeBatches = (Array.isArray(batches) ? batches : []).filter(Boolean);
  const batchByGroup = new Map(safeBatches.map((batch) => [
    batch.group_index,
    batch,
  ]));
  const attemptedCount = safeBatches.filter((batch) =>
    batch.timeout_ms != null &&
    batch.reason_code !== "AI_ADJUDICATION_TOTAL_BUDGET_EXHAUSTED").length;
  const successCount = safeBatches.filter((batch) =>
    batch.status === "SUCCESS").length;
  const failedBatches = safeBatches.filter((batch) =>
    batch.status !== "SUCCESS");
  const timeoutCount = failedBatches.filter((batch) =>
    classifyRerankerFailure({
      code: batch.reason_code,
      message: batch.reason_code,
    }).category === "TIMEOUT").length;
  const summedModelLatencyMs = safeBatches.reduce((total, batch) =>
    total + Math.max(0, Number(batch.model_request_ms) || 0), 0);
  const wallClockMs = Math.max(0, Date.now() - startedAt);
  const slots = (plan?.slots || []).map((slot) => {
    const batch = batchByGroup.get(slot.group_index);
    if (!slot.selected_for_adjudication) return Object.freeze({...slot});
    if (batch?.status === "SUCCESS") {
      return Object.freeze({
        ...slot,
        status: "AI_ADJUDICATION_SUCCESS",
        winner_candidate_id: batch.winner_candidate_id,
        confidence: batch.confidence,
        fallback_reason: null,
      });
    }
    return Object.freeze({
      ...slot,
      status: "AI_ADJUDICATION_FALLBACK",
      fallback_reason: batch?.reason_code || "AI_ADJUDICATION_FAILED",
    });
  });
  return Object.freeze({
    mode: "SELECTIVE_AI_ADJUDICATION",
    total_slot_count: plan?.total_slot_count || 0,
    deterministic_slot_count:
      Math.max(0, (plan?.total_slot_count || 0) - (plan?.selected_count || 0)),
    unambiguous_slot_count: (plan?.slots || []).filter((slot) =>
      !slot.ai_adjudication_required).length,
    adjudication_required_count: plan?.ambiguity_count || 0,
    adjudication_selected_count: plan?.selected_count || 0,
    adjudication_attempted_count: attemptedCount,
    success_count: successCount,
    timeout_count: timeoutCount,
    fallback_count: failedBatches.length,
    batch_count: safeBatches.length,
    successful_batch_count: successCount,
    failed_batch_count: failedBatches.length,
    concurrency: Math.min(
      positiveInteger(concurrency, DEFAULT_SELECTION_CONCURRENCY),
      DEFAULT_SELECTION_CONCURRENCY,
    ),
    margin: plan?.margin || DEFAULT_ADJUDICATION_MARGIN,
    max_calls: plan?.max_calls || MAX_ADJUDICATION_CALLS,
    total_budget_ms: budgetMs,
    total_ai_latency_ms: wallClockMs,
    summed_model_latency_ms: summedModelLatencyMs,
    wall_clock_ms: wallClockMs,
    slots: Object.freeze(slots),
    batches: Object.freeze(safeBatches.map((batch) => Object.freeze({...batch}))),
    settled_count: Array.isArray(settled) ? settled.length : 0,
  });
}

function selectiveTraceWithoutCalls(
  plan,
  reason,
  concurrency = DEFAULT_SELECTION_CONCURRENCY,
) {
  const batches = (plan?.slots || [])
    .filter((slot) => slot.selected_for_adjudication)
    .map((slot, batchIndex) => ({
      batch_index: batchIndex,
      group_index: slot.group_index,
      look_id: slot.look_id,
      slot: slot.slot,
      candidate_count: 2,
      status: "FAILED",
      reason_code: reason,
      category: "ENVIRONMENT_CONFIGURATION",
      timeout_ms: null,
      model_request_ms: 0,
    }));
  return buildSelectiveTrace({
    plan,
    settled: [],
    batches,
    startedAt: Date.now(),
    budgetMs: 0,
    concurrency,
  });
}

function buildCachedSelectiveTrace(sourceTrace, products = []) {
  const source = sourceTrace && typeof sourceTrace === "object"
    ? sourceTrace : {};
  const reusedWinnerIds = (Array.isArray(products) ? products : [])
    .filter((product) => product.ai_adjudication_selected === true &&
      product.ai_adjudication_status === "AI_ADJUDICATION_SUCCESS")
    .map(candidateId)
    .filter(Boolean);
  return Object.freeze({
    mode: "CACHED_SELECTIVE_AI_ADJUDICATION",
    source_mode: source.mode || "SELECTIVE_AI_ADJUDICATION",
    cached_reuse: true,
    model_calls_this_request: 0,
    total_slot_count: Number(source.total_slot_count || 0),
    deterministic_slot_count: Number(source.deterministic_slot_count || 0),
    unambiguous_slot_count: Number(source.unambiguous_slot_count || 0),
    adjudication_required_count:
      Number(source.adjudication_required_count || 0),
    adjudication_selected_count:
      Number(source.adjudication_selected_count || 0),
    adjudication_attempted_count: 0,
    success_count: 0,
    timeout_count: 0,
    fallback_count: 0,
    reused_success_count: Number(source.success_count || 0),
    reused_fallback_count: Number(source.fallback_count || 0),
    reused_winner_candidate_ids: Object.freeze(reusedWinnerIds),
    margin: source.margin || DEFAULT_ADJUDICATION_MARGIN,
    max_calls: source.max_calls || MAX_ADJUDICATION_CALLS,
    total_budget_ms: source.total_budget_ms || 0,
    total_ai_latency_ms: 0,
    summed_model_latency_ms: 0,
    wall_clock_ms: 0,
    slots: Object.freeze((Array.isArray(source.slots) ? source.slots : [])
      .map((slot) => Object.freeze({...slot, cached_reuse: true}))),
    batches: Object.freeze([]),
  });
}

function candidateId(candidate = {}) {
  return String(
    candidate?.candidate_id || candidate?.product_id || candidate?.id || "",
  ).trim();
}

function buildMessages(groups, context) {
  const styleProfile = contextStyleProfile(context);
  const outfitBlueprint = contextOutfitBlueprint(context);
  const aestheticTarget = contextAestheticTarget(
    context,
    (Array.isArray(groups) ? groups : []).map((group) => group?.requirement),
  );
  const payload = {
    intent_priority_score: resolveIntentPriorityScore(styleProfile),
    calibrated_product_weights: CALIBRATED_PRODUCT_WEIGHTS,
    aesthetic_target_profile: aestheticTarget,
    outfit_blueprint: outfitBlueprint,
    user_profile: compactProfile(context.user_profile || context.userProfile || {
      gender: context.gender,
      body_profile: context.bodyType,
    }),
    user_requirements: pickFields(context.user_requirements || context.userRequirements || {
      scene: context.scene,
      style: context.style,
      style_semantics: context.style_semantics || context.styleSemantics,
      style_profile: context.style_profile || context.styleProfile,
      season: context.season,
      budget: context.budget,
      item_budget: context.item_budget ?? context.itemBudget,
      outfit_budget: context.outfit_budget ?? context.outfitBudget,
    }, [
      "scene", "style", "season", "weather", "budget",
      "style_semantics", "styleSemantics",
      "style_profile", "styleProfile",
      "item_budget", "itemBudget", "outfit_budget", "outfitBudget",
      "color_preferences", "colorPreferences",
    ]),
    outfit_plan: compactOutfitPlanForPrompt(
      context.outfit_plan || context.outfitPlan || {},
      groups,
    ),
    product_groups: groups.map((group, index) => ({
      requirement_index: index,
      category_priority: categoryPriority(group.requirement.category),
      required_minimum: Math.min(4, group.candidates.length),
      maximum: Math.min(6, group.candidates.length),
      requirement: compactRequirementForPrompt(group.requirement),
      candidates: group.candidates.map((product) => compactObject({
        product_id: product.product_id,
        look_id: product.look_id,
        title: product.title,
        price: product.price,
        image_url: product.image_url,
        brand: product.brand,
        shop_name: product.shop_name,
        material: product.material,
        category: product.category,
        subcategory: product.subcategory,
        original_gender: product.original_gender || product.gender,
        style: product.style,
        style_tags: product.style_tags,
        occasion_tags: product.occasion_tags || product.occasions,
        color: product.color,
        quality_tier: product.quality_tier,
        sales: product.sales,
        relevance_score: product.relevance_score,
        catalog_aesthetic_score: product.catalog_aesthetic_score,
        aesthetic_score: product.aesthetic_score,
        image_quality_hint: product.image_quality_hint,
        visual_quality_score: product.visual_quality_score,
        fashion_taste_score: product.fashion_taste_score,
        commercial_ad_penalty: product.commercial_ad_penalty,
        subject_coverage_score: product.subject_coverage_score,
        commerce_visual_score: product.commerce_visual_score,
        brand_quality_score: product.brand_quality_score,
        brand_tier: product.brand_tier,
        brand_fallback: product.brand_fallback,
        blueprint_match_score: product.blueprint_match_score,
        matched_elements: product.matched_elements,
        conflict_elements: product.conflict_elements,
        style_match_score: product.style_match_score,
        style_fit_score: product.style_fit_score,
        occasion_fit_score: product.occasion_fit_score,
        color_fit_score: product.color_fit_score,
        silhouette_fit_score: product.silhouette_fit_score,
        footwear_fit_score: product.footwear_fit_score,
        quality_fit_score: product.quality_fit_score,
        gender_fit_score: product.gender_fit_score,
        budget_preference_score: product.budget_preference_score,
        budget_note: product.budget_note,
        aesthetic_quality_flags: product.aesthetic_quality_flags,
      })),
    })),
  };
  return [
    {
      role: "system",
      content: [
        "Each selected_products entry must include the source requirement_index and product_id.",
        "All user-facing natural-language values MUST be written in Simplified Chinese (zh-CN). English is allowed only for internal enum values and identifiers.",
        "Never select underwear, bras, sleepwear, homewear, adult products, shapewear, or swimwear unless explicit_user_search is true. Socks or hosiery are allowed only when a concrete outfit_blueprint or an explicit Styling Completion requirement requests them.",
        "Prioritize top, bottom, shoes, outerwear, dress, and bag over accessory, underwear, and homewear.",
        "For female date, sweet, elegant, premium, or romantic dress requirements, rank visible tailoring, a defined waistline, considered skirt shape, and refined feminine design details above generic solid-color basic dresses. Do not apply this preference to explicitly neutral or unisex intent.",
        "For hats, bags, and accessories, exclude maternity, household, protective, storage, medical, workwear, and other non-fashion utility products even when their marketplace category superficially matches.",
        "Brand is only a weak secondary tie-breaker after aesthetic target fit. A known brand must never outrank a severe style or occasion mismatch.",
        "Never select titles containing manufacturer/wholesale/clearance/viral bargain/street stall/student budget/copy/replica/high replica marketing terms. Only use brand_fallback products when stronger branded candidates are insufficient.",
        "Treat item_budget and outfit_budget as soft preferences for brand choice, price ranking, value assessment, and recommendation reasons; never use them as hard filters.",
        "A slightly over-budget product may be selected when its quality or outfit fit justifies it, but the reason must clearly explain that tradeoff.",
        "Use styling_strategy plus every Look's styling_goal and proportion_strategy as the source of truth for body-proportion fit.",
        "Use aesthetic_target_profile as the primary source of truth for style, occasion, color, silhouette, footwear, quality, and gender fit. Legacy style_semantics/style_profile are fallback context only.",
        "Treat outfit_blueprint as the highest-priority source of truth for what the outfit contains. Marketplace inventory only supplies the concrete items already decided by the blueprint.",
        "Never select an avoid_items conflict. Blueprint remains a hard contract, but among valid candidates aesthetic_target_profile fit determines ranking; image quality, sales, brand, or variety cannot override poor target fit.",
        "Use calibrated_product_weights for ranking. Diversity and brand are tie-breakers only, never core aesthetic signals.",
        "Weather is a weak functional constraint only. It may affect waterproofing, breathability, sole, or material, but must never replace the requested style.",
        "Every selected product must include style_match_score and weather_match_score from 0 to 100. If intent_priority_score is above 80, never select a product with style_match_score below 50.",
        "A strong conflict with must_express, must_avoid, silhouette, preferred materials, or continuous style dimensions is disqualifying; brand or image quality cannot override it.",
        "Do not equate brand with taste. Brand/shop trust is only supporting evidence; image quality, silhouette, material, Look coherence, and body strategy matter more.",
        "Never select a candidate with commercial_ad_penalty >= 60.",
        "Each selected product must also include body_strategy_match_score from 0 to 100.",
        "你是 FitAI 商品审美复选器。只能从候选商品中选择，不得编造或修改 product_id。",
        "综合整套穿搭、用户身材比例、性别、场景、季节、预算、颜色、版型、材质和设计语言判断。",
        "审美分重点判断品牌/店铺可信度、图片呈现、设计感、材质描述和风格匹配；显著降低低价爆款、关键词堆叠标题、廉价感图片和信息不完整商品。",
        "淘汰廉价感明显、设计杂乱、印花夸张、版型冲突或与整套不协调的商品。男性和女性规则必须由输入决定。",
        "必须分别处理每个 requirement_index，而不是整套合计选择 4 至 6 件。",
        "每组 candidates 数量不少于 4 时，该组必须选择 4 至 6 件；少于 4 时选择全部合格商品，不得跨组凑数。",
        "product_groups 中的 required_minimum 和 maximum 是该组的明确数量约束，selected_products 必须逐组满足。",
        "同组商品应兼顾审美首选、百搭、性价比、设计感和身材适配。",
        "三套 Look 之间必须主动保持多样性：同品类避免相同商品、同品牌、标题高度相似或相同图片，并呼应各自不同的 style_direction。",
        "只返回严格 JSON：{\"selected_products\":[{\"requirement_index\":0,\"product_id\":\"候选ID\",\"aesthetic_score\":0,\"fit_score\":0,\"outfit_coherence_score\":0,\"value_score\":0,\"reason\":\"\",\"concern\":\"\"}]}。",
        "所有分数必须在 0 到 100 之间，输出顺序就是最终推荐顺序。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
}

function evidenceValue(value, fallback = null) {
  if (value && typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "value")) {
    return value.value;
  }
  return value ?? fallback;
}

function slotForRequirement(requirement = {}) {
  const slot = String(
    requirement.slot || requirement.slot_key || requirement.slotKey ||
    requirement.category || requirement.subcategory || "other",
  ).trim().toLowerCase();
  return slot === "skirt" ? "bottom" : slot || "other";
}

function compactSlotIntent(context = {}, requirement = {}) {
  const decisionContext = context.decision_context ||
    context.recommendation_context?.decision_context || {};
  const brain = decisionContext?.intent?.user_intent_brain || {};
  const truth = decisionContext?.user_truth || {};
  return compactObject({
    primary_goal: evidenceValue(brain.primary_goal),
    scene: evidenceValue(brain.scene_intent, truth.scene || context.scene),
    desired_impression: evidenceValue(brain.desired_impression, []),
    explicit_avoid: evidenceValue(
      brain.explicit_avoid,
      truth.explicit_avoid || context.user_requirements?.explicit_avoid || [],
    ),
    concept: pickFields(requirement, [
      "look_id", "concept_id", "style", "style_direction", "styling_goal",
      "scene", "formality", "silhouette", "fit", "footwear",
      "must_have", "must_avoid", "prefer", "avoid_items",
    ]),
  });
}

function compactSlotCandidate(product = {}) {
  return compactObject({
    product_id: product.product_id,
    title: product.title,
    category: product.category,
    subcategory: product.subcategory,
    price: product.price,
    original_gender: product.original_gender || product.gender,
    style: product.style,
    style_tags: product.style_tags,
    occasion_tags: product.occasion_tags || product.occasions,
    color: product.color,
    silhouette: product.silhouette,
    fit: product.fit,
    footwear: product.footwear,
    material: product.material,
    enrichment_evidence: compactEvidenceMap(
      product.candidate_enrichment,
      ["category", "subcategory", "gender", "style", "occasion", "color",
        "silhouette", "fit", "footwear", "material", "body_fit",
        "visual_quality", "quality"],
    ),
    acceptance_result: product.product_acceptance_result,
    acceptance_penalty: product.product_acceptance_penalty,
    acceptance_evidence: compactEvidenceMap(
      product.product_acceptance_evidence,
      ["audience_fit", "contemporary_fit", "occasion_fit",
        "desired_impression_fit", "visual_quality", "commerce_quality",
        "product_identity_confidence"],
    ),
    visual_evidence: pickFields(product, [
      "visible_category", "audience_expression", "style_expression",
      "visual_age_expression", "design_detail_level", "visual_quality_score",
      "fashion_taste_score", "subject_coverage_score", "commerce_visual_score",
      "image_url",
    ]),
  });
}

function compactEvidenceMap(source, keys) {
  const value = source && typeof source === "object" ? source : {};
  return compactObject(Object.fromEntries(keys.map((key) => [
    key,
    compactEvidenceRecord(value[key]),
  ])));
}

function compactEvidenceRecord(record) {
  if (record == null) return null;
  if (typeof record !== "object") return truncatePromptValue(record);
  return compactObject({
    value: truncatePromptValue(record.value),
    source: truncatePromptValue(record.source),
    confidence: Number.isFinite(Number(record.confidence))
      ? Number(record.confidence) : undefined,
    evidence: truncatePromptValue(record.evidence),
  });
}

function truncatePromptValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => truncatePromptValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 5).map(
      ([key, item]) => [key, truncatePromptValue(item)],
    ));
  }
  if (typeof value === "string") return value.slice(0, 180);
  return value;
}

function compactSlotRequirement(requirement = {}) {
  return pickFields(requirement, [
    "look_id", "concept_id", "slot_key", "category", "subcategory",
    "item_name", "gender", "scene", "style", "style_direction",
    "silhouette", "fit", "footwear", "must_have", "must_avoid", "prefer",
    "avoid_items", "avoid_attributes", "item_budget", "outfit_budget",
  ]);
}

function buildSlotMessages(batch, context) {
  const group = batch?.groups?.[0] || {};
  const requirement = group.requirement || {};
  const candidates = (Array.isArray(group.candidates) ? group.candidates : [])
    .slice(0, MAX_SLOT_CANDIDATES)
    .map(compactSlotCandidate);
  const minimum = Math.min(MIN_SLOT_SELECTION, candidates.length);
  const maximum = Math.min(MAX_SLOT_SELECTION, candidates.length);
  const payload = {
    slot: slotForRequirement(requirement),
    intent: compactSlotIntent(context, requirement),
    selection: {minimum, maximum},
    product_groups: [{
      requirement_index: 0,
      required_minimum: minimum,
      maximum,
      requirement: compactSlotRequirement(requirement),
      candidates,
    }],
  };
  return [
    {
      role: "system",
      content: [
        "你是 FitAI 单槽商品审美复选器，只能从同一 Slot 的候选中选择，不得编造或修改 product_id。",
        "必须优先判断 audience fit、contemporary fit、desired impression fit、occasion fit 与 visual/style quality。",
        "严重人群、时代感、场景或目标印象错配不能被品牌、价格或销量补救。",
        "Acceptance evidence 是商品事实证据；不得把用户要求当成商品事实。",
        "按 selection.minimum 至 selection.maximum 返回合格商品；若合格商品不足，可以少选，不得用明显错配商品凑数。",
        "每项必须包含 product_id、aesthetic_score、fit_score、outfit_coherence_score、value_score、reason、concern。",
        "只返回严格 JSON：{\"selected_products\":[{\"product_id\":\"候选ID\",\"aesthetic_score\":0,\"fit_score\":0,\"outfit_coherence_score\":0,\"value_score\":0,\"reason\":\"\",\"concern\":\"\"}]}。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
}

function compactRequirementForPrompt(requirement = {}) {
  return pickFields(requirement, [
    "look_id", "lookId", "concept_id", "conceptId", "slot_key", "slotKey",
    "category", "subcategory", "search_subcategory", "item_name", "gender",
    "scene", "occasion", "style", "style_direction", "silhouette",
    "fit", "color", "material", "footwear", "quality_tier",
    "must_have", "must_avoid", "prefer", "avoid_items",
    "required_attributes", "preferred_attributes", "avoid_attributes",
    "negative_keywords", "source_elements", "style_role",
    "item_budget", "outfit_budget", "budget_allocation",
    "body_fit_preferences", "body_fit_soft_signals", "market_soft_signals",
    "market_influence_cap", "aesthetic_target_profile", "decision_authority",
  ]);
}

function compactOutfitPlanForPrompt(plan = {}, groups = []) {
  const lookIds = new Set((Array.isArray(groups) ? groups : [])
    .map((group) => String(
      group?.requirement?.look_id || group?.requirement?.lookId || "",
    ).trim())
    .filter(Boolean));
  const looks = (Array.isArray(plan?.looks) ? plan.looks : [])
    .filter((look) => lookIds.size === 0 || lookIds.has(String(
      look?.look_id || look?.lookId || "",
    ).trim()))
    .map((look) => ({
      ...pickFields(look, [
        "look_id", "lookId", "concept_id", "conceptId", "style",
        "style_direction", "styling_goal", "proportion_strategy",
        "scene", "formality", "color_direction", "quality_direction",
      ]),
      items: (Array.isArray(look?.items) ? look.items : []).map((item) =>
        compactRequirementForPrompt(item)),
    }));
  return {
    ...pickFields(plan, ["source", "summary"]),
    looks,
  };
}

function buildSelectionBatches(groups = []) {
  return (Array.isArray(groups) ? groups : []).map((group, globalIndex) => {
    const lookId = String(
      group?.requirement?.look_id || group?.requirement?.lookId || "default",
    ).trim() || "default";
    return {
      lookIds: [lookId],
      slot: slotForRequirement(group?.requirement || {}),
      groups: [{
        ...group,
        candidates: (Array.isArray(group?.candidates) ? group.candidates : [])
          .slice(0, MAX_SLOT_CANDIDATES),
      }],
      globalGroupIndexes: [globalIndex],
      candidateCount: Math.min(
        MAX_SLOT_CANDIDATES,
        Array.isArray(group?.candidates) ? group.candidates.length : 0,
      ),
    };
  });
}

function remapBatchSelectionPayload(payload, batch) {
  if (!Array.isArray(payload?.selected_products) ||
      payload.selected_products.length === 0) {
    const error = new Error("AI reranker batch response has no selections");
    error.code = "AI_RERANK_BATCH_INVALID_RESPONSE";
    throw error;
  }
  const accepted = [];
  for (const item of payload.selected_products) {
      const productId = String(item?.product_id || "").trim();
      let localIndex = Number(item?.requirement_index);
      if (!Number.isInteger(localIndex) || localIndex < 0 ||
          localIndex >= batch.groups.length) {
        const matchingIndexes = batch.groups.map((group, index) =>
          group.candidates.some((candidate) =>
            String(candidate?.product_id || "") === productId) ? index : -1)
          .filter((index) => index >= 0);
        localIndex = matchingIndexes.length === 1 ? matchingIndexes[0] : -1;
      }
      const candidateExists = localIndex >= 0 && batch.groups[localIndex]
        ?.candidates?.some((candidate) =>
          String(candidate?.product_id || "") === productId);
      const scoresValid = [
        item?.aesthetic_score ?? item?.ai_taste_score,
        item?.fit_score,
        item?.outfit_coherence_score,
        item?.value_score,
      ].every((value) => score(value) != null);
      if (!productId || !candidateExists || !scoresValid) continue;
      accepted.push({
        ...item,
        requirement_index: localIndex >= 0
          ? batch.globalGroupIndexes[localIndex] : -1,
      });
  }
  if (accepted.length === 0) {
    const error = new Error("AI reranker batch returned no valid selections");
    error.code = "AI_RERANK_BATCH_INVALID_RESPONSE";
    throw error;
  }
  return {
    ...payload,
    selected_products: accepted,
    _batch_validation: Object.freeze({
      returned_selection_count: payload.selected_products.length,
      accepted_selection_count: accepted.length,
      rejected_selection_count: payload.selected_products.length - accepted.length,
    }),
  };
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

async function abortableModelRequest(client, payload, timeoutMs, timeoutCode) {
  const budget = Math.max(1, Number(timeoutMs) || 1);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      client.chat.completions.create(payload, {
        timeout: budget + MODEL_TRANSPORT_TIMEOUT_GRACE_MS,
        maxRetries: 0,
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("AI reranker model request timed out");
          error.code = timeoutCode;
          error.timeout_owner = "LOCAL_ABORT_CONTROLLER";
          reject(error);
          controller.abort(error);
        }, budget);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function countCandidateImages(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce(
    (total, group) => total + (Array.isArray(group?.candidates)
      ? group.candidates.filter((product) => String(
        product?.image_url || "",
      ).trim()).length : 0),
    0,
  );
}

function buildVisualBatch(groups) {
  const requirementBuckets = [];
  const entriesByImage = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group, requirementIndex) => {
    const category = String(group?.requirement?.category || "other");
    const bucket = [];
    for (const product of Array.isArray(group?.candidates) ? group.candidates : []) {
      const productId = String(product?.product_id || "").trim();
      const imageUrl = String(product?.image_url || "").trim();
      const imageIdentity = canonicalImageIdentity(imageUrl);
      if (!productId || !imageIdentity) continue;
      if (bucket.some((entry) => entry.product_id === productId)) continue;
      const target = Object.freeze({
        requirement_index: requirementIndex,
        product_id: productId,
      });
      const sharedEntry = entriesByImage.get(imageIdentity);
      if (sharedEntry) {
        if (!sharedEntry.targets.some((entry) =>
          entry.requirement_index === requirementIndex &&
          entry.product_id === productId)) {
          sharedEntry.targets.push(target);
        }
        continue;
      }
      if (bucket.length >= DEFAULT_VISUAL_CANDIDATES_PER_GROUP) break;
      const entry = {
        requirement_index: requirementIndex,
        category,
        product_id: productId,
        title: safeText(product.title, 120),
        image_url: imageUrl,
        targets: [target],
      };
      entriesByImage.set(imageIdentity, entry);
      bucket.push(entry);
    }
    requirementBuckets.push(bucket);
  });
  const batch = [];
  for (let offset = 0; batch.length < MAX_VISUAL_IMAGES_PER_REQUEST; offset += 1) {
    let added = false;
    for (const bucket of requirementBuckets) {
      if (bucket[offset]) {
        batch.push(bucket[offset]);
        added = true;
        if (batch.length >= MAX_VISUAL_IMAGES_PER_REQUEST) break;
      }
    }
    if (!added) break;
  }
  return batch;
}

function canonicalImageIdentity(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(text)) return "";
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function validateSingleVisualPayload(payload, entry) {
  const values = payload?.image_assessments || payload?.products;
  const item = Array.isArray(values) && values.length === 1 ? values[0] : null;
  const validScores = item && [
    item.visual_quality_score,
    item.fashion_taste_score,
    item.commercial_ad_penalty,
    item.subject_coverage_score,
  ].every((value) => score(value) != null);
  if (!item || String(item.product_id || "") !== String(entry.product_id) ||
      Number(item.requirement_index) !== Number(entry.requirement_index) ||
      !validScores) {
    const error = new Error("AI visual response does not match requested candidate");
    error.code = "AI_VISUAL_INVALID_RESPONSE";
    throw error;
  }
  return {
    image_assessments: visualEntryTargets(entry).map((target) => ({
      ...item,
      requirement_index: target.requirement_index,
      product_id: target.product_id,
    })),
  };
}

function visualEntryTargets(entry = {}) {
  const targets = Array.isArray(entry.targets) && entry.targets.length > 0
    ? entry.targets : [{
      requirement_index: entry.requirement_index,
      product_id: entry.product_id,
    }];
  return targets.filter((target) =>
    Number.isInteger(Number(target?.requirement_index)) &&
    String(target?.product_id || "").trim());
}

function applyVisualFailurePenalties(groups, failures) {
  const failedByCandidate = new Map((Array.isArray(failures) ? failures : [])
    .flatMap(({entry, reason}) => visualEntryTargets(entry).map((target) => [
      `${target.requirement_index}:${target.product_id}`,
      safeErrorCode(reason),
    ])));
  if (failedByCandidate.size === 0) return groups;
  return groups.map((group, requirementIndex) => ({
    ...group,
    candidates: group.candidates.map((product) => {
      const failureReason = failedByCandidate.get(
        `${requirementIndex}:${product.product_id}`,
      );
      if (!failureReason) return product;
      const defaults = visualAssessmentDefaults(product);
      const visualQuality = Math.min(defaults.visual_quality_score, 35);
      const fashionTaste = Math.min(defaults.fashion_taste_score, 40);
      const adPenalty = Math.max(defaults.commercial_ad_penalty, 35);
      const subjectCoverage = Math.min(defaults.subject_coverage_score, 45);
      return {
        ...product,
        visual_evaluation_status: "FAILED_DEGRADED",
        visual_evaluation_failure_reason: failureReason,
        visual_quality_score: visualQuality,
        image_quality_score: visualQuality,
        fashion_taste_score: fashionTaste,
        commercial_ad_penalty: adPenalty,
        subject_coverage_score: subjectCoverage,
        commerce_visual_score: commerceVisualScore({
          visualQuality,
          fashionTaste,
          adPenalty,
          subjectCoverage,
        }),
        visual_quality_reason: "图片评估失败，已降低视觉证据置信度",
      };
    }),
  }));
}

function isVisualProductEvidenceFailure(error) {
  const code = safeErrorCode(error);
  return /IMAGE_(?:FETCH_FAILED|DECODE_FAILED|INVALID|UNSUPPORTED)|BAD_IMAGE|UNSUPPORTED_MEDIA/u
    .test(code);
}

function applyVisualInfrastructureStatuses(groups, failures) {
  const unavailable = new Map((Array.isArray(failures) ? failures : [])
    .flatMap(({entry, reason}) => visualEntryTargets(entry).map((target) => [
      `${target.requirement_index}:${target.product_id}`,
      safeErrorCode(reason),
    ])));
  if (unavailable.size === 0) return groups;
  return groups.map((group, requirementIndex) => ({
    ...group,
    candidates: group.candidates.map((product) => {
      const reason = unavailable.get(`${requirementIndex}:${product.product_id}`);
      return reason ? {
        ...product,
        visual_evaluation_status: "FAILED_UNASSESSED",
        visual_evaluation_failure_reason: reason,
      } : product;
    }),
  }));
}

function applyVisualDeadlineStatuses(groups, entries) {
  const skipped = new Set((Array.isArray(entries) ? entries : [])
    .flatMap((entry) => visualEntryTargets(entry).map((target) =>
      `${target.requirement_index}:${target.product_id}`)));
  if (skipped.size === 0) return groups;
  return groups.map((group, requirementIndex) => ({
    ...group,
    candidates: group.candidates.map((product) => skipped.has(
      `${requirementIndex}:${product.product_id}`,
    ) ? {
        ...product,
        visual_evaluation_status: "SKIPPED_DEADLINE",
        visual_evaluation_failure_reason: "AI_VISUAL_DEADLINE_SKIPPED",
      } : product),
  }));
}

function visualEntryTrace(entry = {}, {
  status,
  durationMs = null,
  reasonCode = null,
  timeoutOwner = null,
} = {}) {
  const imageIdentity = canonicalImageIdentity(entry.image_url);
  return Object.freeze({
    requirement_index: entry.requirement_index,
    product_id: entry.product_id,
    candidate_ref_count: visualEntryTargets(entry).length,
    image_hash: imageIdentity
      ? crypto.createHash("sha256").update(imageIdentity).digest("hex").slice(0, 16)
      : null,
    status,
    duration_ms: durationMs,
    reason_code: reasonCode,
    timeout_owner: timeoutOwner,
  });
}

function buildVisualQualityMessages(groups, context, batch = buildVisualBatch(groups)) {
  const stylingStrategy = context?.outfit_plan?.styling_strategy ||
    context?.outfitPlan?.stylingStrategy ||
    context?.styling_strategy ||
    context?.stylingStrategy || {};
  const content = [{
    type: "text",
    text: JSON.stringify({
      task: "Evaluate ecommerce product image quality for a professional styling service.",
      styling_strategy: compactObject(stylingStrategy),
      candidates: batch.map((entry, imageIndex) => ({
        image_index: imageIndex,
        requirement_index: entry.requirement_index,
        category: entry.category,
        product_id: entry.product_id,
        title: entry.title,
      })),
      output_schema: {
        image_assessments: [{
          requirement_index: 0,
          product_id: "candidate id",
          visual_quality_score: 0,
          fashion_taste_score: 0,
          commercial_ad_penalty: 0,
          subject_coverage_score: 0,
          reason: "brief evidence from the image",
        }],
      },
    }),
  }];
  batch.forEach((entry, imageIndex) => {
    content.push({
      type: "text",
      text: `image_index=${imageIndex}; product_id=${entry.product_id}; category=${entry.category}`,
    });
    content.push({
      type: "image_url",
      image_url: {url: entry.image_url, detail: "auto"},
    });
  });
  return [
    {
      role: "system",
      content: [
        "You are a strict ecommerce image art director for a premium personal styling product.",
        "Judge the image itself, not only the title or brand.",
        "High visual_quality_score requires a clear garment/product, clean composition, useful white-background or model presentation, and adequate subject coverage.",
        "Set commercial_ad_penalty high for large advertising text, red/yellow sale banners, oversized price numbers, messy collage layout, tiny product subjects, or phrases such as 50-year-old store, Beijing Mall, factory direct, livestream deal, buy one get one, flash sale, clearance, bestseller, or lowest price.",
        "Do not invent product IDs. Return exactly one assessment for every supplied candidate using strict JSON.",
      ].join("\n"),
    },
    {role: "user", content},
  ];
}

function applyVisualAssessments(groups, payload) {
  const values = payload?.image_assessments || payload?.products;
  if (!Array.isArray(values)) throw new Error("AI_VISUAL_INVALID_RESPONSE");
  const assessments = new Map();
  for (const item of values) {
    const productId = String(item?.product_id || "").trim();
    const requirementIndex = Number(item?.requirement_index);
    const visualQuality = score(item?.visual_quality_score);
    const fashionTaste = score(item?.fashion_taste_score);
    const adPenalty = score(item?.commercial_ad_penalty);
    const subjectCoverage = score(item?.subject_coverage_score);
    if (!productId || visualQuality == null || fashionTaste == null ||
        adPenalty == null || subjectCoverage == null) continue;
    const assessment = {
      visual_quality_score: visualQuality,
      image_quality_score: visualQuality,
      fashion_taste_score: fashionTaste,
      commercial_ad_penalty: adPenalty,
      subject_coverage_score: subjectCoverage,
      commerce_visual_score: commerceVisualScore({
        visualQuality,
        fashionTaste,
        adPenalty,
        subjectCoverage,
      }),
      visual_quality_reason: safeText(item.reason, 180),
    };
    assessments.set(`id:${productId}`, assessment);
    if (Number.isInteger(requirementIndex) && requirementIndex >= 0) {
      assessments.set(`${requirementIndex}:${productId}`, assessment);
    }
  }
  if (assessments.size === 0) throw new Error("AI_VISUAL_NO_VALID_ASSESSMENT");
  return groups.map((group, requirementIndex) => ({
    ...group,
    candidates: group.candidates
      .map((product) => ({
        ...product,
        ...(assessments.get(`${requirementIndex}:${product.product_id}`) ||
          assessments.get(`id:${product.product_id}`) ||
          visualAssessmentDefaults(product)),
      }))
      .filter((product) => product.commercial_ad_penalty < 60)
      .sort((left, right) => candidateQualityPrior(right) - candidateQualityPrior(left)),
  }));
}

function visualAssessmentDefaults(product) {
  const existingVisualQuality = score(
    product?.visual_quality_score ?? product?.image_quality_score,
  );
  const existingFashionTaste = score(product?.fashion_taste_score);
  const existingAdPenalty = score(product?.commercial_ad_penalty);
  const existingSubjectCoverage = score(product?.subject_coverage_score);
  if (existingVisualQuality != null && existingFashionTaste != null &&
      existingAdPenalty != null && existingSubjectCoverage != null) {
    return {
      visual_quality_score: existingVisualQuality,
      image_quality_score: existingVisualQuality,
      fashion_taste_score: existingFashionTaste,
      commercial_ad_penalty: existingAdPenalty,
      subject_coverage_score: existingSubjectCoverage,
      commerce_visual_score: boundedScore(
        product?.commerce_visual_score ?? commerceVisualScore({
          visualQuality: existingVisualQuality,
          fashionTaste: existingFashionTaste,
          adPenalty: existingAdPenalty,
          subjectCoverage: existingSubjectCoverage,
        }),
      ),
      visual_quality_reason: safeText(product?.visual_quality_reason, 180),
    };
  }
  const hint = String(product?.image_quality_hint || "").toLowerCase();
  const promotion = hint === "promotion_poster";
  const visualQuality = promotion ? 20
    : hint === "white_background" ? 86
      : hint === "model_display" ? 82
        : hint === "official" ? 78 : 60;
  const fashionTaste = boundedScore(product?.catalog_aesthetic_score ?? 55);
  const adPenalty = promotion ? 75 : 20;
  const subjectCoverage = promotion ? 30 : 65;
  return {
    visual_quality_score: visualQuality,
    image_quality_score: visualQuality,
    fashion_taste_score: fashionTaste,
    commercial_ad_penalty: adPenalty,
    subject_coverage_score: subjectCoverage,
    commerce_visual_score: commerceVisualScore({
      visualQuality,
      fashionTaste,
      adPenalty,
      subjectCoverage,
    }),
    visual_quality_reason: "",
  };
}

function commerceVisualScore({visualQuality, fashionTaste, adPenalty, subjectCoverage}) {
  return roundScore(boundedScore(
    boundedScore(visualQuality) * 0.45 +
    boundedScore(fashionTaste) * 0.25 +
    boundedScore(subjectCoverage) * 0.3 -
    boundedScore(adPenalty) * 0.6,
  ));
}

function contextStyleProfile(context = {}) {
  return context.style_profile || context.styleProfile ||
    context.user_requirements?.style_profile ||
    context.userRequirements?.styleProfile ||
    context.outfit_plan?.style_profile ||
    context.outfitPlan?.styleProfile || {};
}

function contextOutfitBlueprint(context = {}) {
  return context.outfit_blueprint || context.outfitBlueprint ||
    context.user_requirements?.outfit_blueprint ||
    context.userRequirements?.outfitBlueprint ||
    context.outfit_plan?.outfit_blueprint ||
    context.outfitPlan?.outfitBlueprint || {};
}

function contextStyleSemantics(context = {}) {
  return context.style_semantics || context.styleSemantics ||
    context.user_requirements?.style_semantics ||
    context.userRequirements?.styleSemantics ||
    context.outfit_plan?.style_semantics ||
    context.outfitPlan?.styleSemantics || {};
}

function contextAestheticTarget(context = {}, requirements = []) {
  const configured = context.aesthetic_target_profile ||
    context.aestheticTargetProfile ||
    context.recommendation_context?.aesthetic_target_profile ||
    context.recommendationContext?.aestheticTargetProfile;
  if (configured && Array.isArray(configured.style_targets)) return configured;

  const firstRequirement = (Array.isArray(requirements) ? requirements : [])
    .find((requirement) => requirement && typeof requirement === "object") || {};
  const style = context.style || context.requested_style ||
    context.user_requirements?.style || context.userRequirements?.style ||
    firstRequirement.style;
  const scene = context.scene || context.occasion ||
    context.user_requirements?.scene || context.userRequirements?.scene ||
    firstRequirement.scene || firstRequirement.occasion;
  const gender = context.gender || context.authoritative_gender ||
    context.user_profile?.gender || context.userProfile?.gender ||
    firstRequirement.gender;
  if (![style, scene, gender].some((value) => String(value || "").trim())) {
    return null;
  }
  return resolveAestheticTargetProfile({
    gender,
    scene,
    style,
    item_budget: context.item_budget ?? context.itemBudget,
    outfit_budget: context.outfit_budget ?? context.outfitBudget,
  });
}

function productStyleEvidence(product = {}, requirement = {}) {
  return [
    product.title,
    product.brand,
    product.shop_name,
    product.material,
    product.style,
    product.style_tags,
    product.aesthetic_tags,
    product.silhouette_tags,
    product.detail_tags,
    product.occasion,
    product.occasion_tags,
    product.occasions,
    product.subcategory,
    product.quality_tier,
    product.color,
    requirement.style,
    requirement.scene,
    requirement.occasion,
  ].filter(Boolean).join(" ");
}

function validateSelection(payload, groups, selectionLimit, context = {}) {
  if (!payload || !Array.isArray(payload.selected_products)) {
    throw new Error("AI_RERANK_INVALID_RESPONSE");
  }
  const safeGroups = normalizeGroups(groups, selectionLimit, context);
  const styleProfile = contextStyleProfile(context);
  const styleSemantics = contextStyleSemantics(context);
  const outfitBlueprint = contextOutfitBlueprint(context);
  const aestheticTarget = contextAestheticTarget(
    context,
    (Array.isArray(groups) ? groups : []).map((group) => group?.requirement),
  );
  const intentPriorityScore = resolveIntentPriorityScore(styleProfile);
  const enforceStyleThreshold = hasActionableStyleConstraints(styleProfile);
  const candidates = new Map();
  const productGroups = new Map();
  safeGroups.forEach((group, groupIndex) => {
    group.candidates.forEach((product) => {
      const id = String(product.product_id);
      candidates.set(`${groupIndex}:${id}`, {product, groupIndex});
      const indexes = productGroups.get(id) || [];
      indexes.push(groupIndex);
      productGroups.set(id, indexes);
    });
  });
  const selectedByGroup = safeGroups.map(() => []);
  const seen = new Set();
  for (const item of payload.selected_products) {
    const id = String(item?.product_id || "").trim();
    const requestedGroup = Number(item?.requirement_index);
    const inferredGroups = productGroups.get(id) || [];
    const groupIndex = Number.isInteger(requestedGroup) && requestedGroup >= 0
      ? requestedGroup
      : inferredGroups.length === 1 ? inferredGroups[0] : -1;
    const match = candidates.get(`${groupIndex}:${id}`);
    const selectionKey = `${groupIndex}:${id}`;
    if (!match || seen.has(selectionKey)) continue;
    if (!evaluateStyleGate(
      match.product,
      styleProfile,
      intentPriorityScore,
    ).allowed) continue;
    const blueprintMatch = blueprintMatchAssessment(
      match.product,
      safeGroups[match.groupIndex]?.requirement,
      outfitBlueprint,
    );
    if (!blueprintMatchPassesHardGate(blueprintMatch, intentPriorityScore)) continue;
    const catalogAesthetic = boundedScore(match.product.catalog_aesthetic_score ?? 50);
    const brandQuality = boundedScore(match.product.brand_quality_score ?? BRAND_SCORE.C);
    const aiAesthetic = score(item.aesthetic_score ?? item.ai_taste_score);
    const bodyStrategyMatch = score(
      match.product.body_strategy_match_score ??
      item.body_strategy_match_score ??
      item.fit_score,
    );
    const visualQuality = boundedScore(
      match.product.commerce_visual_score ??
      match.product.visual_quality_score ??
      match.product.image_quality_score ?? 60,
    );
    const values = {
      ai_taste_score: aiAesthetic,
      aesthetic_score: aiAesthetic,
      fit_score: score(item.fit_score),
      body_strategy_match_score: bodyStrategyMatch,
      outfit_coherence_score: score(item.outfit_coherence_score),
      value_score: score(item.value_score),
    };
    if (Object.values(values).some((value) => value == null)) continue;
    const groupProducts = selectedByGroup[match.groupIndex];
    if (groupProducts.length >= selectionLimit) continue;
    seen.add(selectionKey);
    const matchScore = budgetAdjustedMatchScore(match.product);
    const localStyleMatch = styleMatchScore({
      evidence: productStyleEvidence(match.product, safeGroups[match.groupIndex]?.requirement),
      relevanceScore: matchScore,
      styleProfile,
      styleSemantics,
    });
    const targetAssessment = match.product.aesthetic_target_assessment ||
      candidateAestheticTargetAssessment(
        match.product,
        safeGroups[match.groupIndex]?.requirement,
        aestheticTarget,
      );
    const selectedStyleMatch = aestheticTarget
      ? styleGateScore(targetAssessment, localStyleMatch)
      : score(item.style_match_score) ?? localStyleMatch;
    if (shouldRejectForStyle({
      intentPriorityScore,
      styleMatch: selectedStyleMatch,
      enforce: enforceStyleThreshold,
    })) continue;
    const weatherMatch = score(item.weather_match_score) ?? 70;
    const recommendationReason = appendBudgetNote(
      userFacingChineseText(item.reason, "该商品与当前穿搭方案和身体比例策略相匹配", 240),
      match.product.budget_note,
    );
    const calibrated = calibratedProductScore({
      assessment: targetAssessment,
      relevanceScore: matchScore,
      blueprintMatchScore: blueprintMatch.score,
      aestheticScore: values.aesthetic_score,
      visualQualityScore: visualQuality,
      bodyStrategyScore: values.body_strategy_match_score,
      brandQualityScore: brandQuality,
      diversityScore: 100,
      product: match.product,
    });
    groupProducts.push({
      ...match.product,
      ...values,
      match_score: matchScore,
      blueprint_match_score: blueprintMatch.score,
      matched_elements: blueprintMatch.matched_elements,
      conflict_elements: blueprintMatch.conflict_elements,
      aesthetic_target_assessment: targetAssessment,
      style_fit_score: targetAssessment.style_fit,
      occasion_fit_score: targetAssessment.occasion_fit,
      color_fit_score: targetAssessment.color_fit,
      silhouette_fit_score: targetAssessment.silhouette_fit,
      footwear_fit_score: targetAssessment.footwear_fit,
      quality_fit_score: targetAssessment.quality_fit,
      gender_fit_score: targetAssessment.gender_fit,
      style_match_score: selectedStyleMatch,
      weather_match_score: weatherMatch,
      catalog_aesthetic_score: catalogAesthetic,
      commerce_visual_score: visualQuality,
      brand_quality_score: brandQuality,
      diversity_score: 100,
      final_score: calibrated.finalScore,
      ai_match_score: calibrated.finalScore,
      reranker_score_trace: calibrated.trace,
      ranking_reason: calibrated.trace.ranking_reason,
      ai_recommendation_reason: recommendationReason,
      ai_concern: userFacingChineseText(item.concern, "", 180),
      recommendation_reason: recommendationReason,
      ai_rerank_fallback: false,
    });
  }
  if (selectedByGroup.every((products) => products.length === 0)) {
    throw new Error("AI_RERANK_NO_VALID_SELECTION");
  }
  return selectedByGroup.flatMap((products) => applyLabels(products));
}

function groupsBelowMinimum(groups, products, minimum = MIN_SLOT_SELECTION) {
  const selectedIds = new Set(products.map(productGroupKey));
  return groups.filter((group) => {
    const required = Math.min(
      positiveInteger(minimum, MIN_SLOT_SELECTION),
      group.candidates.length,
    );
    const selected = group.candidates.filter((product) =>
      selectedIds.has(productGroupKey(product))).length;
    return required > 0 && selected < required;
  });
}

function replaceGroupProducts(products, replacements, groups) {
  const groupIds = new Set(groups.flatMap((group) =>
    group.candidates.map(productGroupKey)));
  return [
    ...products.filter((product) => !groupIds.has(productGroupKey(product))),
    ...replacements,
  ];
}

function productGroupKey(product) {
  return `${product?.look_id || ""}:${product?.product_id || ""}`;
}

function applyDiversityScores(products, groups, {
  selectionLimit = DEFAULT_SELECTION_LIMIT,
  recentSelections = [],
  context = {},
} = {}) {
  const safeGroups = normalizeGroups(groups, selectionLimit, context);
  const aestheticTarget = contextAestheticTarget(
    context,
    safeGroups.map((group) => group.requirement),
  );
  const available = new Map((Array.isArray(products) ? products : [])
    .map((product) => [productGroupKey(product), product]));
  const previousLookPrimaries = [];
  const primarySelections = [];
  const diversified = [];

  for (const group of safeGroups) {
    const requirement = group.requirement;
    const groupProducts = group.candidates
      .map((candidate) => available.get(productGroupKey(candidate)))
      .filter(Boolean);
    const ranked = [];
    const remaining = [...groupProducts];
    while (remaining.length > 0 && ranked.length < selectionLimit) {
      const scored = remaining.map((product) => {
        const comparisons = [
          ...previousLookPrimaries.filter((item) =>
            item.category === requirement.category),
          ...recentSelections.filter((item) =>
            item.category === requirement.category),
          ...ranked.map((item) => productFingerprint(item, requirement)),
        ];
        const diversity = diversityScore(product, requirement, comparisons);
        const relevance = budgetAdjustedMatchScore(product);
        const aesthetic = boundedScore(
          product.aesthetic_score ?? product.ai_taste_score ??
          product.catalog_aesthetic_score ?? relevance,
        );
        const brandQuality = boundedScore(
          product.brand_quality_score ?? BRAND_SCORE.C,
        );
        const visualQuality = boundedScore(
          product.commerce_visual_score ??
          product.visual_quality_score ??
          product.image_quality_score ?? 60,
        );
        const bodyStrategy = boundedScore(
          product.body_strategy_match_score ?? product.fit_score ?? 60,
        );
        const styleMatch = boundedScore(product.style_match_score ?? relevance);
        const weatherMatch = boundedScore(product.weather_match_score ?? 70);
        const exactDuplicate = hasExactDuplicate(product, comparisons);
        const targetAssessment = product.aesthetic_target_assessment ||
          candidateAestheticTargetAssessment(
            product,
            requirement,
            aestheticTarget,
          );
        const calibrated = calibratedProductScore({
          assessment: targetAssessment,
          relevanceScore: relevance,
          blueprintMatchScore: product.blueprint_match_score ?? styleMatch,
          aestheticScore: aesthetic,
          visualQualityScore: visualQuality,
          bodyStrategyScore: bodyStrategy,
          brandQualityScore: brandQuality,
          diversityScore: diversity,
          exactDuplicate,
          product,
        });
        const finalScore = calibrated.finalScore;
        return {
          product: {
            ...product,
            match_score: relevance,
            style_match_score: styleMatch,
            weather_match_score: weatherMatch,
            aesthetic_score: aesthetic,
            commerce_visual_score: visualQuality,
            body_strategy_match_score: bodyStrategy,
            brand_quality_score: brandQuality,
            diversity_score: diversity,
            aesthetic_target_assessment: targetAssessment,
            style_fit_score: targetAssessment.style_fit,
            occasion_fit_score: targetAssessment.occasion_fit,
            color_fit_score: targetAssessment.color_fit,
            silhouette_fit_score: targetAssessment.silhouette_fit,
            footwear_fit_score: targetAssessment.footwear_fit,
            quality_fit_score: targetAssessment.quality_fit,
            gender_fit_score: targetAssessment.gender_fit,
            final_score: finalScore,
            ai_match_score: finalScore,
            reranker_score_trace: calibrated.trace,
            ranking_reason: calibrated.trace.ranking_reason,
          },
          finalScore,
        };
      }).sort((left, right) => right.finalScore - left.finalScore);
      const selected = scored[0].product;
      ranked.push(selected);
      const selectedIndex = remaining.findIndex((item) =>
        productGroupKey(item) === productGroupKey(selected));
      remaining.splice(selectedIndex, 1);
    }
    if (ranked.length > 0) {
      const primary = productFingerprint(ranked[0], requirement);
      previousLookPrimaries.push(primary);
      primarySelections.push(primary);
    }
    diversified.push(...applyLabels(ranked));
  }
  return {products: diversified, primarySelections};
}

function diversityScore(product, requirement, comparisons) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) return 100;
  let scoreValue = 100;
  const current = productFingerprint(product, requirement);
  for (const previous of comparisons) {
    if (current.product_id && current.product_id === previous.product_id) {
      scoreValue = Math.min(scoreValue, 0);
      continue;
    }
    if (current.image_url && current.image_url === previous.image_url) {
      scoreValue = Math.min(scoreValue, 5);
    }
    const similarity = titleSimilarity(current.title, previous.title);
    if (similarity >= 0.85) scoreValue = Math.min(scoreValue, 20);
    else if (similarity >= 0.65) scoreValue = Math.min(scoreValue, 45);
    if (current.brand && previous.brand && current.brand === previous.brand) {
      scoreValue -= 15;
    }
    if (current.color && previous.color && current.color === previous.color) {
      scoreValue -= 8;
    }
    if (current.fit && previous.fit && current.fit === previous.fit) {
      scoreValue -= 7;
    }
  }
  return boundedScore(scoreValue);
}

function hasExactDuplicate(product, comparisons) {
  const current = productFingerprint(product);
  return comparisons.some((previous) =>
    current.product_id && current.product_id === previous.product_id);
}

function productFingerprint(product, requirement = {}) {
  return {
    product_id: String(product?.product_id || product?.id || "").trim(),
    category: String(product?.category || requirement.category || "").trim(),
    title: normalizeComparisonText(product?.title),
    image_url: String(product?.image_url || product?.imageUrl || "").trim().toLowerCase(),
    brand: normalizeComparisonText(product?.brand || product?.shop_name),
    color: normalizeComparisonText(product?.color || requirement.color),
    fit: normalizeComparisonText(product?.fit || requirement.fit),
  };
}

function titleSimilarity(left, right) {
  const leftParts = bigrams(normalizeComparisonText(left));
  const rightParts = bigrams(normalizeComparisonText(right));
  if (leftParts.size === 0 || rightParts.size === 0) return 0;
  let intersection = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) intersection += 1;
  }
  return intersection / (leftParts.size + rightParts.size - intersection);
}

function bigrams(value) {
  const chars = [...String(value || "")];
  if (chars.length === 1) return new Set(chars);
  const result = new Set();
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.add(`${chars[index]}${chars[index + 1]}`);
  }
  return result;
}

function normalizeComparisonText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function semanticToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function semanticList(value) {
  return (Array.isArray(value) ? value : [value]).flat(Infinity)
    .map(semanticToken).filter(Boolean);
}

function candidateStyleSet(product = {}) {
  return new Set(semanticList([
    product.style,
    product.style_tags,
    product.aesthetic_tags,
  ]));
}

function styleFitAssessment(product = {}, target = null) {
  const targetStyles = Array.isArray(target?.style_targets)
    ? target.style_targets : [];
  if (targetStyles.length === 0) {
    return {score: 50, classification: "NO_STYLE_TARGET", missing: true};
  }
  const candidateStyles = candidateStyleSet(product);
  if (candidateStyles.size === 0) {
    return {score: 35, classification: "MISSING_STYLE_METADATA", missing: true};
  }
  const compatible = new Set(semanticList(target?.compatible_styles));
  const conflicting = new Set(semanticList(target?.conflicting_styles));
  const nearMissTargets = new Set(semanticList(product?.near_miss_styles));
  let totalWeight = 0;
  let weightedScore = 0;
  let strongest = "GENERIC_STYLE";
  let strongestScore = -1;
  for (const entry of targetStyles) {
    const targetId = semanticToken(entry?.id);
    const weight = Number.isFinite(Number(entry?.weight))
      ? Math.max(0, Number(entry.weight)) : 1;
    let scoreValue = 45;
    let classification = "GENERIC_STYLE";
    if (candidateStyles.has(targetId)) {
      scoreValue = 100;
      classification = "EXACT_STYLE_MATCH";
    } else if (nearMissTargets.has(targetId)) {
      scoreValue = 78;
      classification = "COMPATIBLE_NEAR_MISS";
    } else if ([...candidateStyles].some((style) => compatible.has(style))) {
      scoreValue = 72;
      classification = "COMPATIBLE_STYLE";
    } else if ([...candidateStyles].some((style) => conflicting.has(style))) {
      scoreValue = 8;
      classification = "CONTRADICTORY_STYLE";
    }
    totalWeight += weight;
    weightedScore += scoreValue * weight;
    if (scoreValue > strongestScore) {
      strongestScore = scoreValue;
      strongest = classification;
    }
  }
  return {
    score: roundScore(weightedScore / (totalWeight || 1)),
    classification: strongest,
    missing: false,
  };
}

function occasionFitAssessment(product = {}, target = null, requirement = {}) {
  const targetScene = semanticToken(target?.scene || requirement.scene ||
    requirement.occasion);
  if (!targetScene) return {score: 60, classification: "NO_OCCASION_TARGET", missing: true};
  const occasions = new Set(semanticList([
    product.occasion,
    product.occasions,
    product.occasion_tags,
  ]));
  if (occasions.size === 0) {
    return {score: 40, classification: "MISSING_OCCASION_METADATA", missing: true};
  }
  if (occasions.has(targetScene)) {
    return {score: 100, classification: "EXACT_OCCASION_MATCH", missing: false};
  }
  const compatible = new Set(semanticList(SCENE_COMPATIBILITY[targetScene] || []));
  if ([...occasions].some((occasion) => compatible.has(occasion))) {
    return {score: 70, classification: "COMPATIBLE_OCCASION", missing: false};
  }
  return {score: 35, classification: "OCCASION_MISMATCH", missing: false};
}

function candidateEvidence(product = {}) {
  return [
    product.title,
    product.category,
    product.subcategory,
    product.style,
    product.style_tags,
    product.aesthetic_tags,
    product.silhouette_tags,
    product.detail_tags,
    product.material,
    product.color,
  ].flat(Infinity).filter(Boolean).join(" ").toLowerCase();
}

function inferredColorIntensity(product = {}, requirement = {}) {
  const evidence = candidateEvidence(product, requirement);
  if (!String(product.color || "").trim() &&
      !/[黑白灰米杏卡其棕蓝红粉绿紫黄橙]|black|white|gray|grey|beige|brown|blue|red|pink|green|purple|yellow|orange/i.test(evidence)) {
    return null;
  }
  if (/荧光|高饱和|亮色|撞色|玫红|明黄|neon|vivid/i.test(evidence)) return 0.88;
  if (/黑|白|灰|米|杏|卡其|驼|棕|海军蓝|藏蓝|black|white|gray|grey|beige|khaki|brown|navy/i.test(evidence)) return 0.24;
  if (/雾|莫兰迪|柔和|浅|muted|pastel/i.test(evidence)) return 0.38;
  return 0.62;
}

function closenessScore(actual, target, missing = 45) {
  const left = Number(actual);
  const right = Number(target);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return missing;
  return roundScore(boundedScore(100 - Math.abs(left - right) * 100));
}

function colorFitAssessment(product = {}, target = null, requirement = {}) {
  const targetIntensity = Number(target?.color_targets?.intensity ??
    target?.dimensions?.color_intensity);
  if (!Number.isFinite(targetIntensity)) {
    return {score: 60, classification: "NO_COLOR_TARGET", missing: true};
  }
  const actual = inferredColorIntensity(product, requirement);
  if (actual == null) {
    return {score: 40, classification: "MISSING_COLOR_METADATA", missing: true};
  }
  return {
    score: closenessScore(actual, targetIntensity),
    classification: "COLOR_INTENSITY_DISTANCE",
    missing: false,
    actual,
  };
}

function inferSilhouetteVector(product = {}, requirement = {}) {
  const evidence = candidateEvidence(product, requirement);
  const hasSignal = /剪裁|挺括|廓形|高腰|收腰|短款|修身|合身|直筒|锥形|宽松|阔腿|oversize|tailored|structured|fitted|cropped|straight|tapered|wide|relaxed/i
    .test(evidence);
  if (!hasSignal) return null;
  return {
    structure: /剪裁|挺括|廓形|西装|直线|tailored|structured|clean_line/i.test(evidence)
      ? 0.8 : /宽松|慵懒|relaxed|oversize/i.test(evidence) ? 0.35 : 0.52,
    waist_emphasis: /高腰|收腰|腰封|短款|修身|合身|high_waist|cropped|fitted/i.test(evidence)
      ? 0.8 : 0.48,
    volume: /宽松|阔腿|oversize|wide|relaxed/i.test(evidence)
      ? 0.8 : /修身|合身|锥形|fitted|tapered/i.test(evidence) ? 0.35 : 0.52,
    verticality: /高腰|直筒|锥形|修身|长线条|high_waist|straight|tapered|vertical/i.test(evidence)
      ? 0.78 : 0.5,
  };
}

function silhouetteFitAssessment(product = {}, target = null, requirement = {}) {
  const desired = target?.silhouette_targets;
  if (!desired || typeof desired !== "object") {
    return {score: 60, classification: "NO_SILHOUETTE_TARGET", missing: true};
  }
  const actual = inferSilhouetteVector(product, requirement);
  if (!actual) {
    return {score: 45, classification: "MISSING_SILHOUETTE_METADATA", missing: true};
  }
  const fields = ["structure", "waist_emphasis", "volume", "verticality"];
  return {
    score: roundScore(fields.reduce((sum, key) =>
      sum + closenessScore(actual[key], desired[key]), 0) / fields.length),
    classification: "SILHOUETTE_VECTOR_DISTANCE",
    missing: false,
  };
}

function inferredFootwearVector(product = {}, requirement = {}) {
  const evidence = candidateEvidence(product, requirement);
  const sport = /运动|跑鞋|板鞋|球鞋|老爹鞋|德训鞋|赛车鞋|sneaker|trainer|running|sport|air\s*max|samba/i.test(evidence);
  const formal = /正装|礼服|牛津|德比|尖头|细楦|formal|oxford|derby|pumps?|heel/i.test(evidence);
  const refined = /尖头|杏仁头|浅口|芭蕾|玛丽珍|乐福|细楦|pointed|ballet|mary|loafer|oxford|derby/i.test(evidence);
  const quality = qualityLevel(product, evidence);
  return {
    formality: formal ? 0.88 : /乐福|皮鞋|短靴|loafer|boots?/i.test(evidence) ? 0.68 : sport ? 0.24 : 0.48,
    sportiness: sport ? 0.9 : 0.2,
    toe_refinement: refined ? 0.84 : /厚底|大头|圆头/i.test(evidence) ? 0.35 : 0.52,
    material_quality: quality,
  };
}

function footwearFitAssessment(product = {}, target = null, requirement = {}) {
  const category = semanticToken(product.category || requirement.category);
  if (category !== "shoes") {
    return {score: 70, classification: "NOT_FOOTWEAR", missing: false};
  }
  const desired = target?.footwear_targets;
  if (!desired || typeof desired !== "object") {
    return {score: 50, classification: "NO_FOOTWEAR_TARGET", missing: true};
  }
  const actual = inferredFootwearVector(product, requirement);
  const fields = ["formality", "sportiness", "toe_refinement", "material_quality"];
  return {
    score: roundScore(fields.reduce((sum, key) =>
      sum + closenessScore(actual[key], desired[key]), 0) / fields.length),
    classification: "FOOTWEAR_VECTOR_DISTANCE",
    missing: false,
  };
}

function qualityLevel(product = {}, evidence = "") {
  const tier = semanticToken(product.quality_tier);
  if (QUALITY_TIER_VALUE[tier] != null) return QUALITY_TIER_VALUE[tier];
  const text = `${evidence} ${product.material || ""}`;
  if (/羊绒|真丝|桑蚕丝|精纺|头层皮|牛皮|高支|premium|luxury/i.test(text)) return 0.82;
  if (/塑料|廉价|基础|普通|budget/i.test(text)) return 0.32;
  return 0.45;
}

function qualityFitAssessment(product = {}, target = null, requirement = {}) {
  const desired = Number(target?.quality_target ?? target?.dimensions?.quality);
  if (!Number.isFinite(desired)) {
    return {score: 55, classification: "NO_QUALITY_TARGET", missing: true};
  }
  const missing = !String(product.quality_tier || "").trim() &&
    !String(product.material || "").trim();
  if (missing) {
    return {
      score: 40,
      classification: "MISSING_QUALITY_METADATA",
      missing: true,
    };
  }
  return {
    score: closenessScore(qualityLevel(product, candidateEvidence(product, requirement)), desired),
    classification: "QUALITY_TIER_DISTANCE",
    missing: false,
  };
}

function genderFitAssessment(product = {}, target = null, requirement = {}) {
  const requested = semanticToken(target?.style_targets?.[0]?.gender_variant ||
    requirement.gender);
  const actual = semanticToken(product.original_gender || product.gender);
  if (!requested || requested === "unisex" || requested === "unknown") {
    return {score: 90, classification: "NEUTRAL_GENDER_TARGET", missing: !actual};
  }
  if (!actual || actual === "unknown") {
    return {score: 45, classification: "MISSING_GENDER_METADATA", missing: true};
  }
  if (actual === requested) {
    return {score: 100, classification: "EXACT_GENDER_MATCH", missing: false};
  }
  if (actual === "unisex") {
    return {score: 75, classification: "UNISEX_COMPATIBLE", missing: false};
  }
  return {score: 0, classification: "GENDER_CONFLICT", missing: false};
}

function candidateAestheticTargetAssessment(product = {}, requirement = {}, target = null) {
  const canonical = product.target_fit_assessment || buildTargetFitAssessment(
    product,
    requirement,
    {aesthetic_target_profile: target},
  );
  const style = styleFitAssessment(product, target);
  const occasion = occasionFitAssessment(product, target, requirement);
  const color = colorFitAssessment(product, target, requirement);
  const silhouette = silhouetteFitAssessment(product, target, requirement);
  const footwear = footwearFitAssessment(product, target, requirement);
  const quality = qualityFitAssessment(product, target, requirement);
  const gender = genderFitAssessment(product, target, requirement);
  const missingMetadata = [
    ["style", style],
    ["occasion", occasion],
    ["color", color],
    ["silhouette", silhouette],
    ["footwear", footwear],
    ["quality", quality],
    ["gender", gender],
  ].filter(([, assessment]) => assessment.missing)
    .map(([name]) => name);
  return Object.freeze({
    style_fit: canonicalScore(canonical.style_fit, style.score),
    occasion_fit: canonicalScore(canonical.occasion_fit, occasion.score),
    color_fit: canonicalScore(canonical.color_fit, color.score),
    silhouette_fit: canonicalScore(canonical.silhouette_fit, silhouette.score),
    footwear_fit: canonicalScore(canonical.footwear_fit, footwear.score),
    quality_fit: canonicalScore(canonical.quality_fit, quality.score),
    gender_fit: canonicalScore(canonical.audience_fit, gender.score),
    contemporary_fit: canonicalScore(canonical.contemporary_fit, 50),
    desired_impression_fit: canonicalScore(
      canonical.desired_impression_fit,
      50,
    ),
    canonical_assessment: canonical,
    style_classification: style.classification,
    occasion_classification: occasion.classification,
    metadata_missing: Object.freeze(missingMetadata),
  });
}

function canonicalScore(record, fallback) {
  if (!record || ["UNKNOWN", "NOT_APPLICABLE"].includes(record.status)) {
    return fallback;
  }
  const score = Number(record.score);
  return Number.isFinite(score) ? boundedScore(score) : fallback;
}

function styleGateScore(targetAssessment, legacyStyleMatch) {
  const missingStyleMetadata = Array.isArray(targetAssessment?.metadata_missing) &&
    targetAssessment.metadata_missing.includes("style");
  return boundedScore(missingStyleMetadata
    ? legacyStyleMatch
    : targetAssessment?.style_fit ?? legacyStyleMatch);
}

function calibratedProductScore({
  assessment,
  relevanceScore,
  blueprintMatchScore,
  aestheticScore,
  visualQualityScore,
  bodyStrategyScore,
  brandQualityScore,
  diversityScore = 100,
  exactDuplicate = false,
  product = {},
} = {}) {
  const components = {
    style_fit: boundedScore(assessment?.style_fit),
    occasion_fit: boundedScore(assessment?.occasion_fit),
    silhouette_fit: boundedScore(assessment?.silhouette_fit),
    color_fit: boundedScore(assessment?.color_fit),
    footwear_fit: boundedScore(assessment?.footwear_fit),
    quality_fit: boundedScore(assessment?.quality_fit),
    gender_fit: boundedScore(assessment?.gender_fit),
    relevance: boundedScore(relevanceScore),
    blueprint: boundedScore(blueprintMatchScore),
    aesthetic: boundedScore(aestheticScore),
    visual: boundedScore(visualQualityScore),
    body: boundedScore(bodyStrategyScore),
  };
  const contributions = Object.fromEntries(Object.entries(CALIBRATED_PRODUCT_WEIGHTS)
    .map(([key, weight]) => [key, roundScore(components[key] * weight)]));
  const coreScore = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const coreAestheticFit = roundScore(
    components.style_fit * 0.55 +
    components.occasion_fit * 0.20 +
    components.silhouette_fit * 0.10 +
    components.footwear_fit * 0.10 +
    components.color_fit * 0.05,
  );
  const brandAdjustment = coreAestheticFit >= 60
    ? roundScore((boundedScore(brandQualityScore) - 50) * 0.015)
    : 0;
  const diversityPenalty = roundScore(
    (100 - boundedScore(diversityScore)) * 0.0125,
  );
  const duplicatePenalty = exactDuplicate ? 5 : 0;
  const productAcceptancePenalty = boundedScore(
    product?.product_acceptance_penalty ?? 0,
  );
  const finalScore = roundScore(boundedScore(
    coreScore + brandAdjustment - diversityPenalty - duplicatePenalty -
      productAcceptancePenalty,
  ));
  const reasons = [
    assessment?.style_classification || "NO_STYLE_ASSESSMENT",
    assessment?.occasion_classification || "NO_OCCASION_ASSESSMENT",
  ];
  if (brandAdjustment !== 0) reasons.push("BRAND_TIE_BREAKER");
  if (diversityPenalty > 0) reasons.push("DIVERSITY_TIE_BREAKER");
  if (duplicatePenalty > 0) reasons.push("REPEATED_CANDIDATE_PENALTY");
  if (productAcceptancePenalty > 0) {
    reasons.push("REAL_PRODUCT_ACCEPTANCE_PENALTY");
  }
  const trace = Object.freeze({
    version: RERANKER_CALIBRATION_VERSION,
    candidate_id: String(product.product_id || product.id || ""),
    title: String(product.title || ""),
    style_fit: components.style_fit,
    occasion_fit: components.occasion_fit,
    color_fit: components.color_fit,
    silhouette_fit: components.silhouette_fit,
    footwear_fit: components.footwear_fit,
    quality_fit: components.quality_fit,
    brand_score: boundedScore(brandQualityScore),
    diversity_score: boundedScore(diversityScore),
    gender_fit: components.gender_fit,
    metadata_missing: assessment?.metadata_missing || Object.freeze([]),
    raw_component_scores: Object.freeze({
      ...components,
      weights: CALIBRATED_PRODUCT_WEIGHTS,
      contributions: Object.freeze(contributions),
      core_score: roundScore(coreScore),
      core_aesthetic_fit: coreAestheticFit,
      brand_adjustment: brandAdjustment,
      diversity_penalty: diversityPenalty,
      duplicate_penalty: duplicatePenalty,
      product_acceptance_penalty: productAcceptancePenalty,
    }),
    final_score: finalScore,
    ranking_reason: reasons.join(" | "),
  });
  return Object.freeze({finalScore, trace});
}

function compositeProductScore({
  matchScore,
  styleMatchScore = matchScore,
  blueprintMatchScore = styleMatchScore,
  aestheticScore,
  visualQualityScore = aestheticScore,
  bodyStrategyScore = matchScore,
  brandQualityScore,
  occasionFitScore = 60,
  silhouetteFitScore = 60,
  colorFitScore = 60,
  footwearFitScore = 70,
  qualityFitScore = 55,
  genderFitScore = 90,
  diversityScore = 100,
}) {
  return calibratedProductScore({
    assessment: {
      style_fit: styleMatchScore,
      occasion_fit: occasionFitScore,
      silhouette_fit: silhouetteFitScore,
      color_fit: colorFitScore,
      footwear_fit: footwearFitScore,
      quality_fit: qualityFitScore,
      gender_fit: genderFitScore,
      style_classification: "EXPLICIT_COMPONENT_SCORE",
      occasion_classification: "EXPLICIT_COMPONENT_SCORE",
      metadata_missing: Object.freeze([]),
    },
    relevanceScore: matchScore,
    blueprintMatchScore,
    aestheticScore,
    visualQualityScore,
    bodyStrategyScore,
    brandQualityScore,
    diversityScore,
  }).finalScore;
}

function ruleFallback(groups, selectionLimit, context = {}) {
  const styleProfile = contextStyleProfile(context);
  const styleSemantics = contextStyleSemantics(context);
  const intentPriorityScore = resolveIntentPriorityScore(styleProfile);
  const enforceStyleThreshold = hasActionableStyleConstraints(styleProfile);
  const outfitBlueprint = contextOutfitBlueprint(context);
  const aestheticTarget = contextAestheticTarget(
    context,
    (Array.isArray(groups) ? groups : []).map((group) => group?.requirement),
  );
  return groups.flatMap((group) => group.candidates.slice(0, selectionLimit).map((product) => {
    const blueprintMatch = blueprintMatchAssessment(
      product,
      group.requirement,
      outfitBlueprint,
    );
    if (!blueprintMatchPassesHardGate(blueprintMatch, intentPriorityScore)) {
      return null;
    }
    const matchScore = budgetAdjustedMatchScore(product);
    const aestheticScore = boundedScore(
      product.catalog_aesthetic_score ?? matchScore,
    );
    const brandQualityScore = boundedScore(
      product.brand_quality_score ?? BRAND_SCORE.C,
    );
    const visualQualityScore = boundedScore(
      product.commerce_visual_score ??
      product.visual_quality_score ??
      product.image_quality_score ?? 60,
    );
    const bodyStrategyScore = boundedScore(
      product.body_strategy_match_score ?? product.fit_score ?? 60,
    );
    const targetAssessment = product.aesthetic_target_assessment ||
      candidateAestheticTargetAssessment(
        product,
        group.requirement,
        aestheticTarget,
      );
    const legacyStyleMatch = product.style_match_score ?? styleMatchScore({
      evidence: productStyleEvidence(product, group.requirement),
      relevanceScore: matchScore,
      styleProfile,
      styleSemantics,
    });
    const styleMatch = aestheticTarget
      ? styleGateScore(targetAssessment, legacyStyleMatch)
      : boundedScore(legacyStyleMatch);
    if (shouldRejectForStyle({
      intentPriorityScore,
      styleMatch,
      enforce: enforceStyleThreshold,
    })) return null;
    const weatherMatch = boundedScore(product.weather_match_score ?? 70);
    const diversity = 100;
    const calibrated = calibratedProductScore({
      assessment: targetAssessment,
      relevanceScore: matchScore,
      blueprintMatchScore: blueprintMatch.score,
      aestheticScore,
      visualQualityScore,
      bodyStrategyScore,
      brandQualityScore: brandQualityScore,
      diversityScore: diversity,
      product,
    });
    return {
      ...product,
      match_score: matchScore,
      blueprint_match_score: blueprintMatch.score,
      matched_elements: blueprintMatch.matched_elements,
      conflict_elements: blueprintMatch.conflict_elements,
      aesthetic_target_assessment: targetAssessment,
      style_fit_score: targetAssessment.style_fit,
      occasion_fit_score: targetAssessment.occasion_fit,
      color_fit_score: targetAssessment.color_fit,
      silhouette_fit_score: targetAssessment.silhouette_fit,
      footwear_fit_score: targetAssessment.footwear_fit,
      quality_fit_score: targetAssessment.quality_fit,
      gender_fit_score: targetAssessment.gender_fit,
      style_match_score: styleMatch,
      weather_match_score: weatherMatch,
      aesthetic_score: aestheticScore,
      commerce_visual_score: visualQualityScore,
      body_strategy_match_score: bodyStrategyScore,
      brand_quality_score: brandQualityScore,
      diversity_score: diversity,
      final_score: calibrated.finalScore,
      ai_match_score: calibrated.finalScore,
      reranker_score_trace: calibrated.trace,
      ranking_reason: calibrated.trace.ranking_reason,
      recommendation_reason: appendBudgetNote(
        userFacingChineseText(
          product.recommendation_reason,
          "该商品与当前穿搭需求相匹配",
          240,
        ),
        product.budget_note,
      ),
      ai_rerank_fallback: true,
    };
  }).filter(Boolean));
}

function applyLabels(products) {
  if (products.length === 0) return products;
  const maxima = {
    value: Math.max(...products.map((product) => product.value_score)),
    fit: Math.max(...products.map((product) => product.fit_score)),
    coherence: Math.max(...products.map((product) => product.outfit_coherence_score)),
  };
  return products.map((product, index) => ({
    ...product,
    ai_label: index === 0
      ? "AI首选"
      : product.value_score === maxima.value
        ? "性价比"
        : product.fit_score === maxima.fit
          ? "更显比例"
          : product.outfit_coherence_score === maxima.coherence
            ? "最百搭"
            : "设计感",
  }));
}

function normalizeGroups(groups, selectionLimit, context = {}) {
  const limit = Math.min(
    positiveInteger(selectionLimit, DEFAULT_SELECTION_LIMIT),
    MAX_SELECTION_LIMIT,
  );
  const styleProfile = contextStyleProfile(context);
  const styleSemantics = contextStyleSemantics(context);
  const outfitBlueprint = contextOutfitBlueprint(context);
  const aestheticTarget = contextAestheticTarget(
    context,
    (Array.isArray(groups) ? groups : []).map((group) => group?.requirement),
  );
  const intentPriorityScore = resolveIntentPriorityScore(styleProfile);
  const enforceStyleThreshold = hasActionableStyleConstraints(styleProfile);
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const requirement = compactObject(group?.requirement || {});
    const assessedCandidates = Array.isArray(group?.candidates)
      ? group.candidates
        .filter((product) => semanticCategoryMatch(product, requirement))
        .flatMap((product) => {
          const assessment = blueprintMatchAssessment(
            product,
            requirement,
            outfitBlueprint,
          );
          return blueprintMatchPassesHardGate(
            assessment,
            intentPriorityScore,
          ) ? [{
            ...product,
            blueprint_match_score: assessment.score,
            matched_elements: assessment.matched_elements,
            conflict_elements: assessment.conflict_elements,
          }] : [];
        })
        .filter((product) => evaluateStyleGate(
          product,
          styleProfile,
          intentPriorityScore,
        ).allowed)
        .filter((product) => !productQualityBlock(product, requirement))
        .map((product) => {
          const assessed = {
            ...product,
            ...catalogAestheticAssessment(product, requirement),
            ...brandQualityAssessment(product),
          };
          const normalized = {...assessed, ...visualAssessmentDefaults(assessed)};
          const targetAssessment = candidateAestheticTargetAssessment(
            normalized,
            requirement,
            aestheticTarget,
          );
          const legacyStyleMatch = styleMatchScore({
            evidence: productStyleEvidence(normalized, requirement),
            relevanceScore: normalized.relevance_score,
            styleProfile,
            styleSemantics,
          });
          return {
            ...normalized,
            aesthetic_target_assessment: targetAssessment,
            style_fit_score: targetAssessment.style_fit,
            occasion_fit_score: targetAssessment.occasion_fit,
            color_fit_score: targetAssessment.color_fit,
            silhouette_fit_score: targetAssessment.silhouette_fit,
            footwear_fit_score: targetAssessment.footwear_fit,
            quality_fit_score: targetAssessment.quality_fit,
            gender_fit_score: targetAssessment.gender_fit,
            style_match_score: aestheticTarget
              ? styleGateScore(targetAssessment, legacyStyleMatch)
              : legacyStyleMatch,
          };
        })
        .filter((product) => !shouldRejectForStyle({
          intentPriorityScore,
          styleMatch: product.style_match_score,
          enforce: enforceStyleThreshold,
        }))
        .filter((product) => !isAestheticJunk(product))
      : [];
    const requiredMinimum = Math.min(4, assessedCandidates.length);
    const highQualityCount = assessedCandidates.filter((product) =>
      product.brand_quality_score >= HIGH_QUALITY_BRAND_SCORE).length;
    const brandFallback = highQualityCount < requiredMinimum;
    const candidates = assessedCandidates
      .map((product) => ({...product, brand_fallback: brandFallback}))
      .sort((left, right) => candidateQualityPrior(
        right,
        requirement,
        aestheticTarget,
      ) - candidateQualityPrior(left, requirement, aestheticTarget) ||
        String(left.product_id).localeCompare(String(right.product_id)))
      .slice(0, DEFAULT_VISUAL_CANDIDATES_PER_GROUP);
    return {
      requirement,
      candidates,
      selectionLimit: limit,
    };
  });
}

function limitCandidatesPerLook(groups) {
  const counts = new Map();
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const lookId = String(group?.requirement?.look_id || "default").trim() || "default";
    const used = counts.get(lookId) || 0;
    const remaining = Math.max(0, MAX_CANDIDATES_PER_LOOK - used);
    const candidates = (Array.isArray(group?.candidates) ? group.candidates : [])
      .slice(0, Math.min(DEFAULT_VISUAL_CANDIDATES_PER_GROUP, remaining));
    counts.set(lookId, used + candidates.length);
    return {...group, candidates};
  });
}

function remainingBudgetMs(deadlineAt) {
  const remaining = Number(deadlineAt) - Date.now();
  if (remaining <= 0) {
    const error = new Error("AI product selection time budget exhausted");
    error.code = "AI_RERANK_TIME_BUDGET";
    throw error;
  }
  return Math.max(1, remaining);
}

function candidateQualityPrior(product, requirement = {}, target = null) {
  const assessment = product.aesthetic_target_assessment ||
    candidateAestheticTargetAssessment(product, requirement, target);
  return calibratedProductScore({
    assessment,
    relevanceScore: product.relevance_score,
    blueprintMatchScore: product.blueprint_match_score ?? assessment.style_fit,
    bodyStrategyScore: product.body_strategy_match_score ?? product.fit_score ?? 60,
    aestheticScore: product.aesthetic_score ?? product.catalog_aesthetic_score,
    visualQualityScore: product.commerce_visual_score ?? product.visual_quality_score,
    brandQualityScore: product.brand_quality_score,
    product,
  }).finalScore;
}

function budgetAdjustedMatchScore(product) {
  const relevance = boundedScore(product?.relevance_score);
  const rawBudgetScore = Number(product?.budget_preference_score);
  if (!Number.isFinite(rawBudgetScore)) return relevance;
  return roundScore(relevance * 0.85 + boundedScore(rawBudgetScore) * 0.15);
}

function appendBudgetNote(reason, budgetNote) {
  const safeReason = safeText(reason, 240);
  const safeBudgetNote = safeText(budgetNote, 140);
  if (!safeBudgetNote) return safeReason;
  if (!safeReason) return safeBudgetNote;
  if (safeReason.includes(safeBudgetNote)) return safeReason;
  return safeText(`${safeReason} ${safeBudgetNote}`, 320);
}

function brandQualityAssessment(product) {
  const title = String(product?.title || "").trim();
  const brand = String(product?.brand || "").trim();
  const shop = String(product?.shop_name || "").trim();
  const evidence = [brand, shop, title].filter(Boolean);
  const matchedS = matchKnownBrand(evidence, BRAND_TIERS.S);
  if (matchedS) {
    return brandAssessmentResult(BRAND_SCORE.S, "S", matchedS, title);
  }
  const matchedA = matchKnownBrand(evidence, BRAND_TIERS.A);
  if (matchedA) {
    return brandAssessmentResult(BRAND_SCORE.A, "A", matchedA, title);
  }

  const normalizedBrand = normalizeComparisonText(brand);
  const normalizedShop = normalizeComparisonText(shop);
  const genericBrand = /^(?:其他|其它|无品牌|other|none|unknown|精选商品|精选商城)?$/.test(
    normalizedBrand,
  );
  const credibleOriginal = !genericBrand && Boolean(normalizedBrand) &&
    /官方|旗舰|天猫|专卖|原创|设计师|品牌/.test(`${shop}${title}`);
  if (credibleOriginal) {
    return brandAssessmentResult(BRAND_SCORE.B, "B", brand, title);
  }
  if (!genericBrand && normalizedBrand) {
    return brandAssessmentResult(45, "C", brand, title);
  }
  if (normalizedShop && /官方|旗舰|天猫|原创|设计师/.test(shop)) {
    return brandAssessmentResult(55, "C", shop, title);
  }
  return brandAssessmentResult(BRAND_SCORE.C, "C", "", title);
}

function brandAssessmentResult(scoreValue, tier, brandName, title) {
  const sameStyleMarketing = /同款/.test(String(title || ""));
  return {
    brand_quality_score: sameStyleMarketing
      ? Math.min(35, scoreValue)
      : scoreValue,
    brand_tier: sameStyleMarketing ? "C" : tier,
    brand_name: brandName,
  };
}

function matchKnownBrand(evidence, groups) {
  for (const aliases of groups) {
    for (const alias of aliases) {
      if (evidence.some((value) => hasBrandAlias(value, alias))) return aliases[0];
    }
  }
  return "";
}

function hasBrandAlias(value, alias) {
  const normalizedValue = normalizeComparisonText(value);
  const normalizedAlias = normalizeComparisonText(alias);
  if (!normalizedValue || !normalizedAlias) return false;
  if (normalizedAlias === "cos" || normalizedAlias === "apc") {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(value) ||
      normalizeComparisonText(String(value).split(/旗舰|官方|天猫|专卖/)[0]) === normalizedAlias;
  }
  return normalizedValue.includes(normalizedAlias);
}

function catalogAestheticAssessment(product, requirement = {}) {
  const title = String(product?.title || "").trim();
  const normalizedTitle = normalizeComparisonText(title);
  const brand = normalizeComparisonText(product?.brand);
  const shop = normalizeComparisonText(product?.shop_name);
  const materialDescription = normalizeComparisonText(
    product?.material || requirement.material,
  );
  const materialEvidence = `${materialDescription}${normalizedTitle}`;
  const imageUrl = String(product?.image_url || "").trim().toLowerCase();
  const imageQualityHint = String(product?.image_quality_hint || "").trim().toLowerCase();
  const price = Number(product?.price);
  const flags = [];
  let scoreValue = 50;

  if (hasExplicitBrand(product)) {
    scoreValue += 30;
  } else {
    scoreValue -= 20;
    flags.push("missing_brand");
  }

  const positiveTitleTerms = POSITIVE_TITLE_QUALITY_TERMS.filter((term) =>
    title.includes(term));
  if (positiveTitleTerms.length > 0) {
    scoreValue += Math.min(positiveTitleTerms.length * 5, 15);
  }
  if (shop.includes("旗舰店") || shop.includes("天猫") || shop.includes("官方")) {
    scoreValue += 8;
  } else if (shop) {
    scoreValue += 3;
  }

  if (STRONG_IMAGE_QUALITY_HINTS.has(imageQualityHint)) {
    scoreValue += 15;
  } else if (imageQualityHint === "promotion_poster" ||
      /(?:promo|poster|banner|activity|marketing|campaign|sale)[-_/.]/.test(imageUrl)) {
    scoreValue -= 30;
    flags.push("promotion_poster");
  } else if (/^https:\/\//.test(imageUrl) && /(?:alicdn|taobaocdn)\.com/.test(imageUrl)) {
    scoreValue += 8;
  } else if (/^https:\/\//.test(imageUrl)) {
    scoreValue += 3;
  } else {
    scoreValue -= 20;
    flags.push("weak_image_url");
  }
  if (/placeholder|noimage|default[-_]?image/.test(imageUrl)) {
    scoreValue -= 25;
    flags.push("placeholder_image");
  }

  if (title.length >= 8 && title.length <= 38) scoreValue += 8;
  if (title.length > 55 || repeatedBigramRatio(normalizedTitle) > 0.42) {
    scoreValue -= 18;
    flags.push("keyword_stuffing");
  }
  const negativeTitleTerms = NEGATIVE_TITLE_QUALITY_TERMS.filter((term) =>
    title.includes(term));
  if (negativeTitleTerms.length > 0 ||
      /网红|特价|买一送一|全网最低|厂家直销/.test(title)) {
    scoreValue -= 30;
    flags.push("low_end_marketing");
  }
  if (/羊毛|羊绒|真丝|桑蚕丝|亚麻|纯棉|牛皮|头层皮|精纺|醋酸/.test(materialEvidence)) {
    scoreValue += 10;
  } else if (!materialDescription) {
    scoreValue -= 8;
    flags.push("missing_material");
  }
  if (/廓形|垂感|剪裁|肌理|提花|立体|极简|复古|设计感|cleanfit/.test(normalizedTitle)) {
    scoreValue += 7;
  }

  const dressPreference = femaleDressPreference(requirement);
  if (requirement.category === "dress" && dressPreference.applies) {
    if (DRESS_DESIGN_DETAIL_PATTERN.test(title)) {
      scoreValue += 18;
      flags.push("feminine_dress_design_detail");
    } else if (BASIC_DRESS_PATTERN.test(title)) {
      scoreValue -= 35;
      flags.push("generic_basic_dress");
    }
  }

  const minimumPrice = {
    top: 35,
    bottom: 45,
    shoes: 60,
    outerwear: 80,
    dress: 60,
    bag: 50,
  }[requirement.category] || 25;
  if (Number.isFinite(price) && price > 0 && price < minimumPrice * 0.55) {
    scoreValue -= 18;
    flags.push("suspiciously_low_price");
  } else if (Number.isFinite(price) && price > 0 && price < minimumPrice) {
    scoreValue -= 7;
    flags.push("low_price");
  }

  const aestheticScore = roundScore(boundedScore(scoreValue));
  return {
    catalog_aesthetic_score: aestheticScore,
    aesthetic_score: aestheticScore,
    aesthetic_quality_flags: flags,
  };
}

function femaleDressPreference(requirement = {}) {
  const gender = String(requirement.gender || "").toLowerCase();
  const evidence = [
    requirement.style,
    requirement.scene,
    requirement.item_name,
    requirement.product_type,
    requirement.style_role,
    requirement.design_elements,
    requirement.preferred_attributes,
  ].flat().filter(Boolean).join(" ");
  const explicitlyNeutral = /中性|男女同款|男女通用|无性别|unisex|neutral/i.test(evidence);
  return Object.freeze({
    applies: gender === "female" && !explicitlyNeutral &&
      FEMININE_DRESS_SCENE_PATTERN.test(evidence),
  });
}

function hasExplicitBrand(product) {
  const brand = normalizeComparisonText(product?.brand);
  if (!brand || /^(?:其他|其它|无品牌|other|none|unknown|精选商品|精选商家)$/.test(brand)) {
    return false;
  }
  return true;
}

function isAestheticJunk(product) {
  const scoreValue = boundedScore(
    product?.aesthetic_score ?? product?.catalog_aesthetic_score,
  );
  const flags = new Set(Array.isArray(product?.aesthetic_quality_flags)
    ? product.aesthetic_quality_flags
    : []);
  if (scoreValue <= 10) return true;
  return scoreValue < 40 && [
    "promotion_poster",
    "low_end_marketing",
    "keyword_stuffing",
    "placeholder_image",
  ].some((flag) => flags.has(flag));
}

function repeatedBigramRatio(value) {
  const chars = [...String(value || "")];
  if (chars.length < 12) return 0;
  const sequence = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    sequence.push(`${chars[index]}${chars[index + 1]}`);
  }
  return 1 - new Set(sequence).size / sequence.length;
}

function collectQualityBlocks(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.candidates) ? group.candidates : [])
      .map((product) => productQualityBlock(product, group?.requirement || {}))
      .filter(Boolean));
}

function buildCacheKey(groups, context) {
  const normalizedContext = stripRequestIds(compactObject(context));
  const key = JSON.stringify({
    context: normalizedContext,
    groups: groups.map((group) => ({
      requirement: group.requirement,
      candidates: group.candidates.map((product) => ({
        product_id: product.product_id,
        title: product.title,
        image_url: product.image_url,
        price: product.price,
        brand: product.brand,
        brand_quality_score: product.brand_quality_score,
        relevance_score: product.relevance_score,
        body_strategy_match_score: product.body_strategy_match_score,
        style_fit_score: product.style_fit_score,
        aesthetic_target_assessment: product.aesthetic_target_assessment,
        product_acceptance_result: product.product_acceptance_result,
        product_acceptance_penalty: product.product_acceptance_penalty,
        product_acceptance_evidence: product.product_acceptance_evidence,
        candidate_enrichment: product.candidate_enrichment,
      })),
    })),
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

function stripRequestIds(value) {
  if (Array.isArray(value)) return value.map(stripRequestIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "requestId" && key !== "request_id")
    .map(([key, item]) => [key, stripRequestIds(item)]));
}

function parseJsonResponse(text) {
  const normalized = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

function extractText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
  }
  return "";
}

function compactProfile(value) {
  return pickFields(value, [
    "gender", "age", "height", "weight", "body_type", "bodyType",
    "skin_tone", "skinTone", "body_profile", "bodyProfile", "proportions",
  ]);
}

function pickFields(value, fields) {
  const source = compactObject(value);
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== undefined && item !== null && item !== ""));
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? roundScore(number)
    : null;
}

function roundScore(value) {
  return Math.round(Number(value) * 10) / 10;
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function userFacingChineseText(value, fallback, maxLength) {
  const text = safeText(value, maxLength);
  return /[\u3400-\u9fff]/u.test(text) ? text : fallback;
}

function safeErrorCode(error) {
  const code = String(error?.code || error?.message || "AI_RERANK_FAILED");
  return /^[A-Z0-9_.-]{3,80}$/i.test(code) ? code : "AI_RERANK_FAILED";
}

function classifyRerankerFailure(error) {
  const reasonCode = safeErrorCode(error);
  const evidence = `${reasonCode} ${String(error?.name || "")} ${String(
    error?.message || "",
  )}`.toLowerCase();
  let category = "OTHER";
  if (/timeout|timed out|aborted|etimedout|deadline/u.test(evidence)) {
    category = "TIMEOUT";
  } else if (/json|parse|syntax|schema|validation|invalid.*response|response.*invalid/u.test(evidence)) {
    category = "SCHEMA_OR_RESPONSE_VALIDATION";
  } else if (/image|vision|fetch.*image|unsupported.*media/u.test(evidence)) {
    category = "IMAGE_OR_VISION";
  } else if (/model|not.?found|unsupported.?model/u.test(evidence)) {
    category = "MODEL";
  } else if (/api.?key|auth|permission|unauthorized|forbidden|401|403/u.test(evidence)) {
    category = "API_AUTH_OR_PERMISSION";
  } else if (/connect|network|econn|dns|socket|fetch/u.test(evidence)) {
    category = "NETWORK";
  }
  return Object.freeze({reasonCode, category});
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cloneProducts(products) {
  return products.map((product) => ({...product}));
}

function cloneTrace(trace) {
  if (!trace || typeof trace !== "object") return null;
  return JSON.parse(JSON.stringify(trace));
}

module.exports = {
  CALIBRATED_PRODUCT_WEIGHTS,
  ProductAestheticReranker,
  RERANKER_CALIBRATION_VERSION,
  applyVisualAssessments,
  applyDiversityScores,
  applyLabels,
  brandQualityAssessment,
  buildAdjudicationMessages,
  buildDeterministicGroups,
  buildMessages,
  buildVisualBatch,
  buildVisualQualityMessages,
  calibratedProductScore,
  classifyRerankerFailure,
  candidateAestheticTargetAssessment,
  catalogAestheticAssessment,
  compositeProductScore,
  ruleFallback,
  validateAdjudicationResponse,
  validateSelection,
};
