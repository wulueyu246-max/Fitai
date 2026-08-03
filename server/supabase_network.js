const dns = require("node:dns");
const {Agent, fetch: undiciFetch} = require("undici");

class SupabaseConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupabaseConfigError";
    this.code = code;
  }
}

function normalizeSupabaseUrl(value) {
  let normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length >= 2 &&
    ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (!normalized) return "";

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (error) {
    throw new SupabaseConfigError(
      "SUPABASE_URL_INVALID",
      "SUPABASE_URL is not a valid URL",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new SupabaseConfigError(
      "SUPABASE_URL_NOT_HTTPS",
      "SUPABASE_URL must use HTTPS",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SupabaseConfigError(
      "SUPABASE_URL_UNSAFE_COMPONENTS",
      "SUPABASE_URL must not contain credentials, query, or fragment",
    );
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (path && path !== "/rest/v1") {
    throw new SupabaseConfigError(
      path.includes("/rest/v1")
        ? "SUPABASE_URL_DUPLICATE_REST_PATH"
        : "SUPABASE_URL_UNEXPECTED_PATH",
      "SUPABASE_URL must be the project root URL",
    );
  }
  return parsed.origin;
}

function resolveSupabaseConfig(environment = process.env) {
  const configured = Boolean(String(environment.SUPABASE_URL || "").trim());
  try {
    return {
      url: normalizeSupabaseUrl(environment.SUPABASE_URL),
      configured,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      url: "",
      configured,
      errorCode: error.code || "SUPABASE_URL_INVALID",
      errorMessage: error.message,
    };
  }
}

function createDirectSupabaseFetch({
  fetchImpl = undiciFetch,
  dispatcher = new Agent({
    connect: {
      timeout: 15_000,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
    },
  }),
  timeoutMs = 15_000,
} = {}) {
  return (input, init = {}) => fetchImpl(input, {
    ...init,
    dispatcher,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
}

function getSupabaseErrorDetails(error, fallbackHostname = null) {
  const cause = error?.cause;
  return {
    name: safeText(error?.name),
    message: safeText(error?.message),
    causeName: safeText(cause?.name),
    causeMessage: safeText(cause?.message),
    code: safeText(cause?.code || error?.code),
    errno: safeText(cause?.errno),
    hostname: safeText(cause?.hostname || fallbackHostname),
  };
}

async function diagnoseSupabaseConnection({
  url,
  serviceRoleKey,
  table = "shupi_runtime_state",
  fetchImpl,
  lookup = dns.promises.lookup,
  logger = console,
}) {
  const parsed = new URL(normalizeSupabaseUrl(url));
  const result = {
    hostname: parsed.hostname,
    dns: null,
    rootStatus: null,
    restStatus: null,
    errorCode: null,
  };

  try {
    const addresses = await lookup(parsed.hostname, {all: true});
    result.dns = addresses.map(({address, family}) => ({address, family}));
    logger.info("Supabase DNS lookup succeeded", {
      hostname: parsed.hostname,
      addressFamilies: [...new Set(addresses.map(({family}) => family))],
      addressCount: addresses.length,
    });
  } catch (error) {
    const details = getSupabaseErrorDetails(error, parsed.hostname);
    result.errorCode = details.code || "SUPABASE_DNS_FAILED";
    logger.error("Supabase DNS lookup failed", details);
  }

  try {
    const response = await fetchImpl(parsed.origin, {
      headers: {accept: "text/html,application/json"},
    });
    result.rootStatus = response.status;
    logger.info("Supabase HTTPS root diagnostic", {
      hostname: parsed.hostname,
      status: response.status,
    });
  } catch (error) {
    const details = getSupabaseErrorDetails(error, parsed.hostname);
    result.errorCode ||= details.code || "SUPABASE_HTTPS_FAILED";
    logger.error("Supabase HTTPS root diagnostic failed", details);
  }

  try {
    const endpoint = new URL(`${parsed.origin}/rest/v1/${table}`);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("limit", "1");
    const response = await fetchImpl(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: "application/json",
      },
    });
    result.restStatus = response.status;
    if (!response.ok) result.errorCode = `SUPABASE_HTTP_${response.status}`;
    logger.info("Supabase REST diagnostic", {
      hostname: parsed.hostname,
      table,
      status: response.status,
    });
  } catch (error) {
    const details = getSupabaseErrorDetails(error, parsed.hostname);
    result.errorCode ||= details.code || "SUPABASE_REST_FAILED";
    logger.error("Supabase REST diagnostic failed", details);
  }
  return result;
}

function safeText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).slice(0, 500);
}

module.exports = {
  SupabaseConfigError,
  createDirectSupabaseFetch,
  diagnoseSupabaseConnection,
  getSupabaseErrorDetails,
  normalizeSupabaseUrl,
  resolveSupabaseConfig,
};
