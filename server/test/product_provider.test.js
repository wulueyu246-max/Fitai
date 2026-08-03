const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MockProductProvider,
  TaobaoProductProvider,
  createProductProvider,
  signTaobaoRequest,
} = require("../product_provider");
const {TaobaoService} = require("../taobao_service");

test("uses MockProductProvider when Taobao credentials are absent", async () => {
  const provider = createProductProvider({environment: {}});
  const products = await provider.recommend({category: "外套"});

  assert.ok(provider instanceof MockProductProvider);
  assert.ok(products.length > 0);
  assert.ok(products.every((product) => product.platform === "mock-catalog"));
});

test("maps a signed Taobao response into the stable product contract", async () => {
  let requestBody = "";
  const provider = new TaobaoProductProvider({
    appKey: "test-app-key",
    appSecret: "test-app-secret",
    pid: "mm_100_200_300",
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return new Response(JSON.stringify({
        tbk_dg_material_optional_upgrade_response: {
          result_list: {
            map_data: [{
              item_id: "123456",
              title: "测试通勤外套",
              shop_title: "测试品牌店",
              category_name: "外套",
              zk_final_price: "399.00",
              pict_url: "//img.example.com/coat.jpg",
              item_url: "//item.example.com/123456",
              click_url: "//s.click.taobao.com/affiliate",
              coupon_share_url: "//uland.taobao.com/coupon",
              commission_rate: "1550",
            }],
          },
        },
      }), {status: 200, headers: {"content-type": "application/json"}});
    },
  });

  const products = await provider.recommend({
    category: "外套",
    style: "通勤",
  });
  const body = Object.fromEntries(new URLSearchParams(requestBody));
  const {sign, ...unsigned} = body;

  assert.equal(sign, signTaobaoRequest(unsigned, "test-app-secret"));
  assert.equal(requestBody.includes("test-app-secret"), false);
  assert.deepEqual(products, [{
    product_id: "123456",
    title: "测试通勤外套",
    brand: "测试品牌店",
    category: "外套",
    price: 399,
    image_url: "https://img.example.com/coat.jpg",
    detail_url: "https://item.example.com/123456",
    platform: "taobao",
    commission_rate: 0.155,
    affiliate_url: "https://s.click.taobao.com/affiliate",
    stock_status: "in_stock",
    pid: "mm_100_200_300",
    coupon_url: "https://uland.taobao.com/coupon",
  }]);
});

test("selects TaobaoProductProvider only with complete credentials", () => {
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
    },
  });

  assert.ok(provider instanceof TaobaoProductProvider);
});

test("allows real catalog search before an affiliate PID is approved", () => {
  const provider = createProductProvider({
    environment: {
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
    },
  });
  assert.ok(provider instanceof TaobaoProductProvider);
});

test("TaobaoService keeps the search boundary independent of the provider", async () => {
  const service = new TaobaoService({
    provider: {recommend: async () => [{product_id: "product-1"}]},
  });
  assert.deepEqual(await service.search({keyword: "外套"}), [
    {product_id: "product-1"},
  ]);
});
