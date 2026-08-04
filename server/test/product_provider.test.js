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
  const warnings = [];
  const provider = createProductProvider({
    environment: {},
    logger: {warn: (message) => warnings.push(message)},
  });
  const products = await provider.recommend({category: "外套"});

  assert.ok(provider instanceof MockProductProvider);
  assert.ok(products.length > 0);
  assert.ok(products.every((product) => product.platform === "mock-catalog"));
  assert.ok(products.every((product) => product.is_mock === true));
  assert.ok(products.every((product) => product.purchase_url === ""));
  assert.ok(products.every((product) => product.affiliate_url === ""));
  assert.ok(products.every((product) => product.commission_rate === 0));
  assert.equal(warnings.length, 1);
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
  assert.equal(products.length, 1);
  assert.equal(products[0].product_id, "123456");
  assert.equal(products[0].source, "taobao");
  assert.equal(products[0].category, "outerwear");
  assert.equal(products[0].shop_name, "测试品牌店");
  assert.equal(products[0].purchase_url, "https://s.click.taobao.com/affiliate");
  assert.equal(products[0].is_mock, false);
  assert.equal(products[0].commission_rate, 0.155);
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

test("keeps Mock Provider until affiliate PID is approved", () => {
  const warnings = [];
  const provider = createProductProvider({
    environment: {
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
    },
    logger: {warn: (message) => warnings.push(message)},
  });
  assert.ok(provider instanceof MockProductProvider);
  assert.equal(warnings.length, 1);
});

test("rejects non-HTTPS commerce URLs returned by Taobao", async () => {
  const provider = new TaobaoProductProvider({
    appKey: "test-app-key",
    appSecret: "test-app-secret",
    pid: "mm_100_200_300",
    fetchImpl: async () => new Response(JSON.stringify({
      tbk_dg_material_optional_upgrade_response: {
        result_list: {
          map_data: [{
            item_id: "http-product",
            title: "测试商品",
            zk_final_price: "99",
            pict_url: "http://img.example.com/product.jpg",
            item_url: "http://item.example.com/product",
            click_url: "http://click.example.com/product",
          }],
        },
      },
    }), {status: 200}),
  });

  const [product] = await provider.recommend({category: "T恤"});
  assert.equal(product.image_url, "");
  assert.equal(product.detail_url, "");
  assert.equal(product.affiliate_url, "");
  assert.equal(product.purchase_url, "");
});

test("TaobaoService keeps the search boundary independent of the provider", async () => {
  const service = new TaobaoService({
    provider: {recommend: async () => [{product_id: "product-1"}]},
  });
  assert.deepEqual(await service.search({keyword: "外套"}), [
    {product_id: "product-1"},
  ]);
});
