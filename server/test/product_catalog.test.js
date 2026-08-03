const assert = require("node:assert/strict");
const test = require("node:test");

process.env.PRODUCT_PROVIDER = "mock";

const {
  PRODUCT_SEEDS,
  ProductCatalog,
} = require("../product_catalog");
const {app, listenForRequests} = require("../index");

test("ships at least 20 catalog products across required categories", () => {
  assert.ok(PRODUCT_SEEDS.length >= 20);
  const categories = new Set(PRODUCT_SEEDS.map((item) => item.category));
  assert.deepEqual(
    [...categories].sort(),
    ["T恤", "外套", "裤子", "鞋"].sort(),
  );
});

test("matches products by category, style, color and body type", () => {
  const catalog = new ProductCatalog();
  const products = catalog.recommend({
    category: "外套",
    style: "通勤",
    color: "藏青",
    bodyType: "肩窄",
  });

  assert.ok(products.length > 0);
  assert.ok(products.every((item) => item.category === "外套"));
  assert.equal(products[0].product_id, "coat-001");
  assert.equal(products[0].platform, "mock-catalog");
  assert.match(products[0].affiliate_url, /^https:\/\//);
  assert.equal(products[0].pid, "shupi-test");
  assert.equal(products[0].coupon_url, "");
});

test("matches AI query objects to catalog-backed recommendations", () => {
  const catalog = new ProductCatalog();
  const products = catalog.recommendForQueries([
    {category: "T恤", style: "极简", keyword: "透气白色T恤"},
    {category: "裤子", style: "通勤", keyword: "直筒裤"},
    {category: "鞋", style: "简约", keyword: "低帮鞋"},
  ]);

  assert.ok(products.length >= 3);
  assert.ok(products.every((item) => item.product_id && item.title && item.price >= 0));
});

test("GET /products/recommend returns matched catalog products", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/products/recommend?category=${encodeURIComponent("鞋")}&style=${encodeURIComponent("运动")}`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.products));
    assert.ok(body.products.length > 0);
    assert.ok(body.products.every((item) => item.category === "鞋"));
    assert.ok(body.products.every((item) => item.product_id && item.stock_status));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("GET /products/search uses the provider boundary", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/products/search?keyword=${encodeURIComponent("通勤外套")}`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.provider, "mock");
    assert.ok(Array.isArray(body.products));
    assert.ok(body.products.length > 0);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("product clicks are recorded and exposed through the stats API", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const productId = `stats-product-${Date.now()}`;
    const clickResponse = await fetch(
      `http://127.0.0.1:${port}/analytics/events`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          id: `click-event-${Date.now()}`,
          name: "product_click",
          userId: "stats-test-user",
          properties: {
            productId,
            platform: "mock-catalog",
          },
        }),
      },
    );
    const statsResponse = await fetch(
      `http://127.0.0.1:${port}/products/${productId}/stats`,
    );
    const stats = await statsResponse.json();

    assert.equal(clickResponse.status, 202);
    assert.equal(statsResponse.status, 200);
    assert.deepEqual(stats, {click_count: 1});
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
