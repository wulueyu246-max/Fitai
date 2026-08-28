const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {pipeline} = require("node:stream/promises");

const {
  ProductProviderError,
  createProductProvider,
} = require("./product_provider");
const {
  buildRawAvailabilityMatrix,
  createSanitizedRawFixture,
} = require("./taobao_candidate_enrichment");

const TAOBAO_RAW_PROBE_PATH = "/internal/probes/taobao-raw-v1";
const TAOBAO_RAW_PROBE_ARTIFACT_PATH =
  `${TAOBAO_RAW_PROBE_PATH}/artifacts/:artifact_id`;
const TAOBAO_RAW_PROBE_QUERIES = Object.freeze(["女装上衣", "男装裤子", "女鞋"]);
const TAOBAO_RAW_PROBE_PAGE_SIZE = 10;
const TAOBAO_RAW_PROBE_MAX_PRODUCTS = 30;
const INTERNAL_PROBE_TOKEN_MIN_LENGTH = 32;
const TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS = 15 * 60 * 1000;
const TAOBAO_RAW_PROBE_ARTIFACT_MAX_BYTES = 1024 * 1024;
const TAOBAO_RAW_PROBE_ARTIFACT_ID_PATTERN = /^[a-f0-9]{48}$/;
const TAOBAO_RAW_PROBE_ARTIFACT_ROOT = path.join(os.tmpdir(), "fitai-probes");

function createTaobaoRawProbeHandler({
  environment = process.env,
  providerFactory = createProductProvider,
  logger = console,
  now = () => new Date(),
  artifactStore = createTaobaoRawProbeArtifactStore(),
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
      if (result.probe_status !== "SUCCESS") {
        return res.status(502).json({
          probe_status: result.probe_status,
          product_count: result.product_count,
          availability_matrix: result.availability_matrix,
          error_code: "TAOBAO_RAW_PROBE_INCOMPLETE",
        });
      }
      const artifact = await artifactStore.create(result.fixture);
      return res.status(200).json({
        probe_status: result.probe_status,
        product_count: result.product_count,
        availability_matrix: result.availability_matrix,
        checksum: artifact.checksum,
        artifact_id: artifact.artifact_id,
        artifact_ready: true,
      });
    } catch (error) {
      logger.error?.("taobao_raw_probe_failed", {
        code: safeErrorCode(error),
      });
      const status = error instanceof ProductProviderError
        ? error.status
        : Number(error?.status) || 502;
      return res.status(status).json({
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
    product_count: fixture.product_count,
    availability_matrix: buildRawAvailabilityMatrix(fixture.products),
    query_summary: fixture.queries,
    fixture,
  };
}

function createTaobaoRawProbeArtifactDownloadHandler({
  environment = process.env,
  artifactStore,
  logger = console,
} = {}) {
  if (!artifactStore) throw new TypeError("artifactStore is required");
  return async function taobaoRawProbeArtifactDownloadHandler(req, res) {
    const currentEnvironment = typeof environment === "function"
      ? environment()
      : environment;
    const availability = probeAvailability(currentEnvironment);
    if (!availability.enabled) return res.status(404).json({error: "NOT_FOUND"});
    if (!authorized(req, currentEnvironment.INTERNAL_PROBE_TOKEN)) {
      return res.status(403).json({error: "FORBIDDEN"});
    }
    const artifactId = String(req?.params?.artifact_id || "");
    if (!TAOBAO_RAW_PROBE_ARTIFACT_ID_PATTERN.test(artifactId)) {
      return res.status(404).json({error: "PROBE_ARTIFACT_NOT_FOUND"});
    }

    let artifact;
    try {
      artifact = await artifactStore.claim(artifactId);
      if (!artifact) {
        return res.status(404).json({error: "PROBE_ARTIFACT_NOT_FOUND"});
      }
      res.status(200);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="raw_taobao_product_probe_${artifactId}.json"`,
      );
      res.setHeader("Content-Length", String(artifact.bytes));
      await pipeline(fs.createReadStream(artifact.file_path), res);
      return undefined;
    } catch (error) {
      logger.error?.("taobao_raw_probe_artifact_download_failed", {
        code: safeErrorCode(error),
      });
      if (!res.headersSent) {
        return res.status(Number(error?.status) || 502).json({
          error: safeErrorCode(error),
        });
      }
      res.destroy(error);
      return undefined;
    } finally {
      if (artifact) await artifactStore.removeClaimed(artifact);
    }
  };
}

function createTaobaoRawProbeArtifactStore({
  rootDirectory = TAOBAO_RAW_PROBE_ARTIFACT_ROOT,
  ttlMs = TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS,
  maxBytes = TAOBAO_RAW_PROBE_ARTIFACT_MAX_BYTES,
  clock = () => Date.now(),
  randomId = () => crypto.randomBytes(24).toString("hex"),
} = {}) {
  const root = path.resolve(rootDirectory);
  const entries = new Map();
  const expiryTimers = new Map();

  async function create(fixture) {
    await cleanupExpired();
    const body = Buffer.from(JSON.stringify(fixture), "utf8");
    if (body.length > maxBytes) {
      throw probeError("PROBE_ARTIFACT_TOO_LARGE", 413);
    }
    await fs.promises.mkdir(root, {recursive: true, mode: 0o700});

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const artifactId = String(randomId());
      if (!TAOBAO_RAW_PROBE_ARTIFACT_ID_PATTERN.test(artifactId)) {
        throw probeError("PROBE_ARTIFACT_ID_INVALID", 500);
      }
      const filePath = artifactPath(root, artifactId);
      try {
        await fs.promises.writeFile(filePath, body, {flag: "wx", mode: 0o600});
        const entry = Object.freeze({
          artifact_id: artifactId,
          file_path: filePath,
          bytes: body.length,
          checksum: `sha256:${crypto.createHash("sha256")
            .update(body)
            .digest("hex")}`,
          expires_at_ms: clock() + ttlMs,
        });
        entries.set(artifactId, entry);
        scheduleExpiration(entry);
        return Object.freeze({
          artifact_id: artifactId,
          bytes: entry.bytes,
          checksum: entry.checksum,
        });
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw probeError("PROBE_ARTIFACT_WRITE_FAILED", 502);
        }
      }
    }
    throw probeError("PROBE_ARTIFACT_ID_COLLISION", 502);
  }

  async function claim(artifactId) {
    await cleanupExpired();
    if (!TAOBAO_RAW_PROBE_ARTIFACT_ID_PATTERN.test(String(artifactId || ""))) {
      return null;
    }
    const entry = entries.get(artifactId);
    if (!entry) return null;
    entries.delete(artifactId);
    clearExpiration(artifactId);
    return entry;
  }

  async function removeClaimed(entry) {
    if (!entry?.file_path || !isInsideRoot(root, entry.file_path)) return;
    await fs.promises.unlink(entry.file_path).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  async function cleanupExpired() {
    const currentTime = clock();
    for (const entry of [...entries.values()]) {
      if (entry.expires_at_ms > currentTime) continue;
      entries.delete(entry.artifact_id);
      clearExpiration(entry.artifact_id);
      await removeClaimed(entry);
    }
  }

  function scheduleExpiration(entry) {
    const timer = setTimeout(() => {
      entries.delete(entry.artifact_id);
      expiryTimers.delete(entry.artifact_id);
      void removeClaimed(entry);
    }, Math.max(0, entry.expires_at_ms - clock()));
    timer.unref?.();
    expiryTimers.set(entry.artifact_id, timer);
  }

  function clearExpiration(artifactId) {
    const timer = expiryTimers.get(artifactId);
    if (!timer) return;
    clearTimeout(timer);
    expiryTimers.delete(artifactId);
  }

  return Object.freeze({claim, cleanupExpired, create, removeClaimed});
}

function artifactPath(root, artifactId) {
  const candidate = path.resolve(root, `${artifactId}.json`);
  if (!isInsideRoot(root, candidate)) {
    throw probeError("PROBE_ARTIFACT_PATH_INVALID", 404);
  }
  return candidate;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") &&
    !path.isAbsolute(relative);
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

function probeError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
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
  TAOBAO_RAW_PROBE_ARTIFACT_MAX_BYTES,
  TAOBAO_RAW_PROBE_ARTIFACT_PATH,
  TAOBAO_RAW_PROBE_ARTIFACT_ROOT,
  TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS,
  TAOBAO_RAW_PROBE_MAX_PRODUCTS,
  TAOBAO_RAW_PROBE_PAGE_SIZE,
  TAOBAO_RAW_PROBE_PATH,
  TAOBAO_RAW_PROBE_QUERIES,
  createTaobaoRawProbeArtifactDownloadHandler,
  createTaobaoRawProbeArtifactStore,
  createTaobaoRawProbeHandler,
  executeTaobaoRawProbe,
  probeAvailability,
};
