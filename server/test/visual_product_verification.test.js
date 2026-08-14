"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  VISUAL_STATUS,
  VisualProductVerifier,
  applyVisualVerification,
  buildVisualVerificationMessages,
  normalizeVisualAssessment,
  normalizeVisualResponsePayload,
  visualFallbackCandidates,
} = require("../visual_product_verification");

function product(id, overrides = {}) {
  return {
    product_id: id,
    title: `product ${id}`,
    image_url: `https://img.example.com/${id}.jpg`,
    candidate_gate_state: "PASS",
    product_aesthetic_score: 82,
    sales: 100,
    ...overrides,
  };
}

function assessment(candidateId, visualStatus, overrides = {}) {
  return {
    candidate_id: candidateId,
    visual_status: visualStatus,
    visual_match_score: 85,
    category_match: 90,
    silhouette_match: 82,
    style_match: 84,
    material_visual_match: 75,
    avoid_conflicts: [],
    visual_tags: [],
    reason_codes: [],
    ...overrides,
  };
}

const cuteShoeRequirement = Object.freeze({
  request_id: "visual-request",
  look_id: "look-1",
  slot_key: "visual-request:look-1:shoes:0",
  category: "shoes",
  product_type: "低跟玛丽珍鞋",
  product_family: "mary_jane",
  gender: "female",
  required_attributes: ["非明显运动"],
  preferred_attributes: ["轻盈"],
  avoid_attributes: ["运动感", "厚重运动鞋"],
  style_role: "可爱精致",
  fit: "低跟轻量",
});

const cuteContext = Object.freeze({
  outfit_blueprint: {
    style_anchor: {
      core_style_anchor: "可爱",
      allowed_style_variants: ["学院可爱", "法式可爱"],
      disallowed_style_drift: ["成熟极简", "运动休闲"],
    },
  },
});

test("visual verification keeps PASS, ranks UNCERTAIN after it, and removes FAIL", () => {
  const products = [
    product("refined-mary-jane"),
    product("uncertain-sheer-top"),
    product("sporty-mary-jane"),
  ];
  const result = applyVisualVerification(products, {assessments: [
    assessment("refined-mary-jane", "PASS", {
      visual_tags: ["玛丽珍", "轻盈", "女性化"],
    }),
    assessment("uncertain-sheer-top", "UNCERTAIN", {
      visual_match_score: 58,
      style_match: 55,
      reason_codes: ["IMAGE_EVIDENCE_INSUFFICIENT"],
    }),
    assessment("sporty-mary-jane", "PASS", {
      visual_match_score: 20,
      silhouette_match: 15,
      style_match: 20,
      avoid_conflicts: ["厚重运动鞋底"],
      visual_tags: ["运动结构", "厚重"],
      reason_codes: ["SPORTY_CONFLICT", "BULKY_SILHOUETTE"],
    }),
  ]});

  assert.deepEqual(result.map((item) => item.product_id), [
    "refined-mary-jane",
    "uncertain-sheer-top",
  ]);
  assert.equal(result[0].visual_status, "PASS");
  assert.equal(result[1].visual_status, "UNCERTAIN");
});

test("stable visual reason codes reject style-anchor drift and sheer conflicts", () => {
  const matureDrift = normalizeVisualAssessment(assessment("mature-black-dress", "FAIL", {
    style_match: 18,
    reason_codes: ["MATURE_STYLE_DRIFT", "LOW_STYLE_MATCH"],
  }));
  const sheer = normalizeVisualAssessment(assessment("sheer-camisole", "FAIL", {
    avoid_conflicts: ["明显透视吊带结构"],
    reason_codes: ["TOO_SHEER"],
  }));

  assert.equal(matureDrift.visual_status, VISUAL_STATUS.FAIL);
  assert.ok(matureDrift.reason_codes.includes("MATURE_STYLE_DRIFT"));
  assert.equal(sheer.visual_status, VISUAL_STATUS.FAIL);
});

test("a visually mature loose top cannot outrank a young cute top", () => {
  const result = applyVisualVerification([
    product("cute-puff-sleeve"),
    product("mature-loose-top", {sales: 99999}),
  ], {assessments: [
    assessment("cute-puff-sleeve", "PASS", {
      visual_match_score: 92,
      silhouette_match: 90,
      style_match: 94,
      visual_tags: ["泡泡袖", "年轻", "可爱"],
    }),
    assessment("mature-loose-top", "UNCERTAIN", {
      visual_match_score: 38,
      silhouette_match: 42,
      style_match: 40,
      visual_tags: ["成熟", "宽松休闲"],
      reason_codes: ["LOW_STYLE_MATCH"],
    }),
  ]});

  assert.deepEqual(result.map((item) => item.product_id), [
    "cute-puff-sleeve",
    "mature-loose-top",
  ]);
  assert.equal(result[1].visual_status, "UNCERTAIN");
});

test("sport requirements do not cause the verifier to reject running shoes", () => {
  const result = applyVisualVerification([product("running-shoe")], {
    assessments: [assessment("running-shoe", "PASS", {
      visual_tags: ["跑鞋", "轻量", "运动"],
      reason_codes: [],
    })],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].visual_status, "PASS");
});

test("mature pointed heels pass visual inspection", () => {
  const result = applyVisualVerification([product("pointed-heel")], {
    assessments: [assessment("pointed-heel", "PASS", {
      visual_tags: ["尖头", "细跟", "结构感"],
      style_match: 94,
      silhouette_match: 92,
    })],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].visual_status, "PASS");
});

test("visual response normalization preserves the canonical object payload", () => {
  const one = assessment("one", "PASS");
  assert.deepEqual(
    normalizeVisualResponsePayload({assessments: [one]}),
    {assessments: [one]},
  );
});

test("visual response normalization merges strict array wrappers", () => {
  const one = assessment("one", "PASS");
  const two = assessment("two", "UNCERTAIN");
  assert.deepEqual(normalizeVisualResponsePayload([
    {assessments: [one]},
    {assessments: [two]},
  ]), {assessments: [one, two]});
});

test("visual response normalization rejects array elements without assessments", () => {
  assert.throws(
    () => normalizeVisualResponsePayload([{assessments: []}, {items: []}]),
    /VISUAL_RESPONSE_STRUCTURE_INVALID/,
  );
});

test("visual response normalization rejects invalid top-level payloads", () => {
  for (const payload of [null, "invalid", 42, true, [], {items: []}]) {
    assert.throws(
      () => normalizeVisualResponsePayload(payload),
      /VISUAL_RESPONSE_STRUCTURE_INVALID/,
    );
  }
});

test("visual response normalization rejects missing and duplicate candidate IDs", () => {
  assert.throws(
    () => normalizeVisualResponsePayload({assessments: [
      assessment("", "PASS"),
    ]}),
    /VISUAL_RESPONSE_CANDIDATE_ID_MISSING/,
  );
  assert.throws(
    () => normalizeVisualResponsePayload([
      {assessments: [assessment("same", "PASS")]},
      {assessments: [assessment("same", "UNCERTAIN")]},
    ]),
    /VISUAL_RESPONSE_CANDIDATE_ID_DUPLICATE/,
  );
});

test("one slot is sent as one privacy-minimized multi-image call", async () => {
  let calls = 0;
  const verifier = new VisualProductVerifier({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        assert.equal(request.response_format.type, "json_schema");
        const content = request.messages[1].content;
        assert.equal(content.filter((part) => part.type === "image_url").length, 2);
        const prompt = JSON.stringify(content);
        assert.equal(prompt.includes("用户原始私密描述"), false);
        assert.equal(prompt.includes("weather"), false);
        assert.equal(prompt.includes("user_photo"), false);
        return {
          choices: [{message: {content: JSON.stringify({assessments: [
            assessment("one", "PASS"),
            assessment("two", "UNCERTAIN", {
              visual_match_score: 55,
              reason_codes: ["IMAGE_EVIDENCE_INSUFFICIENT"],
            }),
          ]})}}],
        };
      }}},
    },
    model: "qwen3.7-plus",
    maxCandidatesPerSlot: 10,
    logger: {info() {}},
  });
  const result = await verifier.verifyGroups({
    groups: [{
      requirement: cuteShoeRequirement,
      candidates: [product("one"), product("two")],
    }],
    context: {
      ...cuteContext,
      user_input: "用户原始私密描述",
      weather: {description: "unrelated weather"},
      user_photo: "private-image",
    },
    requestId: "visual-request",
  });

  assert.equal(calls, 1);
  assert.equal(result.summary.visual_call_count, 1);
  assert.equal(result.summary.candidate_count, 2);
  assert.equal(result.groups[0].candidates.length, 2);
});

test("visual service failure falls back only to gate PASS and high aesthetic candidates", async () => {
  const verifier = new VisualProductVerifier({
    client: {chat: {completions: {create: async () => {
      throw Object.assign(new Error("VISUAL_TIMEOUT"), {code: "VISUAL_TIMEOUT"});
    }}}},
    model: "qwen3.7-plus",
    logger: {info() {}},
  });
  const result = await verifier.verifyGroups({
    groups: [{
      requirement: cuteShoeRequirement,
      candidates: [
        product("safe"),
        product("unknown", {candidate_gate_state: "UNKNOWN", product_aesthetic_score: 99}),
        product("low", {product_aesthetic_score: 40}),
      ],
    }],
    context: cuteContext,
    requestId: "visual-fallback",
  });

  assert.deepEqual(result.groups[0].candidates.map((item) => item.product_id), ["safe"]);
  assert.equal(result.groups[0].candidates[0].visual_verification_status, "fallback");
  assert.equal(result.summary.fallback_used, true);
});

test("a known visual FAIL can never re-enter through fallback", () => {
  const products = visualFallbackCandidates([
    product("failed", {
      visual_status: "FAIL",
      visual_verification: assessment("failed", "FAIL", {
        reason_codes: ["WRONG_SHOE_STRUCTURE"],
      }),
    }),
    product("safe"),
  ]);
  assert.deepEqual(products.map((item) => item.product_id), ["safe"]);
});

test("visual verifier limit is configurable and capped at twelve candidates per slot", () => {
  assert.equal(new VisualProductVerifier({maxCandidatesPerSlot: 8}).maxCandidatesPerSlot, 8);
  assert.equal(new VisualProductVerifier({maxCandidatesPerSlot: 99}).maxCandidatesPerSlot, 12);
});

test("visual verification input contains only the structured slot contract", () => {
  const messages = buildVisualVerificationMessages(
    cuteShoeRequirement,
    cuteContext,
    [product("one")],
  );
  const payload = JSON.parse(messages[1].content[0].text);
  assert.deepEqual(Object.keys(payload.purchase_specification).sort(), [
    "avoid_attributes",
    "category",
    "core_style_anchor",
    "must_attributes",
    "product_family",
    "product_type",
    "should_attributes",
    "slot_visual_goal",
    "style_roles",
  ]);
});
