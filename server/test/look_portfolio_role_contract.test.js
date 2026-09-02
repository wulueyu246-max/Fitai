"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const fixture = require("../evaluation/golden/look_portfolio_role_v1.json");
const {
  PORTFOLIO_ROLES,
  REQUIRED_INPUTS,
  ROLE_ORDER,
  evaluateLookPortfolioRoles,
} = require("../evaluation/look_portfolio_role_contract");

function byLook(result) {
  return new Map(result.assignments.map((assignment) => [
    assignment.look_id,
    assignment,
  ]));
}

test("three Looks receive the user-confirmed signature/balanced/refined roles", () => {
  const result = evaluateLookPortfolioRoles(fixture);
  const assigned = byLook(result);
  assert.equal(result.status, "PASS");
  assert.equal(result.look_count_preserved, true);
  assert.equal(result.assignments.length, 3);
  assert.deepEqual(new Set(result.assignments.map(({role}) => role)),
    new Set(ROLE_ORDER));
  fixture.looks.forEach((look) => {
    assert.equal(assigned.get(look.look_id).role, look.expected_role);
    assert.ok(assigned.get(look.look_id).reason.length > 20);
    assert.ok(assigned.get(look.look_id).target_user.length > 10);
  });
});

test("role assignment is portfolio-wide and independent of input order", () => {
  const forward = byLook(evaluateLookPortfolioRoles(fixture));
  const reversed = byLook(evaluateLookPortfolioRoles({
    looks: [...fixture.looks].reverse(),
  }));
  for (const look of fixture.looks) {
    assert.equal(reversed.get(look.look_id).role, forward.get(look.look_id).role);
  }
});

test("classification follows score evidence instead of Look ids", () => {
  const renamed = {
    looks: fixture.looks.map((look, index) => ({
      ...structuredClone(look),
      look_id: ["neutral-c", "neutral-a", "neutral-b"][index],
    })),
  };
  const result = evaluateLookPortfolioRoles(renamed);
  const rolesByOriginalIndex = renamed.looks.map((look) =>
    byLook(result).get(look.look_id).role);
  assert.deepEqual(rolesByOriginalIndex, [
    "REFINED_LOOK",
    "BALANCED_LOOK",
    "SIGNATURE_LOOK",
  ]);
});

test("portfolio roles preserve ordinary Looks instead of keeping only Top score", () => {
  const result = evaluateLookPortfolioRoles(fixture);
  const highest = [...fixture.looks].sort((left, right) =>
    right.human_grounded_score - left.human_grounded_score)[0];
  assert.equal(result.assignments.find(({role}) => role === "SIGNATURE_LOOK")
    .look_id, highest.look_id);
  assert.equal(result.assignments.some(({look_id}) => look_id === "look-1"), true);
  assert.equal(result.assignments.some(({look_id}) => look_id === "look-2"), true);
  assert.equal(result.selection_policy,
    "GLOBAL_ROLE_FIT_NOT_LOOK_ORDER_OR_HIGHEST_SCORE_ONLY");
});

test("balanced role responds to Body Fit, comfort and risk", () => {
  const modified = structuredClone(fixture);
  modified.looks[0].body_fit_score = 98;
  modified.looks[0].comfort_score = 98;
  modified.looks[0].risk_score = 2;
  modified.looks[1].body_fit_score = 65;
  modified.looks[1].comfort_score = 62;
  modified.looks[1].risk_score = 45;
  const result = evaluateLookPortfolioRoles(modified);
  assert.equal(byLook(result).get("look-1").role, "BALANCED_LOOK");
  assert.notEqual(byLook(result).get("look-2").role, "BALANCED_LOOK");
});

test("missing role evidence fails closed instead of assigning randomly", () => {
  const incomplete = structuredClone(fixture);
  delete incomplete.looks[0].comfort_score;
  const result = evaluateLookPortfolioRoles(incomplete);
  assert.equal(result.status, "FAIL");
  assert.equal(result.assignments.length, 0);
  assert.ok(result.errors.includes("ROLE_INPUT_MISSING:look-1:comfort_score"));
  assert.deepEqual(REQUIRED_INPUTS, [
    "human_grounded_score",
    "intent_expression_score",
    "scene_expression_strength",
    "design_interest",
    "overall_memorability",
    "body_fit_score",
    "comfort_score",
    "risk_score",
  ]);
});

test("contract defines role responsibilities without scene, gender or product hardcode", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "evaluation",
    "look_portfolio_role_contract.js"), "utf8");
  assert.equal(Object.keys(PORTFOLIO_ROLES).length, 3);
  assert.doesNotMatch(source,
    /female|nightlife|look-1|look-2|look-3|product_id|candidate_id/iu);
});
