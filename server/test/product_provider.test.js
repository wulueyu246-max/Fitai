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

test("an inconsistent Purchase Specification never reaches Taobao or visual verification", async () => {
  let taobaoCalls = 0;
  let visualCalls = 0;
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => {
        taobaoCalls += 1;
        return response(method, []);
      },
    },
    visualVerifier: {
      maxCandidatesPerSlot: 8,
      async verifyGroups({groups}) {
        visualCalls += 1;
        return {groups, summary: {}};
      },
    },
    logger: {info() {}, warn() {}},
  });
  const products = await provider.recommendForQueries([{
    request_id: "request-inconsistent-spec",
    look_id: "look-1",
    slot_key: "request-inconsistent-spec:look-1:shoes:0",
    category: "shoes",
    gender: "female",
    product_type: "白色透气老爹鞋",
    product_family: "sneakers",
    item_name: "白色透气老爹鞋",
    required_attributes: ["尖头", "浅口"],
    constraint_sources: [
      {value: "尖头", level: "required", source: "body_strategy"},
      {value: "浅口", level: "required", source: "body_strategy"},
    ],
  }], {requestId: "request-inconsistent-spec", gender: "female"});

  assert.deepEqual(products, []);
  assert.equal(taobaoCalls, 0);
  assert.equal(visualCalls, 0);
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

test("Shopping Agent exposes Taobao 50001 as zero-result recall metadata", async () => {
  const provider = providerWithClient({
    call: async () => {
      throw new TaobaoApiError("no result", {
        code: "TAOBAO_API_15",
        details: {
          taobao_error_code: "15",
          taobao_sub_code: "50001",
          taobao_sub_msg: "无结果",
        },
      });
    },
  });

  const result = await provider.searchShoppingAgentCandidates({
    query: "女 短袖 衬衫",
    category: "top",
    gender: "female",
    requestId: "shopping-agent-zero-result",
  });

  assert.deepEqual(result.products, []);
  assert.equal(result.raw_count, 0);
  assert.equal(result.valid_count, 0);
  assert.equal(result.zero_result_recall, true);
  assert.equal(result.recall_error_code, "ZERO_RESULT_RECALL");
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

test("new decision pipeline preserves twenty candidates even with legacy visual verifier configured", async () => {
  const capturedGroups = [];
  let visualCalls = 0;
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => response(method, Array.from(
        {length: 30},
        (_, index) => taobaoItem({
          item_basic_info: {
            item_id: `new-pipeline-top-${index}`,
            title: `男士简洁时髦短袖T恤${index}`,
            category_name: "男士T恤",
            pict_url: `//img.example.com/new-pipeline-top-${index}.jpg`,
          },
          publish_info: {
            click_url: `//s.click.taobao.com/new-pipeline-top-${index}`,
          },
        }),
      )),
    },
    visualVerifier: {
      maxCandidatesPerSlot: 10,
      async verifyGroups({groups}) {
        visualCalls += 1;
        return {groups, summary: {}};
      },
    },
    reranker: {
      rerank: async ({groups}) => {
        capturedGroups.push(...groups);
        return groups.flatMap((group) => group.candidates.slice(0, 6));
      },
    },
    outfitPostProcessor: ({products}) => ({
      applied: true,
      products,
      looks: [],
    }),
    logger: {info() {}, warn() {}},
  });

  const products = await provider.recommendForQueries([{
    look_id: "new-pipeline-look",
    category: "top",
    gender: "male",
    item_name: "简洁时髦短袖T恤",
    search_keywords: ["男 T恤 时髦"],
  }], {
    requestId: "new-pipeline-reserve",
    decision_pipeline: "new_decision_pipeline.v1",
  });

  assert.equal(visualCalls, 0);
  assert.equal(capturedGroups[0].candidates.length, 20);
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

test("Candidate Gate rejects core shoe conflicts while final only preserves ranking scores", async () => {
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method) => response(method, [
        taobaoItem({
          item_basic_info: {
            item_id: "blueprint-mary-jane",
            title: "女士蝴蝶结圆头玛丽珍皮鞋",
            category_name: "女鞋",
            pict_url: "//img.example.com/blueprint-mary-jane.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/blueprint-mary-jane"},
        }),
        taobaoItem({
          item_basic_info: {
            item_id: "blueprint-running-shoe",
            title: "361轻量跑步训练运动鞋",
            category_name: "运动鞋",
            pict_url: "//img.example.com/blueprint-running-shoe.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/blueprint-running-shoe"},
        }),
      ]),
    },
    reranker: null,
    logger: {
      info: (...args) => logs.push(args),
      warn() {},
    },
  });

  const products = await provider.recommendForQueries([{
    look_id: "sweet-look-1",
    category: "shoes",
    gender: "female",
    item_name: "圆头玛丽珍皮鞋",
    search_keywords: ["女士 圆头 玛丽珍皮鞋"],
  }], {
    requestId: "blueprint-api-output",
    style_profile: {intent_priority_score: 95},
    outfit_blueprint: {
      style_identity: "轻盈浪漫造型",
      core_elements: ["蝴蝶结", "女性化", "复古甜美"],
      must_have_items: {shoes: ["圆头玛丽珍皮鞋"]},
      avoid_items: ["跑步鞋", "训练鞋", "运动鞋"],
    },
  });

  assert.deepEqual(products.map((product) => product.product_id), [
    "blueprint-mary-jane",
  ]);
  assert.ok(Number.isFinite(products[0].blueprint_match_score));
  assert.ok(products[0].blueprint_match_score >= 50);
  assert.ok(Array.isArray(products[0].matched_elements));
  assert.deepEqual(products[0].conflict_elements, []);
  const summary = logs.find(([name]) => name === "product_blueprint_summary");
  assert.equal(summary[1].request_id, "blueprint-api-output");
  assert.equal(summary[1].product_title, "女士蝴蝶结圆头玛丽珍皮鞋");
  assert.ok(Number.isFinite(summary[1].blueprint_score));
  assert.equal(summary[1].final_rank, 1);
});

test("Blueprint search expansion recovers abstract queries and logs the successful level", async () => {
  const calls = [];
  const logs = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method, params) => {
        calls.push(params.q);
        if (params.q !== "女士 单鞋") return response(method, []);
        return response(method, [taobaoItem({
          item_basic_info: {
            item_id: "expanded-mary-jane",
            title: "女士蝴蝶结圆头低跟玛丽珍单鞋",
            category_name: "女鞋",
            pict_url: "//img.example.com/expanded-mary-jane.jpg",
          },
          publish_info: {click_url: "//s.click.taobao.com/expanded-mary-jane"},
        })]);
      },
    },
    reranker: null,
    logger: {
      info: (...args) => logs.push(args),
      warn() {},
    },
  });

  const products = await provider.recommendForQueries([{
    look_id: "sweet-expanded-look",
    category: "shoes",
    gender: "female",
    item_name: "甜美穿搭风格鞋履",
    search_keywords: ["甜美穿搭风格鞋履"],
  }], {
    requestId: "blueprint-expansion-request",
    style_profile: {intent_priority_score: 95},
    outfit_blueprint: {
      core_elements: ["蝴蝶结", "女性化", "复古甜美"],
      must_have_items: {shoes: ["圆头低跟玛丽珍皮鞋"]},
      avoid_items: ["运动鞋", "跑步鞋", "训练鞋"],
    },
  });

  assert.deepEqual(calls, [
    "女士 蝴蝶结 玛丽珍鞋",
    "女士 玛丽珍鞋",
    "女士 单鞋",
  ]);
  assert.equal(products.length, 1);
  assert.equal(products[0].product_id, "expanded-mary-jane");
  assert.ok(products[0].blueprint_match_score >= 50);
  const summary = logs.find(([name]) => name === "search_expansion_summary");
  assert.equal(summary[1].blueprint_element, "圆头低跟玛丽珍皮鞋");
  assert.equal(summary[1].successful_query, "女士 单鞋");
  assert.equal(summary[1].candidate_count, 1);
});

test("short-leg body strategy ranks proportion evidence without becoming a hard gate", async () => {
  let itemId = 0;
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      call: async (method, params) => {
        const query = String(params.q || "");
        const candidates = /鞋/u.test(query)
          ? [
            ["女士浅口尖头低跟鞋", "女鞋"],
            ["女士厚重厚底高帮鞋", "女鞋"],
          ]
          : /裤|裙|下装/u.test(query)
            ? [
              ["女士高腰垂坠直筒裤显腿长", "女裤"],
              ["女士低腰宽松拖地裤", "女裤"],
            ]
            : [
              ["女士短款合身上衣显腰线", "女士上衣"],
              ["女士宽松长款遮臀上衣", "女士上衣"],
            ];
        return response(method, candidates.map(([title, category]) => taobaoItem({
          item_basic_info: {
            item_id: `body-strategy-${itemId++}`,
            title,
            category_name: category,
            pict_url: `//img.example.com/body-strategy-${itemId}.jpg`,
          },
          publish_info: {click_url: `//s.click.taobao.com/body-strategy-${itemId}`},
        })));
      },
    },
    reranker: null,
    logger: {info() {}, warn() {}},
  });
  const products = await provider.recommendForQueries([
    {
      look_id: "proportion-look",
      category: "top",
      gender: "female",
      item_name: "短款合身上衣",
      search_keywords: ["女士 短款合身上衣"],
    },
    {
      look_id: "proportion-look",
      category: "bottom",
      gender: "female",
      item_name: "高腰垂坠直筒裤",
      search_keywords: ["女士 高腰垂坠直筒裤"],
    },
    {
      look_id: "proportion-look",
      category: "shoes",
      gender: "female",
      item_name: "浅口尖头低跟鞋",
      search_keywords: ["女士 浅口尖头低跟鞋"],
    },
  ], {
    requestId: "short-leg-body-strategy",
    style_profile: {
      intent_priority_score: 95,
      must_avoid: ["盖臀长上衣", "低腰裤", "厚重高帮鞋"],
    },
    outfit_blueprint: {
      core_elements: ["提高腰线", "高腰", "纵向延伸"],
      silhouette_strategy: ["短款上衣搭配高腰下装"],
      must_have_items: {
        top: ["短款合身上衣"],
        bottom: ["高腰垂坠直筒裤"],
        shoes: ["浅口尖头低跟鞋"],
      },
      avoid_items: ["低腰裤", "拖地裤", "厚重高帮鞋", "盖臀长上衣"],
    },
  });

  assert.equal(products.length, 6);
  assert.ok(products.some((product) =>
    product.category === "top" && /短款合身/u.test(product.title)));
  assert.ok(products.some((product) =>
    product.category === "bottom" && /高腰/u.test(product.title)));
  assert.ok(products.some((product) =>
    product.category === "shoes" && /浅口.*尖头.*低跟/u.test(product.title)));
  const preferred = products.filter((product) =>
    /短款合身|高腰|浅口.*尖头.*低跟/u.test(product.title));
  const conflicting = products.filter((product) =>
    /低腰|拖地|厚重|高帮|遮臀/u.test(product.title));
  assert.equal(preferred.length, 3);
  assert.equal(conflicting.length, 3);
  assert.ok(preferred.every((product) => product.body_strategy_match_score >= 90));
  assert.ok(conflicting.every((product) =>
    Number.isFinite(product.body_strategy_match_score)));
  assert.ok(conflicting.some((product) => product.body_strategy_ranking_conflict === true));
});

test("mature, classic and unknown Blueprints all retain at least one matching candidate", async (t) => {
  const cases = [
    {
      name: "mature pointed shoe",
      itemName: "高级成熟鞋履",
      title: "女士真皮尖头低跟皮鞋通勤单鞋",
      blueprint: {
        core_elements: ["结构感", "利落"],
        material_direction: ["真皮"],
        must_have_items: {shoes: ["尖头低跟皮鞋"]},
        avoid_items: ["运动鞋", "跑鞋"],
      },
    },
    {
      name: "classic leather loafer",
      itemName: "经典克制鞋履",
      title: "女士真皮低Logo经典乐福鞋",
      blueprint: {
        core_elements: ["低Logo", "经典轮廓"],
        material_direction: ["真皮"],
        must_have_items: {shoes: ["真皮乐福鞋"]},
        avoid_items: ["大Logo运动"],
      },
    },
    {
      name: "unknown gallery description",
      category: "dress",
      itemName: "夜间艺术展造型",
      title: "女士银灰色不对称立体剪裁连衣裙",
      blueprint: {
        core_elements: ["不对称结构"],
        color_palette: ["银灰色"],
        must_have_items: {dress: ["不对称立体剪裁连衣裙"]},
        avoid_items: ["普通运动套装"],
      },
    },
  ];

  for (const [index, sample] of cases.entries()) {
    await t.test(sample.name, async () => {
      const category = sample.category || "shoes";
      const provider = new TaobaoProductProvider({
        pid: "mm_100_200_300",
        adzoneId: "300",
        client: {
          call: async (method) => response(method, [taobaoItem({
            item_basic_info: {
              item_id: `expanded-case-${index}`,
              title: sample.title,
              category_name: category === "dress" ? "女装连衣裙" : "女鞋",
              pict_url: `//img.example.com/expanded-case-${index}.jpg`,
            },
            publish_info: {click_url: `//s.click.taobao.com/expanded-case-${index}`},
          })]),
        },
        reranker: null,
      });
      const products = await provider.recommendForQueries([{
        look_id: `expanded-case-look-${index}`,
        category,
        gender: "female",
        item_name: sample.itemName,
        search_keywords: [sample.itemName],
      }], {
        requestId: `expanded-case-request-${index}`,
        style_profile: {intent_priority_score: 95},
        outfit_blueprint: sample.blueprint,
      });

      assert.ok(products.length > 0);
      assert.ok(products.every((product) => product.blueprint_match_score >= 50));
    });
  }
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

test("ranking layers cannot zero a Candidate Gate PASS slot before visual verification", async () => {
  const entries = [];
  let visualGroups = [];
  const items = Array.from({length: 400}, (_, index) => taobaoItem({
    item_basic_info: {
      item_id: `convergence-${index}`,
      title: `女士黑色皮质玛丽珍鞋 ${index}`,
      category_name: "女鞋",
      pict_url: `//img.example.com/convergence-${index}.jpg`,
    },
    publish_info: {
      click_url: `//s.click.taobao.com/convergence-${index}`,
    },
  }));
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {call: async (method) => response(method, items)},
    visualVerifier: {
      maxCandidatesPerSlot: 8,
      async verifyGroups({groups}) {
        visualGroups = groups;
        const verified = groups.map((group) => ({
          ...group,
          candidates: group.candidates.map((product) => ({
            ...product,
            visual_status: "PASS",
          })),
          visual_funnel: {
            candidate_count: group.candidates.length,
            pass_count: group.candidates.length,
            uncertain_count: 0,
            fail_count: 0,
            fallback_used: false,
          },
        }));
        return {
          groups: verified,
          summary: {
            candidate_count: verified[0].candidates.length,
            visual_call_count: 1,
            total_visual_ms: 1,
            fallback_used: false,
          },
        };
      },
    },
    reranker: null,
    logger: {
      info: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    },
  });

  const products = await provider.recommendForQueries([{
    request_id: "pipeline-convergence",
    look_id: "look-1",
    slot_key: "pipeline-convergence:look-1:shoes:0",
    category: "shoes",
    gender: "female",
    product_type: "黑色玛丽珍鞋",
    product_family: "mary_jane",
    item_name: "黑色玛丽珍鞋",
    required_attributes: ["玛丽珍结构"],
    avoid_attributes: ["运动感"],
  }], {
    requestId: "pipeline-convergence",
    gender: "female",
    style_profile: {
      intent_priority_score: 95,
      negative_keywords: ["玛丽珍"],
    },
    outfit_blueprint: {
      style_identity: "极简",
      avoid_items: ["玛丽珍"],
    },
  });

  assert.ok(products.length > 0);
  assert.equal(visualGroups.length, 1);
  assert.equal(visualGroups[0].candidates.length, 10);
  const funnel = entries.find(([message]) => message === "product_slot_funnel")?.[1];
  assert.equal(funnel.raw_count, 400);
  assert.equal(funnel.valid_count, 400);
  assert.equal(funnel.candidate_gate_pass, 400);
  assert.equal(funnel.candidate_gate_unknown, 0);
  assert.equal(funnel.candidate_gate_fail, 0);
  assert.ok(funnel.ranked_count > 0);
  assert.equal(funnel.visual_candidate_count, 10);
  assert.equal(funnel.visual_pass, 10);
  assert.equal(funnel.visual_uncertain, 0);
  assert.equal(funnel.visual_fail, 0);
  assert.ok(funnel.final_count > 0);
  assert.equal(funnel.first_zero_stage, null);
  assert.equal(entries.some(([message]) =>
    message === "PRODUCT_PIPELINE_ILLEGAL_ZEROING"), false);
});

test("Candidate Gate remains a hard boundary and reports first_zero_stage", async () => {
  const entries = [];
  let visualCalls = 0;
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {call: async (method) => response(method, [taobaoItem({
      item_basic_info: {
        item_id: "female-conflict",
        title: "女士吊带上衣",
        category_name: "女士上衣",
      },
    })])},
    visualVerifier: {
      maxCandidatesPerSlot: 8,
      async verifyGroups({groups}) {
        visualCalls += 1;
        return {groups, summary: {}};
      },
    },
    logger: {
      info: (...args) => entries.push(args),
      warn: (...args) => entries.push(args),
      error: (...args) => entries.push(args),
    },
  });
  const products = await provider.recommendForQueries([{
    look_id: "look-male",
    slot_key: "candidate-gate-fail:look-male:top:0",
    category: "top",
    gender: "male",
    product_type: "短袖Polo",
    product_family: "polo",
    item_name: "短袖Polo",
  }], {requestId: "candidate-gate-fail", gender: "male"});

  assert.deepEqual(products, []);
  assert.equal(visualCalls, 0);
  const funnel = entries.find(([message]) => message === "product_slot_funnel")?.[1];
  assert.ok(funnel.raw_count > 0);
  assert.ok(funnel.candidate_gate_fail > 0);
  assert.equal(funnel.ranked_count, 0);
  assert.equal(funnel.visual_candidate_count, 0);
  assert.equal(funnel.final_count, 0);
  assert.equal(funnel.first_zero_stage, "candidate_gate");
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
