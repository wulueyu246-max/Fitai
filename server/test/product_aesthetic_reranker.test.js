const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ProductAestheticReranker,
  buildMessages,
  validateSelection,
} = require("../product_aesthetic_reranker");

function product(id, category = "top", relevance = 80) {
  return {
    product_id: id,
    source: "taobao",
    platform: "taobao",
    is_mock: false,
    category,
    title: `${category} product ${id}`,
    price: 100,
    image_url: `https://img.example.com/${id}.jpg`,
    purchase_url: `https://s.click.taobao.com/${id}`,
    relevance_score: relevance,
  };
}

function group(category, ids) {
  return {
    requirement: {
      category,
      gender: "male",
      item_name: `${category} item`,
      search_keywords: [`male ${category} item`],
    },
    candidates: ids.map((id, index) => product(id, category, 90 - index)),
  };
}

function response(selectedProducts) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({selected_products: selectedProducts}),
      },
    }],
  };
}

function selection(productId, overrides = {}) {
  return {
    product_id: productId,
    ai_taste_score: 94,
    fit_score: 91,
    outfit_coherence_score: 95,
    value_score: 86,
    reason: "Clean shape and coherent color.",
    concern: "Check fabric details before purchase.",
    ...overrides,
  };
}

test("validates candidate IDs and applies the weighted final score", () => {
  const groups = [group("top", ["top-1", "top-2"]), group("shoes", ["shoe-1"])];
  const products = validateSelection({
    selected_products: [selection("invented"), selection("shoe-1"), selection("top-1")],
  }, groups, 6);

  assert.deepEqual(products.map((item) => item.product_id), ["top-1", "shoe-1"]);
  assert.equal(products[0].final_score, 92.4);
  assert.equal(products[0].ai_label, "AI首选");
  assert.equal(products[0].ai_rerank_fallback, false);
  assert.equal(products.some((item) => item.product_id === "invented"), false);
});

test("submits all outfit groups in one model call and caches identical pools", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        const prompt = JSON.parse(request.messages[1].content);
        assert.equal(prompt.product_groups.length, 2);
        return response([selection("top-1"), selection("shoe-1")]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });
  const input = {
    groups: [group("top", ["top-1"]), group("shoes", ["shoe-1"])],
    context: {gender: "male", scene: "date"},
    requestId: "request-1",
  };

  const first = await reranker.rerank(input);
  const second = await reranker.rerank({...input, requestId: "request-2"});

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(reranker.getStats().call_count, 1);
  assert.equal(reranker.getStats().cache_hits, 1);
});

test("model failure falls back to relevance ordering without throwing", async () => {
  const warnings = [];
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async () => {
        throw Object.assign(new Error("upstream unavailable"), {code: "ETIMEDOUT"});
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2"])],
    context: {gender: "male"},
  });

  assert.deepEqual(products.map((item) => item.product_id), ["top-1", "top-2"]);
  assert.ok(products.every((item) => item.ai_rerank_fallback === true));
  assert.equal(reranker.getStats().fallback_count, 1);
  assert.equal(warnings[0][1].errorCode, "ETIMEDOUT");
});

test("invalid score or unknown product never enters the selected result", () => {
  const products = validateSelection({
    selected_products: [
      selection("top-1", {ai_taste_score: 101}),
      selection("unknown"),
      selection("top-2"),
    ],
  }, [group("top", ["top-1", "top-2"])], 6);

  assert.deepEqual(products.map((item) => item.product_id), ["top-2"]);
});

test("model prompt excludes affiliate credentials and unrelated context", () => {
  const messages = buildMessages([group("top", ["top-1"])], {
    gender: "male",
    scene: "date",
    appSecret: "never-send-this-secret",
    pid: "never-send-this-pid",
    sign: "never-send-this-signature",
  });
  const serialized = JSON.stringify(messages);

  assert.equal(serialized.includes("never-send-this-secret"), false);
  assert.equal(serialized.includes("never-send-this-pid"), false);
  assert.equal(serialized.includes("never-send-this-signature"), false);
});

test("model prompt requires four to six selections for every sufficiently large group", () => {
  const messages = buildMessages([
    group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"]),
    group("shoes", ["shoe-1", "shoe-2"]),
  ], {gender: "male"});
  const payload = JSON.parse(messages[1].content);

  assert.equal(payload.product_groups[0].required_minimum, 4);
  assert.equal(payload.product_groups[0].maximum, 5);
  assert.equal(payload.product_groups[1].required_minimum, 2);
  assert.equal(payload.product_groups[1].maximum, 2);
  assert.match(messages[0].content, /而不是整套合计选择 4 至 6 件/);
});

test("under-selected groups receive one focused repair call", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        const payload = JSON.parse(request.messages[1].content);
        if (calls === 1) return response([selection("top-1")]);
        assert.equal(payload.product_groups.length, 1);
        return response([
          selection("top-1"),
          selection("top-2"),
          selection("top-3"),
          selection("top-4"),
        ]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"])],
    context: {gender: "male"},
  });

  assert.equal(calls, 2);
  assert.equal(products.length, 4);
  assert.ok(products.every((product) => product.ai_rerank_fallback === false));
  assert.equal(reranker.getStats().call_count, 2);
  assert.equal(reranker.getStats().fallback_count, 0);
});
