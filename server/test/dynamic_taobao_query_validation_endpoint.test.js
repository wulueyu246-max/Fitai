"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {compileLookConceptPortfolio} = require("../look_concept_compiler");
const {TaobaoProductProvider} = require("../product_provider");
const {normalizeProductRequirement} = require("../product_relevance");
const {
  buildValidationDecisionContext,
  createDynamicTaobaoQueryValidationHandler,
  executeDynamicTaobaoQueryValidation,
} = require("../dynamic_taobao_query_validation_endpoint");
const {TAOBAO_MATERIAL_SEARCH_METHOD} = require("../taobao_client");

const TOKEN = "validation-token-that-is-at-least-32-characters";
const silentLogger = Object.freeze({info() {}, warn() {}, error() {}});

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function fakeRawProduct(query, index = 0) {
  return {
    text: {title: `${query} 年轻设计感干净时髦候选${index + 1}`},
  };
}

function fakeProviderFactory(capture) {
  return ({rawCapture}) => ({
    name: "taobao",
    configured: true,
    async recommendForQueries(requirements) {
      capture.requirements.push(...requirements);
      for (const requirement of requirements) {
        for (const query of requirement.search_keywords) {
          capture.queries.push(query);
          rawCapture({
            query,
            products: [fakeRawProduct(query)],
            responseSummary: {requestId: "request-present"},
          });
        }
      }
      return [];
    },
  });
}

test("protected endpoint is closed unless Render flag and token are valid", async () => {
  const handler = createDynamicTaobaoQueryValidationHandler({
    environment: {RENDER: "true", ENABLE_TAOBAO_RAW_PROBE: "false"},
    providerFactory: fakeProviderFactory({requirements: [], queries: []}),
    logger: silentLogger,
  });
  const closed = responseRecorder();
  await handler({headers: {}}, closed);
  assert.equal(closed.statusCode, 404);

  const unauthorized = responseRecorder();
  const protectedHandler = createDynamicTaobaoQueryValidationHandler({
    environment: {
      RENDER: "true",
      ENABLE_TAOBAO_RAW_PROBE: "true",
      INTERNAL_PROBE_TOKEN: TOKEN,
    },
    providerFactory: fakeProviderFactory({requirements: [], queries: []}),
    logger: silentLogger,
  });
  await protectedHandler({headers: {authorization: "Bearer wrong"}}, unauthorized);
  assert.equal(unauthorized.statusCode, 403);
});

test("online validation carries Q1 and Q2 through 36 bounded distinct queries", async () => {
  const capture = {requirements: [], queries: []};
  const result = await executeDynamicTaobaoQueryValidation({
    environment: {PRODUCT_PROVIDER: "taobao"},
    providerFactory: fakeProviderFactory(capture),
    logger: silentLogger,
  });
  assert.equal(result.validation_status, "SUCCESS");
  assert.equal(result.provider, "taobao");
  assert.equal(result.is_mock, false);
  assert.equal(result.case_count, 2);
  assert.equal(result.query_count, 36);
  assert.equal(result.fallback_count, 0);
  assert.equal(capture.requirements.length, 18);
  assert.equal(capture.queries.length, 36);
  assert.ok(capture.requirements.every((requirement) =>
    requirement.query_plan_version === "concept_search_query_planner.v2" &&
    requirement.search_keywords.length === 2));

  const caseA = result.cases.find(({case_id: id}) => id === "A");
  const caseB = result.cases.find(({case_id: id}) => id === "B");
  const caseAQueries = caseA.concepts.flatMap((concept) =>
    concept.slots.flatMap((slot) => slot.queries.map(({q}) => q))).join(" ");
  const caseBQueries = caseB.concepts.flatMap((concept) =>
    concept.slots.flatMap((slot) => slot.queries.map(({q}) => q))).join(" ");
  assert.match(caseAQueries, /年轻/u);
  assert.match(caseAQueries, /设计感/u);
  assert.match(caseAQueries, /宽松/u);
  assert.match(caseBQueries, /时髦/u);
  assert.ok(caseB.concepts.every((concept) => concept.slots.every((slot) =>
    slot.avoid.includes("商务") && slot.avoid.includes("职业"))));
  for (const currentCase of result.cases) {
    const signatures = currentCase.concepts.map((concept) =>
      concept.slots.flatMap((slot) => slot.queries.map(({q}) => q)).join("|"));
    assert.equal(new Set(signatures).size, 3);
    for (const concept of currentCase.concepts) {
      for (const slot of concept.slots) {
        const [q1, q2, q3] = slot.queries;
        assert.equal(q1.query_id, "Q1");
        assert.equal(q1.query_type, "HIGH_RECALL");
        assert.equal(q1.executed, true);
        assert.equal(q2.query_id, "Q2");
        assert.equal(q2.query_type, "INTENT");
        assert.equal(q2.executed, true);
        assert.equal(q3.query_id, "Q3");
        assert.equal(q3.query_type, "BROAD_CATEGORY_FALLBACK");
        assert.equal(q3.executed, false);
        assert.equal(q1.q.split(/\s+/u).length, 2);
        assert.equal(q2.q.split(/\s+/u).length, 3);
        assert.equal(q3.q.split(/\s+/u).length, 2);
        assert.equal(q1.searchable_signal_budget.aesthetic_terms, 0);
        assert.equal(q2.searchable_signal_budget.aesthetic_terms, 1);
        if (slot.slot === "shoes") assert.doesNotMatch(q2.q, /宽松/u);
        assert.doesNotMatch([q1.q, q2.q, q3.q].join(" "),
          /约会|聚会|通勤|低饱和|重点色|商务|职业|爸爸|上班/u);
      }
    }
  }
});

test("query plan normalization preserves typed Q1 Q2 and Q3 contract", () => {
  const context = buildValidationDecisionContext({
    case_id: "A",
    gender: "female",
    scene: "nightlife",
    raw_user_input:
      "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
  });
  const requirement = compileLookConceptPortfolio(context).requirements[0];
  const normalized = normalizeProductRequirement(requirement);
  const plan = normalized.commerce_query_plan;
  assert.equal(plan.version, "concept_search_query_planner.v2");
  assert.deepEqual(plan.query_candidates.map(({query_id: id}) => id), ["Q1", "Q2"]);
  assert.deepEqual(plan.query_candidates.map(({query_type: type}) => type),
    ["HIGH_RECALL", "INTENT"]);
  assert.equal(plan.query_candidates[1].searchable_signal_budget.aesthetic_terms, 1);
  assert.equal(plan.fallback_query.query_id, "Q3");
  assert.equal(plan.fallback_query.execution, "ON_Q1_Q2_ZERO");
  assert.equal(plan.fallback_query.fallback_level, 2);
  assert.equal(plan.fallback_query.fallback_reason, "INTENT_AND_HIGH_RECALL_ZERO");
});

test("shared query text does not leak fallback execution across concepts", async () => {
  let requirementCall = 0;
  const result = await executeDynamicTaobaoQueryValidation({
    environment: {PRODUCT_PROVIDER: "taobao"},
    providerFactory: ({rawCapture}) => ({
      name: "taobao",
      configured: true,
      async recommendForQueries([requirement]) {
        requirementCall += 1;
        for (const query of requirement.search_keywords) {
          rawCapture({
            query,
            products: requirementCall === 1 ? [] : [fakeRawProduct(query)],
            responseSummary: {requestId: "request-present"},
          });
        }
        if (requirementCall === 1) {
          const fallback = requirement.commerce_query_plan.fallback_query.query;
          rawCapture({
            query: fallback,
            products: [fakeRawProduct(fallback)],
            responseSummary: {requestId: "request-present"},
          });
        }
        return [];
      },
    }),
    logger: silentLogger,
  });
  assert.equal(result.fallback_count, 1);
  const fallbackSlots = result.cases.flatMap((currentCase) =>
    currentCase.concepts.flatMap((concept) =>
      concept.slots.filter(({fallback_used: used}) => used)));
  assert.equal(fallbackSlots.length, 1);
  assert.equal(fallbackSlots[0].fallback_level, 2);
});

function taobaoResponse(itemId, title) {
  return {
    tbk_dg_material_optional_upgrade_response: {
      result_list: {
        map_data: [{
          item_basic_info: {
            item_id: itemId,
            title,
            shop_title: "测试店铺",
            category_name: "女装上衣",
            pict_url: `//img.example.com/${itemId}.jpg`,
          },
          price_promotion_info: {final_promotion_price: "199"},
          publish_info: {click_url: `//s.click.taobao.com/${itemId}`},
        }],
      },
    },
  };
}

function emptyTaobaoResponse() {
  return {
    tbk_dg_material_optional_upgrade_response: {
      result_list: {map_data: []},
    },
  };
}

test("TaobaoProductProvider sends every planned q once with page_size at most 8", async () => {
  const context = buildValidationDecisionContext({
    case_id: "A",
    gender: "female",
    scene: "nightlife",
    raw_user_input:
      "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
  });
  const requirement = compileLookConceptPortfolio(context).requirements[0];
  const calls = [];
  const provider = new TaobaoProductProvider({
    pid: ["mm", "100", "200", "300"].join("_"),
    adzoneId: "300",
    client: {
      async call(method, params) {
        assert.equal(method, TAOBAO_MATERIAL_SEARCH_METHOD);
        calls.push({q: params.q, pageSize: Number(params.page_size)});
        return taobaoResponse(`item-${calls.length}`, params.q);
      },
    },
    logger: silentLogger,
  });
  await provider.recommendForQueries([requirement], {requestId: "provider-plan"});
  assert.deepEqual(calls.map(({q}) => q), requirement.search_keywords);
  assert.ok(calls.every(({pageSize}) => pageSize <= 8));
});

test("intent zero uses high recall without executing broad fallback", async () => {
  const context = buildValidationDecisionContext({
    case_id: "B",
    gender: "male",
    scene: "date",
    raw_user_input:
      "周末约会，帮我搭3套，干净时髦一点，不要像上班。",
  });
  const requirement = compileLookConceptPortfolio(context).requirements[0];
  const q1 = requirement.commerce_query_plan.query_candidates[0].query;
  const q2 = requirement.commerce_query_plan.query_candidates[1].query;
  const q3 = requirement.commerce_query_plan.fallback_query.query;
  const calls = [];
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: ["mm", "100", "200", "300"].join("_"),
    adzoneId: "300",
    client: {
      async call(_method, params) {
        calls.push(params.q);
        return params.q === q2
          ? emptyTaobaoResponse()
          : taobaoResponse(`item-${calls.length}`, params.q);
      },
    },
    logger: {info(message, details) { logs.push({message, details}); }, warn() {}},
  });
  await provider.recommendForQueries([requirement], {requestId: "intent-zero"});
  assert.deepEqual(new Set(calls), new Set([q1, q2]));
  assert.equal(calls.includes(q3), false);
  const summary = logs.find(({message}) => message === "search_expansion_summary");
  assert.equal(summary.details.fallback_level, 1);
  assert.equal(summary.details.fallback_reason, "INTENT_QUERY_ZERO");
});

test("Q1 and Q2 zero execute Q3 once and record explicit fallback", async () => {
  const context = buildValidationDecisionContext({
    case_id: "A",
    gender: "female",
    scene: "nightlife",
    raw_user_input:
      "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
  });
  const requirement = compileLookConceptPortfolio(context).requirements[0];
  const [q1, q2] = requirement.search_keywords;
  const q3 = requirement.commerce_query_plan.fallback_query.query;
  const calls = [];
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: ["mm", "100", "200", "300"].join("_"),
    adzoneId: "300",
    client: {
      async call(_method, params) {
        calls.push(params.q);
        return params.q === q3
          ? taobaoResponse("fallback-item", params.q)
          : emptyTaobaoResponse();
      },
    },
    logger: {info(message, details) { logs.push({message, details}); }, warn() {}},
  });
  await provider.recommendForQueries([requirement], {requestId: "broad-fallback"});
  assert.deepEqual(calls, [q1, q2, q3]);
  assert.equal(calls.filter((query) => query === q3).length, 1);
  const summary = logs.find(({message}) => message === "search_expansion_summary");
  assert.equal(summary.details.fallback_level, 2);
  assert.equal(summary.details.fallback_reason,
    "INTENT_AND_HIGH_RECALL_ZERO");
});
