"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {compileLookConceptPortfolio} = require("../look_concept_compiler");
const {TaobaoProductProvider} = require("../product_provider");
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

test("online validation carries both intents through 36 bounded distinct queries", async () => {
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
  assert.equal(capture.requirements.length, 18);
  assert.equal(capture.queries.length, 36);
  assert.ok(capture.requirements.every((requirement) =>
    requirement.query_plan_version === "concept_search_query_planner.v1" &&
    requirement.search_keywords.length === 2));

  const caseA = result.cases.find(({case_id: id}) => id === "A");
  const caseB = result.cases.find(({case_id: id}) => id === "B");
  const caseAQueries = caseA.concepts.flatMap((concept) =>
    concept.slots.flatMap((slot) => slot.queries.map(({q}) => q))).join(" ");
  const caseBQueries = caseB.concepts.flatMap((concept) =>
    concept.slots.flatMap((slot) => slot.queries.map(({q}) => q))).join(" ");
  assert.match(caseAQueries, /年轻/u);
  assert.match(caseAQueries, /设计感/u);
  assert.match(caseAQueries, /休闲/u);
  assert.match(caseBQueries, /干净利落/u);
  assert.match(caseBQueries, /时髦/u);
  assert.ok(caseB.concepts.every((concept) => concept.slots.every((slot) =>
    slot.avoid.includes("商务") && slot.avoid.includes("职业"))));
  for (const currentCase of result.cases) {
    const signatures = currentCase.concepts.map((concept) =>
      concept.slots.flatMap((slot) => slot.queries.map(({q}) => q)).join("|"));
    assert.equal(new Set(signatures).size, 3);
  }
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
