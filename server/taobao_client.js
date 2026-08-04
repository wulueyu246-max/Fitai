const crypto = require("crypto");
const {gunzipSync} = require("node:zlib");
const {Agent} = require("undici");

const TAOBAO_ENDPOINT = "https://eco.taobao.com/router/rest";
const TAOBAO_MATERIAL_SEARCH_METHOD = "taobao.tbk.dg.material.optional.upgrade";
const TAOBAO_MATERIAL_SAMPLE_METHOD = "taobao.tbk.dg.material.recommend";

class TaobaoApiError extends Error {
  constructor(message, {code = "TAOBAO_API_ERROR", retryable = false, cause} = {}) {
    super(message, {cause});
    this.name = "TaobaoApiError";
    this.code = code;
    this.retryable = retryable;
  }
}

class TaobaoApiClient {
  constructor({
    appKey,
    appSecret,
    endpoint = TAOBAO_ENDPOINT,
    fetchImpl = fetch,
    connectTimeoutMs = 5_000,
    totalTimeoutMs = 12_000,
    maxRetries = 1,
    logger = console,
  }) {
    this.appKey = required(appKey, "TAOBAO_APP_KEY");
    this.appSecret = required(appSecret, "TAOBAO_APP_SECRET");
    this.endpoint = httpsUrl(endpoint);
    this.fetch = fetchImpl;
    this.totalTimeoutMs = positiveInteger(totalTimeoutMs, 12_000);
    this.maxRetries = Math.min(positiveInteger(maxRetries, 1), 1);
    this.logger = logger;
    this.dispatcher = fetchImpl === fetch
      ? new Agent({connect: {timeout: positiveInteger(connectTimeoutMs, 5_000)}})
      : undefined;
  }

  async call(method, apiParams = {}, {requestId = crypto.randomUUID()} = {}) {
    const startedAt = Date.now();
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const payload = await this.#callOnce(method, apiParams);
        const errorResponse = payload?.error_response;
        if (errorResponse) {
          const code = safeTopErrorCode(errorResponse);
          throw new TaobaoApiError("淘宝开放平台拒绝了商品请求", {
            code,
            retryable: isRetryableTopError(errorResponse),
          });
        }
        this.logger.info?.("淘宝商品接口完成", {
          requestId,
          method,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          statusCode: 200,
        });
        return payload;
      } catch (error) {
        lastError = normalizeError(error);
        this.logger.warn?.("淘宝商品接口失败", {
          requestId,
          method,
          attempt: attempt + 1,
          durationMs: Date.now() - startedAt,
          errorCode: lastError.code,
          ...safeTransportDetails(lastError, this.endpoint),
        });
        if (!lastError.retryable || attempt >= this.maxRetries) break;
      }
    }
    throw lastError;
  }

  async #callOnce(method, apiParams) {
    const params = {
      app_key: this.appKey,
      format: "json",
      method,
      sign_method: "md5",
      simplify: "true",
      timestamp: taobaoTimestamp(),
      v: "2.0",
      ...cleanParams(apiParams),
    };
    params.sign = signTaobaoRequest(params, this.appSecret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.totalTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetch(this.endpoint, {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams(params).toString(),
        signal: controller.signal,
        ...(this.dispatcher ? {dispatcher: this.dispatcher} : {}),
      });
      if (!response.ok) {
        throw new TaobaoApiError("淘宝开放平台 HTTP 请求失败", {
          code: `TAOBAO_HTTP_${response.status}`,
          retryable: response.status === 429 || response.status >= 500,
        });
      }
      return await parseTaobaoResponse(response);
    } catch (error) {
      if (error instanceof TaobaoApiError) throw error;
      const timeout = error?.name === "AbortError";
      throw new TaobaoApiError(
        timeout ? "淘宝商品请求超时" : "淘宝商品网络请求失败",
        {code: timeout ? "TAOBAO_TIMEOUT" : "TAOBAO_NETWORK_ERROR", retryable: true, cause: error},
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseTaobaoResponse(response) {
  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const jsonBytes = isGzip ? gunzipSync(bytes) : bytes;
    return JSON.parse(jsonBytes.toString("utf8"));
  } catch (error) {
    throw new TaobaoApiError("淘宝开放平台返回了无效响应", {
      code: "TAOBAO_INVALID_RESPONSE",
      retryable: false,
      cause: error,
    });
  }
}

function signTaobaoRequest(params, appSecret) {
  const content = Object.keys(params)
    .filter((key) => key !== "sign" && params[key] != null)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return crypto.createHash("md5")
    .update(`${appSecret}${content}${appSecret}`, "utf8")
    .digest("hex").toUpperCase();
}

function taobaoTimestamp(now = new Date()) {
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 19).replace("T", " ");
}

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) =>
    value !== undefined && value !== null && String(value).trim() !== ""));
}

function safeTopErrorCode(error) {
  const code = String(error?.code || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "");
  const subCode = String(error?.sub_code || "").toUpperCase();
  if (/PERMISSION|ACCESS|AUTH|INVALID_SESSION/.test(subCode)) return "TAOBAO_PERMISSION_DENIED";
  return `TAOBAO_API_${code || "UNKNOWN"}`;
}

function isRetryableTopError(error) {
  const text = `${error?.code || ""} ${error?.sub_code || ""}`.toLowerCase();
  return /isp|service-unavailable|flow-limit|timeout/.test(text);
}

function normalizeError(error) {
  if (error instanceof TaobaoApiError) return error;
  return new TaobaoApiError("淘宝商品请求失败", {code: "TAOBAO_UNKNOWN_ERROR", cause: error});
}

function safeTransportDetails(error, endpoint) {
  let cause = error?.cause;
  while (cause?.cause) cause = cause.cause;
  if (!cause) return {};
  let hostname = "";
  try {
    hostname = new URL(endpoint).hostname;
  } catch (_) {
    // The endpoint is validated during construction.
  }
  return {
    causeName: String(cause.name || "Error").slice(0, 80),
    causeCode: String(cause.code || "UNKNOWN").slice(0, 80),
    causeMessage: sanitizeErrorMessage(cause.message),
    hostname,
  };
}

function sanitizeErrorMessage(value) {
  return String(value || "unknown error")
    .replace(/([?&](?:app_key|sign|session|secret|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 240);
}

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TaobaoApiError(`${name} 未配置`, {code: "TAOBAO_NOT_CONFIGURED"});
  return text;
}

function httpsUrl(value) {
  const url = new URL(required(value, "TAOBAO_API_URL"));
  if (url.protocol !== "https:") {
    throw new TaobaoApiError("淘宝接口必须使用 HTTPS", {code: "TAOBAO_INVALID_ENDPOINT"});
  }
  return url.toString();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

module.exports = {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiClient,
  TaobaoApiError,
  safeTransportDetails,
  signTaobaoRequest,
  taobaoTimestamp,
};
