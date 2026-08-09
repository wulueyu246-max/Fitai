const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AutoProductProvider,
  MockProductProvider,
  TaobaoProductProvider,
  UnavailableProductProvider,
  budgetPreferenceAssessment,
  createProductProvider,
  mapTaobaoProduct,
  normalizePublicImageUrl,
  parseTaobaoPlacement,
  extractTaobaoItems,
} = require("../product_provider");
const {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiError,
} = require("../taobao_client");
const {TaobaoService} = require("../taobao_service");

function taobaoItem(overrides = {}) {
  return {
    item_basic_info: {
      item_id: "123456",
      title: "通勤外套",
      shop_title: "示例店铺",
      category_name: "外套",
      pict_url: "//img.example.com/coat.jpg",
      ...overrides.item_basic_info,
    },
    price_promotion_info: {
      final_promotion_price: "399",
      ...overrides.price_promotion_info,
    },
    publish_info: {
      click_url: "//s.click.taobao.com/default-promotion",
      ...overrides.publish_info,
    },
  };
}

function response(method, items) {
  const key = method === TAOBAO_MATERIAL_SAMPLE_METHOD
    ? "tbk_dg_material_recommend_response"
    : "tbk_dg_material_optional_upgrade_response";
  return {[key]: {result_list: {map_data: items}}};
}

test("27939 uses the authorized upgraded material search method", () => {
  assert.equal(
    TAOBAO_MATERIAL_SEARCH_METHOD,
    "taobao.tbk.dg.material.optional.upgrade",
  );
});

function providerWithClient(client) {
  return new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client,
  });
}

test("reports an unavailable Taobao provider when credentials are absent", async () => {
  const warnings = [];
  const provider = createProductProvider({
    environment: {PRODUCT_PROVIDER: "auto"},
    logger: {warn: (...args) => warnings.push(args)},
  });
  assert.ok(provider instanceof UnavailableProductProvider);
  await assert.rejects(
    () => provider.recommend({category: "外套"}),
    (error) => error.code === "PRODUCT_PROVIDER_NOT_CONFIGURED" && error.status === 503,
  );
  assert.equal(warnings[0][1].configured, false);
  assert.deepEqual(warnings[0][1].missingVariables, [
    "TAOBAO_APP_KEY",
    "TAOBAO_APP_SECRET",
    "TAOBAO_PID",
  ]);
});

test("missing secret is named safely without logging configured values", () => {
  const warnings = [];
  createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "sensitive-app-key-value",
      TAOBAO_PID: "mm_1_2_3",
      TAOBAO_ADZONE_ID: "3",
    },
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });
  assert.deepEqual(warnings[0][1].missingVariables, ["TAOBAO_APP_SECRET"]);
  assert.equal(JSON.stringify(warnings).includes("mm_1_2_3"), false);
  assert.equal(JSON.stringify(warnings).includes("sensitive-app-key-value"), false);
});

test("authorized material search keeps budget soft and sends only official API parameters", async () => {
  const calls = [];
  const provider = providerWithClient({
    call: async (method, params, options) => {
      calls.push({method, params, options});
      return response(method, [taobaoItem({
        item_basic_info: {annual_vol: "268"},
        price_promotion_info: {reserve_price: "499", coupon_amount: "20"},
        publish_info: {
          click_url: "//s.click.taobao.com/promotion",
          income_info: {commission_rate: "1550"},
        },
      })]);
    },
  });
  const products = await provider.recommend({
    category: "外套",
    style: "通勤",
    budget: 300,
    limit: 1,
  });
  assert.equal(calls[0].method, TAOBAO_MATERIAL_SEARCH_METHOD);
  assert.equal("site_id" in calls[0].params, false);
  assert.equal(calls[0].params.adzone_id, "300");
  assert.equal("end_price" in calls[0].params, false);
  assert.equal(calls[0].options.siteId, "200");
  assert.equal(products.length, 1);
  assert.equal(products[0].category, "outerwear");
  assert.equal(products[0].purchase_url, "https://s.click.taobao.com/promotion");
  assert.equal(products[0].original_price, 499);
  assert.equal(products[0].coupon_amount, 20);
  assert.equal(products[0].sales, "268");
  assert.equal(products[0].commission_rate, 0.155);
  assert.equal(products[0].is_mock, false);
  assert.equal(products[0].budget_preference_score, 55);
  assert.match(products[0].budget_note, /高于单品预算/);
});

test("budget preference lowers ranking without filtering over-budget products", () => {
  assert.deepEqual(budgetPreferenceAssessment({price: 180}, 200), {
    budget_preference_score: 100,
    budget_note: "",
  });
  const overBudget = budgetPreferenceAssessment({price: 230}, 200);
  assert.equal(overBudget.budget_preference_score, 80);
  assert.match(overBudget.budget_note, /略高于单品预算/);

  const affordableOnLowBudget = budgetPreferenceAssessment({price: 180}, 200);
  const premiumOnLowBudget = budgetPreferenceAssessment({price: 700}, 200);
  const premiumOnHighBudget = budgetPreferenceAssessment({price: 700}, 1000);
  assert.ok(
    affordableOnLowBudget.budget_preference_score >
      premiumOnLowBudget.budget_preference_score,
  );
  assert.equal(premiumOnHighBudget.budget_preference_score, 100);
});

test("an empty search stays empty without an unrelated sampling fallback", async () => {
  const calls = [];
  const provider = providerWithClient({
    call: async (method) => {
      calls.push(method);
      return response(method, []);
    },
  });
  const products = await provider.recommend({category: "outerwear", limit: 1});
  assert.ok(calls.every((method) => method === TAOBAO_MATERIAL_SEARCH_METHOD));
  assert.ok(calls.length >= 1 && calls.length <= 3);
  assert.deepEqual(products, []);
});

test("successful empty Taobao responses do not silently become Mock products", async () => {
  const provider = providerWithClient({
    call: async (method) => response(method, []),
  });
  const products = await provider.recommend({category: "outerwear", limit: 1});
  assert.deepEqual(products, []);
});

test("Taobao API exceptions are returned explicitly without Mock products", async () => {
  const provider = providerWithClient({
    call: async () => {
      throw new TaobaoApiError("network unavailable", {code: "TAOBAO_NETWORK_ERROR"});
    },
  });
  await assert.rejects(
    () => provider.recommend({category: "outerwear", limit: 1}),
    (error) => error.code === "TAOBAO_NETWORK_ERROR" && error.status === 502,
  );
});

test("one Taobao category failure rejects the request instead of mixing Mock", async () => {
  const provider = providerWithClient({
    call: async (method, params) => {
      if (params.q?.includes("上衣")) throw new TaobaoApiError("denied", {code: "TAOBAO_PERMISSION_DENIED"});
      if (method === TAOBAO_MATERIAL_SAMPLE_METHOD) return response(method, []);
      return response(method, [taobaoItem({
        item_basic_info: {item_id: `item-${params.q}`, category_name: "鞋", title: params.q},
      })]);
    },
  });
  await assert.rejects(
    () => provider.recommend({limit: 1}),
    (error) => error.code === "TAOBAO_PERMISSION_DENIED",
  );
});

test("missing optional Taobao fields neither throw nor fabricate commerce facts", () => {
  const product = mapTaobaoProduct({item_id: "minimal", title: "基础上衣"}, {fallbackCategory: "top"});
  assert.equal(product.purchase_url, "");
  assert.equal(product.detail_url, "");
  assert.equal(product.original_price, null);
  assert.equal(product.coupon_amount, null);
  assert.equal(product.commission_rate, null);
  assert.equal("sales" in product, false);
  assert.equal(product.stock_status, "unknown");
});

test("non-HTTPS URLs never become purchase links", () => {
  const product = mapTaobaoProduct({
    item_id: "unsafe",
    title: "基础上衣",
    click_url: "http://example.com/promotion",
    item_url: "http://example.com/item",
  }, {fallbackCategory: "top"});
  assert.equal(product.purchase_url, "");
  assert.equal(product.detail_url, "");
});

test("auto mode derives site and Adzone from PID when override is absent", async () => {
  const calls = [];
  const client = {call: async (method, params, options) => {
    calls.push({method, params, options});
    return response(method, [taobaoItem()]);
  }};
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
    },
    client,
    logger: {info() {}, warn() {}},
  });
  assert.ok(provider instanceof AutoProductProvider);
  const products = await provider.recommend({category: "outerwear", limit: 1});
  assert.equal(provider.health, true);
  assert.equal(products[0].source, "taobao");
  assert.equal("site_id" in calls[0].params, false);
  assert.equal(calls[0].params.adzone_id, "3");
  assert.equal(calls[0].options.siteId, "2");
});

test("permission failure in auto mode safely falls back to Mock", async () => {
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
      TAOBAO_ADZONE_ID: "3",
    },
    client: {call: async () => { throw new TaobaoApiError("denied", {code: "TAOBAO_PERMISSION_DENIED"}); }},
    logger: {warn() {}},
  });
  const products = await provider.recommend({category: "top"});
  assert.ok(products.length > 0);
  assert.ok(products.every((product) => product.is_mock === true));
  assert.equal(provider.health, false);
  assert.equal(provider.status, "mock");
});

test("production auto mode reports Taobao failure instead of returning Mock", async () => {
  const provider = createProductProvider({
    environment: {
      NODE_ENV: "production",
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
    },
    client: {
      call: async () => {
        throw new TaobaoApiError("temporary", {code: "TAOBAO_NETWORK_ERROR"});
      },
    },
    logger: {info() {}, warn() {}},
  });

  await assert.rejects(
    provider.recommend({category: "top"}),
    (error) => error.code === "TAOBAO_NETWORK_ERROR",
  );
  assert.equal(provider.status, "error");
});

test("production rejects an explicitly configured Mock provider", async () => {
  const provider = createProductProvider({
    environment: {NODE_ENV: "production", PRODUCT_PROVIDER: "mock"},
    logger: {info() {}, error() {}},
  });
  assert.ok(provider instanceof UnavailableProductProvider);
  await assert.rejects(
    provider.recommend({category: "top"}),
    (error) => error.code === "PRODUCT_MOCK_DISABLED_IN_PRODUCTION",
  );
});

test("auto mode does not cache a failure that skips later Taobao calls", async () => {
  let recommendationCalls = 0;
  const taobao = {
    recommend: async () => {
      recommendationCalls += 1;
      if (recommendationCalls === 1) {
        throw new TaobaoApiError("temporary", {code: "TAOBAO_NETWORK_ERROR"});
      }
      return [{product_id: "taobao-1", source: "taobao", is_mock: false}];
    },
  };
  const provider = new AutoProductProvider({
    taobao,
    logger: {info() {}, warn() {}},
  });

  const first = await provider.recommend({category: "top"});
  assert.ok(first.every((product) => product.is_mock === true));
  assert.equal(provider.status, "mock");
  const second = await provider.recommend({category: "shoes"});
  assert.equal(recommendationCalls, 2);
  assert.equal(provider.status, "taobao");
  assert.equal(second[0].source, "taobao");
});

test("a keyword-only request performs one keyword search", async () => {
  const calls = [];
  const provider = providerWithClient({
    call: async (method, params) => {
      calls.push({method, params});
      return response(method, [taobaoItem({
        item_basic_info: {pict_url: "//img.example.com/top.jpg"},
        publish_info: {click_url: "//s.click.taobao.com/top"},
      })]);
    },
  });

  const products = await provider.recommend({keyword: "上衣", limit: 1});

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.q, "上衣");
  assert.equal(products.length, 1);
  assert.equal(products[0].source, "taobao");
});

test("structured queries try precise keywords in order and expose relevance fields", async () => {
  const searchKeywords = [
    "男士 浅灰色 短袖 Polo",
    "男士 clean fit Polo 夏季",
  ];
  const calls = [];
  const provider = providerWithClient({
    call: async (method, params) => {
      calls.push(params.q);
      if (params.q === "男士 clean fit 浅灰色 polo") {
        return response(method, [taobaoItem({
          item_basic_info: {
            title: "女士浅灰色吊带上衣",
            category_name: "上衣",
          },
        })]);
      }
      return response(method, [taobaoItem({
        item_basic_info: {
          title: "男士浅灰色夏季clean fit短袖Polo",
          category_name: "Polo上衣",
        },
      })]);
    },
  });

  const products = await provider.recommendForQueries([{
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    color: "浅灰色",
    style: "clean fit",
    season: "summer",
    search_keywords: searchKeywords,
    negative_keywords: ["女", "吊带", "裙"],
    limit: 1,
  }]);

  assert.equal(calls[0], "男士 clean fit 浅灰色 polo");
  assert.ok(calls.length <= 3);
  assert.ok(calls.slice(1).every((query) => query.includes("polo")));
  assert.equal(products.length, 1);
  assert.equal(products[0].gender, "male");
  assert.equal(products[0].category, "top");
  assert.ok(products[0].search_keyword.includes("polo"));
  assert.ok(products[0].relevance_score >= 80);
  assert.equal(products[0].is_mock, false);
});

test("a Taobao 50001 empty result runs at most two category-specific fallbacks", async () => {
  const searchKeywords = ["女士 米白色 玛丽珍鞋", "女士 法式 玛丽珍鞋 夏季"];
  const calls = [];
  const provider = providerWithClient({
    call: async (method, params) => {
      calls.push(params.q);
      if (params.q === "女士 法式 米白色 玛丽珍鞋") {
        throw new TaobaoApiError("no result", {
          code: "TAOBAO_API_15",
          details: {
            taobao_error_code: "15",
            taobao_sub_code: "50001",
            taobao_sub_msg: "无结果",
          },
        });
      }
      return response(method, Array.from({length: 20}, (_, index) => taobaoItem({
        item_basic_info: {
          item_id: `mary-jane-${index}`,
          title: `女士米白色法式玛丽珍鞋夏季${index}`,
          category_name: "女鞋",
          pict_url: `//img.example.com/mary-jane-${index}.jpg`,
        },
        publish_info: {click_url: `//s.click.taobao.com/mary-jane-${index}`},
      })));
    },
  });

  const products = await provider.recommendForQueries([{
    category: "shoes",
    gender: "female",
    item_name: "米白色玛丽珍鞋",
    color: "米白色",
    style: "法式",
    season: "summer",
    search_keywords: searchKeywords,
  }]);

  assert.equal(calls[0], "女士 法式 米白色 玛丽珍鞋");
  assert.ok(calls.length >= 2 && calls.length <= 3);
  assert.ok(calls.slice(1).every((query) => query.includes("玛丽珍鞋")));
  assert.equal(products.length, 4);
  assert.ok(products.every((product) => product.source === "taobao"));
});

test("an empty accessory result preserves matching core products", async () => {
  const provider = providerWithClient({
    call: async (method, params) => {
      if (method === TAOBAO_MATERIAL_SAMPLE_METHOD ||
          /耳饰|首饰/.test(String(params.q || ""))) {
        return response(method, []);
      }
      return response(method, Array.from({length: 20}, (_, index) => taobaoItem({
        item_basic_info: {
          item_id: `knit-${index}`,
          title: `女士米白色法式针织衫${index}`,
          category_name: "女士上衣",
          pict_url: `//img.example.com/knit-${index}.jpg`,
        },
        publish_info: {click_url: `//s.click.taobao.com/knit-${index}`},
      })));
    },
  });

  const products = await provider.recommendForQueries([
    {
      category: "top",
      gender: "female",
      item_name: "法式针织衫",
      color: "米白色",
      style: "法式",
      search_keywords: ["女士 米白色 法式针织衫"],
      negative_keywords: ["男装"],
    },
    {
      category: "accessory",
      gender: "female",
      item_name: "珍珠耳饰",
      style: "法式",
      search_keywords: ["女士 珍珠耳饰", "女士 简约金属耳饰"],
      negative_keywords: ["男士"],
    },
  ]);

  assert.equal(products.length, 4);
  assert.ok(products.every((product) =>
    product.category === "top" && product.source === "taobao"));
});

test("an empty core category performs one category-specific relaxed search", async () => {
  const searchQueries = [];
  const provider = providerWithClient({
    call: async (method, params) => {
      const query = String(params.q || "");
      searchQueries.push(query);
      if (query === "女士 衬衫") {
        return response(method, [taobaoItem({
          item_basic_info: {
            item_id: "relaxed-french-shirt",
            title: "女士法式简约衬衫",
            category_name: "女装上衣",
            pict_url: "//img.example.com/relaxed-shirt.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/relaxed-shirt"},
        })]);
      }
      return response(method, []);
    },
  });

  const products = await provider.recommendForQueries([{
    look_id: "look-relaxed-1",
    category: "top",
    gender: "female",
    style: "法式",
    item_name: "修身泡泡袖真丝衬衫",
    search_keywords: ["女士 法式 修身 泡泡袖 真丝衬衫"],
  }]);

  assert.equal(searchQueries.filter((query) => query === "女士 衬衫").length, 1);
  assert.ok(searchQueries.length <= 3);
  assert.equal(products.length, 1);
  assert.equal(products[0].category, "top");
  assert.equal(products[0].semantic_match, true);
});

test("fallback products still pass the semantic hard gate and empty results are logged", async () => {
  const logs = [];
  const calls = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    logger: {info: (...args) => logs.push(args), warn() {}},
    client: {
      call: async (method, params) => {
        calls.push(params.q);
        if (calls.length === 1) {
          throw new TaobaoApiError("no result", {
            code: "TAOBAO_API_15",
            details: {
              taobao_error_code: "15",
              taobao_sub_code: "50001",
              taobao_sub_msg: "无结果",
            },
          });
        }
        return response(method, [taobaoItem({
          item_basic_info: {
            item_id: `wrong-${calls.length}`,
            title: "家庭装抽纸纸巾",
            category_name: "日用品",
            pict_url: `//img.example.com/wrong-${calls.length}.jpg`,
          },
          publish_info: {click_url: `//s.click.taobao.com/wrong-${calls.length}`},
        })]);
      },
    },
  });

  const products = await provider.recommendForQueries([{
    category: "top",
    gender: "female",
    item_name: "天蓝色或白色法式衬衫",
    style: "法式",
    search_keywords: ["女士 天蓝色/白色 女 天蓝色 法式衬衫"],
  }]);

  assert.deepEqual(products, []);
  assert.equal(calls[0], "女士 法式 天蓝色 衬衫");
  assert.ok(calls.length <= 3);
  assert.ok(calls.every((query) => query.includes("衬衫")));
  const emptyLog = logs.find(([, details]) => details?.result_status === "empty" &&
    details?.errorCode === "TAOBAO_API_15");
  assert.ok(emptyLog);
  assert.equal(emptyLog[1].fallback_level, 0);
  assert.equal(emptyLog[1].final_count, 0);
});

test("valid accessory candidates remain available when core groups are empty", async () => {
  const provider = providerWithClient({
    call: async (method, params) => {
      const query = String(params.q || "");
      if (/耳饰|耳环/.test(query)) {
        return response(method, [taobaoItem({
          item_basic_info: {
            item_id: "pearl-earring",
            title: "女士法式珍珠耳环",
            category_name: "珠宝首饰",
            pict_url: "//img.example.com/earring.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/earring"},
        })]);
      }
      return response(method, []);
    },
  });

  const products = await provider.recommendForQueries([
    {
      look_id: "look-empty-core",
      category: "top",
      gender: "female",
      item_name: "法式衬衫",
      style: "法式",
      search_keywords: ["女士 法式 衬衫"],
    },
    {
      look_id: "look-empty-core",
      category: "accessory",
      search_subcategory: "jewelry",
      gender: "female",
      item_name: "珍珠耳饰",
      style: "法式",
      search_keywords: ["女士 法式 珍珠耳饰"],
    },
  ]);

  assert.deepEqual(products.map((product) => product.product_id), ["pearl-earring"]);
  assert.ok(products.every((product) => product.source === "taobao"));
});

test("builds a twenty-item quality-filtered pool and sends only four to AI", async () => {
  const pageSizes = [];
  const capturedGroups = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method, params) => {
        pageSizes.push(params.page_size);
        return response(method, Array.from({length: 30}, (_, index) => taobaoItem({
          item_basic_info: {
            item_id: `polo-${index}`,
            title: `男士浅灰色短袖Polo夏季${index}`,
            category_name: "Polo上衣",
            pict_url: `//img.example.com/polo-${index}.jpg`,
          },
          publish_info: {
            click_url: `//s.click.taobao.com/polo-${index}`,
          },
        })));
      },
    },
    reranker: {
      rerank: async ({groups}) => {
        capturedGroups.push(...groups);
        return groups.flatMap((group) => group.candidates.slice(0, 6));
      },
    },
    logger: {info() {}, warn() {}},
  });

  const products = await provider.recommendForQueries([{
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    color: "浅灰色",
    season: "summer",
    search_keywords: ["男士 浅灰色 短袖 Polo"],
  }]);

  assert.deepEqual(pageSizes, ["50"]);
  assert.equal(capturedGroups[0].candidates.length, 4);
  assert.equal(products.length, 4);
  assert.ok(products.every((product) => product.source === "taobao"));
});

test("AI rerank timeout returns rule-ranked real Taobao products", async () => {
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => response(method, Array.from(
        {length: 50},
        (_, index) => taobaoItem({
          item_basic_info: {
            item_id: `timeout-top-${index}`,
            title: `女士法式白色衬衫${index}`,
            category_name: "女士衬衫",
            pict_url: `//img.example.com/timeout-top-${index}.jpg`,
          },
          publish_info: {
            click_url: `//s.click.taobao.com/timeout-top-${index}`,
          },
        }),
      )),
    },
    reranker: {rerank: async () => new Promise(() => {})},
    rerankBudgetMs: 20,
    logger: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
    },
  });

  const products = await provider.recommendForQueries([{
    look_id: "look-timeout",
    category: "top",
    gender: "female",
    item_name: "法式白色衬衫",
    search_keywords: ["女士 法式 白色 衬衫"],
  }], {requestId: "request-timeout"});

  assert.equal(products.length, 4);
  assert.ok(products.every((product) => product.source === "taobao"));
  assert.ok(products.every((product) => product.is_mock === false));
  assert.ok(products.every((product) => product.ai_rerank_fallback === true));
  const summary = logs.find(([message]) => message === "product_pipeline_summary");
  assert.ok(summary);
  assert.equal(summary[1].ai_rerank_success, false);
  assert.equal(summary[1].fallback_used, true);
  assert.equal(summary[1].rule_rank_count, 4);
});

test("AI rerank error cannot clear valid Taobao products", async () => {
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => response(method, [taobaoItem({
        item_basic_info: {
          item_id: "error-top-1",
          title: "女士简约白色衬衫",
          category_name: "女士衬衫",
          pict_url: "//img.example.com/error-top-1.jpg",
        },
        publish_info: {click_url: "//s.click.taobao.com/error-top-1"},
      })]),
    },
    reranker: {rerank: async () => {
      throw Object.assign(new Error("invalid model output"), {code: "AI_BAD_JSON"});
    }},
    logger: {info() {}, warn() {}},
  });

  const products = await provider.recommendForQueries([{
    look_id: "look-error",
    category: "top",
    gender: "female",
    item_name: "简约白色衬衫",
    search_keywords: ["女士 简约 白色 衬衫"],
  }], {requestId: "request-error"});

  assert.deepEqual(products.map((product) => product.product_id), ["error-top-1"]);
  assert.equal(products[0].ai_rerank_fallback, true);
  assert.equal(products[0].rerank_status, "fallback");
});

test("timeout fallback style profile cannot clear valid Taobao products", async () => {
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => response(method, [taobaoItem({
        item_basic_info: {
          item_id: "fallback-style-top-1",
          title: "女士甜美短袖上衣",
          category_name: "女士上衣",
          pict_url: "//img.example.com/fallback-style-top-1.jpg",
        },
        publish_info: {click_url: "//s.click.taobao.com/fallback-style-top-1"},
      })]),
    },
    reranker: null,
    logger: {info() {}, warn() {}},
  });
  const fallbackStyleProfile = {
    source_text: "甜美穿搭",
    intent_priority_score: 90,
    primary_style: "甜美穿搭",
    must_have: ["甜美穿搭"],
    positive_keywords: ["甜美穿搭"],
    must_avoid: [],
  };

  const products = await provider.recommendForQueries([{
    look_id: "fallback-look-1",
    category: "top",
    gender: "female",
    item_name: "简洁合身上衣",
    style: "甜美穿搭",
    search_keywords: ["女士 甜美穿搭 简洁合身上衣"],
  }], {
    requestId: "timeout-fallback-products",
    style_profile: fallbackStyleProfile,
  });

  assert.equal(products.length, 1);
  assert.equal(products[0].product_id, "fallback-style-top-1");
  assert.equal(products[0].source, "taobao");
  assert.equal(products[0].is_mock, false);
});

test("recommendation cache reuses request, look, category and keyword results", async () => {
  let calls = 0;
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => {
        calls += 1;
        return response(method, [taobaoItem({
          item_basic_info: {
            item_id: "cached-top-1",
            title: "男士浅灰色短袖Polo",
            category_name: "Polo上衣",
            pict_url: "//img.example.com/cached-top-1.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/cached-top-1"},
        })]);
      },
    },
    logger: {info() {}, warn() {}},
  });
  const queries = [{
    look_id: "look-cache",
    category: "top",
    gender: "male",
    item_name: "浅灰色短袖Polo",
    search_keywords: ["男士 浅灰色 短袖 Polo"],
  }];
  const context = {requestId: "request-cache"};

  const first = await provider.recommendForQueries(queries, context);
  const second = await provider.recommendForQueries(queries, context);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test("extracts official simplified camelCase result containers", () => {
  const items = extractTaobaoItems({
    tbkDgMaterialOptionalUpgradeResponse: {
      totalResults: 1,
      resultList: {mapData: [taobaoItem()]},
    },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].item_basic_info.item_id, "123456");
});

test("mapping diagnostics contain counts but no product content or URLs", async () => {
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    client: {
      call: async (method) => response(method, [taobaoItem()]),
    },
    logger: {info: (...args) => logs.push(args), warn() {}},
  });

  await provider.recommend({keyword: "上衣", requestId: "request-map-1", limit: 1});

  const message = logs.find(([value]) => value.startsWith("淘宝商品映射诊断 "))[0];
  const diagnostics = JSON.parse(message.slice("淘宝商品映射诊断 ".length));
  assert.equal(diagnostics.rawCount, 1);
  assert.equal(diagnostics.mappedCount, 1);
  assert.equal(diagnostics.usableCount, 1);
  assert.equal(diagnostics.responseRoot, "tbk_dg_material_optional_upgrade_response");
  assert.deepEqual(diagnostics.resultListKeys, ["map_data"]);
  assert.equal(JSON.stringify(diagnostics).includes("通勤外套"), false);
  assert.equal(JSON.stringify(diagnostics).includes("s.click.taobao.com"), false);
});

test("legacy Taobao URLs map to affiliate, coupon, purchase and PID fields", () => {
  const product = mapTaobaoProduct({
    item_id: "legacy-1",
    title: "基础上衣",
    url: "//s.click.taobao.com/affiliate",
    coupon_share_url: "//uland.taobao.com/coupon",
    commission_rate: "1250",
  }, {pid: "mm_1_2_3", fallbackCategory: "top"});
  assert.equal(product.source, "taobao");
  assert.equal(product.platform, "taobao");
  assert.equal(product.affiliate_url, "https://s.click.taobao.com/affiliate");
  assert.equal(product.coupon_url, "https://uland.taobao.com/coupon");
  assert.equal(product.purchase_url, "https://uland.taobao.com/coupon");
  assert.equal(product.pid, "mm_1_2_3");
  assert.equal(product.commission_rate, 0.125);
  assert.equal(product.is_mock, false);
});

test("protocol-relative Taobao images become public HTTPS URLs", () => {
  assert.equal(
    normalizePublicImageUrl("//img.alicdn.com/bao/uploaded/item.jpg"),
    "https://img.alicdn.com/bao/uploaded/item.jpg",
  );
  assert.equal(normalizePublicImageUrl("file:///tmp/item.jpg"), "");
  assert.equal(normalizePublicImageUrl("http://127.0.0.1/item.jpg"), "");
});

test("Taobao mapping prefers a white-background image and records its quality", () => {
  const product = mapTaobaoProduct({
    item_basic_info: {
      item_id: "white-image-1",
      title: "品牌官方通勤包",
      pict_url: "//img.alicdn.com/regular.jpg",
      white_image: "//img.alicdn.com/white.jpg",
    },
  }, {fallbackCategory: "bag"});

  assert.equal(product.image_url, "https://img.alicdn.com/white.jpg");
  assert.equal(product.image_quality_hint, "white_background");
});

test("Taobao mapping recognizes official and promotional image presentation", () => {
  const official = mapTaobaoProduct({
    item_basic_info: {
      item_id: "official-image-1",
      title: "品牌系列男士衬衫",
      shop_title: "品牌官方旗舰店",
      pict_url: "//img.alicdn.com/item.jpg",
    },
  }, {fallbackCategory: "top"});
  const promotional = mapTaobaoProduct({
    item_basic_info: {
      item_id: "promo-image-1",
      title: "男士衬衫",
      pict_url: "//img.alicdn.com/promo-poster/sale.jpg",
    },
  }, {fallbackCategory: "top"});

  assert.equal(official.image_quality_hint, "official");
  assert.equal(promotional.image_quality_hint, "promotion_poster");
});

test("matching TAOBAO_ADZONE_ID may explicitly override the PID value", () => {
  assert.deepEqual(parseTaobaoPlacement("mm_1_2_300", "300"), {
    siteId: "2",
    adzoneId: "300",
  });
});

test("mismatched PID and Adzone fails startup without logging the PID", () => {
  const errors = [];
  assert.throws(() => createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_300",
      TAOBAO_ADZONE_ID: "999",
    },
    logger: {info() {}, error: (...args) => errors.push(args)},
  }), (error) => error.code === "TAOBAO_PID_ADZONE_MISMATCH");
  assert.equal(errors[0][1].errorCode, "TAOBAO_PID_ADZONE_MISMATCH");
  assert.equal(JSON.stringify(errors).includes("mm_1_2_300"), false);
});

test("invalid PID format fails startup with an explicit safe error", () => {
  assert.throws(
    () => parseTaobaoPlacement("invalid-pid"),
    (error) => error.code === "TAOBAO_INVALID_PID" && /TAOBAO_PID/.test(error.message),
  );
});

test("TaobaoService keeps provider implementation server-side", async () => {
  const service = new TaobaoService({provider: {recommend: async () => [{product_id: "p1"}]}});
  assert.deepEqual(await service.search({keyword: "外套"}), [{product_id: "p1"}]);
});
