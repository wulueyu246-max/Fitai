"use strict";

const CONTRACT_VERSION = "look_portfolio_role_contract.v1";

const PORTFOLIO_ROLES = Object.freeze({
  SIGNATURE_LOOK: Object.freeze({
    target_user: "优先追求场景表达、设计感和记忆点，能接受适度造型风险的用户",
    weights: Object.freeze({
      human_grounded_score: 0.18,
      intent_expression_score: 0.22,
      scene_expression_strength: 0.16,
      design_interest: 0.18,
      overall_memorability: 0.12,
      body_fit_score: 0.05,
      comfort_score: 0.04,
      safety_score: 0.05,
    }),
  }),
  BALANCED_LOOK: Object.freeze({
    target_user: "优先好穿、身材适配和低风险，希望稳定出门的用户",
    weights: Object.freeze({
      human_grounded_score: 0.18,
      intent_expression_score: 0.10,
      scene_expression_strength: 0.04,
      design_interest: 0.03,
      overall_memorability: 0.03,
      body_fit_score: 0.24,
      comfort_score: 0.23,
      safety_score: 0.15,
    }),
  }),
  REFINED_LOOK: Object.freeze({
    target_user: "希望从日常穿着向更有审美的方向升级，但不想过度冒险的用户",
    weights: Object.freeze({
      human_grounded_score: 0.22,
      intent_expression_score: 0.20,
      scene_expression_strength: 0.07,
      design_interest: 0.10,
      overall_memorability: 0.08,
      body_fit_score: 0.12,
      comfort_score: 0.12,
      safety_score: 0.09,
    }),
  }),
});

const ROLE_ORDER = Object.freeze(Object.keys(PORTFOLIO_ROLES));
const REQUIRED_INPUTS = Object.freeze([
  "human_grounded_score",
  "intent_expression_score",
  "scene_expression_strength",
  "design_interest",
  "overall_memorability",
  "body_fit_score",
  "comfort_score",
  "risk_score",
]);

function evaluateLookPortfolioRoles(input = {}) {
  const looks = Array.isArray(input.looks) ? input.looks : [];
  const normalized = looks.map(normalizeLook);
  const errors = [];
  if (normalized.length !== ROLE_ORDER.length) {
    errors.push("PORTFOLIO_ROLE_REQUIRES_EXACTLY_THREE_LOOKS");
  }
  const ids = normalized.map(({look_id: id}) => id).filter(Boolean);
  if (ids.length !== normalized.length || new Set(ids).size !== ids.length) {
    errors.push("PORTFOLIO_ROLE_LOOK_ID_INVALID");
  }
  for (const look of normalized) {
    for (const key of REQUIRED_INPUTS) {
      if (look[key] == null) errors.push(`ROLE_INPUT_MISSING:${look.look_id}:${key}`);
    }
  }
  if (errors.length > 0) {
    return deepFreeze({
      version: CONTRACT_VERSION,
      status: "FAIL",
      assignments: [],
      errors: unique(errors),
    });
  }

  const matrix = new Map(normalized.map((look) => [
    look.look_id,
    Object.fromEntries(ROLE_ORDER.map((role) => [
      role,
      roleFitScore(look, PORTFOLIO_ROLES[role].weights),
    ])),
  ]));
  const assignment = bestAssignment(normalized, matrix);
  const assignments = assignment.map(({look, role}) => deepFreeze({
    look_id: look.look_id,
    role,
    reason: roleReason(role, look, normalized),
    target_user: PORTFOLIO_ROLES[role].target_user,
    role_fit_score: matrix.get(look.look_id)[role],
  })).sort((left, right) => ids.indexOf(left.look_id) - ids.indexOf(right.look_id));

  return deepFreeze({
    version: CONTRACT_VERSION,
    status: "PASS",
    assignments,
    role_coverage: Object.fromEntries(ROLE_ORDER.map((role) => [
      role,
      assignments.some((entry) => entry.role === role),
    ])),
    look_count_preserved: assignments.length === looks.length,
    selection_policy: "GLOBAL_ROLE_FIT_NOT_LOOK_ORDER_OR_HIGHEST_SCORE_ONLY",
    errors: [],
  });
}

function normalizeLook(input = {}) {
  const intent = object(input.intent_expression);
  return {
    look_id: string(input.look_id),
    human_grounded_score: score(input.human_grounded_score),
    intent_expression_score: score(
      input.intent_expression_score ?? intent.score,
    ),
    scene_expression_strength: score(
      input.scene_expression_strength ?? intent.scene_expression_strength,
    ),
    design_interest: score(input.design_interest ?? intent.design_interest),
    overall_memorability: score(
      input.overall_memorability ?? intent.overall_memorability,
    ),
    body_fit_score: score(input.body_fit_score),
    comfort_score: score(input.comfort_score),
    risk_score: score(input.risk_score),
  };
}

function roleFitScore(look, weights) {
  const values = {...look, safety_score: 100 - look.risk_score};
  return round(Object.entries(weights).reduce((sum, [key, weight]) =>
    sum + values[key] * weight, 0));
}

function bestAssignment(looks, matrix) {
  const permutations = permute(looks);
  return permutations.map((orderedLooks) => ({
    assignments: ROLE_ORDER.map((role, index) => ({
      role,
      look: orderedLooks[index],
    })),
    score: round(ROLE_ORDER.reduce((sum, role, index) =>
      sum + matrix.get(orderedLooks[index].look_id)[role], 0)),
  })).sort((left, right) => right.score - left.score ||
    assignmentKey(left.assignments).localeCompare(assignmentKey(right.assignments)))[0]
    .assignments;
}

function assignmentKey(assignments) {
  return assignments.map(({look, role}) => `${role}:${look.look_id}`).join("|");
}

function permute(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permute([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((rest) => [value, ...rest]));
}

function roleReason(role, look, portfolio) {
  if (role === "SIGNATURE_LOOK") {
    const strongestExpression = maximum(portfolio, (item) => expressionScore(item));
    return `场景/设计/记忆表达 ${round(expressionScore(look))}，` +
      `Human-Grounded ${look.human_grounded_score}；` +
      (look.look_id === strongestExpression.look_id
        ? "是组合中表达最强的造型。" : "承担组合中的高表达造型角色。");
  }
  if (role === "BALANCED_LOOK") {
    const reliability = round(balanceScore(look));
    return `Body Fit ${look.body_fit_score}、舒适度 ${look.comfort_score}、` +
      `风险 ${look.risk_score}；稳定适配指数 ${reliability}，负责低风险好穿。`;
  }
  return `Human-Grounded ${look.human_grounded_score}、Intent Expression ` +
    `${look.intent_expression_score}、风险 ${look.risk_score}；` +
    "在日常可穿基础上提供适度审美升级。";
}

function expressionScore(look) {
  return average([
    look.intent_expression_score,
    look.scene_expression_strength,
    look.design_interest,
    look.overall_memorability,
  ]);
}

function balanceScore(look) {
  return average([look.body_fit_score, look.comfort_score, 100 - look.risk_score]);
}

function maximum(values, accessor) {
  return [...values].sort((left, right) => accessor(right) - accessor(left) ||
    left.look_id.localeCompare(right.look_id))[0];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function score(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

module.exports = {
  CONTRACT_VERSION,
  PORTFOLIO_ROLES,
  REQUIRED_INPUTS,
  ROLE_ORDER,
  evaluateLookPortfolioRoles,
};
