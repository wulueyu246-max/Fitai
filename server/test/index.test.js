const assert = require("node:assert/strict");
const test = require("node:test");

process.env.AFFILIATE_POSTBACK_SECRET = "fitai-test-affiliate-secret";
process.env.PRODUCT_PROVIDER = "mock";
process.env.AI_FORCE_MOCK = "true";

const {
  app,
  assertStyleExpressionConsistency,
  analyticsStore,
  buildAiRequestUrl,
  createAiClient,
  createAiDispatcher,
  createDiagnosticFetch,
  createAiErrorDetails,
  createBasicFallbackOutfitAnalysis,
  generateSemanticFallbackInterpretation,
  createMockOutfitAnalysis,
  buildOutfitApiResponse,
  configureProxyEnvironment,
  extractAiText,
  parseOutfitAnalysis,
  parseBlueprintPhase,
  mergeBlueprintAndLookPhase,
  generatePhasedOutfitAnalysis,
  repairStyleInterpretationAndLooks,
  readBoolean,
  listenForRequests,
  logOptionalServiceWarnings,
  partialViewSafetyInstruction,
  productRecommendationFilters,
  productRecommendationRequest,
  resolveAiFallbackReason,
  resolveAiModeReason,
  resolveAiConfig,
  resolveAiTimeoutMs,
  resolveBlueprintTimeoutMs,
  resolveLookTimeoutMs,
  sanitizeAiErrorMessage,
  shouldUseMockAi,
  shouldRepairStyleInterpretation,
  isAllowedOrigin,
  isLocalDevelopmentOrigin,
  validateProductionConfig,
  validateOutfitRequest,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_BLUEPRINT_TIMEOUT_MS,
  DEFAULT_LOOK_TIMEOUT_MS,
  LEGACY_AI_MODEL,
  structuredJsonRequestOptions,
} = require("../index");
const {AnalyticsStore} = require("../analytics_store");
const {blueprintHasCoreItems} = require("../outfit_blueprint");

const imageDataUrl = "data:image/jpeg;base64,AA==";

test("product recommendations accept q as an alias for keyword", () => {
  assert.equal(
    productRecommendationFilters({q: "上衣"}, "request-products-1").keyword,
    "上衣",
  );
  assert.equal(
    productRecommendationFilters({keyword: "外套", q: "上衣"}).keyword,
    "外套",
  );
});

test("keeps the HTTP server listening until it is explicitly closed", async () => {
  const server = await listenForRequests(app, 0);

  assert.equal(server.listening, true);
  assert.notEqual(server.address(), null);

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert.equal(server.listening, false);
});

test("production startup permits disabled optional services", () => {
  const productionConfig = {
    isProduction: true,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    allowedOrigins: new Set(),
    adminAnalyticsKey: "",
    affiliatePostbackSecret: "",
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
  };

  assert.doesNotThrow(() => validateProductionConfig(productionConfig, {
    OPENAI_API_KEY: "configured-but-not-logged",
    AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    AI_MODEL: "qwen3.7-plus",
  }));
});

test("production startup still requires the core AI configuration", () => {
  const productionConfig = {
    isProduction: true,
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    allowedOrigins: new Set(),
    adminAnalyticsKey: "",
    affiliatePostbackSecret: "",
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
  };

  assert.throws(
    () => validateProductionConfig(productionConfig, {}),
    /OPENAI_API_KEY, AI_BASE_URL, AI_MODEL/,
  );
});

test("logs clear warnings for disabled optional services", () => {
  const warnings = [];
  logOptionalServiceWarnings({
    allowedOrigins: new Set(),
    adminAnalyticsKey: "",
    affiliatePostbackSecret: "",
    supabaseUrl: "",
    supabaseServiceRoleKey: "",
  }, {warn: (message) => warnings.push(message)});

  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((message) => message.includes("Supabase")));
  assert.ok(warnings.some((message) => message.includes("返回 503")));
});

test("allows only exact localhost and loopback HTTP origins", () => {
  const configured = {allowedOrigins: new Set()};
  for (const origin of [
    "http://localhost",
    "http://localhost:61728",
    "http://localhost:1",
    "http://127.0.0.1",
    "http://127.0.0.1:54321",
  ]) {
    assert.equal(isLocalDevelopmentOrigin(origin), true, origin);
    assert.equal(isAllowedOrigin(origin, configured), true, origin);
  }

  for (const origin of [
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com:61728",
    "https://localhost:61728",
    "http://localhost:61728/path",
    "http://user:pass@localhost:61728",
  ]) {
    assert.equal(isLocalDevelopmentOrigin(origin), false, origin);
    assert.equal(isAllowedOrigin(origin, configured), false, origin);
  }
});

test("allows configured HTTPS origins and requests without Origin", () => {
  const configured = {
    allowedOrigins: new Set(["https://app.example.com"]),
  };

  assert.equal(isAllowedOrigin("https://app.example.com", configured), true);
  assert.equal(isAllowedOrigin(undefined, configured), true);
  assert.equal(
    isAllowedOrigin("https://other.example.com", configured),
    false,
  );
});

test("handles allowed and rejected CORS preflight requests", async () => {
  const server = await listenForRequests(app, 0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/outfit`;
    const response = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:61728",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-requested-with",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:61728",
    );
    assert.match(
      response.headers.get("access-control-allow-methods") || "",
      /OPTIONS/,
    );
    assert.match(
      response.headers.get("access-control-allow-headers") || "",
      /X-Requested-With/i,
    );

    const rejected = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost.evil.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 403);
    assert.equal(rejectedBody.error.code, "ORIGIN_NOT_ALLOWED");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("validates a complete outfit request with three images", () => {
  const result = validateOutfitRequest({
    height: 170,
    weight: 60,
    scene: "日常",
    request: "通勤穿搭",
    images: {
      front: imageDataUrl,
      side: imageDataUrl,
      back: imageDataUrl,
    },
  });

  assert.equal(result.height, 170);
  assert.equal(result.weight, 60);
  assert.deepEqual(Object.keys(result.images), ["front", "side", "back"]);
});

test("accepts a front-only outfit request without optional photo fields", () => {
  const result = validateOutfitRequest({
    height: 170,
    weight: 60,
    scene: "日常",
    request: "简约穿搭",
    images: {front: imageDataUrl},
  });

  assert.deepEqual(Object.keys(result.images), ["front"]);
  assert.equal(result.images.front, imageDataUrl);
});

test("deferred outfit responses return before product matching with timings", async () => {
  const server = await listenForRequests(app, 0);
  try {
    const {port} = server.address();
    const requestId = "9a4e3d10-44f2-4aa1-a120-9a4e3d1044f2";
    const response = await fetch(`http://127.0.0.1:${port}/outfit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-defer-products": "true",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        height: 170,
        weight: 60,
        scene: "日常",
        request: "简约穿搭",
        images: {front: imageDataUrl},
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-id"), requestId);
    assert.match(response.headers.get("server-timing") || "", /total;dur=/);
    assert.deepEqual(body.recommendations.products, []);
    assert.equal(typeof body.bodyProfile, "string");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("rejects an outfit request without a front photo", () => {
  assert.throws(
    () => validateOutfitRequest({
      height: 170,
      weight: 60,
      scene: "日常",
      request: "简约穿搭",
      images: {side: imageDataUrl},
    }),
    /请上传正面全身照/,
  );
});

test("vision prompt only analyzes photo angles that were provided", () => {
  assert.match(partialViewSafetyInstruction, /仅提供正面照/);
  assert.match(partialViewSafetyInstruction, /不得假装已观察到侧面或背面/);
  assert.match(partialViewSafetyInstruction, /实际可见信息/);
});

test("parses AI output into a structured analysis", () => {
  const result = parseOutfitAnalysis(
    JSON.stringify({
      bodyProfile: "身体分析",
      style: "风格",
      recommendations: {
        top: "上衣",
        bottom: "下装",
        shoes: "鞋子",
        accessories: "配饰",
        summary: "总结",
      },
      products: [
        {
          category: "上衣",
          style: "简约通勤",
          keyword: "短款外套",
        },
      ],
    }),
  );

  assert.equal(result.bodyProfile, "身体分析");
  assert.equal(result.products[0].category, "top");
  assert.equal(result.products[0].gender, "unisex");
  assert.equal(result.products[0].item_name, "短款外套");
  assert.ok(result.products[0].search_keywords.length >= 2);
  assert.ok(result.products[0].search_keywords.length <= 3);
});

test("adds catalog recommendations while upgrading legacy product requirements", async () => {
  const analysis = {
    bodyProfile: "balanced",
    style: "minimal",
    recommendations: {
      top: "shirt",
      bottom: "trousers",
      shoes: "loafers",
      accessories: "watch",
      summary: "commute look",
    },
    products: [
      {category: "T恤", style: "minimal", keyword: "shirt keyword"},
    ],
  };
  const matchedProducts = [
    {
      product_id: "product-1",
      title: "Structured Shirt",
      brand: "Shupi Select",
      category: "top",
      price: 299,
      image_url: "https://cdn.example.com/product-1.jpg",
      detail_url: "https://shop.example.com/product-1",
      platform: "mock-catalog",
      commission_rate: 0.08,
      affiliate_url: "https://shop.example.com/product-1?channel=test",
      stock_status: "in_stock",
    },
  ];

  const response = await buildOutfitApiResponse(analysis, matchedProducts);

  assert.equal(response.products[0].category, "top");
  assert.equal(response.products[0].item_name, "shirt keyword");
  assert.ok(response.products[0].search_keywords.length >= 2);
  assert.deepEqual(response.recommendations.products, matchedProducts);
  assert.equal(response.recommendations.top, "shirt");
});

test("preserves a male AI gender when a product omits its gender", () => {
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "male",
    bodyProfile: "balanced",
    style: "法式",
    recommendations: {
      top: "法式男士衬衫",
      bottom: "休闲裤",
      shoes: "皮鞋",
      accessories: "手表",
      summary: "男性约会穿搭",
    },
    products: [{
      category: "top",
      item_name: "法式衬衫",
      style: "法式",
      fit: "长袖",
      search_keywords: ["法式衬衫", "法式 长袖衬衫", "法式 上衣"],
      negative_keywords: ["女装", "荷叶边", "吊带"],
    }],
  }), {gender: "male"});

  assert.equal(analysis.gender, "male");
  assert.equal(analysis.products[0].gender, "male");
  assert.deepEqual(analysis.products[0].search_keywords, [
    "男士 法式衬衫",
    "男士 法式 长袖衬衫",
    "男士 法式 上衣",
  ]);
});

test("AI designs three complete male Clean Fit looks before product matching", () => {
  const item = (category, itemName, color) => ({
    category,
    item_name: itemName,
    color,
    fit: "合体",
    material: "棉混纺",
    style: "Clean Fit",
    season: "summer",
    scene: "date",
    search_keywords: [`${color} ${itemName}`, `Clean Fit ${itemName}`],
    negative_keywords: ["女装", "吊带", "连衣裙"],
  });
  const looks = [1, 2, 3].map((index) => ({
    look_id: `male-clean-${index}`,
    gender: "male",
    scene: "date",
    style: "Clean Fit",
    style_direction: index === 1 ? "日系极简" : index === 2 ? "韩系高级" : "轻商务",
    items: [
      item("top", "短袖Polo", "浅灰色"),
      item("bottom", "九分休闲裤", "米白色"),
      item("shoes", "德训鞋", "白色"),
      item("accessory", "简约腕表", "银色"),
    ],
  }));

  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "male",
    bodyProfile: "男性身体比例分析",
    style: "Clean Fit",
    recommendations: {
      top: "浅灰 Polo",
      bottom: "米白休闲裤",
      shoes: "白色德训鞋",
      accessories: "简约腕表",
      summary: "夏季约会完整搭配",
    },
    looks,
  }), {
    gender: "male",
    scene: "date",
    requestId: "request-male-clean",
  });

  assert.equal(analysis.looks.length, 3);
  assert.equal(analysis.products.length, 12);
  assert.equal(analysis.style_upgrade_level, "upgrade");
  assert.deepEqual(analysis.looks.map((look) => look.style_direction), [
    "日系极简",
    "韩系高级",
    "轻商务",
  ]);
  assert.ok(analysis.looks.every((look) =>
    look.request_id === "request-male-clean" && look.gender === "male"));
  assert.ok(analysis.products.every((product) =>
    product.gender === "male" && product.search_keywords.every((keyword) => keyword.startsWith("男士"))));
});

test("Styling Strategy raises a short visual leg line before designing French Looks", () => {
  const item = (category, itemName, fit) => ({
    category,
    item_name: itemName,
    color: "cream",
    fit,
    material: "structured fabric",
    style: "French date",
    season: "summer",
    scene: "date",
    search_keywords: [`women cream ${itemName}`, `women French ${itemName}`],
    negative_keywords: ["menswear"],
  });
  const stylingStrategy = {
    body_strengths: ["defined shoulder line"],
    proportion_issues: ["visually short leg line"],
    visual_goals: ["raise_visual_waistline", "elongate_legs"],
    waistline_strategy: "Use a clear high waist without over-tightening.",
    top_length_strategy: "Prefer cropped or tucked tops.",
    bottom_strategy: "Use high-rise A-line or full-length vertical trousers.",
    shoe_strategy: "Prioritize almond or pointed toes and a comfortable 3cm low heel.",
    color_strategy: "Continue the lower-body and shoe color where possible.",
    silhouette_strategy: "Create three distinct vertical and waistline solutions.",
    skin_exposure_strategy: "Use a measured ankle or neckline opening for lightness.",
    accessory_strategy: "Keep accessories compact around the raised waistline.",
    weather_strategy: "Use breathable summer materials.",
  };
  const looks = [
    {
      look_id: "french-waist-1",
      styling_goal: "raise the visual waistline",
      proportion_strategy: "cropped knit plus high-rise A-line skirt and almond-toe low heel",
      why_this_changes_the_body_proportion: "The shorter top and higher waist increase the visible leg share.",
      items: [
        item("top", "cropped knit top", "cropped"),
        item("bottom", "high-rise A-line skirt", "high-rise A-line"),
        item("shoes", "almond-toe low heel", "low_heel almond_toe"),
      ],
    },
    {
      look_id: "french-line-2",
      styling_goal: "create a long vertical line",
      proportion_strategy: "tucked blouse plus full-length high-rise trousers and pointed flats",
      why_this_changes_the_body_proportion: "A continuous trouser line and pointed toe extend the lower-body line.",
      items: [
        item("top", "tucked draped blouse", "tucked"),
        item("bottom", "high-rise wide-leg trousers", "full-length high-rise"),
        item("shoes", "pointed flat", "flat pointed_toe"),
      ],
    },
    {
      look_id: "french-dress-3",
      styling_goal: "use one-color continuity",
      proportion_strategy: "defined-waist midi dress and low-vamp shoes",
      why_this_changes_the_body_proportion: "The uninterrupted color column creates a lighter vertical silhouette.",
      items: [
        item("dress", "defined-waist midi dress", "defined waist"),
        item("shoes", "low-vamp Mary Jane", "low_heel low_vamp"),
      ],
    },
  ].map((look, index) => ({
    ...look,
    gender: "female",
    scene: "date",
    style: "French",
    style_direction: `French proportion direction ${index + 1}`,
  }));

  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "female",
    bodyProfile: "160cm, 49kg, photographed leg line appears slightly short",
    style: "French date",
    styling_strategy: stylingStrategy,
    recommendations: {
      top: "cropped or tucked refined tops",
      bottom: "high-rise shaped bottoms",
      shoes: "leg-line extending but comfortable shoes",
      accessories: "compact refined accessories",
      summary: "three proportion-led French Looks",
    },
    looks,
  }), {gender: "female", scene: "date"});

  assert.deepEqual(analysis.styling_strategy.visual_goals, [
    "raise_visual_waistline",
    "elongate_legs",
  ]);
  assert.match(analysis.styling_strategy.shoe_strategy, /杏仁头|尖头|3厘米/);
  assert.ok(analysis.looks.some((look) =>
    /高腰|腰线/.test(look.proportion_strategy) &&
    look.items.some((product) =>
      product.category === "shoes" && /pointed|almond|low_heel/i.test(product.fit))));
  assert.equal(new Set(analysis.looks.map((look) => look.proportion_strategy)).size, 3);
});

test("balanced Clean Fit and rain strategies do not force impractical height shoes", () => {
  const makePayload = ({scene, shoeStrategy, weatherStrategy, shoeName, shoeFit}) => ({
    gender: "male",
    bodyProfile: "balanced visual proportions",
    style: "Clean Fit",
    styling_strategy: {
      body_strengths: ["balanced shoulder and leg proportion"],
      proportion_issues: [],
      visual_goals: ["create_structure"],
      waistline_strategy: "Keep a natural waistline.",
      top_length_strategy: "Use a clean regular length.",
      bottom_strategy: "Use a straight trouser line.",
      shoe_strategy: shoeStrategy,
      color_strategy: "Use quiet tonal continuity.",
      silhouette_strategy: "Keep a clean structured silhouette.",
      skin_exposure_strategy: "Keep exposure minimal and intentional.",
      accessory_strategy: "Use one restrained accessory.",
      weather_strategy: weatherStrategy,
    },
    recommendations: {
      top: "structured knit polo",
      bottom: "straight trousers",
      shoes: shoeName,
      accessories: "minimal watch",
      summary: "balanced Clean Fit",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `clean-weather-${index}`,
      gender: "male",
      scene,
      style: "Clean Fit",
      style_direction: `Clean direction ${index}`,
      styling_goal: "preserve balanced proportions",
      proportion_strategy: "natural waist and straight vertical trouser line",
      why_this_changes_the_body_proportion: "Structure is added without artificial height devices.",
      items: [
        {category: "top", item_name: "knit polo", fit: "regular", search_keywords: ["men knit polo"], negative_keywords: ["women"]},
        {category: "bottom", item_name: "straight trousers", fit: "straight", search_keywords: ["men straight trousers"], negative_keywords: ["women"]},
        {category: "shoes", item_name: shoeName, fit: shoeFit, search_keywords: [`men ${shoeName}`], negative_keywords: ["women"]},
      ],
    })),
  });
  const clean = parseOutfitAnalysis(JSON.stringify(makePayload({
    scene: "daily",
    shoeStrategy: "Use flat loafers or light sneakers for comfort.",
    weatherStrategy: "Dry mild weather.",
    shoeName: "minimal loafer",
    shoeFit: "flat loafer",
  })), {gender: "male", scene: "daily"});
  const rainy = parseOutfitAnalysis(JSON.stringify(makePayload({
    scene: "rainy commute",
    shoeStrategy: "Use water-resistant rubber-soled loafers or sneakers.",
    weatherStrategy: "Avoid suede, open toes, and slippery soles in rain.",
    shoeName: "water-resistant rubber-soled loafer",
    shoeFit: "flat weatherproof loafer",
  })), {gender: "male", scene: "rainy commute"});

  assert.doesNotMatch(clean.styling_strategy.shoe_strategy, /高跟|厚底/);
  assert.match(rainy.styling_strategy.weather_strategy, /雨天|麂皮|易滑/);
  assert.ok(rainy.products
    .filter((item) => item.category === "shoes")
    .every((item) => !/open.toe|suede|heel/i.test(`${item.item_name} ${item.fit}`)));
});

test("upgrade mode rejects repeating a female user's white tee and black shorts", () => {
  const repeatedLook = (index) => ({
    look_id: `female-date-${index}`,
    gender: "female",
    scene: "日常约会",
    style: "日常",
    style_direction: `方向 ${index}`,
    items: [
      {category: "top", item_name: "白色T恤", color: "白色", search_keywords: ["女士 白色 T恤"], negative_keywords: ["男装"]},
      {category: "bottom", item_name: "黑色短裤", color: "黑色", search_keywords: ["女士 黑色 短裤"], negative_keywords: ["男装"]},
      {category: "shoes", item_name: "小白鞋", color: "白色", search_keywords: ["女士 白色 小白鞋"], negative_keywords: ["男鞋"]},
      {category: "bag", item_name: "腋下包", color: "黑色", search_keywords: ["女士 黑色 腋下包"], negative_keywords: ["男包"]},
    ],
  });
  const payload = JSON.stringify({
    gender: "female",
    bodyProfile: "160cm 49kg",
    style: "日常约会",
    style_upgrade_level: "upgrade",
    recommendations: {
      top: "白色T恤",
      bottom: "黑色短裤",
      shoes: "小白鞋",
      accessories: "腋下包",
      summary: "保持原搭配",
    },
    looks: [1, 2, 3].map(repeatedLook),
  });

  assert.throws(() => parseOutfitAnalysis(payload, {
    gender: "female",
    scene: "日常约会",
    userInput: "女生160cm 49kg，当前穿：白T+黑短裤",
  }), /未达到 style_upgrade_level=upgrade/);

  const upgradedPayload = JSON.parse(payload);
  upgradedPayload.looks.forEach((look, index) => {
    const upgradedTop = index === 0 ? "短款针织衫" : index === 1 ? "垂感衬衫" : "翻领Polo针织衫";
    const upgradedBottom = index === 0 ? "高腰阔腿裤" : index === 1 ? "直筒西裤" : "A字中长裙";
    look.items[0] = {
      ...look.items[0],
      item_name: upgradedTop,
      color: index === 0 ? "燕麦色" : index === 1 ? "雾蓝色" : "奶油色",
      search_keywords: [`女士 ${upgradedTop}`],
    };
    look.items[1] = {
      ...look.items[1],
      item_name: upgradedBottom,
      color: index === 2 ? "深灰色" : "米白色",
      search_keywords: [`女士 ${upgradedBottom}`],
    };
  });
  const upgraded = parseOutfitAnalysis(JSON.stringify(upgradedPayload), {
    gender: "female",
    scene: "日常约会",
    userInput: "女生160cm 49kg，当前穿：白T+黑短裤",
  });

  assert.equal(upgraded.style_upgrade_level, "upgrade");
  assert.ok(upgraded.looks.every((look) =>
    !look.items.some((item) => item.item_name === "白色T恤" || item.item_name === "黑色短裤")));
});

test("American vintage menswear includes a hat requirement by styling decision", () => {
  const coreItems = () => [
    {category: "top", item_name: "复古牛仔衬衫", color: "靛蓝", search_keywords: ["男士 靛蓝 复古 牛仔衬衫"], negative_keywords: ["女装"]},
    {category: "bottom", item_name: "直筒卡其裤", color: "卡其", search_keywords: ["男士 卡其 直筒裤 复古"], negative_keywords: ["女装"]},
    {category: "shoes", item_name: "复古工装靴", color: "棕色", search_keywords: ["男士 棕色 复古 工装靴"], negative_keywords: ["女鞋"]},
    {category: "hat", item_name: "复古牛仔帽", color: "靛蓝", style: "vintage", search_keywords: ["男士 牛仔帽 复古", "美式街头帽"], negative_keywords: ["女帽"]},
  ];
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "male",
    bodyProfile: "成年男性，比例均衡",
    style: "美式复古男装",
    style_upgrade_level: "upgrade",
    recommendations: {
      top: "复古牛仔衬衫",
      bottom: "直筒卡其裤",
      shoes: "工装靴",
      accessories: "复古牛仔帽",
      summary: "美式复古完整造型",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `vintage-${index}`,
      gender: "male",
      scene: "周末出行",
      style: "美式复古",
      style_direction: `美式复古方向 ${index}`,
      accessories_decision: [
        {category: "hat", include: true, reason: "强化美式复古轮廓和造型完整度"},
        {category: "scarf", include: false, reason: "当前季节无需增加颈部层次"},
      ],
      items: coreItems(),
    })),
  }), {gender: "male", scene: "周末出行"});

  const hats = analysis.products.filter((item) => item.category === "hat");
  assert.equal(hats.length, 3);
  assert.ok(hats.every((item) => item.accessory_type === "hat"));
  assert.ok(hats.every((item) => item.search_keywords[0].includes("男士")));
  assert.ok(analysis.looks.every((look) =>
    look.accessories_decision.find((decision) => decision.category === "hat").include));
});

test("Clean Fit minimalist decisions remove a forced hat before product search", () => {
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "male",
    bodyProfile: "成年男性，比例均衡",
    style: "Clean Fit 极简",
    style_upgrade_level: "upgrade",
    recommendations: {
      top: "针织Polo",
      bottom: "九分西裤",
      shoes: "极简德训鞋",
      accessories: "无需帽子",
      summary: "保持极简留白",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `clean-${index}`,
      gender: "male",
      scene: "日常约会",
      style: "Clean Fit 极简",
      style_direction: `Clean Fit 方向 ${index}`,
      accessories_decision: [
        {category: "hat", include: false, reason: "保持头肩线条简洁，避免过度造型"},
      ],
      items: [
        {category: "top", item_name: "针织Polo", color: "燕麦色", search_keywords: ["男士 燕麦色 针织 Polo"], negative_keywords: ["女装"]},
        {category: "bottom", item_name: "九分西裤", color: "深灰色", search_keywords: ["男士 深灰色 九分 西裤"], negative_keywords: ["女装"]},
        {category: "shoes", item_name: "极简德训鞋", color: "白色", search_keywords: ["男士 白色 极简 德训鞋"], negative_keywords: ["女鞋"]},
        {category: "hat", item_name: "棒球帽", color: "白色", search_keywords: ["男士 白色 棒球帽"], negative_keywords: ["女帽"]},
      ],
    })),
  }), {gender: "male", scene: "日常约会"});

  assert.equal(analysis.products.length, 9);
  assert.equal(analysis.products.some((item) => item.category === "hat"), false);
  assert.ok(analysis.looks.every((look) =>
    look.accessories_decision[0].include === false &&
    look.items.every((item) => item.category !== "hat")));
});

test("duplicate accessory categories keep the first valid decision", () => {
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "male",
    bodyProfile: "adult male",
    style: "Clean Fit",
    style_upgrade_level: "maintain",
    style_semantics: {
      identity_impression: ["clean modern professional"],
      emotional_tone: ["calm", "confident"],
      visual_personality: ["minimal", "structured"],
      social_signal: ["reliable"],
      must_express: ["clean structure"],
      must_avoid: ["messy decoration"],
      style_atoms: ["minimalism", "structure"],
      confidence: 0.9,
      interpretation_summary: "A clean and structured modern direction.",
    },
    recommendations: {
      top: "knit polo",
      bottom: "straight trousers",
      shoes: "minimal sneakers",
      accessories: "no hat required",
      summary: "clean complete look",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `dedupe-${index}`,
      gender: "male",
      scene: "date",
      style: "Clean Fit",
      style_direction: `direction-${index}`,
      accessories_decision: index === 3 ? [] : [
        {category: "hat", include: false, reason: "keep the silhouette clean"},
        {category: "cap", include: true, reason: "duplicate normalized category"},
      ],
      items: [
        {category: "top", item_name: "knit polo", color: "grey", search_keywords: ["men grey knit polo"], negative_keywords: ["women"]},
        {category: "bottom", item_name: "straight trousers", color: "navy", search_keywords: ["men navy straight trousers"], negative_keywords: ["women"]},
        {category: "shoes", item_name: "minimal sneakers", color: "white", search_keywords: ["men white minimal sneakers"], negative_keywords: ["women"]},
      ],
    })),
  }), {gender: "male", scene: "date"});

  assert.equal(analysis.looks[0].accessories_decision.length, 1);
  assert.deepEqual(analysis.looks[0].accessories_decision[0], {
    category: "hat",
    include: false,
    reason: "当前造型无需额外加入该配饰",
  });
  assert.equal(analysis.looks[1].accessories_decision.length, 1);
  assert.deepEqual(analysis.looks[2].accessories_decision, []);
});

test("unknown AI accessory decisions are discarded without weakening core Looks", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.looks[0].accessories_decision.push({
    category: "decorative-object",
    include: true,
    reason: "Adds decoration.",
  });
  payload.looks[1].accessories_decision.push({
    category: "bracelet",
    include: true,
    reason: "Adds polish.",
  });

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "male",
    requestId: "accessory-tolerance-request",
  });

  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.looks.every((look) =>
    look.items.some((item) => item.category === "top") &&
    look.items.some((item) => item.category === "bottom") &&
    look.items.some((item) => item.category === "shoes")));
  assert.ok(analysis.looks[0].accessories_decision.every((decision) =>
    decision.category !== "decorative-object"));
  assert.ok(analysis.looks[1].accessories_decision.some((decision) =>
    decision.category === "jewelry"));
});

function validAiOutfitPayloadForNormalization() {
  const coreItems = [
    {
      category: "top",
      item_name: "structured shirt",
      search_keywords: ["men structured shirt"],
      negative_keywords: ["women"],
    },
    {
      category: "bottom",
      item_name: "straight trousers",
      search_keywords: ["men straight trousers"],
      negative_keywords: ["women"],
    },
    {
      category: "shoes",
      item_name: "leather loafers",
      search_keywords: ["men leather loafers"],
      negative_keywords: ["women"],
    },
  ];
  const reasons = ["", "   ", undefined];
  return {
    gender: "male",
    bodyProfile: "balanced adult male",
    style: "Clean Fit",
    style_upgrade_level: "maintain",
    styling_strategy: {
      body_strengths: ["balanced shoulders"],
      proportion_issues: [],
      visual_goals: ["create_structure"],
      waistline_strategy: "",
      top_length_strategy: null,
      bottom_strategy: "   ",
      shoe_strategy: "comfortable loafers",
      color_strategy: "",
      silhouette_strategy: "clean vertical line",
      skin_exposure_strategy: "",
      accessory_strategy: "",
      weather_strategy: "",
    },
    recommendations: {
      top: "structured shirt",
      bottom: "straight trousers",
      shoes: "leather loafers",
      accessories: "optional watch",
      summary: "complete Clean Fit outfit",
    },
    looks: [0, 1, 2].map((index) => ({
      look_id: `normalized-look-${index + 1}`,
      gender: "male",
      scene: "date",
      style: "Clean Fit",
      style_direction: `direction-${index + 1}`,
      styling_goal: index === 0 ? "" : "balanced styling",
      proportion_strategy: index === 1 ? "   " : "clean vertical line",
      why_this_changes_the_body_proportion: index === 2 ? null : "adds structure",
      accessories_decision: [{
        category: "watch",
        include: index !== 1,
        ...(reasons[index] === undefined ? {} : {reason: reasons[index]}),
      }],
      items: coreItems,
    })),
  };
}

test("Outfit Blueprint is preserved and drives concrete Look requirements", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.outfit_blueprint = {
    style_identity: "精致晚间造型",
    character_impression: "克制而有艺术感",
    visual_keywords: ["精致", "艺术感"],
    core_elements: ["立体剪裁"],
    silhouette_strategy: ["清晰纵向轮廓"],
    color_palette: ["墨绿色"],
    material_direction: ["真丝", "精纺羊毛"],
    must_have_items: {
      top: ["真丝立领衬衫"],
      bottom: ["高腰精纺长裤"],
      shoes: ["尖头皮质乐福鞋"],
    },
    avoid_items: ["普通运动套装"],
    occasion_strategy: "适合晚间文化活动",
  };

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    requestId: "blueprint-integration",
    gender: "male",
    scene: "晚间活动",
    userInput: "未来的自然语言风格描述",
  });

  assert.equal(analysis.outfit_blueprint.style_identity, "精致晚间造型");
  assert.equal(analysis.looks[0].items[0].item_name, "真丝立领衬衫");
  assert.ok(analysis.looks[0].items[0].search_keywords[0].includes("真丝立领衬衫"));
  assert.match(analysis.looks[0].items[0].query_reason, /穿搭蓝图/u);
  assert.ok(analysis.looks[0].items[0].source_elements.includes("真丝立领衬衫"));
  assert.ok(analysis.looks[0].items[0].translated_queries.length >= 1);
  assert.ok(analysis.looks[0].items[0].search_keywords.every(
    (query) => !query.includes(analysis.outfit_blueprint.style_identity),
  ));
  assert.ok(analysis.products
    .filter((item) => ["top", "bottom", "shoes"].includes(item.category))
    .every((item) => item.blueprint_required === true));
});

test("high-priority style intent replaces generic casual Looks and advice", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.gender = "female";
  payload.style = "普通休闲";
  payload.style_semantics = {
    identity_impression: ["甜美精致"],
    emotional_tone: ["轻盈愉悦"],
    visual_personality: ["柔和浪漫"],
    social_signal: ["亲和但有造型感"],
    must_express: ["甜美轮廓", "轻盈细节", "柔和配色"],
    must_avoid: ["普通休闲", "运动鞋", "工装感"],
    style_atoms: ["浪漫", "精致", "轻盈"],
    confidence: 0.95,
    interpretation_summary: "以轻盈、精致和柔和轮廓表达明确的甜美气质。",
  };
  payload.style_profile = {
    source_text: "甜美穿搭",
    intent_priority_score: 95,
    interpretation: "用柔和色彩、精致细节和轻盈轮廓形成甜美但不幼稚的造型。",
    primary_style: "甜美精致",
    secondary_styles: ["轻盈浪漫"],
    blend_rationale: "甜美为主，轻盈和精致感控制整体完成度。",
    dimensions: {
      maturity: 48, femininity: 92, masculinity: 8, structure: 45,
      minimalism: 42, romantic: 90, sportiness: 5, sexiness: 35,
      youthfulness: 78, luxury: 58, casualness: 32,
    },
    silhouette: "轻盈收腰并强调柔和曲线",
    preferred_items: [
      "蝴蝶结针织衫", "荷叶边雪纺衫", "短款柔软开衫",
      "高腰A字半身裙", "柔粉垂坠半身裙", "高腰微喇长裤",
      "圆头玛丽珍鞋", "缎面芭蕾鞋", "精致低跟单鞋",
    ],
    preferred_colors: ["柔粉色", "奶油白", "浅紫色"],
    preferred_materials: ["细腻针织", "轻盈雪纺", "柔光缎面"],
    must_have: ["甜美轮廓", "轻盈细节", "柔和配色"],
    must_avoid: ["普通休闲", "运动鞋", "跑步鞋", "工装感"],
    positive_keywords: ["甜美", "轻盈", "精致"],
    negative_keywords: ["运动鞋", "跑步鞋", "工装"],
  };
  payload.recommendations = {
    top: "穿一件普通上衣。",
    bottom: "搭配普通裤子。",
    shoes: "选择舒适的鞋。",
    accessories: "可以加配饰。",
    summary: "保持休闲舒适。",
  };
  payload.looks = [0, 1, 2].map((index) => ({
    look_id: `generic-casual-${index + 1}`,
    gender: "female",
    scene: "日常约会",
    style: "普通休闲",
    style_direction: `日常休闲套装 ${index + 1}`,
    styling_goal: "保持舒适和日常",
    proportion_strategy: "自然宽松",
    why_this_changes_the_body_proportion: "穿着方便",
    accessories_decision: [],
    items: [
      {
        category: "top", gender: "female", item_name: "白色T恤",
        search_keywords: ["女士 白色 T恤"], negative_keywords: ["男装"],
      },
      {
        category: "bottom", gender: "female", item_name: "休闲弯刀裤",
        search_keywords: ["女士 休闲 弯刀裤"], negative_keywords: ["男装"],
      },
      {
        category: "shoes", gender: "female", item_name: "361运动鞋",
        search_keywords: ["女士 361 运动鞋"], negative_keywords: ["男鞋"],
      },
    ],
  }));

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "female",
    scene: "日常约会",
    requestId: "sweet-style-request",
    userInput: "甜美穿搭",
  });
  const allItems = analysis.looks.flatMap((look) => look.items);
  const forbidden = /白色T恤|弯刀裤|361|运动鞋/u;

  assert.equal(analysis.looks.length, 3);
  assert.equal(
    allItems.some((item) => forbidden.test(item.item_name)),
    false,
    JSON.stringify(allItems.map((item) => ({
      category: item.category,
      item_name: item.item_name,
      style_match_score: item.style_match_score,
    }))),
  );
  assert.ok(analysis.looks.every((look) =>
    look.style === "甜美精致" &&
    look.style_match_score >= 60 &&
    !/普通休闲/u.test(look.style_direction)));
  assert.ok(allItems.every((item) => item.style_match_score >= 60));
  assert.match(analysis.recommendations.summary, /甜美穿搭/u);
  assert.doesNotMatch(
    Object.values(analysis.recommendations).join(" "),
    /保持休闲舒适|普通上衣|普通裤子/u,
  );
});

test("invalid AI Look output keeps the requested style instead of generic casual fallback", () => {
  const aiContent = JSON.stringify({
    gender: "female",
    bodyProfile: "身材比例分析已完成",
    style: "甜美精致",
    style_semantics: {
      must_express: ["甜美", "轻盈", "精致细节"],
      must_avoid: ["普通休闲", "运动鞋", "工装"],
    },
    style_profile: {
      source_text: "甜美穿搭",
      intent_priority_score: 95,
      primary_style: "甜美精致",
      preferred_items: [
        "蝴蝶结针织衫",
        "荷叶边雪纺衫",
        "短款柔软开衫",
        "高腰A字半身裙",
        "柔粉垂坠半身裙",
        "高腰微喇长裤",
        "圆头玛丽珍鞋",
        "缎面芭蕾鞋",
        "精致低跟单鞋",
      ],
      preferred_colors: ["柔粉色", "奶油白"],
      preferred_materials: ["细腻针织", "轻盈雪纺"],
      must_have: ["甜美", "轻盈", "精致"],
      must_avoid: ["普通休闲", "运动鞋", "工装"],
      positive_keywords: ["甜美", "轻盈", "精致"],
      negative_keywords: ["普通休闲", "运动鞋", "工装"],
    },
    looks: [{look_id: "broken-look", items: []}],
  });
  const analysis = createBasicFallbackOutfitAnalysis({
    requestId: "sweet-fallback-request",
    request: "甜美穿搭",
    gender: "female",
    scene: "约会",
  }, "AI_OUTPUT_INVALID", {aiContent});

  const itemNames = analysis.looks.flatMap((look) =>
    look.items.map((item) => item.item_name));
  const searchKeywords = analysis.looks.flatMap((look) =>
    look.items.flatMap((item) => item.search_keywords));

  assert.equal(analysis.analysisMode, "rule_fallback");
  assert.equal(analysis.style_profile.source_text, "甜美穿搭");
  assert.equal(analysis.outfit_blueprint.blueprint_source, "semantic_fallback");
  assert.equal(analysis.style_profile.intent_priority_score, 95);
  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.recommendations.summary.includes("甜美穿搭"));
  assert.ok(itemNames.some((name) => name.includes("蝴蝶结")));
  assert.ok(itemNames.some((name) => name.includes("玛丽珍")));
  assert.ok(searchKeywords.every((keyword) => keyword.includes("甜美")));
  assert.equal(itemNames.some((name) => /简洁实穿|休闲弯刀|361/.test(name)), false);
  assert.ok(analysis.looks.every((look) => look.style_match_score >= 60));
});

test("AI timeout fallback keeps weather context out of product search keywords", () => {
  const analysis = createBasicFallbackOutfitAnalysis({
    requestId: "timeout-fallback-request",
    request: "甜美穿搭 用户地区：中国 绍兴；当前实时天气：绍兴，31℃，多云；场景：约会。穿搭方案必须遵循：高温时优先透气材质。",
    gender: "female",
    scene: "约会",
  }, "AI_TIMEOUT");

  const keywords = analysis.looks.flatMap((look) =>
    look.items.flatMap((item) => item.search_keywords));
  const itemNames = analysis.looks.flatMap((look) =>
    look.items.map((item) => item.item_name));

  assert.equal(analysis.analysisMode, "rule_fallback");
  assert.equal(analysis.fallbackReason, "AI_TIMEOUT");
  assert.equal(analysis.style_profile.source_text, "甜美穿搭");
  assert.equal(analysis.looks.length, 3);
  assert.ok(keywords.length > 0);
  assert.ok(keywords.every((keyword) => keyword.length <= 160));
  assert.ok(keywords.every((keyword) => !keyword.includes("当前实时天气")));
  assert.ok(keywords.every((keyword) => !keyword.includes("穿搭方案必须遵循")));
  assert.ok(keywords.some((keyword) => keyword.includes("甜美穿搭")));
  assert.equal(itemNames.some((name) => /甜美穿搭(?:上衣|下装|鞋履)/u.test(name)), false);
});

test("semantic Blueprint fallback preserves mature intent without casual sports", () => {
  const analysis = createBasicFallbackOutfitAnalysis({
    requestId: "mature-semantic-fallback",
    request: "成熟利落、有气场的女性约会穿搭",
    gender: "female",
    scene: "约会",
  }, "AI_TIMEOUT", {
    styleInterpretation: {
      style_semantics: {
        must_express: ["成熟气场", "结构感", "利落线条"],
        must_avoid: ["休闲运动", "跑步鞋", "训练服"],
        style_atoms: ["收束腰线", "垂坠材质", "尖头鞋"],
        confidence: 0.91,
        interpretation_summary: "强调成熟、结构和女性气场。",
      },
      style_profile: {
        source_text: "成熟利落、有气场的女性约会穿搭",
        intent_priority_score: 94,
        interpretation: "以修身结构和成熟材质塑造利落女性气场。",
        primary_style: "成熟结构感",
        preferred_items: ["垂坠真丝衬衫", "高腰修身西裤", "尖头低跟鞋"],
        preferred_colors: ["黑色", "酒红色"],
        preferred_materials: ["真丝", "精纺羊毛"],
        must_have: ["结构感", "成熟材质", "修身轮廓"],
        must_avoid: ["休闲运动", "跑步鞋", "训练服"],
        positive_keywords: ["利落", "成熟", "有气场"],
        negative_keywords: ["运动鞋", "训练外套"],
      },
      outfit_blueprint: {
        style_identity: "成熟结构感",
        core_elements: ["结构感", "成熟材质", "修身轮廓"],
        must_have_items: {
          top: ["垂坠真丝衬衫"],
          bottom: ["高腰修身西裤"],
          shoes: ["尖头低跟鞋"],
        },
        avoid_items: ["休闲运动", "跑步鞋", "训练服"],
      },
    },
  });

  const itemNames = analysis.looks.flatMap((look) =>
    look.items.map((item) => item.item_name));
  const selectedItemText = analysis.looks.flatMap((look) => look.items)
    .map((item) => [item.item_name, item.style, ...item.search_keywords].join(" "))
    .join(" ");

  assert.equal(analysis.outfit_blueprint.blueprint_source, "semantic_fallback");
  assert.ok(itemNames.some((name) => name.includes("真丝衬衫")));
  assert.ok(itemNames.some((name) => name.includes("修身西裤")));
  assert.ok(itemNames.some((name) => name.includes("尖头低跟鞋")));
  assert.doesNotMatch(selectedItemText, /跑步鞋|训练服|休闲运动/u);
  assert.doesNotMatch(
    selectedItemText,
    /简洁合身上衣|中高腰直筒下装|简洁浅口鞋/u,
  );
});

test("AI failure uses one text-only semantic fallback with concrete Blueprint items", async () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.style_semantics = {
    identity_impression: ["轻盈", "精致"],
    emotional_tone: ["浪漫"],
    visual_personality: ["柔和"],
    social_signal: ["约会氛围"],
    must_express: ["浪漫细节", "轻盈轮廓"],
    must_avoid: ["运动鞋", "工装裤"],
    style_atoms: ["蝴蝶结", "轻盈裙摆"],
    confidence: 0.92,
    interpretation_summary: "以轻盈精致的浪漫细节完成约会造型。",
  };
  payload.style_profile = {
    source_text: "像糖霜花园一样轻盈精致的约会穿搭",
    intent_priority_score: 95,
    interpretation: "轻盈浪漫并带有精致细节。",
    primary_style: "轻盈浪漫造型",
    secondary_styles: [],
    blend_rationale: "保持单一而清晰的浪漫方向。",
    dimensions: {
      maturity: 45, femininity: 92, masculinity: 8, structure: 38,
      minimalism: 35, romantic: 94, sportiness: 4, sexiness: 30,
      youthfulness: 82, luxury: 55, casualness: 28,
    },
    silhouette: "收腰并保持轻盈裙摆",
    preferred_items: ["蝴蝶结上衣", "高腰百褶裙", "圆头玛丽珍鞋"],
    preferred_colors: ["奶油白", "浅粉色"],
    preferred_materials: ["蕾丝", "轻盈雪纺"],
    must_have: ["浪漫细节", "轻盈轮廓"],
    must_avoid: ["运动鞋", "工装裤"],
    positive_keywords: ["浪漫", "轻盈"],
    negative_keywords: ["运动", "工装"],
  };
  payload.outfit_blueprint = {
    style_identity: "轻盈浪漫造型",
    core_elements: ["蝴蝶结", "轻盈裙摆"],
    must_have_items: {
      top: ["蝴蝶结上衣"],
      bottom: ["高腰百褶裙"],
      shoes: ["圆头玛丽珍鞋"],
    },
    avoid_items: ["运动鞋", "工装裤"],
  };
  let callCount = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          callCount += 1;
          return {choices: [{message: {content: JSON.stringify(payload)}}]};
        },
      },
    },
  };

  const result = await generateSemanticFallbackInterpretation({
    outfitRequest: {
      requestId: "semantic-ai-fallback",
      request: "像糖霜花园一样轻盈精致的约会穿搭",
      gender: "female",
      scene: "约会",
    },
    sourceText: "像糖霜花园一样轻盈精致的约会穿搭",
    client,
    timeoutMs: 1_000,
  });

  assert.equal(callCount, 1);
  assert.equal(result.outfit_blueprint.blueprint_source, "semantic_fallback");
  assert.deepEqual(result.outfit_blueprint.must_have_items.shoes, [
    "圆头玛丽珍鞋",
  ]);
  assert.equal(result.style_profile.source_text,
    "像糖霜花园一样轻盈精致的约会穿搭");
});

test("AI Style Interpreter preserves an unknown blended style through Look parsing", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.style = "韩系Clean Fit学长感";
  payload.style_profile = {
    source_text: "韩系Clean Fit学长感",
    interpretation: "以干净克制的轮廓融合韩系年轻学院氛围",
    primary_style: "Clean Fit",
    secondary_styles: ["韩系", "学长感"],
    blend_rationale: "Clean Fit 为主，韩系学院感为辅",
    dimensions: {
      maturity: 48,
      femininity: 18,
      masculinity: 72,
      structure: 62,
      minimalism: 86,
      romantic: 20,
      sportiness: 24,
      sexiness: 12,
      youthfulness: 76,
      luxury: 42,
      casualness: 58,
    },
    silhouette: "利落但不过度正式的直线轮廓",
    preferred_items: ["短夹克", "直筒裤"],
    preferred_colors: ["灰色", "海军蓝"],
    preferred_materials: ["精梳棉", "轻薄羊毛"],
    positive_keywords: ["干净", "克制", "学院感"],
    negative_keywords: ["繁复印花", "松垮"],
  };

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "male",
    userInput: "想要韩系Clean Fit学长感，但不要普通休闲",
  });

  assert.equal(analysis.style_profile.source_text, "韩系Clean Fit学长感");
  assert.equal(analysis.style_profile.primary_style, "Clean Fit");
  assert.deepEqual(analysis.style_profile.secondary_styles, ["韩系", "学长感"]);
  assert.equal(analysis.style_expression, "masculine");
  assert.doesNotMatch(analysis.style_profile.interpretation, /普通休闲/);
});

test("Style Semantic Repair runs once without resubmitting images", async () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.style_semantics = {
    identity_impression: ["generic"],
    emotional_tone: [],
    visual_personality: [],
    social_signal: [],
    must_express: [],
    must_avoid: [],
    style_atoms: [],
    confidence: 0.2,
    interpretation_summary: "",
  };
  payload.style_profile = {
    source_text: "invented style",
    interpretation: "generic",
    dimensions: Object.fromEntries([
      "maturity", "femininity", "masculinity", "structure", "minimalism",
      "romantic", "sportiness", "sexiness", "youthfulness", "luxury",
      "casualness",
    ].map((field) => [field, 50])),
  };
  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "male",
    scene: "date",
    requestId: "style-repair-request",
    userInput: "invented style",
  });
  const repairPatch = {
    ...payload,
    style_semantics: {
      identity_impression: ["calm curator"],
      emotional_tone: ["restrained"],
      visual_personality: ["light structure"],
      social_signal: ["independent"],
      must_express: ["clear structure"],
      must_avoid: ["ordinary casual"],
      style_atoms: ["future", "curation"],
      confidence: 0.91,
      interpretation_summary: "A restrained, lightly structured curatorial direction.",
    },
    style_profile: {
      source_text: "invented style",
      interpretation: "A restrained, lightly structured curatorial direction.",
      primary_style: "curatorial structure",
      secondary_styles: ["future lightness"],
      blend_rationale: "Structure leads while lightness softens the result.",
      dimensions: {
        maturity: 74, femininity: 32, masculinity: 66, structure: 84,
        minimalism: 78, romantic: 18, sportiness: 22, sexiness: 16,
        youthfulness: 54, luxury: 62, casualness: 28,
      },
      silhouette: "clean vertical light structure",
      preferred_items: ["cropped jacket", "straight trousers"],
      preferred_colors: ["rain gray", "cool blue"],
      preferred_materials: ["fine wool", "subtle technical fabric"],
      positive_keywords: ["light structure", "clean line"],
      negative_keywords: ["messy print", "ordinary casual"],
    },
  };
  const calls = [];
  const client = {
    chat: {completions: {create: async (...args) => {
      calls.push(args);
      return {choices: [{message: {content: JSON.stringify(repairPatch)}}]};
    }}},
  };

  const repaired = await repairStyleInterpretationAndLooks({
    analysis,
    outfitRequest: {
      requestId: "style-repair-request",
      request: "invented style",
      scene: "date",
      height: 178,
      weight: 68,
      itemBudget: "200-500",
      outfitBudget: "800-1500",
    },
    requestContext: {gender: "male", style_expression: "masculine"},
    sourceText: "invented style",
    issues: ["LOW_CONFIDENCE", "GENERIC_DIMENSIONS"],
    client,
    timeoutMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(repaired.style_semantics.confidence, 0.91);
  assert.equal(repaired.style_profile.dimensions.structure, 84);
  assert.doesNotMatch(JSON.stringify(calls[0][0].messages), /image_url|data:image/);
  assert.equal(calls[0][1].maxRetries, 0);
});

test("normalizes blank explanatory AI fields before strict outfit validation", () => {
  const analysis = parseOutfitAnalysis(
    JSON.stringify(validAiOutfitPayloadForNormalization()),
    {gender: "male", scene: "date", requestId: "normalize-request"},
  );

  assert.equal(analysis.looks[0].styling_goal, "提升整体造型与比例协调性");
  assert.equal(
    analysis.looks[1].proportion_strategy,
    "通过轮廓、腰线与长度关系优化整体比例",
  );
  assert.equal(
    analysis.looks[2].why_this_changes_the_body_proportion,
    "通过协调轮廓、腰线、衣长与鞋型改善视觉比例",
  );
  assert.equal(
    analysis.looks[0].accessories_decision[0].reason,
    "该配饰有助于提升整体造型完成度",
  );
  assert.equal(
    analysis.looks[1].accessories_decision[0].reason,
    "当前造型无需额外加入该配饰",
  );
  assert.equal(
    analysis.looks[2].accessories_decision[0].reason,
    "该配饰有助于提升整体造型完成度",
  );
  assert.equal(
    analysis.styling_strategy.waistline_strategy,
    "根据身体比例调整视觉腰线",
  );
  assert.equal(analysis.looks.length, 3);
});

test("English internal enums remain valid while user-facing AI text becomes Chinese", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.bodyProfile = "Balanced shoulders with a slightly long torso.";
  payload.style = "Clean Fit";
  payload.recommendations = {
    top: "Choose a structured shirt.",
    bottom: "Use straight trousers.",
    shoes: "Wear leather loafers.",
    accessories: "Add a watch.",
    summary: "A clean balanced outfit.",
  };
  payload.looks.forEach((look) => {
    look.style = "Clean Fit";
    look.style_direction = "smart casual";
    look.styling_goal = "Create a stronger vertical line.";
    look.proportion_strategy = "Use a raised waistline.";
    look.why_this_changes_the_body_proportion = "It lengthens the leg line.";
    look.accessories_decision[0].reason = "Adds polish.";
  });

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "male",
    requestId: "language-request",
  });
  const containsChinese = (value) => /[\u3400-\u9fff]/u.test(String(value));

  assert.equal(analysis.styling_strategy.visual_goals[0], "create_structure");
  assert.ok(containsChinese(analysis.bodyProfile));
  assert.ok(containsChinese(analysis.style));
  assert.ok(Object.values(analysis.recommendations).every(containsChinese));
  assert.ok(analysis.looks.every((look) =>
    containsChinese(look.style) &&
    containsChinese(look.style_direction) &&
    containsChinese(look.styling_goal) &&
    containsChinese(look.proportion_strategy) &&
    containsChinese(look.why_this_changes_the_body_proportion) &&
    look.accessories_decision.every((decision) => containsChinese(decision.reason))));
});

test("invalid core Look identifiers remove only that Look", () => {
  for (const mutate of [
    (payload) => delete payload.looks[0].items,
    (payload) => delete payload.looks[0].look_id,
    (payload) => { payload.looks[0].gender = "unknown-gender"; },
  ]) {
    const payload = validAiOutfitPayloadForNormalization();
    mutate(payload);
    const analysis = parseOutfitAnalysis(JSON.stringify(payload), {gender: "male"});
    assert.equal(analysis.looks.length, 2);
    assert.equal(analysis.look_validation_summary.removed_looks, 1);
    assert.equal(analysis.look_validation_summary.fallback_used, false);
  }
});

test("a Look missing shoes is repaired without discarding valid siblings", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.looks[1].items = payload.looks[1].items.filter(
    (item) => item.category !== "shoes",
  );

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {
    gender: "male",
    requestId: "repair-shoes-request",
  });

  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.looks[1].items.some((item) => item.category === "shoes"));
  assert.equal(analysis.look_validation_summary.valid_looks, 2);
  assert.equal(analysis.look_validation_summary.repaired_looks, 1);
  assert.equal(analysis.look_validation_summary.fallback_used, false);
});

test("an invalid item category is removed and the Look core is repaired", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.looks[1].items = payload.looks[1].items.map((item) => ({...item}));
  payload.looks[1].items.find((item) => item.category === "shoes").category = "food";

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {gender: "male"});

  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.looks[1].items.some((item) => item.category === "shoes"));
  assert.ok(analysis.looks[1].items.every((item) => item.category !== "food"));
  assert.equal(analysis.look_validation_summary.repaired_looks, 1);
});

test("one complete Look succeeds when the other Looks are invalid", () => {
  const payload = validAiOutfitPayloadForNormalization();
  delete payload.looks[1].items;
  delete payload.looks[2].look_id;

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {gender: "male"});

  assert.equal(analysis.looks.length, 1);
  assert.equal(analysis.look_validation_summary.valid_looks, 1);
  assert.equal(analysis.look_validation_summary.removed_looks, 2);
  assert.equal(analysis.look_validation_summary.fallback_used, false);
});

test("all invalid Looks produce one strict core fallback Look", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.looks.forEach((look) => delete look.items);

  const analysis = parseOutfitAnalysis(JSON.stringify(payload), {gender: "male"});

  assert.equal(analysis.looks.length, 1);
  assert.equal(analysis.looks[0].look_id, "fallback-look-1");
  assert.deepEqual(
    new Set(analysis.looks[0].items.map((item) => item.category)),
    new Set(["top", "bottom", "shoes"]),
  );
  assert.equal(analysis.look_validation_summary.removed_looks, 3);
  assert.equal(analysis.look_validation_summary.fallback_used, true);
});

test("top-level styling strategy structure remains strict", () => {
  const payload = validAiOutfitPayloadForNormalization();
  payload.styling_strategy.visual_goals = [];
  assert.throws(
    () => parseOutfitAnalysis(JSON.stringify(payload), {gender: "male"}),
    /visual_goals/,
  );
});

test("included jewelry, hat and bag decisions create product requirements without failing", () => {
  const coreItems = [
    {category: "top", item_name: "法式针织衫", color: "米白色", search_keywords: ["女士 米白色 法式针织衫"], negative_keywords: ["男装"]},
    {category: "bottom", item_name: "高腰阔腿裤", color: "杏色", search_keywords: ["女士 杏色 高腰阔腿裤"], negative_keywords: ["男装"]},
    {category: "shoes", item_name: "玛丽珍鞋", color: "黑色", search_keywords: ["女士 黑色 玛丽珍鞋"], negative_keywords: ["男鞋"]},
  ];
  const decisions = [
    {category: "jewelry", include: true, reason: "增加法式精致感"},
    {category: "cap", include: true, reason: "补充休闲层次"},
    {category: "bag", include: true, reason: "完成约会造型"},
  ];
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "female",
    bodyProfile: "adult female",
    style: "French date",
    style_upgrade_level: "maintain",
    recommendations: {
      top: "French knit top",
      bottom: "high-waisted trousers",
      shoes: "Mary Jane shoes",
      accessories: "jewelry, hat and bag",
      summary: "complete French date outfit",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `accessory-look-${index}`,
      gender: "female",
      scene: "date",
      style: "French",
      style_direction: `French direction ${index}`,
      accessories_decision: decisions,
      items: coreItems,
    })),
  }), {gender: "female", scene: "date"});

  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.looks.every((look) => look.items.length === 6));
  assert.ok(analysis.looks.every((look) =>
    ["jewelry", "hat", "bag"].every((category) =>
      look.items.some((item) => item.accessory_type === category))));
  const jewelry = analysis.looks[0].items.find((item) =>
    item.accessory_type === "jewelry");
  assert.equal(jewelry.category, "accessory");
  assert.equal(jewelry.item_name, "珍珠耳饰");
  assert.deepEqual(jewelry.search_keywords.slice(0, 2), [
    "女士 珍珠耳饰",
    "女士 简约金属耳饰",
  ]);

  const productRequest = productRecommendationRequest({
    gender: "female",
    scene: "date",
    style: "French",
    looks: [{
      look_id: "accessory-product-look",
      gender: "female",
      scene: "date",
      style: "French",
      accessories_decision: decisions,
      items: coreItems,
    }],
  }, "accessory-request");
  assert.equal(productRequest.items.length, 6);
  assert.ok(["jewelry", "hat", "bag"].every((category) =>
    productRequest.items.some((item) => item.accessory_type === category)));
});

test("female French dress Looks pass without separate top and bottom items", () => {
  const analysis = parseOutfitAnalysis(JSON.stringify({
    gender: "female",
    bodyProfile: "adult female",
    style: "French date",
    style_upgrade_level: "maintain",
    recommendations: {
      top: "one-piece dress",
      bottom: "the dress defines the complete silhouette",
      shoes: "Mary Jane shoes",
      accessories: "small shoulder bag",
      summary: "a complete French dress look",
    },
    looks: [1, 2, 3].map((index) => ({
      look_id: `french-dress-${index}`,
      gender: "female",
      scene: "date",
      style: "French",
      style_direction: `French dress direction ${index}`,
      items: [
        {
          category: "dress",
          item_name: "French midi dress",
          color: "cream",
          search_keywords: ["women cream French midi dress"],
          negative_keywords: ["menswear"],
        },
        {
          category: "shoes",
          item_name: "Mary Jane shoes",
          color: "black",
          search_keywords: ["women black Mary Jane shoes"],
          negative_keywords: ["mens shoes"],
        },
      ],
    })),
  }), {gender: "female", scene: "date"});

  assert.equal(analysis.looks.length, 3);
  assert.ok(analysis.looks.every((look) => look.items.length === 2));
  assert.ok(analysis.looks.every((look) =>
    look.items.some((item) => item.category === "dress") &&
    look.items.some((item) => item.category === "shoes")));
  const productRequest = productRecommendationRequest({
    gender: "female",
    scene: "date",
    style: "French",
    looks: [analysis.looks[0]],
  }, "french-dress-request");
  assert.equal(productRequest.items.length, 2);
  assert.deepEqual(productRequest.items.map((item) => item.category), [
    "dress",
    "shoes",
  ]);
});

test("female French looks remain grouped through product search requirements", () => {
  const result = productRecommendationRequest({
    gender: "female",
    style: "法式",
    scene: "约会",
    looks: [{
      look_id: "female-french-1",
      gender: "female",
      style: "法式",
      scene: "约会",
      items: [
        {
          category: "top",
          item_name: "短款针织衫",
          color: "米白色",
          fit: "短款合体",
          material: "针织",
          search_keywords: ["女士 米白色 短款针织衫"],
          negative_keywords: ["男装"],
        },
        {
          category: "bottom",
          item_name: "高腰阔腿裤",
          color: "杏色",
          search_keywords: ["女士 杏色 高腰阔腿裤"],
          negative_keywords: ["男装"],
        },
        {
          category: "shoes",
          item_name: "玛丽珍鞋",
          color: "黑色",
          search_keywords: ["女士 黑色 玛丽珍鞋"],
          negative_keywords: ["男鞋"],
        },
        {
          category: "bag",
          item_name: "法式腋下包",
          color: "棕色",
          search_keywords: ["女士 棕色 法式腋下包"],
          negative_keywords: ["男包"],
        },
      ],
    }],
  }, "request-female-french");

  assert.equal(result.looks.length, 1);
  assert.equal(result.items.length, 4);
  assert.ok(result.items.every((item) =>
    item.look_id === "female-french-1" && item.gender === "female"));
  assert.equal(result.items[0].fit, "短款合体");
  assert.equal(result.items[0].material, "针织");
});

test("female feminine expression rejects three masculine trouser and loafer Looks", () => {
  const looks = [1, 2, 3].map((index) => ({
    look_id: `look-${index}`,
    items: [
      {category: "top", item_name: "宽松衬衫"},
      {category: "bottom", item_name: "男款直筒西裤"},
      {category: "shoes", item_name: "乐福鞋"},
    ],
  }));
  assert.throws(
    () => assertStyleExpressionConsistency(looks, {
      gender: "female",
      styleExpression: "feminine",
    }),
    /cannot all use masculine/,
  );
  looks[0].items = [
    {category: "dress", item_name: "收腰连衣裙"},
    {category: "shoes", item_name: "低跟尖头鞋"},
  ];
  assert.doesNotThrow(() => assertStyleExpressionConsistency(looks, {
    gender: "female",
    styleExpression: "feminine",
  }));
});

test("product search rejects an opposite-gender Look before Taobao is called", () => {
  assert.throws(() => productRecommendationRequest({
    gender: "male",
    looks: [{
      look_id: "wrong-gender-look",
      gender: "female",
      scene: "date",
      style: "法式",
      items: [
        {category: "top", item_name: "针织衫", search_keywords: ["女士 针织衫"], negative_keywords: []},
        {category: "bottom", item_name: "半身裙", search_keywords: ["女士 半身裙"], negative_keywords: []},
        {category: "shoes", item_name: "玛丽珍鞋", search_keywords: ["女士 玛丽珍鞋"], negative_keywords: []},
      ],
    }],
  }, "request-male"), /conflicts with request gender/);
});

test("accepts structured product requirements with normalized gender", () => {
  const result = productRecommendationRequest({
    gender: "女士",
    style: "法式",
    scene: "约会",
    items: [
      {
        category: "dress",
        gender: "female",
        item_name: "法式连衣裙",
        color: "白色",
        search_keywords: ["女士 白色 法式连衣裙", "女士 夏季 连衣裙"],
        negative_keywords: ["男装"],
      },
    ],
  }, "request-products-structured");

  assert.equal(result.filters.gender, "女士");
  assert.equal(result.items[0].gender, "female");
  assert.equal(result.items[0].category, "dress");
  assert.deepEqual(result.items[0].search_keywords, [
    "女士 白色 法式连衣裙",
    "女士 夏季 连衣裙",
  ]);
});

test("extracts text from DashScope compatible content parts", () => {
  const text = extractAiText({
    choices: [
      {
        message: {
          content: [{type: "text", text: '{"bodyProfile":"ok"}'}],
        },
      },
    ],
  });

  assert.equal(text, '{"bodyProfile":"ok"}');
});

test("normalizes fenced snake-case AI output", () => {
  const result = parseOutfitAnalysis(`\`\`\`json
${JSON.stringify({
    body_profile: "balanced",
    style: "minimal",
    recommendations: {
      top_recommendation: "structured top",
      bottom_recommendation: "straight trousers",
      shoe_recommendation: "low shoes",
      accessory_recommendation: "watch",
      suggestion: "keep proportions clean",
    },
    products: [
      {
        category: "top",
        style: "minimal",
        keyword: "short jacket",
      },
    ],
  })}
\`\`\``);

  assert.equal(result.bodyProfile, "已结合照片与身体数据完成比例分析");
  assert.equal(result.recommendations.summary, "本方案围绕身体比例、场景和风格进行整体搭配");
});

test("repairs a model response missing only trailing JSON braces", () => {
  const complete = JSON.stringify({
    bodyProfile: "balanced",
    style: "minimal",
    recommendations: {
      top: "top",
      bottom: "bottom",
      shoes: "shoes",
      accessories: "accessories",
      summary: "summary",
    },
    products: [
      {
        category: "top",
        style: "minimal",
        keyword: "jacket",
      },
    ],
  });
  const missingRootBrace = complete.slice(0, -1) + "   \n";

  const result = parseOutfitAnalysis(missingRootBrace);

  assert.equal(result.bodyProfile, "已结合照片与身体数据完成比例分析");
  assert.equal(result.products.length, 1);
});

test("rejects incomplete AI output", () => {
  assert.throws(
    () => parseOutfitAnalysis(JSON.stringify({style: "极简"})),
    /bodyProfile/,
  );
});

test("uses OPENAI_API_KEY with DashScope defaults", () => {
  const result = resolveAiConfig({
    OPENAI_API_KEY: "openai-test-key",
  });

  assert.equal(result.provider, "dashscope");
  assert.equal(
    result.baseURL,
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(result.model, "qwen3.7-plus");
  assert.equal(result.apiKey, "openai-test-key");
});

test("selects DashScope defaults for a DashScope API key", () => {
  const result = resolveAiConfig({
    DASHSCOPE_API_KEY: "dashscope-test-key",
  });

  assert.equal(result.provider, "dashscope");
  assert.equal(
    result.baseURL,
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(result.model, "qwen3.7-plus");
  assert.equal(result.apiKey, "dashscope-test-key");
});

test("uses qwen3.7-plus by default and keeps legacy rollback explicit", () => {
  assert.equal(DEFAULT_AI_MODEL, "qwen3.7-plus");
  assert.equal(DEFAULT_AI_TIMEOUT_MS, 60_000);
  assert.equal(resolveAiTimeoutMs("45000"), 45_000);
  assert.equal(resolveAiTimeoutMs("60000"), 60_000);
  assert.equal(resolveAiTimeoutMs("120000"), 60_000);
  assert.equal(DEFAULT_BLUEPRINT_TIMEOUT_MS, 120_000);
  assert.equal(resolveBlueprintTimeoutMs("90000"), 90_000);
  assert.equal(resolveBlueprintTimeoutMs("180000"), 120_000);
  assert.equal(DEFAULT_LOOK_TIMEOUT_MS, 60_000);
  assert.equal(resolveLookTimeoutMs("45000"), 45_000);
  assert.equal(resolveLookTimeoutMs("120000"), 60_000);
  assert.equal(LEGACY_AI_MODEL, "qwen-vl-plus");
  assert.equal(resolveAiConfig({
    DASHSCOPE_API_KEY: "dashscope-test-key",
    AI_MODEL: LEGACY_AI_MODEL,
  }).model, "qwen-vl-plus");
});

test("disables thinking for stable structured JSON output", () => {
  assert.deepEqual(structuredJsonRequestOptions(), {
    response_format: {type: "json_object"},
    enable_thinking: false,
  });
});

function phasedBlueprintFixture() {
  return {
    gender: "female",
    bodyProfile: "肩腰比例协调，适合通过高腰线强化腿部视觉长度",
    style: "甜美穿搭",
    style_expression: "feminine",
    style_semantics: {
      identity_impression: ["甜美", "精致"],
      emotional_tone: ["浪漫"],
      visual_personality: ["轻盈"],
      social_signal: ["约会感"],
      must_express: ["蝴蝶结", "蕾丝", "少女感"],
      must_avoid: ["跑步鞋", "工装裤", "训练外套"],
      style_atoms: ["圆润线条", "精致细节"],
      confidence: 0.94,
      interpretation_summary: "以女性化细节和轻盈轮廓完成甜美约会造型",
    },
    style_profile: {
      source_text: "甜妹穿搭",
      intent_priority_score: 92,
      interpretation: "甜美、精致且具有少女感",
      primary_style: "甜美穿搭",
      secondary_styles: ["浪漫"],
      blend_rationale: "用轻盈轮廓承载精致细节",
      dimensions: {
        maturity: 42,
        femininity: 92,
        masculinity: 8,
        structure: 38,
        minimalism: 32,
        romantic: 90,
        sportiness: 6,
        sexiness: 30,
        youthfulness: 84,
        luxury: 52,
        casualness: 36,
      },
      silhouette: "高腰A字与收腰轮廓",
      preferred_items: ["蕾丝上衣", "高腰百褶裙", "玛丽珍鞋"],
      preferred_colors: ["奶油白", "樱花粉"],
      preferred_materials: ["蕾丝", "细针织"],
      must_have: ["蝴蝶结", "蕾丝", "玛丽珍鞋"],
      must_avoid: ["跑步鞋", "工装裤", "训练外套"],
      positive_keywords: ["甜美", "女性化", "精致"],
      negative_keywords: ["运动风", "机能风", "男款"],
    },
    outfit_blueprint: {
      blueprint_source: "ai_generated",
      style_identity: "甜美穿搭",
      character_impression: "精致而轻盈的约会少女感",
      visual_keywords: ["蝴蝶结", "蕾丝", "高腰线"],
      core_elements: ["女性化领口", "A字轮廓", "圆头鞋型"],
      silhouette_strategy: ["短上衣配高腰下装"],
      color_palette: ["奶油白", "樱花粉"],
      material_direction: ["蕾丝", "细针织"],
      must_have_items: {
        top: ["蕾丝上衣"],
        bottom: ["高腰百褶裙"],
        shoes: ["玛丽珍鞋"],
      },
      avoid_items: ["跑步鞋", "工装裤", "训练外套"],
      occasion_strategy: "保持约会场景所需的精致与舒适",
    },
    styling_strategy: {
      body_strengths: ["肩腰比例协调"],
      proportion_issues: ["需要强调腰线"],
      visual_goals: ["raise_visual_waistline"],
      waistline_strategy: "使用高腰线",
      top_length_strategy: "上衣控制在腰线附近",
      bottom_strategy: "选择高腰A字轮廓",
      shoe_strategy: "圆头低跟鞋延续女性化线条",
      color_strategy: "奶油白与柔粉形成轻盈层次",
      silhouette_strategy: "短上衣配高腰下装",
      skin_exposure_strategy: "保持克制露肤",
      accessory_strategy: "少量精致配饰",
      weather_strategy: "按天气调整面料厚度",
    },
  };
}

test("parses the AI Blueprint independently before Look generation", () => {
  const result = parseBlueprintPhase(JSON.stringify(phasedBlueprintFixture()), {
    gender: "female",
    scene: "约会",
    userInput: "甜妹穿搭",
  });

  assert.equal(result.gender, "female");
  assert.equal(result.outfit_blueprint.blueprint_source, "ai_generated");
  assert.deepEqual(
    result.outfit_blueprint.must_have_items.shoes,
    ["玛丽珍鞋"],
  );
});

test("recovers AI Blueprint core categories from its own flat item evidence", () => {
  const fixture = phasedBlueprintFixture();
  fixture.outfit_blueprint.must_have_items = [
    "蕾丝蝴蝶结上衣",
    "高腰百褶裙",
    "圆头低跟玛丽珍鞋",
  ];
  const result = parseBlueprintPhase(JSON.stringify(fixture), {
    gender: "female",
    scene: "日常约会",
    requestId: "phase-flat-blueprint",
    userInput: "甜美穿搭",
  });

  assert.equal(blueprintHasCoreItems(result.outfit_blueprint), true);
  assert.ok(result.outfit_blueprint.must_have_items.top.includes(
    "蕾丝蝴蝶结上衣",
  ));
  assert.ok(result.outfit_blueprint.must_have_items.bottom.includes(
    "高腰百褶裙",
  ));
  assert.ok(result.outfit_blueprint.must_have_items.shoes.includes(
    "圆头低跟玛丽珍鞋",
  ));
  assert.equal(result.outfit_blueprint.blueprint_source, "ai_generated");
});

test("keeps a valid AI Blueprint when StyleProfile needs text-only repair", () => {
  const payload = phasedBlueprintFixture();
  payload.style_semantics.confidence = 0.4;
  payload.style_profile.dimensions = Object.fromEntries(
    Object.keys(payload.style_profile.dimensions).map((key) => [key, 50]),
  );

  const result = parseBlueprintPhase(JSON.stringify(payload), {
    gender: "female",
    scene: "约会",
    requestId: "phase-style-repair",
    userInput: "甜妹穿搭",
  });

  assert.equal(result.style_validation_pending, true);
  assert.equal(result.outfit_blueprint.blueprint_source, "ai_generated");
  assert.deepEqual(result.outfit_blueprint.must_have_items.shoes, ["玛丽珍鞋"]);
});

test("merges a text-only Look phase into the immutable AI Blueprint", () => {
  const blueprint = parseBlueprintPhase(JSON.stringify(phasedBlueprintFixture()), {
    gender: "female",
    scene: "约会",
    userInput: "甜妹穿搭",
  });
  const item = (category, itemName, color) => ({
    category,
    gender: "female",
    item_name: itemName,
    color,
    fit: "合身",
    material: category === "shoes" ? "真皮" : "细腻面料",
    style: "甜美穿搭",
    season: "all",
    scene: "约会",
    search_keywords: [`女士 ${color} ${itemName}`, `女士 甜美 ${itemName}`],
    negative_keywords: ["男款", "运动风", "工装"],
  });
  const result = mergeBlueprintAndLookPhase(blueprint, JSON.stringify({
    style_upgrade_level: "upgrade",
    recommendations: {
      top: "选择带蕾丝与蝴蝶结细节的女性化上衣",
      bottom: "用高腰百褶裙建立轻盈A字轮廓",
      shoes: "圆头玛丽珍鞋延续甜美精致感",
      accessories: "使用小体量珍珠配饰点亮造型",
      summary: "整套造型以高腰线、蕾丝和圆润鞋型回应甜美诉求",
    },
    looks: [{
      request_id: "phase-look-test",
      look_id: "look-1",
      gender: "female",
      style: "甜美穿搭",
      style_direction: "蕾丝高腰约会造型",
      styling_goal: "强化轻盈甜美气质",
      proportion_strategy: "短上衣配高腰A字裙",
      why_this_changes_the_body_proportion: "提高视觉腰线并延长腿部线条",
      scene: "约会",
      accessories_decision: [],
      items: [
        item("top", "蕾丝上衣", "奶油白"),
        item("bottom", "高腰百褶裙", "樱花粉"),
        item("shoes", "玛丽珍鞋", "奶油白"),
      ],
    }],
  }), {
    gender: "female",
    scene: "约会",
    requestId: "phase-look-test",
    userInput: "甜妹穿搭",
  });

  assert.equal(result.looks.length, 1);
  assert.equal(result.outfit_blueprint.style_identity, "甜美穿搭");
  assert.deepEqual(
    result.products.map((product) => product.item_name),
    ["蕾丝上衣", "高腰百褶裙", "玛丽珍鞋"],
  );
});

test("preserves a successful Blueprint when the Look phase times out", async () => {
  let callCount = 0;
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (request) => {
          callCount += 1;
          requests.push(request);
          if (callCount === 1) {
            return {choices: [{message: {content: JSON.stringify(
              phasedBlueprintFixture(),
            )}}]};
          }
          const timeout = new Error("Request timed out.");
          timeout.code = "ETIMEDOUT";
          throw timeout;
        },
      },
    },
  };
  const result = await generatePhasedOutfitAnalysis({
    outfitRequest: {
      requestId: "phase-test-1",
      request: "甜妹穿搭",
      gender: "female",
      scene: "约会",
      itemBudget: "200-500",
      outfitBudget: "800-1500",
    },
    requestContext: {gender: "female", style_expression: "feminine"},
    userContent: [{type: "text", text: "甜妹穿搭"}],
    sourceText: "甜妹穿搭",
    client,
    blueprintTimeoutMs: 1_000,
    lookTimeoutMs: 1_000,
  });

  assert.equal(callCount, 2);
  assert.equal(result.analysis.analysisMode, "blueprint_partial");
  assert.equal(shouldRepairStyleInterpretation(result.analysis), false);
  assert.equal(result.analysis.outfit_blueprint.blueprint_source, "ai_generated");
  assert.equal(result.analysis.look_validation_summary.blueprint_preserved, true);
  assert.equal(result.analysis.look_validation_summary.fallback_used, false);
  assert.match(requests[0].messages[0].content, /Phase 1 only/);
  assert.match(requests[0].messages[0].content, /Do not generate Looks/);
  assert.doesNotMatch(
    requests[0].messages[0].content,
    /styling_strategy must contain/,
  );
  assert.match(requests[1].messages[0].content, /Phase 2 only/);
  assert.match(
    requests[1].messages[0].content,
    /styling_strategy must contain/,
  );
  const lookInput = JSON.parse(requests[1].messages[1].content);
  assert.equal(lookInput.outfit_blueprint.blueprint_source, "ai_generated");
  assert.equal(Object.hasOwn(lookInput, "styling_strategy"), false);
});

test("respects explicit compatible API configuration", () => {
  const result = resolveAiConfig({
    OPENAI_API_KEY: "custom-test-key",
    AI_BASE_URL: "https://example.com/v1",
    AI_MODEL: "custom-vision-model",
  });

  assert.equal(result.provider, "custom");
  assert.equal(result.baseURL, "https://example.com/v1");
  assert.equal(result.model, "custom-vision-model");
});

test("falls back to Mock only when forced or no AI client exists", () => {
  assert.equal(shouldUseMockAi({forceMockAi: false}, null), true);
  assert.equal(shouldUseMockAi({forceMockAi: true}, {}), true);
  assert.equal(shouldUseMockAi({forceMockAi: false}, {}), false);
});

test("parses AI_FORCE_MOCK values without whitespace or casing issues", () => {
  assert.equal(readBoolean(" TRUE "), true);
  assert.equal(readBoolean("false", true), false);
  assert.equal(readBoolean("0", true), false);
  assert.equal(readBoolean(undefined), false);
});

test("creates an OpenAI-compatible vision client only when a key exists", () => {
  class FakeOpenAIClient {
    constructor(options) {
      this.options = options;
    }
  }

  assert.equal(
    createAiClient({apiKey: "", baseURL: "", aiTimeoutMs: 1000}, FakeOpenAIClient),
    null,
  );
  const client = createAiClient(
    {
      apiKey: "test-key",
      baseURL: "https://example.com/v1",
      aiTimeoutMs: 1234,
      aiConnectTimeoutMs: 5678,
      aiMaxRetries: 0,
    },
    FakeOpenAIClient,
    {
      dispatcher: {name: "test-dispatcher"},
      fetchImplementation: async () => {},
    },
  );
  assert.deepEqual(client.options, {
    apiKey: "test-key",
    baseURL: "https://example.com/v1",
    timeout: 1234,
    maxRetries: 0,
    fetch: client.options.fetch,
    fetchOptions: {
      dispatcher: {name: "test-dispatcher"},
    },
  });
  assert.equal(typeof client.options.fetch, "function");
});

test("uses a proxy dispatcher when AI_PROXY_URL is configured", () => {
  class FakeAgent {
    constructor(options) {
      this.options = options;
      this.type = "direct";
    }
  }
  class FakeProxyAgent {
    constructor(url) {
      this.url = url;
      this.type = "proxy";
    }
  }

  const direct = createAiDispatcher(
    {useProxy: false, aiProxyUrl: "", aiConnectTimeoutMs: 30_000},
    {AgentClass: FakeAgent, ProxyAgentClass: FakeProxyAgent},
  );
  assert.equal(direct.type, "direct");
  assert.equal(direct.options.connect.timeout, 30_000);

  const proxy = createAiDispatcher(
    {
      useProxy: true,
      aiProxyUrl: "http://user:secret@127.0.0.1:7890",
      aiConnectTimeoutMs: 30_000,
    },
    {AgentClass: FakeAgent, ProxyAgentClass: FakeProxyAgent},
  );
  assert.equal(proxy.type, "proxy");
  assert.equal(proxy.url, "http://user:secret@127.0.0.1:7890");
});

test("disables and clears inherited proxies unless USE_PROXY is true", () => {
  const environment = {
    USE_PROXY: "false",
    AI_PROXY_URL: "http://127.0.0.1:7890",
    HTTP_PROXY: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    ALL_PROXY: "http://127.0.0.1:7890",
    http_proxy: "http://127.0.0.1:7890",
    https_proxy: "http://127.0.0.1:7890",
    all_proxy: "http://127.0.0.1:7890",
  };

  const result = configureProxyEnvironment(environment);

  assert.deepEqual(result, {useProxy: false, proxyUrl: null});
  assert.equal(environment.AI_PROXY_URL, undefined);
  assert.equal(environment.HTTP_PROXY, undefined);
  assert.equal(environment.HTTPS_PROXY, undefined);
  assert.equal(environment.ALL_PROXY, undefined);
});

test("reports live readiness and classifies provider fallback reasons", () => {
  assert.equal(
    resolveAiModeReason({forceMockAi: false}, {}),
    "vision_model_ready",
  );
  assert.equal(resolveAiFallbackReason({message: "Request timed out."}), "AI_TIMEOUT");
  assert.equal(resolveAiFallbackReason({message: "Request was aborted."}), "AI_TIMEOUT");
  assert.equal(resolveAiFallbackReason({status: 401}), "AI_AUTH_FAILED");
  assert.equal(resolveAiFallbackReason({status: 429}), "AI_RATE_LIMITED");
});

test("reports sanitized AI request diagnostics without secrets or images", () => {
  const cause = new Error("Connect Timeout Error");
  cause.code = "UND_ERR_CONNECT_TIMEOUT";
  const error = new Error("Request timed out.", {cause});
  const details = createAiErrorDetails(
    error,
    {
      aiProvider: "openai",
      model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1/",
      aiTimeoutMs: 90_000,
      aiConnectTimeoutMs: 30_000,
      aiMaxRetries: 0,
      aiProxyUrl: "http://user:secret@127.0.0.1:7890",
    },
    10_500,
  );

  assert.equal(
    buildAiRequestUrl("https://api.openai.com/v1/"),
    "https://api.openai.com/v1/chat/completions",
  );
  assert.equal(details.cause_code, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(details.timeout_ms, 90_000);
  assert.equal(details.connect_timeout_ms, 30_000);
  assert.equal(details.proxy_url, "http://127.0.0.1:7890");
  assert.equal(details.request_url, "https://api.openai.com/v1/chat/completions");
  assert.equal(JSON.stringify(details).includes("base64"), false);
  assert.equal(JSON.stringify(details).includes("test-key"), false);
  assert.equal(
    sanitizeAiErrorMessage(
      "401 Incorrect API key provided: sk-example-secret-value.",
    ),
    "401 Incorrect API key provided: [REDACTED_API_KEY]",
  );
});

test("diagnostic fetch logs the underlying transport timeout safely", async () => {
  const logged = [];
  const cause = new Error("Connect Timeout Error");
  cause.code = "UND_ERR_CONNECT_TIMEOUT";
  const transportError = new TypeError("fetch failed", {cause});
  const diagnosticFetch = createDiagnosticFetch(
    {
      baseURL: "https://api.openai.com/v1",
      aiTimeoutMs: 90_000,
      aiConnectTimeoutMs: 30_000,
      aiProxyUrl: "",
    },
    async () => {
      throw transportError;
    },
    {
      warn: () => {},
      error: (message, details) => logged.push({message, details}),
    },
  );

  await assert.rejects(
    diagnosticFetch("https://api.openai.com/v1/chat/completions", {}),
    /fetch failed/,
  );
  assert.equal(logged[0].message, "AI HTTP 连接失败");
  assert.equal(logged[0].details.causeCode, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(logged[0].details.timeoutMs, 90_000);
  assert.equal(
    logged[0].details.requestUrl,
    "https://api.openai.com/v1/chat/completions",
  );
});

test("creates a clearly marked local mock analysis", () => {
  const result = createMockOutfitAnalysis({
    height: 175,
    weight: 68,
    scene: "商务会议",
    request: "",
    images: {front: imageDataUrl},
  });

  assert.match(result.bodyProfile, /未对照片进行真实视觉识别/);
  assert.match(result.style, /商务/);
  assert.equal(typeof result.recommendations.top, "string");
  assert.equal(typeof result.recommendations.summary, "string");
  assert.equal(result.products.length, 3);
  assert.equal(result.analysisMode, "mock");
});

test("/outfit returns a structured validation error", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/outfit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_REQUEST");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("/health returns status and security headers", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(typeof body.ai_provider, "string");
    assert.equal(typeof body.ai_model, "string");
    assert.equal(
      response.headers.get("x-content-type-options"),
      "nosniff",
    );
    assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("supports register, profile update, session restore, and logout", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const email = `fitai-${Date.now()}@example.com`;
    const registerResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        email,
        password: "FitAI-test-2026",
        nickname: "测试用户",
      }),
    });
    const registered = await registerResponse.json();

    assert.equal(registerResponse.status, 201);
    assert.equal(registered.account.email, email);
    assert.equal(registered.account.nickname, "测试用户");
    assert.equal(registered.session.isMock, false);
    assert.equal(registered.account.passwordHash, undefined);

    const authorization = `Bearer ${registered.session.token}`;
    const updateResponse = await fetch(`${baseUrl}/auth/profile`, {
      method: "PATCH",
      headers: {
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        nickname: "FitAI 用户",
        gender: "女性",
        height: 168,
        weight: 52,
        bodyType: "偏瘦体型",
        stylePreference: ["极简", "通勤"],
        budgetPreference: {min: 200, max: 1800},
        favoriteBrands: ["COS", "ZARA"],
      }),
    });
    const updated = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(updated.account.gender, "女性");
    assert.equal(updated.account.height, 168);
    assert.deepEqual(updated.account.budgetPreference, {
      min: 200,
      max: 1800,
    });

    const meResponse = await fetch(`${baseUrl}/auth/me`, {
      headers: {authorization},
    });
    const me = await meResponse.json();
    assert.equal(meResponse.status, 200);
    assert.equal(me.account.nickname, "FitAI 用户");

    const wardrobe = {
      favoriteProducts: [{id: "product-1", name: "测试衬衫"}],
      outfitPlans: [{id: "plan-1", title: "通勤方案"}],
      tryOnHistory: [{id: "try-on-1", imageUrl: "assets/mock.png"}],
      aiRecommendationHistory: [],
    };
    const wardrobeUpdateResponse = await fetch(`${baseUrl}/user/wardrobe`, {
      method: "PUT",
      headers: {authorization, "content-type": "application/json"},
      body: JSON.stringify(wardrobe),
    });
    assert.equal(wardrobeUpdateResponse.status, 200);

    const wardrobeResponse = await fetch(`${baseUrl}/user/wardrobe`, {
      headers: {authorization},
    });
    const wardrobeBody = await wardrobeResponse.json();
    assert.equal(wardrobeResponse.status, 200);
    assert.equal(wardrobeBody.wardrobe.favoriteProducts[0].id, "product-1");
    assert.equal(wardrobeBody.wardrobe.tryOnHistory[0].id, "try-on-1");

    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: {authorization},
    });
    assert.equal(logoutResponse.status, 204);

    const expiredResponse = await fetch(`${baseUrl}/auth/me`, {
      headers: {authorization},
    });
    assert.equal(expiredResponse.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("rejects duplicate registration and invalid credentials", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const email = `duplicate-${Date.now()}@example.com`;
    const payload = {
      email,
      password: "FitAI-test-2026",
      nickname: "测试用户",
    };

    const first = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 201);

    const duplicate = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(payload),
    });
    assert.equal(duplicate.status, 409);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({...payload, password: "wrong-password"}),
    });
    assert.equal(login.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("deletes an account and invalidates its session", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const registerResponse = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        email: `delete-${Date.now()}@example.com`,
        password: "Shupi-test-2026",
        nickname: "Deletion test",
      }),
    });
    const registered = await registerResponse.json();
    const authorization = `Bearer ${registered.session.token}`;

    const deletionResponse = await fetch(`${baseUrl}/auth/account`, {
      method: "DELETE",
      headers: {authorization},
    });
    assert.equal(deletionResponse.status, 200);
    assert.equal((await deletionResponse.json()).deleted, true);

    const meResponse = await fetch(`${baseUrl}/auth/me`, {
      headers: {authorization},
    });
    assert.equal(meResponse.status, 401);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("aggregates daily V1.3 user and commerce metrics", () => {
  const store = new AnalyticsStore();
  const userId = "validation-user";
  const record = (name, properties = {}) => {
    store.record({
      id: `${name}-${Date.now()}`,
      name,
      userId,
      properties,
    });
  };
  record("new_user_onboarding_completed", {scene: "工作"});
  record("photo_upload_completed", {imageCount: "3"});
  record("outfit_generated", {scene: "工作"});
  record("product_impression", {productId: "product-1"});
  record("product_click", {productId: "product-1"});
  record("product_detail_view", {productId: "product-1"});
  record("purchase_intent", {productId: "product-1"});
  record("product_favorite", {productId: "product-1"});
  record("product_purchase_redirect", {
    productId: "product-1",
    productPrice: "500",
    commissionRate: "0.1",
  });
  record("product_purchase_completed", {
    productId: "product-1",
    productPrice: "500",
    commissionRate: "0.1",
  });
  record("try_on_result_saved", {outfitPlanId: "plan-1"});
  record("try_on_result_shared", {outfitPlanId: "plan-1"});
  record("outfit_plan_favorited", {outfitPlanId: "plan-1"});
  record("recommendation_feedback_submitted", {
    satisfaction: "4",
    willingToBuy: "false",
    noPurchaseReason: "价格太高",
  });

  const dashboard = store.getDashboard();
  assert.equal(dashboard.newUsers, 1);
  assert.equal(dashboard.photoUploadUsers, 1);
  assert.equal(dashboard.outfitGenerationCount, 1);
  assert.equal(dashboard.clickThroughRate, 1);
  assert.equal(dashboard.favoriteRate, 1);
  assert.equal(dashboard.purchaseRedirectRate, 1);
  assert.equal(dashboard.productDetailViews, 1);
  assert.equal(dashboard.purchaseIntents, 1);
  assert.equal(dashboard.detailToPurchaseIntentRate, 1);
  assert.equal(dashboard.potentialCommission, 50);
  assert.equal(dashboard.confirmedCommission, 50);
  assert.equal(dashboard.savedTryOnResults, 1);
  assert.equal(dashboard.sharedTryOnResults, 1);
  assert.equal(dashboard.favoritedOutfitPlans, 1);
  assert.equal(dashboard.averageSatisfaction, 4);
  assert.equal(dashboard.noPurchaseReasons["价格太高"], 1);
});

test("/analytics/events accepts allow-listed, anonymized events", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/analytics/events`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          id: `analytics-test-${Date.now()}`,
          name: "outfit_generated",
          userId: "installation-test",
          properties: {scene: "旅行"},
        }),
      },
    );
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("/affiliate/conversions records an idempotent confirmed order", async () => {
  const server = app.listen(0);

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}/affiliate/conversions`;
    const orderId = `ORDER-${Date.now()}`;
    const payload = {
      orderId,
      productId: "product-commercial-1",
      sku: "FITAI-COMMERCIAL-1",
      brand: "FitAI Partner",
      channelId: "partner-test",
      productPrice: 500,
      commissionRate: 0.1,
      attributionId: "click-test-1",
    };
    const before = analyticsStore.getDashboard().totalPurchaseCompleted;
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-affiliate-secret": "fitai-test-affiliate-secret",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      assert.equal(response.status, 202);
      assert.equal(body.accepted, true);
    }
    const dashboard = analyticsStore.getDashboard();
    assert.equal(dashboard.totalPurchaseCompleted, before + 1);
    assert.equal(dashboard.confirmedCommission, 50);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("supports development phone verification login without logging the code", async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const phone = `138${Date.now().toString().slice(-8)}`;
    const codeResponse = await fetch(`${baseUrl}/auth/phone/code`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({phone}),
    });
    const challenge = await codeResponse.json();
    assert.equal(codeResponse.status, 202);
    assert.match(challenge.debugCode, /^\d{6}$/);

    const loginResponse = await fetch(`${baseUrl}/auth/phone/login`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({phone, code: challenge.debugCode}),
    });
    const result = await loginResponse.json();
    assert.equal(loginResponse.status, 200);
    assert.equal(result.account.phone, phone);
    assert.equal(result.account.passwordHash, undefined);
    assert.ok(result.session.token.length >= 20);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
