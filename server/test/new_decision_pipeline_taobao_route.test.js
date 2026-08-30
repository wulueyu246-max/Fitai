"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const APP_SECRET_CANARY = ["CONTRACT", "APP", "SECRET", "CANARY"].join("_");
const PID_CANARY = ["mm", "123456789", "234567890", "345678901"].join("_");
const TOKEN_CANARY = ["CONTRACT", "INTERNAL", "TOKEN", "CANARY"].join("_");

process.env.NEW_DECISION_PIPELINE = "true";
process.env.PRODUCT_PROVIDER = "taobao";
process.env.AI_FORCE_MOCK = "true";
process.env.NODE_ENV = "test";
process.env.TAOBAO_APP_KEY = "test-app-key";
process.env.TAOBAO_APP_SECRET = APP_SECRET_CANARY;
process.env.TAOBAO_PID = PID_CANARY;
process.env.TAOBAO_ADZONE_ID = "345678901";
process.env.INTERNAL_PROBE_TOKEN = TOKEN_CANARY;
process.env.ENABLE_TAOBAO_RAW_PROBE = "false";
process.env.SHOPPING_AGENT_V1_ENABLED = "false";

const {
  app,
  config,
  productProvider,
} = require("../index");

function categoryForQuery(query) {
  if (/鞋|靴|乐福|玛丽珍/u.test(query)) return "鞋";
  if (/裤|裙|下装/u.test(query)) return "裤装";
  return "上衣";
}

function titleForQuery(query, index) {
  const gender = /^男/u.test(query) ? "男士" : "女士";
  const category = categoryForQuery(query);
  const productType = category === "鞋"
    ? "年轻时髦设计感轻量休闲鞋"
    : category === "裤装"
      ? /裙/u.test(query) ? "年轻时髦设计感高腰半身裙"
        : "年轻时髦设计感利落直筒裤"
      : "年轻时髦设计感短袖上衣";
  return `${gender}${productType} ${query} ${index + 1}`;
}

function fakeTaobaoResponse(query, callNumber) {
  const items = Array.from({length: 8}, (_, index) => ({
    item_basic_info: {
      item_id: String(10_000_000_000 + callNumber * 100 + index),
      title: titleForQuery(query, index),
      shop_title: "Contract Fixture Shop",
      category_name: categoryForQuery(query),
      pict_url: `https://img.example.com/${callNumber}-${index}.jpg?token=${TOKEN_CANARY}`,
    },
    price_promotion_info: {
      final_promotion_price: String(180 + index * 10),
      reserve_price: String(220 + index * 10),
    },
    publish_info: {
      click_url: `https://s.click.taobao.com/item/${callNumber}-${index}` +
        `?pid=${PID_CANARY}&sign=CANARY_SIGN&token=${TOKEN_CANARY}`,
    },
  }));
  return {
    tbk_dg_material_optional_upgrade_response: {
      result_list: {map_data: items},
      request_id: `fake-request-${callNumber}`,
    },
  };
}

test("/outfit executes the native Taobao decision pipeline without leaking credentials", async () => {
  assert.equal(config.newDecisionPipelineEnabled, true);
  assert.equal(productProvider.name, "taobao");

  const calls = [];
  productProvider.logger = {
    info() {},
    warn() {},
    error() {},
  };
  productProvider.client.call = async (_method, params) => {
    const query = String(params.q || "");
    calls.push(query);
    return fakeTaobaoResponse(query, calls.length);
  };

  const originalConsole = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/outfit`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        gender: "female",
        height: 160,
        weight: 50,
        scene: "nightlife",
        request: "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
        item_budget: "500-1000",
        outfit_budget: "800-1500",
        images: {front: "data:image/jpeg;base64,AA=="},
      }),
    });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    assert.equal(response.status, 200, serialized.slice(0, 1000));
    assert.equal(payload.analysisMode, "new_decision_pipeline.v1",
      JSON.stringify(payload.decision_pipeline));
    assert.equal(payload.decision_pipeline.mode, "PRIMARY");
    assert.equal(payload.decision_pipeline.fallback_used, false);
    assert.equal(payload.decision_pipeline.legacy_blueprint_calls, 0);
    assert.equal(payload.decision_pipeline.portfolio_validation.status, "PASS");
    assert.equal(payload.looks.length, 3);
    assert.equal(payload.looks.every((look) =>
      look.selected_products.length === 3), true);
    const selected = payload.looks.flatMap((look) => look.selected_products);
    assert.equal(selected.every((item) =>
      item.source === "taobao" && item.is_mock === false), true);
    assert.equal(new Set(selected.map((item) => item.product_id)).size,
      selected.length);

    const trace = payload.decision_pipeline.candidate_pipeline_trace;
    assert.equal(trace.relevance_executed, true);
    assert.equal(trace.reranker_executed, true);
    assert.equal(trace.strategy_executed, true);
    assert.equal(trace.query_plans.length, 9);
    assert.equal(trace.query_plans.every((entry) =>
      entry.query_plan_version === "concept_search_query_planner.v2"), true);
    assert.equal(calls.length >= 18, true);
    assert.equal(calls.every((query) => /^女\s/u.test(query)), true);

    for (const secret of [APP_SECRET_CANARY, PID_CANARY, TOKEN_CANARY,
      "CANARY_SIGN"]) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.equal(/"pid"\s*:/u.test(serialized), false);
    assert.equal(/(?:\?|&)(?:pid|sign|token)=/iu.test(serialized), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});

test("/outfit exposes an explicit legacy fallback when the new provider contract fails", async () => {
  const originalRecommend = productProvider.recommendForQueries;
  const originalConsole = {
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  productProvider.recommendForQueries = async () => {
    const error = new Error("contract provider unavailable");
    error.code = "CONTRACT_PROVIDER_UNAVAILABLE";
    throw error;
  };
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/outfit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-defer-products": "true",
      },
      body: JSON.stringify({
        gender: "female",
        height: 160,
        weight: 50,
        scene: "nightlife",
        request: "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
        item_budget: "500-1000",
        outfit_budget: "800-1500",
        images: {front: "data:image/jpeg;base64,AA=="},
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200, JSON.stringify(payload).slice(0, 1000));
    assert.equal(payload.decision_pipeline.mode, "LEGACY_FALLBACK_ONLY");
    assert.equal(payload.decision_pipeline.fallback_used, true);
    assert.equal(payload.decision_pipeline.fallback_reason,
      "CONTRACT_PROVIDER_UNAVAILABLE");
    assert.equal(payload.decision_pipeline.fallback_stage,
      "PRODUCT_PROVIDER_CONTRACT");
    assert.equal(payload.decision_pipeline.silent_fallback, false);
    assert.equal(payload.decision_pipeline.legacy_blueprint_calls, 1);
  } finally {
    productProvider.recommendForQueries = originalRecommend;
    await new Promise((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});
