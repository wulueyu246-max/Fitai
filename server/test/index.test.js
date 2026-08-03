const assert = require("node:assert/strict");
const test = require("node:test");

process.env.AFFILIATE_POSTBACK_SECRET = "fitai-test-affiliate-secret";
process.env.PRODUCT_PROVIDER = "mock";

const {
  app,
  analyticsStore,
  buildAiRequestUrl,
  createAiClient,
  createAiDispatcher,
  createDiagnosticFetch,
  createAiErrorDetails,
  createMockOutfitAnalysis,
  buildOutfitApiResponse,
  configureProxyEnvironment,
  extractAiText,
  parseOutfitAnalysis,
  readBoolean,
  listenForRequests,
  logOptionalServiceWarnings,
  partialViewSafetyInstruction,
  resolveAiFallbackReason,
  resolveAiModeReason,
  resolveAiConfig,
  sanitizeAiErrorMessage,
  shouldUseMockAi,
  isAllowedOrigin,
  isLocalDevelopmentOrigin,
  validateProductionConfig,
  validateOutfitRequest,
} = require("../index");
const {AnalyticsStore} = require("../analytics_store");

const imageDataUrl = "data:image/jpeg;base64,AA==";

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
    AI_MODEL: "qwen-vl-plus",
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

  assert.deepEqual(result, {
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
  });
});

test("adds catalog product recommendations without changing legacy products", async () => {
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

  assert.deepEqual(response.products, analysis.products);
  assert.deepEqual(response.recommendations.products, matchedProducts);
  assert.equal(response.recommendations.top, "shirt");
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

  assert.equal(result.bodyProfile, "balanced");
  assert.equal(result.recommendations.summary, "keep proportions clean");
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

  assert.equal(result.bodyProfile, "balanced");
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
  assert.equal(result.model, "qwen-vl-plus");
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
  assert.equal(result.model, "qwen-vl-plus");
  assert.equal(result.apiKey, "dashscope-test-key");
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
