"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
  DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
  OUTFIT_COMPOSITION_SCHEMA,
  PRODUCT_SELECTION_SCHEMA,
  SHOPPING_PLAN_SCHEMA,
  ShoppingAgentV1Error,
  TaobaoShoppingAgentV1,
  classifyTaobaoRetrievalError,
  hardGateCandidate,
  normalizeAgentInput,
  normalizeShoppingIntent,
  parseAiJson,
  validateComposedLooks,
  validateProductSelection,
} = require("../shopping_agent_v1");

function plan(gender = "female", aesthetic = "清新法式休闲") {
  const genderLabel = gender === "male" ? "男款" : gender === "female" ? "女款" : "中性";
  return {
    shopping_intent: {
      gender,
      persona: {expression: gender === "female" ? "女性化" : "利落", maturity: "年轻成人"},
      overall_aesthetic: {
        core_direction: aesthetic,
        traits: ["轻松", "精致"],
        anti_drift: ["明显训练风"],
      },
      body_strategy: {
        goals: ["比例协调"],
        hard_constraints: [],
        soft_tactics: ["腰线清晰"],
      },
      occasion: {type: "日常外出", formality: "休闲"},
      weather_constraints: {
        material: ["透气"],
        thickness: "轻薄",
        comfort: ["活动方便"],
        safety: [],
      },
      slots: [
        {
          category: "top",
          role: "形成清爽上半身轮廓",
          hard_constraints: [gender, "top", "not_underwear"],
          soft_preferences: ["合身", "方领"],
          avoid: ["家居服"],
          search_query: `${genderLabel} 方领 合身 上衣`,
        },
        {
          category: "bottom",
          role: "建立清晰腰线",
          hard_constraints: [gender, "bottom", "not_underwear"],
          soft_preferences: ["高腰", "A字"],
          avoid: ["家居服"],
          search_query: `${genderLabel} 高腰 A字裙`,
        },
        {
          category: "shoes",
          role: "保持轻盈完整度",
          hard_constraints: [gender, "shoes"],
          soft_preferences: ["轻量", "精致"],
          avoid: ["训练鞋"],
          search_query: `${genderLabel} 轻量 精致 鞋`,
        },
      ],
    },
  };
}

function product(category, index, title) {
  return {
    product_id: `${category}-${index}`,
    source: "taobao",
    title,
    _category_text: title,
    category,
    price: 100 + index,
    sales: String(1000 - index),
    image_url: `https://img.example.com/${category}-${index}.jpg`,
    purchase_url: `https://item.example.com/${category}-${index}`,
    is_mock: false,
  };
}

function candidates(category) {
  if (category === "top") {
    return [
      product("top", 1, "女款方领修身短袖上衣"),
      product("top", 2, "女款轻薄针织上衣"),
      product("top", 3, "女款法式短袖衬衫"),
      product("top", 4, "男士商务衬衫"),
      product("top", 5, "女士家居服睡衣"),
    ];
  }
  if (category === "bottom") {
    return [
      product("bottom", 1, "女款高腰A字半身裙"),
      product("bottom", 2, "女款高腰直筒裤"),
      product("bottom", 3, "女款高腰百褶裙"),
      product("bottom", 4, "女士纯棉内裤"),
      product("top", 5, "女款短袖上衣"),
    ];
  }
  return [
    product("shoes", 1, "女款浅口玛丽珍鞋"),
    product("shoes", 2, "女款尖头低跟鞋"),
    product("shoes", 3, "女款轻便乐福鞋"),
    product("shoes", 4, "男士运动鞋"),
    product("bottom", 5, "女款直筒裤"),
  ];
}

class FakeProvider {
  constructor() {
    this.calls = [];
  }

  async searchShoppingAgentCandidates(input) {
    this.calls.push(input);
    const products = candidates(input.category);
    return {products, raw_count: products.length, valid_count: products.length};
  }
}

class FakeAiClient {
  constructor({
    composerLookCount = 2,
    foreignComposerId = false,
    wrapComposer = false,
  } = {}) {
    this.calls = [];
    this.composerLookCount = composerLookCount;
    this.foreignComposerId = foreignComposerId;
    this.wrapComposer = wrapComposer;
    this.chat = {completions: {create: this.create.bind(this)}};
  }

  async create(input) {
    this.calls.push(input);
    const name = input.response_format.json_schema.name;
    let payload;
    if (name === "fitai_shopping_agent_v1_plan") {
      payload = plan();
    } else if (name.startsWith("fitai_product_selector_")) {
      const metadata = JSON.parse(input.messages[1].content[0].text);
      payload = {
        assessments: metadata.candidates.map((candidate, index) => ({
          candidate_id: candidate.candidate_id,
          status: index < 2 ? "KEEP" : "UNCERTAIN",
          scores: {
            category_fit: 95,
            aesthetic_fit: 90 - index,
            persona_fit: 91 - index,
            silhouette_fit: 88 - index,
            outfit_potential: 92 - index,
          },
          reason_codes: [],
        })),
      };
    } else if (name === "fitai_real_product_outfit_composer") {
      const metadata = JSON.parse(input.messages[1].content[0].text);
      const pools = metadata.candidate_pools;
      payload = {
        looks: Array.from({length: this.composerLookCount}, (_, index) => ({
          look_id: `look-${index + 1}`,
          top_candidate_id: index === 0 && this.foreignComposerId
            ? "candidate_999" : pools.top[index].candidate_id,
          bottom_candidate_id: pools.bottom[index].candidate_id,
          shoes_candidate_id: pools.shoes[index].candidate_id,
          scores: {
            aesthetic_coherence: 90,
            persona_fit: 92,
            body_proportion: 88,
            occasion_fit: 91,
            weather_fit: 86,
          },
          explanation: "真实候选形成的完整外出搭配",
        })),
      };
      if (this.wrapComposer) payload = [payload];
    } else {
      throw new Error(`unexpected schema ${name}`);
    }
    return {
      choices: [{finish_reason: "stop", message: {content: JSON.stringify(payload)}}],
    };
  }
}

test("Shopping Agent V1 schemas are strict objects", () => {
  for (const schema of [
    SHOPPING_PLAN_SCHEMA,
    PRODUCT_SELECTION_SCHEMA,
    OUTFIT_COMPOSITION_SCHEMA,
  ]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.ok(Array.isArray(schema.required));
  }
});

function aiResponse(content, finishReason = "stop") {
  return {choices: [{finish_reason: finishReason, message: {content}}]};
}

test("Shopping Agent structured parser records a valid object safely", () => {
  const diagnostics = [];
  const payload = parseAiJson(aiResponse(JSON.stringify(plan())), {
    onDiagnostic: (value) => diagnostics.push(value),
  });
  assert.deepEqual(payload, plan());
  assert.deepEqual(diagnostics, [{
    finish_reason: "stop",
    content_type: "string",
    content_length: JSON.stringify(plan()).length,
    json_parse_success: true,
    parsed_json_type: "object",
    schema_error_kind: null,
    top_level_keys: ["shopping_intent"],
  }]);
});

test("Shopping Agent structured parser diagnoses every legal non-object JSON type", () => {
  const cases = [
    {
      value: [{shopping_intent: plan().shopping_intent}],
      kind: "TOP_LEVEL_ARRAY",
      type: "array",
      extra: {
        array_length: 1,
        first_item_type: "object",
        first_item_keys: ["shopping_intent"],
      },
    },
    {value: "wrapped", kind: "TOP_LEVEL_STRING", type: "string", extra: {}},
    {value: 42, kind: "TOP_LEVEL_NUMBER", type: "number", extra: {}},
    {value: true, kind: "TOP_LEVEL_BOOLEAN", type: "boolean", extra: {}},
    {value: null, kind: "TOP_LEVEL_NULL", type: "null", extra: {}},
  ];
  for (const item of cases) {
    const diagnostics = [];
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(item.value)), {
        onDiagnostic: (value) => diagnostics.push(value),
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === item.kind,
    );
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      finish_reason: "stop",
      content_type: "string",
      content_length: JSON.stringify(item.value).length,
      json_parse_success: true,
      parsed_json_type: item.type,
      schema_error_kind: item.kind,
      ...item.extra,
    });
  }
});

test("Product Selector parser accepts object and one safe assessments wrapper only", () => {
  const payload = {assessments: []};
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify(payload)), {
      allowSingleAssessmentWrapper: true,
    }),
    payload,
  );
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify([payload])), {
      allowSingleAssessmentWrapper: true,
    }),
    payload,
  );

  for (const invalid of [
    [],
    [payload, payload],
    ["not-an-object"],
    [{}],
  ]) {
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(invalid)), {
        allowSingleAssessmentWrapper: true,
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === "INVALID_SELECTOR_ARRAY_WRAPPER",
    );
  }
});

test("Composer parser accepts object and one safe looks wrapper only", () => {
  const payload = {looks: []};
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify(payload)), {
      allowSingleLooksWrapper: true,
    }),
    payload,
  );
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify([payload])), {
      allowSingleLooksWrapper: true,
    }),
    payload,
  );

  for (const invalid of [
    [],
    [payload, payload],
    ["not-an-object"],
    [{}],
  ]) {
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(invalid)), {
        allowSingleLooksWrapper: true,
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === "INVALID_COMPOSER_ARRAY_WRAPPER",
    );
  }
});

test("Shopping Intent reports a missing top-level shopping_intent explicitly", () => {
  const input = normalizeAgentInput({user_input: "出去玩", gender: "female"});
  const parsed = parseAiJson(aiResponse("{}"));
  assert.throws(
    () => normalizeShoppingIntent(parsed.shopping_intent, input),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.schema_error_kind === "MISSING_SHOPPING_INTENT",
  );
});

test("Shopping Intent reports an invalid slots count explicitly", () => {
  const input = normalizeAgentInput({user_input: "出去玩", gender: "female"});
  const intent = structuredClone(plan().shopping_intent);
  intent.slots.pop();
  assert.throws(
    () => normalizeShoppingIntent(intent, input),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.schema_error_kind === "INVALID_SLOTS",
  );
});

test("Taobao retrieval budgets leave a bounded outer safety margin", () => {
  assert.equal(DEFAULT_TAOBAO_SLOT_TIMEOUT_MS, 25_000);
  assert.equal(DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS, 30_000);
  assert.ok(DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS > DEFAULT_TAOBAO_SLOT_TIMEOUT_MS);
});

test("Shopping Intent preserves only flexible slot intent and one executable query", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    gender: "female",
    height: 160,
    weight: 49,
  });
  const intent = normalizeShoppingIntent(plan().shopping_intent, input);
  assert.equal(intent.gender, "female");
  assert.deepEqual(intent.slots.map((slot) => slot.category), ["top", "bottom", "shoes"]);
  assert.ok(intent.slots.every((slot) => slot.search_query.includes("女")));
  assert.ok(intent.slots.every((slot) => !Object.hasOwn(slot, "product_type")));
});

test("hard gate rejects wrong gender, wrong category and underwear/homewear only", () => {
  const intent = normalizeShoppingIntent(
    plan().shopping_intent,
    normalizeAgentInput({user_input: "出去玩", gender: "female"}),
  );
  const top = intent.slots[0];
  assert.equal(hardGateCandidate(product("top", 1, "女款方领上衣"), top, intent).status, "PASS");
  assert.deepEqual(
    hardGateCandidate(product("top", 2, "男士商务衬衫"), top, intent).reason_codes,
    ["WRONG_GENDER"],
  );
  assert.ok(hardGateCandidate(product("bottom", 3, "女款直筒裤"), top, intent)
    .reason_codes.includes("WRONG_CATEGORY"));
  assert.ok(hardGateCandidate(product("top", 4, "女士家居服睡衣"), top, intent)
    .reason_codes.includes("UNDERWEAR_OR_HOMEWEAR"));
});

test("selector candidate ID invariant rejects missing, duplicate and foreign IDs", () => {
  const values = [
    {...product("top", 1, "女款上衣"), candidate_id: "candidate_001"},
    {...product("top", 2, "女款衬衫"), candidate_id: "candidate_002"},
  ];
  const assessment = (candidateId) => ({
    candidate_id: candidateId,
    status: "KEEP",
    scores: {
      category_fit: 90,
      aesthetic_fit: 90,
      persona_fit: 90,
      silhouette_fit: 90,
      outfit_potential: 90,
    },
    reason_codes: [],
  });
  assert.throws(
    () => validateProductSelection({assessments: [assessment("candidate_001")]}, values),
    ShoppingAgentV1Error,
  );
  assert.throws(
    () => validateProductSelection({
      assessments: [assessment("candidate_001"), assessment("candidate_999")],
    }, values),
    ShoppingAgentV1Error,
  );
  const wrapped = parseAiJson(aiResponse(JSON.stringify([{
    assessments: [assessment("candidate_001"), assessment("candidate_999")],
  }])), {allowSingleAssessmentWrapper: true});
  assert.throws(
    () => validateProductSelection(wrapped, values),
    ShoppingAgentV1Error,
  );
});

test("composer rejects candidate IDs outside the real candidate pools", () => {
  const pools = ["top", "bottom", "shoes"].map((category, index) => ({
    slot: {category},
    final_candidate_pool: [{
      ...product(category, 1, `${category} product`),
      candidate_id: `candidate_00${index + 1}`,
    }],
  }));
  const result = validateComposedLooks({looks: [{
    look_id: "look-1",
    top_candidate_id: "candidate_999",
    bottom_candidate_id: "candidate_002",
    shoes_candidate_id: "candidate_003",
    scores: {
      aesthetic_coherence: 90,
      persona_fit: 90,
      body_proportion: 90,
      occasion_fit: 90,
      weather_fit: 90,
    },
    explanation: "invalid",
  }]}, pools);
  assert.equal(result.looks.length, 0);
  assert.equal(result.invalid_candidate_reference.length, 1);
  assert.deepEqual(result.invalid_candidate_reference[0].categories, ["top"]);
});

test("Composer wrapper keeps candidate references and minimum Look count strict", async () => {
  const wrappedAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const wrappedResult = await wrappedAgent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  assert.equal(wrappedResult.final_look_count, 2);

  const foreignAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({foreignComposerId: true, wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => foreignAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );

  const oneLookAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1, wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => oneLookAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );
});

test("minimal proof uses exactly five AI calls, three Taobao calls and real IDs", async () => {
  const client = new FakeAiClient();
  const provider = new FakeProvider();
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}},
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
    height: 160,
    weight: 49,
    occasion: "出去玩",
  });
  assert.equal(result.ai_call_count, 5);
  assert.equal(result.taobao_call_count, 3);
  assert.equal(result.state, "success");
  assert.equal(provider.calls.length, 3);
  assert.equal(result.final_look_count, 2);
  assert.equal(result.invalid_candidate_reference.length, 0);
  assert.ok(Object.values(result.candidate_pools).flat().every((item) =>
    /^candidate_\d{3}$/.test(item.candidate_id)));
  assert.notDeepEqual(result.looks[0].candidate_ids, result.looks[1].candidate_ids);
  assert.ok(result.looks.every((look) =>
    Object.values(look.items).every((item) => item.source === "taobao" && item.is_mock === false)));
  assert.ok(result.slot_metrics.every((slot) => slot.candidate_gate_fail >= 2));
});

test("male casual and cute female retain authoritative gender in the proof contract", () => {
  const maleInput = normalizeAgentInput({user_input: "男生日常休闲", gender: "male"});
  const maleIntent = normalizeShoppingIntent(plan("male", "清爽男性休闲").shopping_intent, maleInput);
  assert.equal(maleIntent.gender, "male");
  assert.ok(maleIntent.slots.every((slot) => slot.search_query.includes("男")));

  const cuteInput = normalizeAgentInput({user_input: "穿得可爱一点", gender: "female"});
  const cuteIntent = normalizeShoppingIntent(plan("female", "轻甜可爱").shopping_intent, cuteInput);
  assert.equal(cuteIntent.overall_aesthetic.core_direction, "轻甜可爱");
  assert.equal(cuteIntent.gender, "female");
});

test("a top timeout preserves successful bottom and shoes and skips every selector", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, signal, onAttempt}) {
      onAttempt?.(1);
      if (category === "top") {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({products: candidates(category)}), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.code = "TAOBAO_TIMEOUT";
            error.attempts = 1;
            reject(error);
          }, {once: true});
        });
      }
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    taobaoSlotTimeoutMs: 10,
    taobaoRetrievalTimeoutMs: 50,
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.reason, "PARTIAL_TAOBAO_RETRIEVAL");
  assert.equal(result.failed_slots.length, 1);
  assert.equal(result.failed_slots[0].category, "top");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_SLOT_TIMEOUT");
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["bottom", "shoes"]);
  assert.equal(result.retrieved_candidates.bottom.length, 2);
  assert.equal(result.retrieved_candidates.shoes.length, 3);
  assert.equal(result.final_look_count, 0);
  assert.equal(result.ai_call_count, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(logs.filter((entry) => entry.event === "shopping_agent_v1_taobao_slot").length, 3);
});

test("a bottom provider error preserves other slots and never enters Composer", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, onAttempt}) {
      onAttempt?.(1);
      if (category === "bottom") {
        const error = new Error("provider unavailable");
        error.code = "TAOBAO_PERMISSION_DENIED";
        error.attempts = 1;
        throw error;
      }
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.failed_slots[0].category, "bottom");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_PROVIDER_ERROR");
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["shoes", "top"]);
  assert.equal(result.looks.length, 0);
  assert.equal(client.calls.length, 1);
});

test("retrieval error classification distinguishes local proxy and provider failures", () => {
  assert.equal(
    classifyTaobaoRetrievalError({code: "LOCAL_TO_RENDER_TIMEOUT"}),
    "LOCAL_TO_RENDER_TIMEOUT",
  );
  assert.equal(
    classifyTaobaoRetrievalError({code: "TAOBAO_TIMEOUT"}),
    "TAOBAO_SLOT_TIMEOUT",
  );
  assert.equal(
    classifyTaobaoRetrievalError({
      code: "TAOBAO_NETWORK_ERROR",
      details: {cause_code: "ETIMEDOUT"},
    }),
    "TAOBAO_NETWORK_ERROR",
  );
  assert.equal(
    classifyTaobaoRetrievalError({code: "TAOBAO_PERMISSION_DENIED"}),
    "TAOBAO_PROVIDER_ERROR",
  );
});

test("two top ETIMEDOUT attempts retain successful slots and report network error", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, onAttempt}) {
      if (category === "top") {
        onAttempt?.(1);
        onAttempt?.(2);
        const error = new Error("network unavailable");
        error.code = "TAOBAO_NETWORK_ERROR";
        error.details = {cause_code: "ETIMEDOUT"};
        error.attempts = 2;
        throw error;
      }
      onAttempt?.(1);
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });

  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.reason, "PARTIAL_TAOBAO_RETRIEVAL");
  assert.equal(result.failed_slots[0].category, "top");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_NETWORK_ERROR");
  assert.equal(result.failed_slots[0].cause_code, "ETIMEDOUT");
  assert.equal(result.failed_slots[0].attempts, 2);
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["bottom", "shoes"]);
  assert.equal(result.final_look_count, 0);
  assert.equal(client.calls.length, 1);
});
