const assert = require("node:assert/strict");
const test = require("node:test");

process.env.PRODUCT_PROVIDER = "mock";

const {
  CATEGORY_SLOTS,
  PRODUCT_SEEDS,
  ProductCatalog,
  buildCategorySlots,
  canonicalCategory,
} = require("../product_catalog");
const {app, listenForRequests} = require("../index");

test("ships at least four products for every stable category slot", () => {
  assert.ok(PRODUCT_SEEDS.length >= 20);
  for (const slot of CATEGORY_SLOTS) {
    assert.ok(
      PRODUCT_SEEDS.filter((item) => item.category === slot).length >= 4,
      `${slot} should contain at least four products`,
    );
  }
});

test("normalizes legacy Chinese and English category aliases", () => {
  const aliases = {
    top: ["shirt", "tshirt", "upper", "上衣", "T恤"],
    bottom: ["pants", "trousers", "skirt", "裤子", "裙子"],
    shoes: ["shoe", "sneakers", "loafers", "鞋"],
    outerwear: ["coat", "jacket", "外套"],
    accessories: ["bag", "hat", "scarf", "配饰"],
  };
  for (const [slot, values] of Object.entries(aliases)) {
    assert.ok(values.every((value) => canonicalCategory(value) === slot));
  }
});

test("response slots preserve dress products without changing Mock slots", () => {
  const slots = buildCategorySlots([
    {product_id: "dress-1", category: "dress", title: "女士法式连衣裙"},
    {product_id: "top-1", category: "top", title: "女士针织衫"},
  ]);

  assert.equal(slots.dress[0].product_id, "dress-1");
  assert.equal(slots.top[0].product_id, "top-1");
  assert.ok(CATEGORY_SLOTS.every((slot) => Array.isArray(slots[slot])));
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
  assert.ok(products.every((item) => item.category === "outerwear"));
  assert.equal(products[0].product_id, "coat-001");
  assert.equal(products[0].platform, "mock-catalog");
  assert.equal(products[0].is_mock, true);
  assert.equal(products[0].affiliate_url, "");
  assert.equal(products[0].purchase_url, "");
  assert.equal(products[0].detail_url, "");
  assert.equal(products[0].commission_rate, 0);
  assert.equal(products[0].pid, "");
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
  assert.deepEqual(
    new Set(products.map((item) => item.category)),
    new Set(["top", "bottom", "shoes"]),
  );
});

test("uses category fallback when an exact budget match is unavailable", () => {
  const catalog = new ProductCatalog();
  const products = catalog.recommendForQueries([
    {category: "T恤", keyword: "透气"},
    {category: "裤子", keyword: "直筒"},
  ], {budget: 500});

  assert.ok(products.length >= 2);
  assert.ok(products.some((item) => item.category === "top"));
  assert.ok(products.some((item) => item.category === "bottom"));
});

test("unfiltered recommendations keep every outfit category available", () => {
  const products = new ProductCatalog().recommend({limit: 12});

  assert.equal(products.length, 12);
  assert.deepEqual(
    new Set(products.map((item) => item.category)),
    new Set(CATEGORY_SLOTS),
  );
  assert.equal(new Set(products.map((item) => item.product_id)).size, 12);
});

test("falls back from style to color to season to any item in category", () => {
  const customProducts = [
    {...PRODUCT_SEEDS[0], product_id: "style", id: "style", style: "极简", color: "白色", season: "四季", tags: []},
    {...PRODUCT_SEEDS[0], product_id: "color", id: "color", style: "休闲", color: "森林绿", season: "四季", tags: []},
    {...PRODUCT_SEEDS[0], product_id: "season", id: "season", style: "休闲", color: "白色", season: "秋冬", tags: []},
    {...PRODUCT_SEEDS[0], product_id: "any", id: "any", style: "休闲", color: "白色", season: "四季", tags: []},
  ];
  const catalog = new ProductCatalog(customProducts);

  assert.equal(catalog.recommend({category: "上衣", style: "极简"})[0].product_id, "style");
  assert.equal(catalog.recommend({category: "top", color: "森林绿"})[0].product_id, "color");
  assert.equal(catalog.recommend({category: "shirt", season: "秋冬"})[0].product_id, "season");
  assert.ok(catalog.recommend({category: "upper", style: "不存在"}).length > 0);
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
    assert.ok(body.products.every((item) => item.category === "shoes"));
    assert.ok(body.products.every((item) => item.product_id && item.stock_status));
    assert.deepEqual(Object.keys(body.categorySlots), CATEGORY_SLOTS);
    assert.equal(body.categorySlots.shoes.length, body.products.length);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("POST /products/recommend returns Mock Provider products", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/products/recommend`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({category: "外套", style: "通勤"}),
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.products));
    assert.ok(body.products.length > 0);
    assert.ok(body.products.every((item) => item.category === "outerwear"));
    assert.ok(body.products.every((item) => item.is_mock === true));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("default recommendation endpoint returns complete categorySlots", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/products/recommend`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.categorySlots.top.length >= 1);
    assert.ok(body.categorySlots.bottom.length >= 1);
    assert.ok(body.categorySlots.shoes.length >= 1);
    assert.ok(body.categorySlots.outerwear.length >= 1);
    assert.ok(body.categorySlots.accessories.length >= 1);
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
