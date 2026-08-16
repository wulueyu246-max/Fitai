"use strict";

const crypto = require("node:crypto");

const {
  normalizeGender,
  normalizeProductCategory,
  semanticCategoryMatch,
} = require("./product_relevance");

const CORE_CATEGORIES = Object.freeze(["top", "bottom", "shoes"]);
const CATEGORY_LABELS = Object.freeze({
  top: "上衣",
  bottom: "下装",
  shoes: "鞋",
});
const SELECTOR_STATUS = Object.freeze({
  KEEP: "KEEP",
  REJECT: "REJECT",
  UNCERTAIN: "UNCERTAIN",
});
const SELECTION_TIER = Object.freeze({
  HIGH: "HIGH",
  NORMAL: "NORMAL",
  NONE: "NONE",
});
const POOL_HOMOGENEITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});
const MAX_VALID_CANDIDATES_PER_SLOT = 10;
const MAX_SELECTED_CANDIDATES_PER_SLOT = 3;
const MAX_REFINEMENT_ROUNDS = 1;
const SELECTOR_RECOMMENDABLE_SCORE = 75;
const PRICE_POSITION = Object.freeze({
  UNKNOWN: "UNKNOWN",
  BELOW_MEDIAN: "BELOW_MEDIAN",
  TYPICAL: "TYPICAL",
  UPPER_QUARTILE: "UPPER_QUARTILE",
  OUTLIER_HIGH: "PRICE_OUTLIER_HIGH",
});
const DEFAULT_TAOBAO_SLOT_TIMEOUT_MS = 25_000;
const DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS = 30_000;

const STRING_ARRAY_SCHEMA = Object.freeze({
  type: "array",
  items: {type: "string"},
});

const SHOPPING_PLAN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    shopping_intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        gender: {type: "string", enum: ["female", "male", "unisex"]},
        persona: {
          type: "object",
          additionalProperties: false,
          properties: {
            expression: {type: "string"},
            maturity: {type: "string"},
          },
          required: ["expression", "maturity"],
        },
        overall_aesthetic: {
          type: "object",
          additionalProperties: false,
          properties: {
            core_direction: {type: "string"},
            traits: STRING_ARRAY_SCHEMA,
            anti_drift: STRING_ARRAY_SCHEMA,
          },
          required: ["core_direction", "traits", "anti_drift"],
        },
        body_strategy: {
          type: "object",
          additionalProperties: false,
          properties: {
            goals: STRING_ARRAY_SCHEMA,
            hard_constraints: STRING_ARRAY_SCHEMA,
            soft_tactics: STRING_ARRAY_SCHEMA,
          },
          required: ["goals", "hard_constraints", "soft_tactics"],
        },
        occasion: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {type: "string"},
            formality: {type: "string"},
          },
          required: ["type", "formality"],
        },
        weather_constraints: {
          type: "object",
          additionalProperties: false,
          properties: {
            material: STRING_ARRAY_SCHEMA,
            thickness: {type: "string"},
            comfort: STRING_ARRAY_SCHEMA,
            safety: STRING_ARRAY_SCHEMA,
          },
          required: ["material", "thickness", "comfort", "safety"],
        },
        slots: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: {type: "string", enum: CORE_CATEGORIES},
              role: {type: "string"},
              hard_constraints: STRING_ARRAY_SCHEMA,
              soft_preferences: STRING_ARRAY_SCHEMA,
              avoid: STRING_ARRAY_SCHEMA,
              search_query: {type: "string"},
            },
            required: [
              "category",
              "role",
              "hard_constraints",
              "soft_preferences",
              "avoid",
              "search_query",
            ],
          },
        },
      },
      required: [
        "gender",
        "persona",
        "overall_aesthetic",
        "body_strategy",
        "occasion",
        "weather_constraints",
        "slots",
      ],
    },
  },
  required: ["shopping_intent"],
});

const SCORE_PROPERTIES = Object.freeze({
  category_fit: {type: "number", minimum: 0, maximum: 100},
  aesthetic_fit: {type: "number", minimum: 0, maximum: 100},
  persona_fit: {type: "number", minimum: 0, maximum: 100},
  silhouette_fit: {type: "number", minimum: 0, maximum: 100},
  outfit_potential: {type: "number", minimum: 0, maximum: 100},
  aesthetic_distinctiveness: {type: "number", minimum: 0, maximum: 100},
  quality_perception: {type: "number", minimum: 0, maximum: 100},
  age_appropriateness: {type: "number", minimum: 0, maximum: 100},
  styling_value: {type: "number", minimum: 0, maximum: 100},
});

const PRODUCT_SELECTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    assessments: {
      type: "array",
      minItems: 1,
      maxItems: MAX_VALID_CANDIDATES_PER_SLOT,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidate_id: {type: "string"},
          status: {
            type: "string",
            enum: Object.values(SELECTOR_STATUS),
          },
          selection_tier: {
            type: "string",
            enum: Object.values(SELECTION_TIER),
          },
          scores: {
            type: "object",
            additionalProperties: false,
            properties: SCORE_PROPERTIES,
            required: Object.keys(SCORE_PROPERTIES),
          },
          reason_codes: STRING_ARRAY_SCHEMA,
        },
        required: [
          "candidate_id",
          "status",
          "selection_tier",
          "scores",
          "reason_codes",
        ],
      },
    },
    quality_sufficient: {type: "boolean"},
    refinement_needed: {type: "boolean"},
    refinement_reasons: STRING_ARRAY_SCHEMA,
    candidate_pool_homogeneity: {
      type: "string",
      enum: Object.values(POOL_HOMOGENEITY),
    },
    refinement_query: {type: "string"},
  },
  required: [
    "assessments",
    "quality_sufficient",
    "refinement_needed",
    "refinement_reasons",
    "candidate_pool_homogeneity",
    "refinement_query",
  ],
});

const COMPOSER_SCORE_PROPERTIES = Object.freeze({
  aesthetic_coherence: {type: "number", minimum: 0, maximum: 100},
  proportion_balance: {type: "number", minimum: 0, maximum: 100},
  color_harmony: {type: "number", minimum: 0, maximum: 100},
  material_harmony: {type: "number", minimum: 0, maximum: 100},
  visual_hierarchy: {type: "number", minimum: 0, maximum: 100},
  style_story: {type: "number", minimum: 0, maximum: 100},
  distinctiveness: {type: "number", minimum: 0, maximum: 100},
  persona_fit: {type: "number", minimum: 0, maximum: 100},
  body_proportion: {type: "number", minimum: 0, maximum: 100},
  occasion_fit: {type: "number", minimum: 0, maximum: 100},
  weather_fit: {type: "number", minimum: 0, maximum: 100},
  value_coherence: {type: "number", minimum: 0, maximum: 100},
  cross_look_distinctiveness: {type: "number", minimum: 0, maximum: 100},
  final_score: {type: "number", minimum: 0, maximum: 100},
});

const OUTFIT_COMPOSITION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    looks: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          look_id: {type: "string"},
          top_candidate_id: {type: "string"},
          bottom_candidate_id: {type: "string"},
          shoes_candidate_id: {type: "string"},
          scores: {
            type: "object",
            additionalProperties: false,
            properties: COMPOSER_SCORE_PROPERTIES,
            required: Object.keys(COMPOSER_SCORE_PROPERTIES),
          },
        },
        required: [
          "look_id",
          "top_candidate_id",
          "bottom_candidate_id",
          "shoes_candidate_id",
          "scores",
        ],
      },
    },
  },
  required: ["looks"],
});

class ShoppingAgentV1Error extends Error {
  constructor(message, {code = "SHOPPING_AGENT_V1_FAILED", status = 502, details} = {}) {
    super(message);
    this.name = "ShoppingAgentV1Error";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

class TaobaoShoppingAgentV1 {
  constructor({
    client,
    model,
    productProvider,
    fashionBrain = null,
    logger = console,
    plannerTimeoutMs = 45_000,
    selectorTimeoutMs = 45_000,
    composerTimeoutMs = 45_000,
    taobaoSlotTimeoutMs = DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
    taobaoRetrievalTimeoutMs = DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
  } = {}) {
    this.client = client || null;
    this.model = text(model, 120);
    this.productProvider = productProvider || null;
    this.fashionBrain = fashionBrain;
    this.logger = logger;
    this.plannerTimeoutMs = positiveInteger(plannerTimeoutMs, 45_000);
    this.selectorTimeoutMs = positiveInteger(selectorTimeoutMs, 45_000);
    this.composerTimeoutMs = positiveInteger(composerTimeoutMs, 45_000);
    this.taobaoSlotTimeoutMs = Math.min(
      positiveInteger(taobaoSlotTimeoutMs, DEFAULT_TAOBAO_SLOT_TIMEOUT_MS),
      DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
    );
    this.taobaoRetrievalTimeoutMs = Math.min(
      Math.max(
        positiveInteger(
          taobaoRetrievalTimeoutMs,
          DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
        ),
        this.taobaoSlotTimeoutMs + 1_000,
      ),
      DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
    );
  }

  get configured() {
    return Boolean(
      this.client &&
      this.model &&
      this.productProvider &&
      typeof this.productProvider.searchShoppingAgentCandidates === "function",
    );
  }

  async run(input = {}) {
    if (!this.configured) {
      throw new ShoppingAgentV1Error("Shopping Agent V1 未完整配置", {
        code: "SHOPPING_AGENT_V1_NOT_CONFIGURED",
        status: 503,
      });
    }
    const startedAt = Date.now();
    const normalizedInput = normalizeAgentInput(input);
    const requestId = normalizedInput.request_id;
    const metrics = {
      ai_call_count: 0,
      taobao_call_count: 0,
      ai_calls: [],
    };

    const planning = await this.#aiCall({
      phase: "shopping_intent_search_plan",
      schemaName: "fitai_shopping_agent_v1_plan",
      schema: SHOPPING_PLAN_SCHEMA,
      timeoutMs: this.plannerTimeoutMs,
      metrics,
      messages: buildPlannerMessages(
        normalizedInput,
        this.#fashionKnowledge(normalizedInput),
      ),
    });
    const shoppingIntent = normalizeShoppingIntent(
      planning.shopping_intent,
      normalizedInput,
    );
    this.logger.info?.("shopping_agent_v1_intent", {
      request_id: requestId,
      shopping_intent: shoppingIntent,
      search_queries: Object.fromEntries(shoppingIntent.slots.map((slot) => [
        slot.category,
        slot.search_query,
      ])),
    });

    let candidateCounter = 0;
    const retrieveSlot = async ({slot, query, round = 1, exclude = []}) => {
      metrics.taobao_call_count += 1;
      const slotKey = `${requestId}:shopping-agent-v1:${slot.category}` +
        (round > 1 ? `:refinement-${round - 1}` : "");
      const slotStartedAt = Date.now();
      const controller = new AbortController();
      let timeoutId;
      let result;
      let attempts = 0;
      try {
        result = await Promise.race([
          this.productProvider.searchShoppingAgentCandidates({
            query,
            category: slot.category,
            gender: shoppingIntent.gender,
            requestId,
            limit: 30,
            signal: controller.signal,
            onAttempt: (attempt) => {
              attempts = Math.max(attempts, Number(attempt || 0));
            },
          }),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              controller.abort();
              const error = new Error("Taobao slot retrieval timed out");
              error.code = "TAOBAO_SLOT_TIMEOUT";
              reject(error);
            }, this.taobaoSlotTimeoutMs);
            timeoutId.unref?.();
          }),
        ]);
      } catch (error) {
        const errorCode = classifyTaobaoRetrievalError(error, controller.signal.aborted);
        throw new ShoppingAgentV1Error(`${slot.category} 真实淘宝候选召回失败`, {
          code: errorCode,
          details: {
            slot_key: slotKey,
            category: slot.category,
            query,
            round,
            start_time: new Date(slotStartedAt).toISOString(),
            end_time: new Date().toISOString(),
            elapsed_ms: Date.now() - slotStartedAt,
            attempts: Number(error?.attempts || attempts || 0),
            status: "FAILED",
            error_code: errorCode,
            cause_code: taobaoCauseCode(error) || null,
            raw_candidate_count: 0,
          },
        });
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      const rawProducts = Array.isArray(result) ? result : result?.products || [];
      const excludedIdentities = new Set(exclude.map(productIdentity));
      const assessments = rawProducts.map((product) => ({
        product,
        gate: hardGateCandidate(product, slot, shoppingIntent),
      }));
      const gatedCandidates = assessments
        .filter(({product, gate}) =>
          gate.status === "PASS" && !excludedIdentities.has(productIdentity(product)))
        .slice(0, MAX_VALID_CANDIDATES_PER_SLOT)
        .map(({product, gate}) => ({
          ...product,
          candidate_id: neutralCandidateId(++candidateCounter),
          candidate_gate_status: gate.status,
          candidate_gate_reasons: gate.reason_codes,
        }));
      const priceContext = buildPriceContext(gatedCandidates);
      const passed = gatedCandidates.map((candidate) => enrichCandidatePriceContext(
        candidate,
        priceContext,
        shoppingIntent.budget,
      ));
      const retrieval = {
        slot,
        slot_key: slotKey,
        start_time: new Date(slotStartedAt).toISOString(),
        end_time: new Date().toISOString(),
        elapsed_ms: Date.now() - slotStartedAt,
        attempts: Number(result?.attempts || attempts || 1),
        status: "SUCCESS",
        error_code: null,
        round,
        query,
        raw_count: Number(result?.raw_count ?? rawProducts.length),
        valid_count: Number(result?.valid_count ?? rawProducts.length),
        candidate_gate_pass: assessments.filter(({gate}) => gate.status === "PASS").length,
        candidate_gate_fail: assessments.filter(({gate}) => gate.status === "FAIL").length,
        price_context: priceContext,
        candidates: passed,
      };
      this.logger.info?.("shopping_agent_v1_candidate_gate", {
        request_id: requestId,
        category: slot.category,
        round,
        search_query: query,
        raw_candidate_count: retrieval.raw_count,
        valid_candidate_count: retrieval.valid_count,
        candidate_gate_pass: retrieval.candidate_gate_pass,
        candidate_gate_fail: retrieval.candidate_gate_fail,
        evidence_candidate_ids: passed.map((candidate) => candidate.candidate_id),
      });
      return retrieval;
    };
    const retrievalTasks = shoppingIntent.slots.map((slot) => retrieveSlot({
      slot,
      query: slot.search_query,
    }));
    const settledRetrievals = await Promise.allSettled(retrievalTasks);
    const retrievals = [];
    const retrievalFailures = [];
    for (const [index, settled] of settledRetrievals.entries()) {
      const slot = shoppingIntent.slots[index];
      if (settled.status === "fulfilled") {
        retrievals.push(settled.value);
        this.logger.info?.("shopping_agent_v1_taobao_slot", {
          request_id: requestId,
          slot_key: settled.value.slot_key,
          category: slot.category,
          query: slot.search_query,
          start_time: settled.value.start_time,
          end_time: settled.value.end_time,
          elapsed_ms: settled.value.elapsed_ms,
          attempts: settled.value.attempts,
          status: settled.value.status,
          error_code: settled.value.error_code,
          raw_candidate_count: settled.value.raw_count,
        });
      } else {
        const details = settled.reason?.details || {
          slot_key: `${requestId}:shopping-agent-v1:${slot.category}`,
          category: slot.category,
          query: slot.search_query,
          start_time: null,
          end_time: null,
          elapsed_ms: null,
          attempts: 0,
          status: "FAILED",
          error_code: classifyTaobaoRetrievalError(settled.reason),
          raw_candidate_count: 0,
        };
        retrievalFailures.push(details);
        this.logger.warn?.("shopping_agent_v1_taobao_slot", {
          request_id: requestId,
          ...details,
        });
      }
    }

    if (retrievalFailures.length > 0) {
      const successfulByCategory = Object.fromEntries(retrievals.map((retrieval) => [
        retrieval.slot.category,
        retrieval.candidates.map(publicCandidate),
      ]));
      return {
        request_id: requestId,
        source: "taobao_shopping_agent_v1",
        state: "retryable",
        reason: "PARTIAL_TAOBAO_RETRIEVAL",
        authoritative_gender: shoppingIntent.gender,
        shopping_intent: shoppingIntent,
        search_queries: Object.fromEntries(shoppingIntent.slots.map((slot) => [
          slot.category,
          slot.search_query,
        ])),
        retrieval_budget_ms: this.taobaoRetrievalTimeoutMs,
        slot_timeout_ms: this.taobaoSlotTimeoutMs,
        failed_slots: retrievalFailures,
        retrieved_candidates: successfulByCategory,
        slot_metrics: shoppingIntent.slots.map((slot) => {
          const success = retrievals.find((item) => item.slot.category === slot.category);
          const failure = retrievalFailures.find((item) => item.category === slot.category);
          return success ? retrievalMetric(success) : failure;
        }),
        candidate_pools: {},
        composer_candidate_ids: [],
        invalid_candidate_reference: [],
        looks: [],
        final_look_count: 0,
        ai_call_count: metrics.ai_call_count,
        taobao_call_count: metrics.taobao_call_count,
        timings: {
          ai_calls: metrics.ai_calls,
          total_ms: Date.now() - startedAt,
        },
      };
    }

    for (const group of retrievals) {
      if (group.candidates.length === 0) {
        throw new ShoppingAgentV1Error(
          `${group.slot.category} 没有通过核心 Gate 的真实淘宝候选`,
          {
            code: "SHOPPING_AGENT_NO_HARD_GATE_CANDIDATES",
            details: {category: group.slot.category},
          },
        );
      }
    }

    const selectGroup = async (group, {round = 1} = {}) => {
      const payload = await this.#aiCall({
        phase: `product_selector_${group.slot.category}` +
          (round > 1 ? `_refinement_${round - 1}` : ""),
        schemaName: `fitai_product_selector_${group.slot.category}` +
          (round > 1 ? `_refinement_${round - 1}` : ""),
        schema: PRODUCT_SELECTION_SCHEMA,
        timeoutMs: this.selectorTimeoutMs,
        metrics,
        messages: buildSelectorMessages(shoppingIntent, group, {round}),
      });
      const initialQuery = group.query || group.slot.search_query;
      let normalized;
      try {
        normalized = validateProductSelection(payload, group.candidates, {
          slot: group.slot,
          gender: shoppingIntent.gender,
          originalQuery: initialQuery,
        });
        this.logger.info?.("shopping_agent_v1_refinement_query_validation", {
          request_id: requestId,
          slot_key: group.slot_key,
          initial_query: initialQuery,
          refinement_query: normalized.refinement_query,
          canonical_category: normalized.refinement_query
            ? normalizeProductCategory(normalized.refinement_query)
            : null,
          validation_status: normalized.refinement_query ? "PASS" : "NOT_REQUIRED",
          validation_error_kind: null,
        });
      } catch (error) {
        const validationErrorKind = error?.schema_error_kind || "INVALID_STRUCTURE";
        if (!String(validationErrorKind).startsWith("REFINEMENT_QUERY_")) throw error;
        const refinementQuery = text(payload?.refinement_query, 80);
        this.logger.warn?.("shopping_agent_v1_refinement_query_validation", {
          request_id: requestId,
          slot_key: group.slot_key,
          initial_query: initialQuery,
          refinement_query: refinementQuery,
          canonical_category: refinementQuery
            ? normalizeProductCategory(refinementQuery)
            : null,
          validation_status: "FAIL",
          validation_error_kind: validationErrorKind,
        });
        throw error;
      }
      const pool = selectFinalCandidatePool(group.candidates, normalized.assessments);
      if (pool.length === 0) {
        throw new ShoppingAgentV1Error(
          `${group.slot.category} 经 AI 真实图片选择后没有可用候选`,
          {
            code: "SHOPPING_AGENT_SELECTOR_EMPTY",
            details: {category: group.slot.category},
          },
        );
      }
      const selection = {
        ...group,
        round,
        selector_keep: normalized.assessments.filter((item) =>
          item.status === SELECTOR_STATUS.KEEP).length,
        selector_reject: normalized.assessments.filter((item) =>
          item.status === SELECTOR_STATUS.REJECT).length,
        selector_uncertain: normalized.assessments.filter((item) =>
          item.status === SELECTOR_STATUS.UNCERTAIN).length,
        quality_sufficient: normalized.quality_sufficient,
        refinement_needed: normalized.refinement_needed,
        refinement_reasons: normalized.refinement_reasons,
        refinement_query: normalized.refinement_query,
        candidate_pool_homogeneity: normalized.candidate_pool_homogeneity,
        top_candidate_quality: topSelectorQuality(normalized.assessments),
        assessments: normalized.assessments,
        final_candidate_pool: pool,
        diversity: candidatePoolDiversity(pool, group.slot.category),
      };
      this.logger.info?.("shopping_agent_v1_product_selector", {
        request_id: requestId,
        category: group.slot.category,
        round,
        selector_keep: selection.selector_keep,
        selector_reject: selection.selector_reject,
        selector_uncertain: selection.selector_uncertain,
        quality_sufficient: selection.quality_sufficient,
        refinement_needed: selection.refinement_needed,
        refinement_reasons: selection.refinement_reasons,
        refinement_query: selection.refinement_query,
        candidate_pool_homogeneity: selection.candidate_pool_homogeneity,
        top_candidate_quality: selection.top_candidate_quality,
        price_context: selection.price_context,
        diversity: selection.diversity,
        final_candidate_pool: pool.map((candidate) => candidate.candidate_id),
      });
      return selection;
    };
    const firstRoundSelections = await Promise.all(retrievals.map((group) =>
      selectGroup(group)));

    const refinementPlans = firstRoundSelections.map((selection) => ({
      selection,
      decision: refinementDecision(selection),
    })).filter(({decision}) => decision.needed);
    const refinementResults = await Promise.all(refinementPlans.map(async ({
      selection,
      decision,
    }) => {
      let retrieval;
      try {
        retrieval = await retrieveSlot({
          slot: selection.slot,
          query: decision.query,
          round: 2,
          exclude: selection.candidates,
        });
        this.logger.info?.("shopping_agent_v1_refinement_retrieval", {
          request_id: requestId,
          category: selection.slot.category,
          first_query: selection.query || selection.slot.search_query,
          refinement_query: decision.query,
          refinement_reasons: decision.reasons,
          raw_candidate_count: retrieval.raw_count,
          candidate_gate_pass: retrieval.candidate_gate_pass,
          elapsed_ms: retrieval.elapsed_ms,
          status: "SUCCESS",
        });
      } catch (error) {
        const errorCode = classifyTaobaoRetrievalError(error);
        const causeCode = taobaoCauseCode(error) || null;
        const hasFirstRoundCandidates = selection.final_candidate_pool.length > 0;
        const refinementFallbackUsed = errorCode === "TAOBAO_NETWORK_ERROR" &&
          hasFirstRoundCandidates;
        this.logger.warn?.("shopping_agent_v1_refinement_retrieval", {
          request_id: requestId,
          category: selection.slot.category,
          first_query: selection.query || selection.slot.search_query,
          refinement_query: decision.query,
          refinement_reasons: decision.reasons,
          status: refinementFallbackUsed ? "failed_fallback" : "FAILED",
          error_code: errorCode,
          cause_code: causeCode,
          refinement_fallback_used: refinementFallbackUsed,
        });
        if (errorCode === "TAOBAO_NETWORK_ERROR" && !hasFirstRoundCandidates) {
          throw error;
        }
        return {
          category: selection.slot.category,
          selection,
          decision,
          retrieval: null,
          errorCode,
          causeCode,
          refinementFallbackUsed,
        };
      }
      if (retrieval.candidates.length === 0) {
        return {category: selection.slot.category, selection, decision, retrieval};
      }
      const refinedSelection = await selectGroup(retrieval, {round: 2});
      return {
        category: selection.slot.category,
        selection,
        decision,
        retrieval,
        refinedSelection,
      };
    }));
    const refinementByCategory = new Map(refinementResults.map((result) => [
      result.category,
      result,
    ]));
    const selections = firstRoundSelections.map((selection) => {
      const refinement = refinementByCategory.get(selection.slot.category);
      if (!refinement?.refinedSelection) {
        const status = refinement
          ? refinement.refinementFallbackUsed
            ? "failed_fallback"
            : refinement.retrieval
              ? "NO_NEW_CANDIDATES"
              : "FAILED"
          : "NOT_NEEDED";
        return {
          ...selection,
          refinement: refinement ? {
            triggered: true,
            status,
            refinement_status: status,
            refinement_attempted: true,
            refinement_succeeded: false,
            refinement_fallback_used: refinement.refinementFallbackUsed === true,
            refinement_error_code: refinement.errorCode || null,
            refinement_cause_code: refinement.causeCode || null,
            first_query: selection.query || selection.slot.search_query,
            second_query: refinement.decision.query,
            reasons: refinement.decision.reasons,
            rounds: [selectorRoundMetric(selection)],
          } : {
            triggered: false,
            status: "NOT_NEEDED",
            refinement_status: "NOT_NEEDED",
            refinement_attempted: false,
            refinement_succeeded: false,
            refinement_fallback_used: false,
            refinement_error_code: null,
            refinement_cause_code: null,
            first_query: selection.query || selection.slot.search_query,
            second_query: null,
            reasons: [],
            rounds: [selectorRoundMetric(selection)],
          },
        };
      }
      return mergeSelectionRounds(selection, refinement.refinedSelection, {
        decision: refinement.decision,
      });
    });

    const composition = await this.#aiCall({
      phase: "real_product_outfit_composer",
      schemaName: "fitai_real_product_outfit_composer",
      schema: OUTFIT_COMPOSITION_SCHEMA,
      responseFormatType: "json_object",
      timeoutMs: this.composerTimeoutMs,
      metrics,
      messages: buildComposerMessages(shoppingIntent, selections),
    });
    const validatedLooks = validateComposedLooks(composition, selections, {
      onScoreError: (diagnostic) => {
        this.logger.warn?.("COMPOSER_SCORE_INVALID", {
          request_id: requestId,
          ...diagnostic,
        });
      },
    });
    for (const audit of validatedLooks.candidate_reference_audit) {
      if (audit.error_code === "COMPOSER_INVALID_CANDIDATE_REFERENCE") {
        this.logger.warn?.("COMPOSER_INVALID_CANDIDATE_REFERENCE", {
          request_id: requestId,
          ...audit,
        });
      }
    }
    this.logger.info?.("shopping_agent_v1_composer", {
      request_id: requestId,
      composer_candidate_ids: validatedLooks.composer_candidate_ids,
      invalid_candidate_reference: validatedLooks.invalid_candidate_reference,
      candidate_reference_audit: validatedLooks.candidate_reference_audit,
      structural_duplicate: validatedLooks.structural_duplicate,
      diversity_insufficient: validatedLooks.diversity_insufficient,
      final_look_count: validatedLooks.looks.length,
    });
    if (validatedLooks.looks.length < 2) {
      throw new ShoppingAgentV1Error("真实候选不足以组成两套有效 Look", {
        code: "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
        details: {
          invalid_candidate_reference: validatedLooks.invalid_candidate_reference,
          structural_duplicate: validatedLooks.structural_duplicate,
          diversity_insufficient: validatedLooks.diversity_insufficient,
        },
      });
    }

    const slotMetrics = selections.map((selection) => ({
      ...retrievalMetric(selection),
      selector_keep: selection.selector_keep,
      selector_reject: selection.selector_reject,
      selector_uncertain: selection.selector_uncertain,
      selector_high: selection.assessments.filter((item) =>
        item.status === SELECTOR_STATUS.KEEP &&
        item.selection_tier === SELECTION_TIER.HIGH).length,
      selector_normal: selection.assessments.filter((item) =>
        item.status === SELECTOR_STATUS.KEEP &&
        item.selection_tier === SELECTION_TIER.NORMAL).length,
      candidate_pool_homogeneity: selection.candidate_pool_homogeneity,
      price_context: selection.price_context,
      diversity: selection.diversity,
      top_candidate_quality: selection.top_candidate_quality,
      refinement_status: selection.refinement.refinement_status,
      refinement_attempted: selection.refinement.refinement_attempted,
      refinement_succeeded: selection.refinement.refinement_succeeded,
      refinement_fallback_used: selection.refinement.refinement_fallback_used,
      refinement_error_code: selection.refinement.refinement_error_code,
      refinement: selection.refinement,
      final_candidate_pool: selection.final_candidate_pool.map((product) =>
        product.candidate_id),
    }));
    const response = {
      request_id: requestId,
      source: "taobao_shopping_agent_v1",
      state: "success",
      authoritative_gender: shoppingIntent.gender,
      shopping_intent: shoppingIntent,
      search_queries: Object.fromEntries(shoppingIntent.slots.map((slot) => [
        slot.category,
        slot.search_query,
      ])),
      refinement_queries: Object.fromEntries(selections.map((selection) => [
        selection.slot.category,
        selection.refinement?.second_query || null,
      ])),
      slot_metrics: slotMetrics,
      retrieval_budget_ms: this.taobaoRetrievalTimeoutMs,
      slot_timeout_ms: this.taobaoSlotTimeoutMs,
      max_refinement_rounds: MAX_REFINEMENT_ROUNDS,
      candidate_pools: Object.fromEntries(selections.map((selection) => [
        selection.slot.category,
        selection.final_candidate_pool.map(publicCandidate),
      ])),
      composer_candidate_ids: validatedLooks.composer_candidate_ids,
      invalid_candidate_reference: validatedLooks.invalid_candidate_reference,
      structural_duplicate: validatedLooks.structural_duplicate,
      diversity_insufficient: validatedLooks.diversity_insufficient,
      candidate_reference_audit: validatedLooks.candidate_reference_audit,
      looks: validatedLooks.looks,
      final_look_count: validatedLooks.looks.length,
      ai_call_count: metrics.ai_call_count,
      taobao_call_count: metrics.taobao_call_count,
      timings: {
        ai_calls: metrics.ai_calls,
        total_ms: Date.now() - startedAt,
      },
    };
    this.logger.info?.("shopping_agent_v1_summary", {
      request_id: requestId,
      search_queries: response.search_queries,
      slot_metrics: slotMetrics,
      composer_candidate_ids: response.composer_candidate_ids,
      invalid_candidate_reference: response.invalid_candidate_reference,
      final_look_count: response.final_look_count,
      diversity_insufficient: response.diversity_insufficient,
      ai_call_count: response.ai_call_count,
      taobao_call_count: response.taobao_call_count,
      total_ms: response.timings.total_ms,
    });
    return response;
  }

  #fashionKnowledge(input) {
    if (!this.fashionBrain || typeof this.fashionBrain.retrieve !== "function") {
      return {};
    }
    const query = [
      input.user_input,
      input.occasion,
      input.height ? `${input.height}cm` : "",
    ].filter(Boolean).join(" ");
    const context = this.fashionBrain.retrieve(query).knowledgeContext || {};
    return {
      semantic_signals: context.semantic_signals || {},
      knowledge: (Array.isArray(context.knowledge) ? context.knowledge : [])
        .slice(0, 8),
    };
  }

  async #aiCall({
    phase,
    schemaName,
    schema,
    responseFormatType = "json_schema",
    timeoutMs,
    metrics,
    messages,
  }) {
    const startedAt = Date.now();
    metrics.ai_call_count += 1;
    const responseFormat = responseFormatType === "json_object"
      ? {type: "json_object"}
      : {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema,
          },
        };
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        response_format: responseFormat,
        enable_thinking: false,
        temperature: 0,
        messages,
      }, {
        timeout: timeoutMs,
        maxRetries: 0,
      });
      const payload = parseAiJson(response, {
        allowSingleAssessmentWrapper: phase.startsWith("product_selector_"),
        allowSingleLooksWrapper: phase === "real_product_outfit_composer",
        onDiagnostic: (diagnostic) => {
          const level = diagnostic.schema_error_kind ? "warn" : "info";
          this.logger[level]?.("shopping_agent_v1_structured_output", {
            phase,
            model: this.model,
            response_format_type: responseFormat.type,
            strict: responseFormat.type === "json_schema",
            ...diagnostic,
          });
        },
      });
      metrics.ai_calls.push({
        phase,
        duration_ms: Date.now() - startedAt,
        finish_reason: response?.choices?.[0]?.finish_reason ?? null,
        success: true,
      });
      return payload;
    } catch (error) {
      metrics.ai_calls.push({
        phase,
        duration_ms: Date.now() - startedAt,
        finish_reason: error?.finish_reason ?? null,
        success: false,
        error_code: error?.code || error?.name || "AI_REQUEST_FAILED",
      });
      if (error instanceof ShoppingAgentV1Error) throw error;
      throw new ShoppingAgentV1Error(`${phase} AI 调用失败`, {
        code: "SHOPPING_AGENT_AI_FAILED",
        details: {phase, cause: safeErrorCode(error)},
      });
    }
  }
}

function normalizeAgentInput(input = {}) {
  const userInput = text(input.user_input ?? input.userInput ?? input.request, 500);
  if (!userInput) {
    throw new ShoppingAgentV1Error("user_input is required", {
      code: "INVALID_SHOPPING_AGENT_INPUT",
      status: 400,
    });
  }
  const gender = normalizeGender(
    input.authoritative_gender ?? input.authoritativeGender ?? input.gender,
  );
  const height = optionalPositiveNumber(input.height, 100, 230);
  const weight = optionalPositiveNumber(input.weight, 20, 300);
  return Object.freeze({
    request_id: text(input.request_id ?? input.requestId, 120) || crypto.randomUUID(),
    user_input: userInput,
    gender,
    height,
    weight,
    body_profile: normalizePlainObject(input.body_profile ?? input.bodyProfile),
    persona: normalizePlainObject(input.persona),
    occasion: text(input.occasion ?? input.scene, 120) || "日常外出",
    weather: normalizePlainObject(input.weather),
    budget: normalizeBudgetContext(input.budget, userInput),
  });
}

function normalizeShoppingIntent(value, input) {
  if (value == null) {
    throw schemaError("shopping_intent is required", "MISSING_SHOPPING_INTENT");
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw schemaError("shopping_intent must be an object", "INVALID_SHOPPING_INTENT");
  }
  if (normalizeGender(value.gender) !== input.gender) {
    throw schemaError("shopping_intent.gender conflicts with authoritative gender");
  }
  if (!Array.isArray(value.slots) || value.slots.length !== CORE_CATEGORIES.length) {
    throw schemaError("shopping_intent.slots must contain exactly three items", "INVALID_SLOTS");
  }
  const rawSlots = value.slots;
  const slotsByCategory = new Map();
  for (const rawSlot of rawSlots) {
    const category = normalizeProductCategory(rawSlot?.category);
    if (!CORE_CATEGORIES.includes(category) || slotsByCategory.has(category)) {
      throw schemaError(
        "shopping_intent must contain one unique top, bottom and shoes slot",
        "INVALID_SLOTS",
      );
    }
    const slot = {
      category,
      role: text(rawSlot.role, 160),
      hard_constraints: stringList(rawSlot.hard_constraints, 12),
      soft_preferences: stringList(rawSlot.soft_preferences, 12),
      avoid: stringList(rawSlot.avoid, 12),
      search_query: normalizeSearchQuery(rawSlot.search_query, input.gender, category),
    };
    if (!slot.role) throw schemaError(`${category}.role is required`);
    slotsByCategory.set(category, Object.freeze(slot));
  }
  if (slotsByCategory.size !== CORE_CATEGORIES.length) {
    throw schemaError("shopping_intent must contain top, bottom and shoes", "INVALID_SLOTS");
  }
  return Object.freeze({
    gender: input.gender,
    persona: Object.freeze({
      expression: text(value.persona?.expression, 120),
      maturity: text(value.persona?.maturity, 120),
    }),
    overall_aesthetic: Object.freeze({
      core_direction: text(value.overall_aesthetic?.core_direction, 160),
      traits: Object.freeze(stringList(value.overall_aesthetic?.traits, 10)),
      anti_drift: Object.freeze(stringList(value.overall_aesthetic?.anti_drift, 10)),
    }),
    body_strategy: Object.freeze({
      goals: Object.freeze(stringList(value.body_strategy?.goals, 10)),
      hard_constraints: Object.freeze(stringList(
        value.body_strategy?.hard_constraints,
        10,
      )),
      soft_tactics: Object.freeze(stringList(value.body_strategy?.soft_tactics, 10)),
    }),
    occasion: Object.freeze({
      type: text(value.occasion?.type, 120),
      formality: text(value.occasion?.formality, 120),
    }),
    weather_constraints: Object.freeze({
      material: Object.freeze(stringList(value.weather_constraints?.material, 8)),
      thickness: text(value.weather_constraints?.thickness, 80),
      comfort: Object.freeze(stringList(value.weather_constraints?.comfort, 8)),
      safety: Object.freeze(stringList(value.weather_constraints?.safety, 8)),
    }),
    budget: input.budget,
    slots: Object.freeze(CORE_CATEGORIES.map((category) => slotsByCategory.get(category))),
  });
}

function normalizeBudgetContext(value, userInput = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const explicitItem = positiveBudgetNumber(source.item_budget ?? source.itemBudget);
  const explicitOutfit = positiveBudgetNumber(source.outfit_budget ?? source.outfitBudget);
  const textValue = String(userInput || "");
  const itemMatch = textValue.match(/(?:单件|每件)[^\d]{0,8}(\d{2,6}(?:\.\d{1,2})?)/);
  const outfitMatch = textValue.match(/(?:整套|全套|总预算|预算)[^\d]{0,8}(\d{2,6}(?:\.\d{1,2})?)/);
  return Object.freeze({
    item_budget: explicitItem ?? positiveBudgetNumber(itemMatch?.[1]),
    outfit_budget: explicitOutfit ?? positiveBudgetNumber(outfitMatch?.[1]),
  });
}

function positiveBudgetNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? roundPrice(number) : null;
}

function normalizeSearchQuery(value, gender, category) {
  const query = text(value, 80).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
  const genderPattern = gender === "female" ? /女/ : gender === "male" ? /男/ : null;
  const categoryPatterns = {
    top: /上衣|衬衫|针织|T恤|背心|外套|罩衫/,
    bottom: /下装|裤|裙/,
    shoes: /鞋|靴/,
  };
  if (!query || query.length > 50 || /天气|气温|身材策略|穿搭方案必须|因为|所以|：|:/.test(query)) {
    throw schemaError(`${category}.search_query is not concise executable product language`);
  }
  if (genderPattern && !genderPattern.test(query)) {
    throw schemaError(`${category}.search_query must contain gender`);
  }
  if (!categoryPatterns[category].test(query)) {
    throw schemaError(`${category}.search_query must contain category`);
  }
  return query;
}

function normalizeRefinementQuery(value, gender, category) {
  const query = text(value, 80).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
  if (!query) {
    throw schemaError(
      `${category}.refinement_query is required`,
      "REFINEMENT_QUERY_EMPTY",
    );
  }
  if (query.length > 50 || /天气|气温|身材策略|穿搭方案必须|因为|所以|：|:/.test(query)) {
    throw schemaError(
      `${category}.refinement_query is not concise executable product language`,
      "REFINEMENT_QUERY_INVALID",
    );
  }
  const genderPattern = gender === "female"
    ? /女士|女装|女款|女鞋|女性|女生|^女/
    : gender === "male"
      ? /男士|男装|男款|男鞋|男性|男生|^男/
      : null;
  const unisexDirection = /男女同款|男女通用|中性|情侣/.test(query);
  if ((genderPattern && !genderPattern.test(query)) ||
      (genderPattern && unisexDirection) ||
      explicitGenderConflict(query, gender)) {
    throw schemaError(
      `${category}.refinement_query conflicts with authoritative gender`,
      "REFINEMENT_QUERY_GENDER_MISMATCH",
    );
  }
  const canonicalCategory = normalizeProductCategory(query);
  if (canonicalCategory !== category) {
    throw schemaError(
      `${category}.refinement_query resolves to ${canonicalCategory || "unknown"}`,
      "REFINEMENT_QUERY_CATEGORY_MISMATCH",
    );
  }
  return Object.freeze({query, canonical_category: canonicalCategory});
}

function hardGateCandidate(product, slot, shoppingIntent) {
  const evidence = candidateEvidence(product);
  const reasonCodes = [];
  if (!semanticCategoryMatch(product, {category: slot.category, gender: shoppingIntent.gender})) {
    reasonCodes.push("WRONG_CATEGORY");
  }
  if (explicitGenderConflict(evidence, shoppingIntent.gender)) {
    reasonCodes.push("WRONG_GENDER");
  }
  if (underwearOrHomewearConflict(evidence, slot.category)) {
    reasonCodes.push("UNDERWEAR_OR_HOMEWEAR");
  }
  for (const constraint of slot.hard_constraints) {
    if (explicitHardConstraintConflict(constraint, evidence)) {
      reasonCodes.push("HARD_CONSTRAINT_CONFLICT");
      break;
    }
  }
  return Object.freeze({
    status: reasonCodes.length > 0 ? "FAIL" : "PASS",
    reason_codes: Object.freeze([...new Set(reasonCodes)]),
  });
}

function explicitGenderConflict(evidence, gender) {
  if (gender === "unisex" || /男女同款|男女通用|中性|情侣/.test(evidence)) return false;
  const hasFemale = /女士|女装|女款|女鞋|女性|女生/.test(evidence);
  const hasMale = /男士|男装|男款|男鞋|男性|男生/.test(evidence);
  if (gender === "female") return hasMale && !hasFemale;
  return hasFemale && !hasMale;
}

function underwearOrHomewearConflict(evidence, category) {
  if (/睡衣|家居服|睡袍|浴袍|睡裤|家居裤/.test(evidence)) return true;
  if (category === "top" && /文胸|胸罩|乳贴|内衣套装|塑身衣/.test(evidence)) return true;
  if (category === "bottom" && /内裤|平角裤|三角裤|丁字裤|安全裤/.test(evidence)) {
    return true;
  }
  return false;
}

function explicitHardConstraintConflict(constraint, evidence) {
  const value = String(constraint || "").toLowerCase();
  if (/非运动|不得运动|不要运动|non.?sport/.test(value)) {
    return /跑步|训练|篮球|足球|运动鞋|速干运动|健身/.test(evidence);
  }
  if (/高腰|high.?waist/.test(value)) return /低腰/.test(evidence);
  if (/不透|非透视|不得透视|not.?sheer/.test(value)) {
    return /透视|透明|超薄透/.test(evidence);
  }
  return false;
}

function validateProductSelection(payload, candidates, {
  slot,
  gender,
  originalQuery,
} = {}) {
  const assessments = Array.isArray(payload?.assessments) ? payload.assessments : null;
  if (!assessments) throw schemaError("selector assessments must be an array");
  const allowedIds = new Set(candidates.map((candidate) => candidate.candidate_id));
  const seen = new Set();
  const normalized = assessments.map((assessment) => {
    const candidateId = text(assessment?.candidate_id, 80);
    if (!allowedIds.has(candidateId) || seen.has(candidateId)) {
      throw schemaError("selector returned an unknown or duplicate candidate_id");
    }
    seen.add(candidateId);
    const status = String(assessment?.status || "").toUpperCase();
    if (!Object.values(SELECTOR_STATUS).includes(status)) {
      throw schemaError("selector returned an invalid status");
    }
    const selectionTier = String(assessment?.selection_tier || "").toUpperCase();
    if (!Object.values(SELECTION_TIER).includes(selectionTier)) {
      throw schemaError("selector returned an invalid selection_tier");
    }
    if (status === SELECTOR_STATUS.KEEP && selectionTier === SELECTION_TIER.NONE) {
      throw schemaError("KEEP candidates require HIGH or NORMAL selection_tier");
    }
    if (status !== SELECTOR_STATUS.KEEP && selectionTier !== SELECTION_TIER.NONE) {
      throw schemaError("non-KEEP candidates require NONE selection_tier");
    }
    return Object.freeze({
      candidate_id: candidateId,
      status,
      selection_tier: selectionTier,
      scores: normalizeScoreObject(assessment.scores, Object.keys(SCORE_PROPERTIES)),
      reason_codes: Object.freeze(stringList(assessment.reason_codes, 12)),
    });
  });
  if (seen.size !== allowedIds.size) {
    throw schemaError("selector must assess every candidate exactly once");
  }
  if (typeof payload?.quality_sufficient !== "boolean" ||
      typeof payload?.refinement_needed !== "boolean") {
    throw schemaError("selector quality decisions must be boolean");
  }
  const homogeneity = String(payload?.candidate_pool_homogeneity || "").toUpperCase();
  if (!Object.values(POOL_HOMOGENEITY).includes(homogeneity)) {
    throw schemaError("selector returned invalid candidate_pool_homogeneity");
  }
  const refinementReasons = Object.freeze(stringList(payload.refinement_reasons, 8));
  let refinementQuery = text(payload.refinement_query, 80);
  if (payload.refinement_needed) {
    if (!slot || !gender || !originalQuery) {
      throw schemaError(
        "selector refinement_query validation context is required",
        "REFINEMENT_QUERY_CONTEXT_MISSING",
      );
    } else {
      refinementQuery = normalizeRefinementQuery(
        refinementQuery,
        gender,
        slot.category,
      ).query;
      if (canonicalQuery(refinementQuery) === canonicalQuery(originalQuery)) {
        throw schemaError(
          `${slot.category}.refinement_query must differ from initial_query`,
          "REFINEMENT_QUERY_NOT_DISTINCT",
        );
      }
    }
  } else if (refinementQuery) {
    if (!slot || !gender) {
      throw schemaError(
        "selector refinement_query validation context is required",
        "REFINEMENT_QUERY_CONTEXT_MISSING",
      );
    }
    refinementQuery = normalizeRefinementQuery(
      refinementQuery,
      gender,
      slot.category,
    ).query;
  }
  return {
    assessments: normalized,
    quality_sufficient: payload.quality_sufficient,
    refinement_needed: payload.refinement_needed,
    refinement_reasons: refinementReasons,
    candidate_pool_homogeneity: homogeneity,
    refinement_query: refinementQuery,
  };
}

function selectFinalCandidatePool(candidates, assessments) {
  const byId = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const evaluated = assessments.map((assessment) => evaluateCandidateValue(
    byId.get(assessment.candidate_id),
    assessment,
  ));
  const order = (status, tier) => evaluated
    .filter((item) => item.status === status && (!tier || item.effective_tier === tier))
    .sort((left, right) => right.value_adjusted_score - left.value_adjusted_score);
  return [
    ...order(SELECTOR_STATUS.KEEP, SELECTION_TIER.HIGH),
    ...order(SELECTOR_STATUS.KEEP, SELECTION_TIER.NORMAL),
    ...order(SELECTOR_STATUS.UNCERTAIN),
  ].slice(0, MAX_SELECTED_CANDIDATES_PER_SLOT).map((evaluatedItem) => ({
    ...byId.get(evaluatedItem.assessment.candidate_id),
    selector_status: evaluatedItem.status,
    selection_tier: evaluatedItem.effective_tier,
    selector_quality_score: evaluatedItem.value_adjusted_score,
    selector_raw_quality_score: evaluatedItem.raw_quality_score,
    selector_scores: Object.freeze({
      ...evaluatedItem.assessment.scores,
      outfit_potential: evaluatedItem.effective_outfit_potential,
    }),
    selector_raw_scores: evaluatedItem.assessment.scores,
    selector_reason_codes: evaluatedItem.assessment.reason_codes,
    value_reasonableness: evaluatedItem.value_reasonableness,
    value_reason_codes: evaluatedItem.value_reason_codes,
    value_adjustment: evaluatedItem.value_adjustment,
    variation_axes: candidateVariationAxes(
      byId.get(evaluatedItem.assessment.candidate_id),
    ),
  }));
}

function buildPriceContext(candidates) {
  const prices = candidates.map((candidate) => Number(candidate?.price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);
  if (prices.length === 0) {
    return Object.freeze({
      min_price: null,
      median_price: null,
      p75_price: null,
      max_price: null,
      observed_count: 0,
    });
  }
  return Object.freeze({
    min_price: roundPrice(prices[0]),
    median_price: roundPrice(percentile(prices, 0.5)),
    p75_price: roundPrice(percentile(prices, 0.75)),
    max_price: roundPrice(prices.at(-1)),
    observed_count: prices.length,
  });
}

function enrichCandidatePriceContext(candidate, priceContext, budget = {}) {
  const price = Number(candidate?.price);
  const position = pricePosition(price, priceContext);
  const withinExplicitItemBudget = Number.isFinite(budget?.item_budget) &&
    price <= budget.item_budget;
  let valueReasonableness = 72;
  const reasonCodes = [];
  if (!Number.isFinite(price) || price <= 0) {
    valueReasonableness = 55;
    reasonCodes.push("PRICE_EVIDENCE_MISSING");
  } else if (position === PRICE_POSITION.OUTLIER_HIGH) {
    reasonCodes.push("PRICE_OUTLIER_HIGH");
    if (withinExplicitItemBudget) {
      valueReasonableness = 72;
      reasonCodes.push("WITHIN_EXPLICIT_ITEM_BUDGET");
    } else {
      valueReasonableness = 42;
    }
  } else if (withinExplicitItemBudget) {
    valueReasonableness = 78;
    reasonCodes.push("WITHIN_EXPLICIT_ITEM_BUDGET");
  }
  return Object.freeze({
    ...candidate,
    price_context: priceContext,
    price_position: position,
    value_reasonableness: valueReasonableness,
    value_reason_codes: Object.freeze(reasonCodes),
    explicit_budget: budget,
  });
}

function evaluateCandidateValue(candidate, assessment) {
  const rawQualityScore = selectorQualityScore(assessment);
  const reasonCodes = new Set(candidate?.value_reason_codes || []);
  let valueReasonableness = Number(candidate?.value_reasonableness ?? 60);
  let valueAdjustment = 0;
  let effectiveTier = assessment.selection_tier;
  if (candidate?.price_position === PRICE_POSITION.OUTLIER_HIGH &&
      !reasonCodes.has("WITHIN_EXPLICIT_ITEM_BUDGET")) {
    if (hasExceptionalAestheticValue(assessment)) {
      valueReasonableness = Math.max(valueReasonableness, 64);
      reasonCodes.add("PRICE_PREMIUM_JUSTIFIED_BY_SELECTION_EVIDENCE");
      valueAdjustment = -4;
    } else {
      valueReasonableness = Math.min(valueReasonableness, 42);
      reasonCodes.add("PRICE_PREMIUM_NOT_JUSTIFIED");
      valueAdjustment = -18;
      if (effectiveTier === SELECTION_TIER.HIGH) effectiveTier = SELECTION_TIER.NORMAL;
    }
  }
  return Object.freeze({
    assessment,
    status: assessment.status,
    effective_tier: effectiveTier,
    raw_quality_score: rawQualityScore,
    value_adjusted_score: roundScore(Math.max(0, rawQualityScore + valueAdjustment)),
    value_reasonableness: roundScore(valueReasonableness),
    value_reason_codes: Object.freeze([...reasonCodes]),
    value_adjustment: valueAdjustment,
    effective_outfit_potential: roundScore(Math.max(
      0,
      Number(assessment.scores?.outfit_potential || 0) + valueAdjustment,
    )),
  });
}

function hasExceptionalAestheticValue(assessment) {
  const scores = assessment?.scores || {};
  const proof = [
    scores.aesthetic_fit,
    scores.aesthetic_distinctiveness,
    scores.quality_perception,
    scores.styling_value,
    scores.outfit_potential,
  ].map(Number);
  return proof.every(Number.isFinite) &&
    proof.reduce((sum, score) => sum + score, 0) / proof.length >= 86 &&
    Number(scores.aesthetic_distinctiveness) >= 82 &&
    Number(scores.styling_value) >= 82;
}

function pricePosition(price, context) {
  if (!Number.isFinite(price) || price <= 0 || !context?.observed_count) {
    return PRICE_POSITION.UNKNOWN;
  }
  const highThreshold = Math.max(
    Number(context.p75_price || 0) * 2,
    Number(context.median_price || 0) * 2.5,
  );
  if (context.observed_count >= 4 && price > highThreshold) {
    return PRICE_POSITION.OUTLIER_HIGH;
  }
  if (price < context.median_price) return PRICE_POSITION.BELOW_MEDIAN;
  if (price <= context.p75_price) return PRICE_POSITION.TYPICAL;
  return PRICE_POSITION.UPPER_QUARTILE;
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

function roundPrice(value) {
  return Math.round(Number(value) * 100) / 100;
}

function selectorQualityScore(assessment) {
  const scores = assessment?.scores || {};
  return roundScore(
    Number(scores.outfit_potential || 0) * 0.2 +
    Number(scores.aesthetic_fit || 0) * 0.15 +
    Number(scores.aesthetic_distinctiveness || 0) * 0.15 +
    Number(scores.quality_perception || 0) * 0.15 +
    Number(scores.styling_value || 0) * 0.15 +
    Number(scores.persona_fit || 0) * 0.08 +
    Number(scores.silhouette_fit || 0) * 0.05 +
    Number(scores.age_appropriateness || 0) * 0.05 +
    Number(scores.category_fit || 0) * 0.02,
  );
}

function topSelectorQuality(assessments) {
  const eligible = assessments.filter((item) =>
    item.status === SELECTOR_STATUS.KEEP || item.status === SELECTOR_STATUS.UNCERTAIN);
  return eligible.length > 0
    ? Math.max(...eligible.map(selectorQualityScore))
    : 0;
}

function candidateVariationAxes(candidate) {
  const evidence = candidateEvidence(candidate);
  const category = normalizeProductCategory(candidate?.category || evidence);
  return Object.freeze({
    top_family: category === "top" ? matchAxis(evidence, [
      ["polo", /polo/],
      ["knit_top", /针织|毛衣/],
      ["shirt", /衬衫|衬衣/],
      ["tshirt", /t恤|tee|短袖t/i],
      ["tank_or_camisole", /背心|吊带/],
      ["jacket", /外套|夹克|西装/],
      ["blouse", /罩衫|雪纺衫/],
    ]) : null,
    top_silhouette: category === "top" ? matchAxis(evidence, [
      ["cropped", /短款|露脐/],
      ["fitted", /修身|紧身|合身/],
      ["relaxed", /宽松|廓形|oversi[sz]e/i],
      ["longline", /长款/],
    ]) : null,
    bottom_family: category === "bottom" ? matchAxis(evidence, [
      ["skirt", /半身裙|a字裙|包臀裙|百褶裙|短裙|长裙/],
      ["shorts", /短裤/],
      ["wide_leg_pants", /阔腿|喇叭裤/],
      ["straight_pants", /直筒|烟管裤/],
      ["jogger_pants", /束脚|运动裤/],
      ["skinny_pants", /紧身裤|铅笔裤/],
    ]) : null,
    shoe_family: category === "shoes" ? matchAxis(evidence, [
      ["ballet_flat", /芭蕾鞋|芭蕾平底/],
      ["loafer", /乐福鞋/],
      ["mary_jane", /玛丽珍/],
      ["heel", /高跟|细跟|猫跟|尖头低跟/],
      ["trainer", /德训鞋/],
      ["sneaker", /运动鞋|跑鞋|板鞋|老爹鞋/],
      ["sandal", /凉鞋|拖鞋/],
      ["boot", /靴/],
      ["flat", /平底鞋|浅口鞋/],
    ]) : null,
    color_story: matchAxis(evidence, [
      ["light_neutral", /白|米|奶油|燕麦|杏/],
      ["dark_neutral", /黑|深灰|炭灰|藏青/],
      ["cool_color", /蓝|绿|薄荷|紫/],
      ["warm_color", /红|粉|橙|黄|棕|咖/],
      ["metallic", /银|金属/],
    ]),
    expression: matchAxis(evidence, [
      ["feminine", /女性化|甜美|优雅|法式|蝴蝶结|蕾丝/],
      ["clean", /极简|简约|利落|clean/i],
      ["sporty", /运动|跑步|训练|机能/],
      ["retro", /复古|vintage/i],
    ]),
    styling_mood: matchAxis(evidence, [
      ["polished", /精致|通勤|气质/],
      ["relaxed", /休闲|慵懒|宽松/],
      ["playful", /可爱|甜|俏皮/],
      ["active", /活力|运动|户外/],
    ]),
  });
}

function matchAxis(evidence, options) {
  return options.find(([, pattern]) => pattern.test(evidence))?.[0] || "unknown";
}

function candidatePoolDiversity(pool, category) {
  const axisKeys = category === "top"
    ? ["top_family", "top_silhouette"]
    : category === "bottom" ? ["bottom_family"] : ["shoe_family"];
  const signatures = pool.map((candidate) => {
    const axes = candidate.variation_axes || candidateVariationAxes(candidate);
    return axisKeys.map((key) => axes[key]).join("|");
  });
  const known = signatures.filter((signature) => !signature.split("|").every((item) =>
    item === "unknown" || item === "null"));
  const uniqueKnown = new Set(known);
  const evidenceSufficient = known.length >= 2;
  return Object.freeze({
    category,
    axis_keys: Object.freeze(axisKeys),
    unique_structure_count: uniqueKnown.size,
    evidence_sufficient: evidenceSufficient,
    diversity_insufficient: evidenceSufficient && uniqueKnown.size < 2,
  });
}

function refinementDecision(selection) {
  const reasons = new Set(selection.refinement_reasons || []);
  if (selection.selector_keep < MAX_SELECTED_CANDIDATES_PER_SLOT) {
    reasons.add("KEEP_BELOW_THREE");
  }
  if (selection.top_candidate_quality < SELECTOR_RECOMMENDABLE_SCORE) {
    reasons.add("TOP_CANDIDATE_QUALITY_BELOW_75");
  }
  if (selection.candidate_pool_homogeneity === POOL_HOMOGENEITY.HIGH) {
    reasons.add("CANDIDATE_POOL_HOMOGENEITY_HIGH");
  }
  if (selection.diversity?.diversity_insufficient) reasons.add("DIVERSITY_GAP");
  if (!selection.quality_sufficient) reasons.add("QUALITY_INSUFFICIENT");
  if (selection.refinement_needed) reasons.add("SELECTOR_REQUESTED_REFINEMENT");
  const needed = reasons.size > 0;
  const query = needed ? text(selection.refinement_query, 80) : "";
  if (needed && !query) {
    throw schemaError("refinement is required but selector returned no refinement_query");
  }
  if (needed && canonicalQuery(query) === canonicalQuery(
    selection.query || selection.slot.search_query,
  )) {
    throw schemaError("refinement query must differ from first query");
  }
  return Object.freeze({needed, query, reasons: Object.freeze([...reasons])});
}

function mergeSelectionRounds(first, second, {decision} = {}) {
  const mergedCandidates = dedupeProducts([...first.candidates, ...second.candidates]);
  const priceContext = buildPriceContext(mergedCandidates);
  const candidates = mergedCandidates.map((candidate) => enrichCandidatePriceContext(
    candidate,
    priceContext,
    candidate.explicit_budget,
  ));
  const allowedIds = new Set(candidates.map((candidate) => candidate.candidate_id));
  const assessments = [...first.assessments, ...second.assessments]
    .filter((assessment) => allowedIds.has(assessment.candidate_id));
  const pool = selectFinalCandidatePool(candidates, assessments);
  return {
    ...first,
    candidates,
    assessments,
    selector_keep: assessments.filter((item) => item.status === SELECTOR_STATUS.KEEP).length,
    selector_reject: assessments.filter((item) => item.status === SELECTOR_STATUS.REJECT).length,
    selector_uncertain: assessments.filter((item) =>
      item.status === SELECTOR_STATUS.UNCERTAIN).length,
    quality_sufficient: second.quality_sufficient,
    refinement_needed: false,
    refinement_reasons: decision?.reasons || [],
    refinement_query: second.query,
    candidate_pool_homogeneity: second.candidate_pool_homogeneity,
    top_candidate_quality: topSelectorQuality(assessments),
    final_candidate_pool: pool,
    price_context: priceContext,
    diversity: candidatePoolDiversity(pool, first.slot.category),
    refinement: {
      triggered: true,
      status: "SUCCESS",
      refinement_status: "SUCCESS",
      refinement_attempted: true,
      refinement_succeeded: true,
      refinement_fallback_used: false,
      refinement_error_code: null,
      refinement_cause_code: null,
      first_query: first.query || first.slot.search_query,
      second_query: second.query,
      reasons: decision?.reasons || [],
      first_round_candidate_ids: first.final_candidate_pool.map((item) => item.candidate_id),
      second_round_candidate_ids: second.final_candidate_pool.map((item) => item.candidate_id),
      rounds: [selectorRoundMetric(first), selectorRoundMetric(second)],
    },
  };
}

function selectorRoundMetric(selection) {
  return Object.freeze({
    round: selection.round,
    query: selection.query || selection.slot.search_query,
    selector_keep: selection.selector_keep,
    selector_reject: selection.selector_reject,
    selector_uncertain: selection.selector_uncertain,
    selector_high: selection.assessments.filter((item) =>
      item.status === SELECTOR_STATUS.KEEP &&
      item.selection_tier === SELECTION_TIER.HIGH).length,
    selector_normal: selection.assessments.filter((item) =>
      item.status === SELECTOR_STATUS.KEEP &&
      item.selection_tier === SELECTION_TIER.NORMAL).length,
    candidate_pool_homogeneity: selection.candidate_pool_homogeneity,
    top_candidate_quality: selection.top_candidate_quality,
    candidate_ids: Object.freeze(selection.final_candidate_pool.map((item) =>
      item.candidate_id)),
  });
}

function validateComposedLooks(payload, selections, {onScoreError} = {}) {
  const looks = Array.isArray(payload?.looks) ? payload.looks : [];
  const pools = new Map(selections.map((selection) => [
    selection.slot.category,
    new Map(selection.final_candidate_pool.map((candidate) => [
      candidate.candidate_id,
      candidate,
    ])),
  ]));
  const invalidReferences = [];
  const signatures = new Set();
  const structuralSignatures = new Set();
  const structuralDuplicates = [];
  const validLooks = [];
  const composerIds = [];
  const referenceAudit = [];
  for (const [index, look] of looks.entries()) {
    const lookId = text(look?.look_id, 80) || `look-${index + 1}`;
    const ids = {
      top: text(look?.top_candidate_id, 80),
      bottom: text(look?.bottom_candidate_id, 80),
      shoes: text(look?.shoes_candidate_id, 80),
    };
    const validity = Object.fromEntries(CORE_CATEGORIES.map((category) => [
      category,
      pools.get(category)?.has(ids[category]) === true,
    ]));
    const invalid = CORE_CATEGORIES.filter((category) => !validity[category]);
    referenceAudit.push({
      look_id: lookId,
      requested_top_id: ids.top,
      requested_bottom_id: ids.bottom,
      requested_shoes_id: ids.shoes,
      top_id_valid: validity.top,
      bottom_id_valid: validity.bottom,
      shoes_id_valid: validity.shoes,
      error_code: invalid.length > 0
        ? "COMPOSER_INVALID_CANDIDATE_REFERENCE"
        : null,
    });
    if (invalid.length > 0) {
      invalidReferences.push({
        look_id: lookId,
        categories: invalid,
        candidate_ids: invalid.map((category) => ids[category]),
      });
      continue;
    }
    const signature = CORE_CATEGORIES.map((category) => ids[category]).join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const selectedCandidates = Object.fromEntries(CORE_CATEGORIES.map((category) => [
      category,
      pools.get(category).get(ids[category]),
    ]));
    const structuralSignature = lookStructuralSignature(selectedCandidates);
    if (structuralSignature.comparable && structuralSignatures.has(structuralSignature.value)) {
      structuralDuplicates.push(Object.freeze({
        look_id: lookId,
        error_code: "STRUCTURAL_DUPLICATE",
        structural_signature: structuralSignature.value,
      }));
      continue;
    }
    if (structuralSignature.comparable) structuralSignatures.add(structuralSignature.value);
    composerIds.push(...Object.values(ids));
    validLooks.push({
      look_id: lookId,
      candidate_ids: ids,
      scores: normalizeScoreObject(
        look?.scores,
        Object.keys(COMPOSER_SCORE_PROPERTIES),
        {
          requireRawNumber: true,
          lookId,
          onScoreError,
        },
      ),
      items: Object.fromEntries(CORE_CATEGORIES.map((category) => [
        category,
        publicCandidate(selectedCandidates[category]),
      ])),
    });
  }
  return {
    looks: validLooks.slice(0, 3),
    composer_candidate_ids: [...new Set(composerIds)],
    invalid_candidate_reference: invalidReferences,
    candidate_reference_audit: referenceAudit,
    structural_duplicate: structuralDuplicates,
    diversity_insufficient: validLooks.length < 2 || candidatePoolsCannotDiversify(selections),
  };
}

function candidatePoolsCannotDiversify(selections) {
  const evidence = selections.map((selection) => selection.diversity ||
    candidatePoolDiversity(selection.final_candidate_pool, selection.slot.category));
  return evidence.every((item) => item.evidence_sufficient) &&
    evidence.every((item) => item.diversity_insufficient);
}

function lookStructuralSignature(items) {
  const top = items.top?.variation_axes || candidateVariationAxes(items.top);
  const bottom = items.bottom?.variation_axes || candidateVariationAxes(items.bottom);
  const shoes = items.shoes?.variation_axes || candidateVariationAxes(items.shoes);
  const values = [
    top.top_family,
    top.top_silhouette,
    bottom.bottom_family,
    shoes.shoe_family,
  ];
  const knownMajorAxes = [
    top.top_family !== "unknown" || top.top_silhouette !== "unknown",
    bottom.bottom_family !== "unknown",
    shoes.shoe_family !== "unknown",
  ];
  return Object.freeze({
    value: values.join("|"),
    comparable: knownMajorAxes.every(Boolean),
  });
}

function buildPlannerMessages(input, fashionKnowledge) {
  return [
    {
      role: "system",
      content: `You are FitAI Shopping Intent and Taobao Search Planner V1.
Decide one coherent, purchasable styling direction before marketplace search. User intent and authoritative gender outrank occasion and weather. Weather may only change material, thickness, comfort and safety; it must not select a functional or sports aesthetic unless the user explicitly asks for sport.
Create exactly three slots: top, bottom and shoes. Shopping Intent is flexible intent, not an imagined SKU contract. Hard constraints contain only truly non-negotiable gender/category/safety requirements. Put ordinary aesthetic choices in soft_preferences.
Generate exactly one concise Chinese Taobao query per slot. Every query must contain the gender direction, the product category and only one or two key styling traits. Never include weather prose, body-strategy explanations, reasons, prompt text, colons or multiple alternatives. Return only the strict JSON object.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        user_input: input.user_input,
        authoritative_gender: input.gender,
        persona: input.persona,
        body: {
          height_cm: input.height,
          weight_kg: input.weight,
          profile: input.body_profile,
        },
        occasion: input.occasion,
        weather: input.weather,
        budget: input.budget,
        fashion_brain_context: fashionKnowledge,
      }),
    },
  ];
}

function buildSelectorMessages(shoppingIntent, group, {round = 1} = {}) {
  const content = [{
    type: "text",
    text: JSON.stringify({
      instruction: `逐件查看随后主图；必须评估每个中性candidate_id一次。明确硬错误REJECT；证据不足UNCERTAIN。普通但没错的商品可以KEEP_NORMAL，但只有真正值得搭配师主动选用的商品才是KEEP_HIGH。评分必须严格校准：50以下明显不推荐；50-59勉强符合但审美差；60-69普通可穿；70-79好看可推荐；80-89明显有选品价值；90-94非常优秀；95以上极少使用。price_context描述当前真实slot价格分布；PRICE_OUTLIER_HIGH不是硬拒绝，但若商品没有明显更强的设计、材质或审美价值，不得因品牌名给高价合理性，且outfit_potential与styling_value应反映购买价值。判断本轮是否有至少3件足以组成最终Look且有合理结构差异的商品。若候选在商品family或silhouette上同质，refinement_query应在同一overall_aesthetic与hard_constraints内补足DIVERSITY_GAP，而不是只换品牌或颜色。refinement_query始终给出一个不同于本轮、保留hard_constraints的简洁安全备选查询；只有refinement_needed=true时系统才会调用。`,
      selector_round: round,
      shopping_intent: {
        gender: shoppingIntent.gender,
        persona: shoppingIntent.persona,
        overall_aesthetic: shoppingIntent.overall_aesthetic,
        body_strategy: shoppingIntent.body_strategy,
        occasion: shoppingIntent.occasion,
        weather_constraints: shoppingIntent.weather_constraints,
        budget: shoppingIntent.budget,
      },
      slot: group.slot,
      current_query: group.query || group.slot.search_query,
      candidates: group.candidates.map(evidenceCandidate),
    }),
  }];
  for (const candidate of group.candidates) {
    content.push({
      type: "text",
      text: JSON.stringify({
        candidate_id: candidate.candidate_id,
        title: candidate.title,
        price: candidate.price,
        category: candidate.category,
      }),
    });
    content.push({
      type: "image_url",
      image_url: {url: candidate.image_url},
    });
  }
  return [
    {
      role: "system",
      content: "你是审美标准严格的商品视觉采购员。只依据当前Shopping Intent与真实主图证据输出严格JSON，不得根据candidate_id推断。不要因为商品没犯硬错误就给高分；必须区分普通可穿和有造型价值。识别候选池是否同质，refinement最多只提出一个新query，不得删除hard constraints。",
    },
    {role: "user", content},
  ];
}

function buildComposerMessages(shoppingIntent, selections) {
  const allowedIds = Object.fromEntries(CORE_CATEGORIES.map((category) => {
    const selection = selections.find((item) => item.slot.category === category);
    return [
      `${category.toUpperCase()}_ALLOWED_IDS`,
      (selection?.final_candidate_pool || []).map((candidate) => candidate.candidate_id),
    ];
  }));
  const content = [{
    type: "text",
    text: JSON.stringify({
      instruction: `只使用候选池中真实candidate_id组合2到3套完整Look。top_candidate_id只能从TOP_ALLOWED_IDS选择，bottom_candidate_id只能从BOTTOM_ALLOWED_IDS选择，shoes_candidate_id只能从SHOES_ALLOWED_IDS选择，禁止跨slot引用。生成前逐套自检三个candidate_id均属于对应allowed list。每套只输出look_id、top_candidate_id、bottom_candidate_id、shoes_candidate_id和scores，不得输出candidate对象。多套Look必须共享overall_aesthetic，但至少在top family/silhouette、bottom family或shoe family中的一个主要结构轴真实变化；只换品牌、颜色或candidate_id仍是STRUCTURAL_DUPLICATE。不要为了不同而破坏单套审美，宁可只给2套。不得创造新商品或新ID。优先使用selection_tier=HIGH，NORMAL仅作为补足。必须独立判断三件之间的体积与腰线、裤长和鞋量感、配色、材质关系、视觉主次、共同风格故事与辨识度；不能把单品分数直接平均成整套高分。value_coherence必须判断单件价格与整套定位、价格离群商品是否真正提升造型、是否有审美相近但价值更合理的候选；品牌名本身不能证明高价合理。cross_look_distinctiveness必须判断与前面Look在主要结构轴上的真实差异。评分严格校准：60为能穿但普通，70为好看，80为明显值得推荐，90为造型师级优秀，95以上极罕见。scores中的aesthetic_coherence、proportion_balance、color_harmony、material_harmony、visual_hierarchy、style_story、distinctiveness、persona_fit、body_proportion、occasion_fit、weather_fit、value_coherence、cross_look_distinctiveness、final_score必须全部是有限的JSON number，每个值必须大于等于0且小于等于100。正确示例为"final_score":78。禁止百分号字符串、"95/100"、null、文字评分、0到1或0到10归一化表达。特别检查身高与body_strategy下的比例风险。返回一个顶层JSON对象，业务结构为 {"looks":[...]}；不得返回JSON Schema、Markdown、解释文字或顶层数组。`,
      shopping_intent: shoppingIntent,
      ...allowedIds,
      candidate_pools: Object.fromEntries(selections.map((selection) => [
        selection.slot.category,
        selection.final_candidate_pool.map(evidenceCandidate),
      ])),
    }),
  }];
  for (const selection of selections) {
    for (const candidate of selection.final_candidate_pool) {
      content.push({
        type: "text",
        text: JSON.stringify({
          candidate_id: candidate.candidate_id,
          category: selection.slot.category,
          title: candidate.title,
          selector_status: candidate.selector_status,
          selection_tier: candidate.selection_tier,
          selector_quality_score: candidate.selector_quality_score,
          selector_scores: candidate.selector_scores,
        }),
      });
      content.push({type: "image_url", image_url: {url: candidate.image_url}});
    }
  }
  return [
    {
      role: "system",
      content: "你是基于真实商品池工作的资深造型师。商品池是唯一可用库存，三个slot的allowed ID list是不可跨越的白名单。整套评分必须来自商品之间的真实视觉关系，普通基础款组合不得虚高。只返回一个包含looks数组的JSON对象，每套Look只含look_id、三个slot的candidate_id和scores；禁止返回JSON Schema、Markdown、额外解释、candidate对象或顶层数组，禁止幻想商品。",
    },
    {role: "user", content},
  ];
}

function evidenceCandidate(candidate) {
  return {
    candidate_id: candidate.candidate_id,
    title: text(candidate.title, 300),
    image: text(candidate.image_url, 1000),
    price: Number(candidate.price || 0),
    sales: text(candidate.sales, 80),
    category: normalizeProductCategory(candidate.category),
    selection_tier: candidate.selection_tier,
    selector_quality_score: candidate.selector_quality_score,
    scores: candidate.selector_scores,
    raw_scores: candidate.selector_raw_scores,
    price_context: candidate.price_context,
    price_position: candidate.price_position,
    value_reasonableness: candidate.value_reasonableness,
    value_reason_codes: candidate.value_reason_codes,
    variation_axes: candidate.variation_axes || candidateVariationAxes(candidate),
    brand: text(candidate.brand, 120),
    shop: text(candidate.shop_name, 160),
  };
}

function publicCandidate(candidate) {
  return {
    candidate_id: candidate.candidate_id,
    product_id: String(candidate.product_id || ""),
    title: text(candidate.title, 300),
    category: normalizeProductCategory(candidate.category),
    price: Number(candidate.price || 0),
    sales: text(candidate.sales, 80),
    image_url: text(candidate.image_url, 1000),
    purchase_url: text(candidate.purchase_url, 1600),
    brand: text(candidate.brand, 120),
    shop_name: text(candidate.shop_name, 160),
    source: candidate.source,
    is_mock: candidate.is_mock === true,
    selector_status: candidate.selector_status,
    selection_tier: candidate.selection_tier,
    selector_quality_score: candidate.selector_quality_score,
    selector_scores: candidate.selector_scores,
    selector_raw_scores: candidate.selector_raw_scores,
    selector_reason_codes: candidate.selector_reason_codes,
    price_context: candidate.price_context,
    price_position: candidate.price_position,
    value_reasonableness: candidate.value_reasonableness,
    value_reason_codes: candidate.value_reason_codes,
    value_adjustment: candidate.value_adjustment,
    variation_axes: candidate.variation_axes || candidateVariationAxes(candidate),
  };
}

function productIdentity(product) {
  const productId = text(product?.product_id, 240);
  if (productId) return `id:${productId}`;
  const image = text(product?.image_url, 1000).toLowerCase();
  if (image) return `image:${image}`;
  return `title:${text(product?.title, 300).toLowerCase().replace(/\s+/g, "")}`;
}

function dedupeProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const identity = productIdentity(product);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function canonicalQuery(value) {
  return text(value, 100).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function retrievalMetric(retrieval) {
  return {
    slot_key: retrieval.slot_key,
    category: retrieval.slot.category,
    query: retrieval.slot.search_query,
    start_time: retrieval.start_time,
    end_time: retrieval.end_time,
    elapsed_ms: retrieval.elapsed_ms,
    attempts: retrieval.attempts,
    status: retrieval.status,
    error_code: retrieval.error_code,
    raw_candidate_count: retrieval.raw_count,
    valid_candidate_count: retrieval.valid_count,
    candidate_gate_pass: retrieval.candidate_gate_pass,
    candidate_gate_fail: retrieval.candidate_gate_fail,
  };
}

function classifyTaobaoRetrievalError(error, slotDeadlineAborted = false) {
  const code = safeErrorCode(error);
  if (code === "LOCAL_TO_RENDER_TIMEOUT") return "LOCAL_TO_RENDER_TIMEOUT";
  if (slotDeadlineAborted || [
    "TAOBAO_SLOT_TIMEOUT",
    "TAOBAO_TIMEOUT",
  ].includes(code)) {
    return "TAOBAO_SLOT_TIMEOUT";
  }
  if (code === "TAOBAO_NETWORK_ERROR" || taobaoCauseCode(error)) {
    return "TAOBAO_NETWORK_ERROR";
  }
  return "TAOBAO_PROVIDER_ERROR";
}

function taobaoCauseCode(error) {
  const retryableCodes = new Set([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);
  const queue = [error?.details?.cause_code, error?.cause, error];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current === "string") {
      const code = current.trim().toUpperCase();
      if (retryableCodes.has(code)) return code;
      continue;
    }
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    const code = String(current.code || "").trim().toUpperCase();
    if (retryableCodes.has(code)) return code;
    if (current.cause) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return "";
}

function parseAiJson(response, {
  allowSingleAssessmentWrapper = false,
  allowSingleLooksWrapper = false,
  onDiagnostic,
} = {}) {
  const content = response?.choices?.[0]?.message?.content;
  const diagnostic = {
    finish_reason: response?.choices?.[0]?.finish_reason ?? null,
    content_type: jsonValueType(content),
    content_length: typeof content === "string" ? content.length : 0,
    json_parse_success: false,
    parsed_json_type: null,
    schema_error_kind: null,
  };
  if (typeof content !== "string" || !content.trim()) {
    diagnostic.schema_error_kind = "INVALID_CONTENT";
    onDiagnostic?.(Object.freeze({...diagnostic}));
    throw schemaError("AI content is empty or not a string", "INVALID_CONTENT", diagnostic);
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    diagnostic.schema_error_kind = "INVALID_JSON";
    onDiagnostic?.(Object.freeze({...diagnostic}));
    throw schemaError("AI content is not valid JSON", "INVALID_JSON", diagnostic);
  }
  diagnostic.json_parse_success = true;
  diagnostic.parsed_json_type = jsonValueType(parsed);
  if (Array.isArray(parsed)) {
    diagnostic.array_length = parsed.length;
    diagnostic.first_item_type = parsed.length > 0 ? jsonValueType(parsed[0]) : null;
    if (diagnostic.first_item_type === "object") {
      diagnostic.first_item_keys = safeSchemaKeys(parsed[0]);
    }
  } else if (diagnostic.parsed_json_type === "object") {
    diagnostic.top_level_keys = safeSchemaKeys(parsed);
  }
  if (allowSingleLooksWrapper) {
    diagnostic.raw_array_length = Array.isArray(parsed) ? parsed.length : null;
    diagnostic.normalized_look_count = null;
  }
  if (allowSingleLooksWrapper && containsJsonSchemaMetadata(parsed)) {
    diagnostic.schema_error_kind = "COMPOSER_SCHEMA_ECHO";
    diagnostic.composer_raw_structure = "SCHEMA_ECHO";
    onDiagnostic?.(Object.freeze({...diagnostic}));
    throw schemaError(
      "Composer returned JSON Schema metadata instead of Looks",
      "COMPOSER_SCHEMA_ECHO",
      diagnostic,
    );
  }
  if (allowSingleAssessmentWrapper && isSingleAssessmentWrapper(parsed)) {
    parsed = parsed[0];
    diagnostic.parsed_json_type = "object";
    diagnostic.top_level_keys = safeSchemaKeys(parsed);
  } else if (allowSingleLooksWrapper) {
    if (isComposerObjectWrapper(parsed)) {
      diagnostic.composer_raw_structure = "OBJECT_WRAPPER";
      diagnostic.normalized_look_count = parsed.looks.length;
    } else if (isSingleLooksWrapper(parsed)) {
      parsed = parsed[0];
      diagnostic.parsed_json_type = "object";
      diagnostic.top_level_keys = safeSchemaKeys(parsed);
      diagnostic.composer_raw_structure = "SINGLE_ARRAY_WRAPPER";
      diagnostic.normalized_look_count = parsed.looks.length;
    } else if (isDirectLookArray(parsed)) {
      parsed = {looks: parsed};
      diagnostic.parsed_json_type = "object";
      diagnostic.top_level_keys = ["looks"];
      diagnostic.composer_raw_structure = "DIRECT_LOOK_ARRAY";
      diagnostic.normalized_look_count = parsed.looks.length;
    }
  }
  if (diagnostic.parsed_json_type !== "object") {
    if (allowSingleAssessmentWrapper && diagnostic.parsed_json_type === "array") {
      diagnostic.schema_error_kind = "INVALID_SELECTOR_ARRAY_WRAPPER";
    } else if (allowSingleLooksWrapper && diagnostic.parsed_json_type === "array") {
      diagnostic.schema_error_kind = "INVALID_COMPOSER_ARRAY_WRAPPER";
    } else {
      diagnostic.schema_error_kind = topLevelSchemaErrorKind(diagnostic.parsed_json_type);
    }
    onDiagnostic?.(Object.freeze({...diagnostic}));
    throw schemaError(
      `AI JSON top level must be an object, received ${diagnostic.parsed_json_type}`,
      diagnostic.schema_error_kind,
      diagnostic,
    );
  }
  onDiagnostic?.(Object.freeze({...diagnostic}));
  return parsed;
}

function isSingleAssessmentWrapper(value) {
  return Array.isArray(value) &&
    value.length === 1 &&
    value[0] &&
    typeof value[0] === "object" &&
    !Array.isArray(value[0]) &&
    Array.isArray(value[0].assessments);
}

function isSingleLooksWrapper(value) {
  return Array.isArray(value) &&
    value.length === 1 &&
    value[0] &&
    typeof value[0] === "object" &&
    !Array.isArray(value[0]) &&
    Array.isArray(value[0].looks);
}

function isComposerObjectWrapper(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray(value.looks);
}

function containsJsonSchemaMetadata(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const keys = new Set(Object.keys(item));
    return keys.has("properties") && (
      keys.has("type") ||
      keys.has("additionalProperties") ||
      keys.has("required") ||
      keys.has("items")
    );
  });
}

function isDirectLookArray(value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every(isComposerLookObject);
}

function isComposerLookObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const requiredKeys = OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.required;
  const allowedKeys = Object.keys(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties,
  );
  if (!requiredKeys.every((key) => Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    return false;
  }
  if (!["look_id", "top_candidate_id", "bottom_candidate_id", "shoes_candidate_id"]
    .every((key) => typeof value[key] === "string" && value[key].trim())) {
    return false;
  }
  if (!value.scores || typeof value.scores !== "object" || Array.isArray(value.scores)) {
    return false;
  }
  const scoreKeys = Object.keys(COMPOSER_SCORE_PROPERTIES);
  return scoreKeys.every((key) => Number.isFinite(value.scores[key]) &&
      value.scores[key] >= 0 && value.scores[key] <= 100) &&
    Object.keys(value.scores).every((key) => scoreKeys.includes(key));
}

function jsonValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  return ["object", "string", "number", "boolean"].includes(type) ? type : "other";
}

function safeSchemaKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, 20).map((key) => String(key)
    .replace(/[^\p{L}\p{N}_.:-]/gu, "_")
    .slice(0, 80));
}

function topLevelSchemaErrorKind(type) {
  const kinds = {
    array: "TOP_LEVEL_ARRAY",
    string: "TOP_LEVEL_STRING",
    number: "TOP_LEVEL_NUMBER",
    boolean: "TOP_LEVEL_BOOLEAN",
    null: "TOP_LEVEL_NULL",
  };
  return kinds[type] || "TOP_LEVEL_OTHER";
}

function normalizeScoreObject(value, keys, {
  requireRawNumber = false,
  lookId = null,
  onScoreError,
} = {}) {
  if (!requireRawNumber) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw schemaError("score object is required");
    }
    return Object.fromEntries(keys.map((key) => {
      const score = Number(value[key]);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw schemaError(`${key} must be between 0 and 100`);
      }
      return [key, score];
    }));
  }
  const scoreObject = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.fromEntries(keys.map((key) => {
    const present = Object.hasOwn(scoreObject, key);
    const rawValue = present ? scoreObject[key] : undefined;
    let scoreErrorKind = null;
    if (!present) {
      scoreErrorKind = "MISSING_SCORE";
    } else if (typeof rawValue !== "number") {
      scoreErrorKind = "NON_NUMERIC_SCORE";
    } else {
      const score = rawValue;
      if (!Number.isFinite(score)) {
        scoreErrorKind = typeof score === "number"
          ? "NON_FINITE_SCORE"
          : "NON_NUMERIC_SCORE";
      } else if (score < 0) {
        scoreErrorKind = "SCORE_BELOW_ZERO";
      } else if (score > 100) {
        scoreErrorKind = "SCORE_ABOVE_100";
      } else {
        return [key, score];
      }
    }
    const diagnostic = Object.freeze({
      look_id: lookId,
      score_field: key,
      raw_type: scoreRawType(rawValue, present),
      raw_value: safeRawScoreValue(rawValue, present),
      score_error_kind: scoreErrorKind,
    });
    onScoreError?.(diagnostic);
    throw scoreValidationError(diagnostic);
  }));
}

function scoreRawType(value, present) {
  if (!present) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function safeRawScoreValue(value, present) {
  if (!present) return null;
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean" || value === null) return value;
  return null;
}

function scoreValidationError(diagnostic) {
  const messages = {
    MISSING_SCORE: `${diagnostic.score_field} is required`,
    NON_NUMERIC_SCORE: `${diagnostic.score_field} must be a JSON number`,
    NON_FINITE_SCORE: `${diagnostic.score_field} must be finite`,
    SCORE_BELOW_ZERO: `${diagnostic.score_field} must be at least 0`,
    SCORE_ABOVE_100: `${diagnostic.score_field} must be at most 100`,
  };
  const error = schemaError(
    messages[diagnostic.score_error_kind],
    diagnostic.score_error_kind,
  );
  error.details = Object.freeze({
    ...error.details,
    ...diagnostic,
  });
  return error;
}

function neutralCandidateId(index) {
  return `candidate_${String(index).padStart(3, "0")}`;
}

function candidateEvidence(product) {
  return [product?.title, product?._category_text, product?.brand, product?.shop_name]
    .filter(Boolean).join(" ").toLowerCase();
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, item]) => [
    text(key, 80),
    typeof item === "string" || typeof item === "number" || typeof item === "boolean"
      ? item
      : Array.isArray(item)
        ? item.slice(0, 20).map((entry) => text(entry, 120)).filter(Boolean)
        : text(JSON.stringify(item), 500),
  ]));
}

function stringList(value, limit) {
  if (!Array.isArray(value)) throw schemaError("expected an array");
  return [...new Set(value.map((item) => text(item, 160)).filter(Boolean))].slice(0, limit);
}

function optionalPositiveNumber(value, minimum, maximum) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new ShoppingAgentV1Error("身体数据无效", {
      code: "INVALID_SHOPPING_AGENT_INPUT",
      status: 400,
    });
  }
  return number;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function text(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function schemaError(message, schemaErrorKind = "INVALID_STRUCTURE", structuredOutput) {
  const error = new ShoppingAgentV1Error(message, {
    code: "SHOPPING_AGENT_SCHEMA_INVALID",
    status: 502,
    details: {
      schema_error_kind: schemaErrorKind,
      ...(structuredOutput ? {structured_output: Object.freeze({...structuredOutput})} : {}),
    },
  });
  error.schema_error_kind = schemaErrorKind;
  error.finish_reason = structuredOutput?.finish_reason ?? null;
  return error;
}

function safeErrorCode(error) {
  return String(error?.code || error?.name || "UNKNOWN_ERROR").slice(0, 120);
}

module.exports = {
  COMPOSER_SCORE_PROPERTIES,
  CORE_CATEGORIES,
  DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
  DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
  MAX_SELECTED_CANDIDATES_PER_SLOT,
  MAX_VALID_CANDIDATES_PER_SLOT,
  MAX_REFINEMENT_ROUNDS,
  OUTFIT_COMPOSITION_SCHEMA,
  POOL_HOMOGENEITY,
  PRICE_POSITION,
  PRODUCT_SELECTION_SCHEMA,
  SELECTION_TIER,
  SELECTOR_STATUS,
  SHOPPING_PLAN_SCHEMA,
  ShoppingAgentV1Error,
  TaobaoShoppingAgentV1,
  buildPriceContext,
  candidatePoolDiversity,
  candidateVariationAxes,
  enrichCandidatePriceContext,
  classifyTaobaoRetrievalError,
  explicitGenderConflict,
  hardGateCandidate,
  normalizeAgentInput,
  normalizeBudgetContext,
  normalizeRefinementQuery,
  normalizeSearchQuery,
  normalizeShoppingIntent,
  parseAiJson,
  refinementDecision,
  selectFinalCandidatePool,
  selectorQualityScore,
  validateComposedLooks,
  validateProductSelection,
};
