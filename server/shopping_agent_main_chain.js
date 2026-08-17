"use strict";

const CORE_SLOTS = Object.freeze(["top", "bottom", "shoes"]);

function shoppingAgentFeatureEnabled(
  environment = process.env,
  nodeEnvironment = environment.NODE_ENV,
) {
  const configured = String(environment.SHOPPING_AGENT_V1_ENABLED || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(configured)) return true;
  if (["false", "0", "no", "off"].includes(configured)) return false;
  return nodeEnvironment === "test";
}

function buildShoppingAgentMainInput(outfitRequest, analysis, requestId) {
  const context = plainObject(outfitRequest?.context);
  const weather = plainObject(context.weather);
  const authoritativeGender = normalizeGender(
    outfitRequest?.authoritative_gender || outfitRequest?.gender,
  );
  return {
    request_id: String(requestId || outfitRequest?.requestId || "").trim(),
    user_input: String(
      outfitRequest?.user_input || outfitRequest?.request || "",
    ).trim(),
    authoritative_gender: authoritativeGender,
    gender: authoritativeGender,
    height: outfitRequest?.height,
    weight: outfitRequest?.weight,
    body_profile: {
      ...plainObject(context.body_profile),
      analysis: String(analysis?.bodyProfile || "").trim(),
    },
    persona: {
      gender: authoritativeGender,
      style_expression: String(analysis?.style_expression || "").trim(),
      style: String(analysis?.style || "").trim(),
      styling_constitution: plainObject(analysis?.styling_constitution),
      style_anchor: plainObject(analysis?.style_anchor),
      outfit_blueprint: plainObject(analysis?.outfit_blueprint),
    },
    occasion: String(context.scene || outfitRequest?.scene || "").trim(),
    weather: {
      ...weather,
      constraints: Array.isArray(context.weather_constraints)
        ? context.weather_constraints
        : [],
    },
    budget: {
      item_budget: numericBudget(outfitRequest?.itemBudget),
      outfit_budget: numericBudget(outfitRequest?.outfitBudget),
    },
  };
}

async function integrateShoppingAgentMainChain({
  enabled,
  agent,
  basePayload,
  outfitRequest,
  analysis,
  requestId,
  now = () => new Date(),
}) {
  if (!enabled) {
    return {
      ...basePayload,
      shopping_agent_status: "disabled",
    };
  }

  const agentRequestId = String(requestId || outfitRequest?.requestId || "").trim();
  try {
    const result = await agent.run(
      buildShoppingAgentMainInput(outfitRequest, analysis, agentRequestId),
    );
    if (result?.state !== "success") {
      return attachShoppingAgentFailure(basePayload, {
        requestId: result?.request_id || agentRequestId,
        firstFailureStage: firstFailureStage(result),
        retryable: result?.state === "retryable",
        code: result?.reason || "SHOPPING_AGENT_FAILED",
      });
    }
    return adaptShoppingAgentSuccess(result, {
      basePayload,
      outfitRequest,
      now,
    });
  } catch (error) {
    return attachShoppingAgentFailure(basePayload, {
      requestId: agentRequestId,
      firstFailureStage: firstFailureStage(error),
      retryable: isRetryableShoppingAgentError(error),
      code: error?.code || "SHOPPING_AGENT_FAILED",
    });
  }
}

function adaptShoppingAgentSuccess(result, {
  basePayload = {},
  outfitRequest = {},
  now = () => new Date(),
} = {}) {
  if (result?.state !== "success" || !Array.isArray(result.looks)) {
    throw integrationError("Shopping Agent success payload is invalid");
  }
  if (result.looks.length < 2) {
    throw integrationError("Shopping Agent returned fewer than two Looks");
  }

  const requestId = String(result.request_id || outfitRequest.requestId || "").trim();
  const gender = normalizeGender(
    result.authoritative_gender || outfitRequest.authoritative_gender || outfitRequest.gender,
  );
  const style = String(
    result.shopping_intent?.overall_aesthetic?.core_direction || basePayload.style || "",
  ).trim();
  const scene = String(outfitRequest.scene || "日常").trim() || "日常";
  const createdTime = now().toISOString();
  const productsById = new Map();

  const shoppingAgentLooks = result.looks.map((look, index) => {
    const lookId = String(look?.look_id || `shopping-look-${index + 1}`).trim();
    const scores = plainObject(look?.scores);
    const mappedItems = Object.fromEntries(CORE_SLOTS.map((slot) => {
      const candidate = look?.items?.[slot];
      const mapped = mapCandidateProduct(candidate, {
        slot,
        lookId,
        requestId,
        gender,
      });
      if (!productsById.has(mapped.candidate_id)) {
        productsById.set(mapped.candidate_id, mapped);
      }
      return [slot, mapped];
    }));
    const finalScore = score(scores.final_score);
    const explanation = style
      ? `基于真实淘宝候选组成的${style}方案，整套评分 ${finalScore}。`
      : `基于真实淘宝候选组成的完整方案，整套评分 ${finalScore}。`;
    return {
      look_id: lookId,
      ...mappedItems,
      explanation,
      final_score: finalScore,
      scores,
    };
  });

  const products = [...productsById.values()];
  const outfitPlans = shoppingAgentLooks.map((look, index) => ({
    id: `shopping-agent-${look.look_id}`,
    title: `真实商品 Look ${index + 1}`,
    top: look.top,
    bottom: look.bottom,
    shoes: look.shoes,
    reason: look.explanation,
    createdTime,
    scene,
    style,
    style_direction: style,
    gender,
    request_id: requestId,
    look_id: look.look_id,
    matchScore: Math.round(look.final_score),
  }));

  return {
    ...basePayload,
    request_id: requestId || basePayload.request_id,
    gender,
    shopping_agent_status: "success",
    shopping_agent_request_id: requestId,
    shopping_agent_first_failure_stage: null,
    shopping_agent_retryable: false,
    shopping_agent_looks: shoppingAgentLooks,
    shopping_agent_products: products,
    outfit_plans: outfitPlans,
    outfit_plan: outfitPlans[0],
    recommendations: {
      ...plainObject(basePayload.recommendations),
      products,
    },
  };
}

function mapCandidateProduct(candidate, {slot, lookId, requestId, gender}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw integrationError(`${slot} candidate is missing`);
  }
  const candidateId = String(candidate.candidate_id || "").trim();
  const title = String(candidate.title || "").trim();
  const image = String(candidate.image_url || candidate.image || "").trim();
  const purchaseUrl = String(candidate.purchase_url || "").trim();
  const price = Number(candidate.price);
  if (!candidateId || !title || !image || !purchaseUrl || !Number.isFinite(price)) {
    throw integrationError(`${slot} candidate mapping is incomplete`);
  }
  const selectorScores = plainObject(candidate.selector_scores);
  return {
    id: candidateId,
    candidate_id: candidateId,
    product_id: candidateId,
    source_product_id: String(candidate.product_id || "").trim(),
    title,
    name: title,
    category: slot,
    image,
    image_url: image,
    price,
    purchase_url: purchaseUrl,
    affiliate_url: purchaseUrl,
    detail_url: purchaseUrl,
    brand: String(candidate.brand || "精选商品").trim() || "精选商品",
    shop_name: String(candidate.shop_name || "").trim(),
    platform: "taobao",
    source: "taobao",
    source_provider: "taobao",
    stock_status: "in_stock",
    is_mock: false,
    request_id: requestId,
    look_id: lookId,
    gender,
    selection_tier: candidate.selection_tier,
    aesthetic_score: score(
      selectorScores.aesthetic_fit ?? candidate.selector_quality_score,
    ),
    final_score: score(candidate.selector_quality_score),
    recommendation_reason: "Shopping Agent 视觉选品与整套组合结果",
  };
}

function attachShoppingAgentFailure(basePayload, {
  requestId,
  firstFailureStage,
  retryable,
  code,
}) {
  return {
    ...basePayload,
    shopping_agent_status: "failed",
    shopping_agent_request_id: String(requestId || "").trim(),
    shopping_agent_first_failure_stage: firstFailureStage || "shopping_agent",
    shopping_agent_retryable: retryable === true,
    shopping_agent_error_code: String(code || "SHOPPING_AGENT_FAILED"),
    shopping_agent_looks: [],
    shopping_agent_products: [],
    outfit_plans: [],
    outfit_plan: null,
    recommendations: {
      ...plainObject(basePayload?.recommendations),
      products: [],
    },
  };
}

function firstFailureStage(value) {
  const explicit = value?.first_failure_stage ||
    value?.details?.phase ||
    value?.phase;
  if (explicit) return String(explicit);
  const code = String(value?.code || value?.reason || "").toUpperCase();
  if (/TAOBAO|RETRIEVAL|PROVIDER/.test(code)) return "taobao_retrieval";
  if (/REFINEMENT_QUERY/.test(code)) return "product_selector_refinement";
  if (/SELECTOR/.test(code)) return "product_selector";
  if (/COMPOSER|LOOK/.test(code)) return "real_product_outfit_composer";
  if (/INTENT|SEARCH_PLAN|SCHEMA/.test(code)) return "shopping_intent_search_plan";
  if (/CANDIDATE|HARD_GATE/.test(code)) return "candidate_gate";
  return "shopping_agent";
}

function isRetryableShoppingAgentError(error) {
  if (typeof error?.retryable === "boolean") return error.retryable;
  const code = String(error?.code || "").toUpperCase();
  return /TIMEOUT|NETWORK|AI_FAILED|PROVIDER|INSUFFICIENT/.test(code);
}

function integrationError(message) {
  const error = new Error(message);
  error.code = "SHOPPING_AGENT_RESPONSE_ADAPTER_INVALID";
  return error;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["female", "女", "女性", "女士"].includes(normalized)) return "female";
  if (["male", "男", "男性", "男士"].includes(normalized)) return "male";
  return "unisex";
}

function numericBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

module.exports = {
  adaptShoppingAgentSuccess,
  attachShoppingAgentFailure,
  buildShoppingAgentMainInput,
  integrateShoppingAgentMainChain,
  shoppingAgentFeatureEnabled,
};
