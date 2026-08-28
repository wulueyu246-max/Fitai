const crypto = require("crypto");

const {
  ProductProviderError,
  createProductProvider,
} = require("./product_provider");
const {
  buildRawAvailabilityMatrix,
  createSanitizedRawFixture,
} = require("./taobao_candidate_enrichment");

const TAOBAO_RAW_PROBE_PATH = "/internal/probes/taobao-raw-v1";
const TAOBAO_RAW_PROBE_QUERIES = Object.freeze(["女装上衣", "男装裤子", "女鞋"]);
const TAOBAO_RAW_PROBE_PAGE_SIZE = 10;
const TAOBAO_RAW_PROBE_MAX_PRODUCTS = 30;
const INTERNAL_PROBE_TOKEN_MIN_LENGTH = 32;

function createTaobaoRawProbeHandler({
  environment = process.env,
  providerFactory = createProductProvider,
  logger = console,
  now = () => new Date(),
} = {}) {
  return async function taobaoRawProbeHandler(req, res) {
    const currentEnvironment = typeof environment === "function"
      ? environment()
      : environment;
    const availability = probeAvailability(currentEnvironment);
    if (!availability.enabled) return res.status(404).json({error: "NOT_FOUND"});
    if (!authorized(req, currentEnvironment.INTERNAL_PROBE_TOKEN)) {
      return res.status(403).json({error: "FORBIDDEN"});
    }

    try {
      const result = await executeTaobaoRawProbe({
        environment: currentEnvironment,
        providerFactory,
        logger: createSafeProbeLogger(logger),
        now,
      });
      return res.status(result.probe_status === "SUCCESS" ? 200 : 502).json(result);
    } catch (error) {
      logger.error?.("taobao_raw_probe_failed", {
        code: safeErrorCode(error),
      });
      return res.status(error instanceof ProductProviderError ? error.status : 502).json({
        probe_status: "FAILED",
        error_code: safeErrorCode(error),
      });
    }
  };
}

async function executeTaobaoRawProbe({
  environment,
  providerFactory = createProductProvider,
  logger = console,
  now = () => new Date(),
} = {}) {
  const capturedAt = now().toISOString();
  const captured = new Map();
  const provider = providerFactory({
    environment: {...environment, PRODUCT_PROVIDER: "taobao"},
    logger,
    rawCapture: ({query, products, responseSummary}) => {
      const allowedQuery = TAOBAO_RAW_PROBE_QUERIES.find((value) => value === query);
      if (!allowedQuery || captured.has(allowedQuery)) return;
      captured.set(allowedQuery, {
        products: (Array.isArray(products) ? products : []).slice(
          0,
          TAOBAO_RAW_PROBE_PAGE_SIZE,
        ),
        request_id: safeText(responseSummary?.requestId),
      });
    },
  });
  if (provider?.name !== "taobao" || provider?.configured !== true) {
    throw new ProductProviderError("Real Taobao provider is unavailable", {
      status: 503,
      code: "TAOBAO_PROVIDER_UNAVAILABLE",
    });
  }

  const querySummary = [];
  for (const query of TAOBAO_RAW_PROBE_QUERIES) {
    try {
      await provider.recommend({keyword: query, limit: TAOBAO_RAW_PROBE_PAGE_SIZE});
      const capture = captured.get(query) || {products: [], request_id: null};
      querySummary.push({
        query,
        api_success: true,
        error_code: null,
        sub_code: null,
        msg: null,
        request_id: capture.request_id,
        result_count: capture.products.length,
      });
    } catch (error) {
      const summary = safeProviderErrorSummary(error, query);
      querySummary.push(summary);
      if (isPlacementFailure(summary)) break;
    }
  }

  const rawProducts = TAOBAO_RAW_PROBE_QUERIES.flatMap(
    (query) => captured.get(query)?.products || [],
  ).slice(0, TAOBAO_RAW_PROBE_MAX_PRODUCTS);
  const fixture = createSanitizedRawFixture({
    products: rawProducts,
    queries: querySummary,
    capturedAt,
  });
  const allSucceeded = querySummary.length === TAOBAO_RAW_PROBE_QUERIES.length &&
    querySummary.every((entry) => entry.api_success === true);

  return {
    probe_status: allSucceeded ? "SUCCESS" : "FAILED",
    captured_at: fixture.captured_at,
    query_summary: fixture.queries,
    raw_product_count: fixture.product_count,
    raw_products: fixture.products,
    field_availability: buildRawAvailabilityMatrix(fixture.products),
    fixture_checksum: fixture.checksum,
    fixture_storage: {
      persisted_on_render: false,
      reason: "RENDER_FILESYSTEM_EPHEMERAL",
    },
  };
}

function probeAvailability(environment = {}) {
  const flagEnabled = String(environment.ENABLE_TAOBAO_RAW_PROBE || "")
    .trim().toLowerCase() === "true";
  const renderRuntime = String(environment.RENDER || "").trim().toLowerCase() === "true";
  const token = String(environment.INTERNAL_PROBE_TOKEN || "");
  const independent = token !== String(environment.TAOBAO_APP_SECRET || "") &&
    token !== String(environment.TAOBAO_PID || "");
  return {
    enabled: flagEnabled && renderRuntime && token.length >= INTERNAL_PROBE_TOKEN_MIN_LENGTH && independent,
  };
}

function authorized(req, expectedToken) {
  const header = String(req?.headers?.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(String(expectedToken || ""), "utf8");
  return actual.length === expected.length && actual.length > 0 &&
    crypto.timingSafeEqual(actual, expected);
}

function createSafeProbeLogger(logger = console) {
  return {
    info(message, details) {
      logger.info?.(message, safeLogDetails(details));
    },
    warn(message, details) {
      logger.warn?.(message, safeLogDetails(details));
    },
    error(message, details) {
      logger.error?.(message, safeLogDetails(details));
    },
  };
}

function safeLogDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const allowed = [
    "configured", "mode", "provider", "method", "result_status", "category",
    "candidate_count", "semantic_filtered_count", "final_count", "rawCount",
    "mappedCount", "usableCount", "errorCode",
  ];
  return Object.fromEntries(allowed
    .filter((key) => details[key] !== undefined)
    .map((key) => [key, details[key]]));
}

function safeProviderErrorSummary(error, query) {
  const cause = error?.cause || {};
  const details = cause?.details || error?.details || {};
  return {
    query,
    api_success: false,
    error_code: safeText(details.taobao_error_code || cause?.code || error?.code || "TAOBAO_PROBE_FAILED"),
    sub_code: safeText(details.taobao_sub_code || cause?.subCode || cause?.sub_code),
    msg: safeText(details.taobao_sub_msg || details.taobao_msg || cause?.message || error?.message),
    request_id: safeText(details.taobao_request_id || cause?.requestId || cause?.request_id),
    result_count: 0,
  };
}

function safeErrorCode(error) {
  return safeText(error?.code) || "TAOBAO_RAW_PROBE_FAILED";
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  return String(value)
    .replace(/mm_[A-Za-z0-9]+_[A-Za-z0-9]+_[A-Za-z0-9]+/g, "mm_***_***_***")
    .replace(/[?&](?:sign|token|secret|pid|app_key)=[^&\s]*/gi, "")
    .slice(0, 300);
}

function isPlacementFailure(summary) {
  return /(?:^|_)15$/.test(String(summary.error_code || "")) &&
    String(summary.sub_code || "") === "2";
}

module.exports = {
  INTERNAL_PROBE_TOKEN_MIN_LENGTH,
  TAOBAO_RAW_PROBE_MAX_PRODUCTS,
  TAOBAO_RAW_PROBE_PAGE_SIZE,
  TAOBAO_RAW_PROBE_PATH,
  TAOBAO_RAW_PROBE_QUERIES,
  createTaobaoRawProbeHandler,
  executeTaobaoRawProbe,
  probeAvailability,
};
