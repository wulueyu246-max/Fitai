const {getSupabaseErrorDetails, normalizeSupabaseUrl} = require("./supabase_network");

class CloudPersistenceError extends Error {
  constructor(message, cause, code = "SUPABASE_PERSISTENCE_FAILED") {
    super(message, {cause});
    this.name = "CloudPersistenceError";
    this.code = code;
    this.details = cause ? getSupabaseErrorDetails(cause) : null;
  }
}

class SupabasePersistence {
  constructor({
    url,
    serviceRoleKey,
    table = "shupi_runtime_state",
    recordId = "primary",
    fetchImpl = fetch,
  }) {
    this.url = normalizeSupabaseUrl(url);
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.table = table;
    this.recordId = recordId;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.url && this.serviceRoleKey);
  }

  async load() {
    this.#assertConfigured();
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    endpoint.searchParams.set("id", `eq.${this.recordId}`);
    endpoint.searchParams.set("select", "payload");
    const response = await this.#request(endpoint, {headers: this.#headers()});
    if (!response.ok) {
      throw new CloudPersistenceError(
        `云数据库读取失败（HTTP ${response.status}）`,
        null,
        `SUPABASE_HTTP_${response.status}`,
      );
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows[0]?.payload ? rows[0].payload : null;
  }

  async save(payload) {
    this.#assertConfigured();
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    endpoint.searchParams.set("on_conflict", "id");
    const response = await this.#request(endpoint, {
      method: "POST",
      headers: {
        ...this.#headers(),
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: this.recordId,
        payload,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new CloudPersistenceError(
        `云数据库写入失败（HTTP ${response.status}）`,
        null,
        `SUPABASE_HTTP_${response.status}`,
      );
    }
  }

  async healthCheck() {
    await this.load();
    return true;
  }

  async #request(endpoint, init) {
    try {
      return await this.fetch(endpoint, init);
    } catch (error) {
      const details = getSupabaseErrorDetails(error, new URL(endpoint).hostname);
      throw new CloudPersistenceError(
        `Supabase network request failed: ${details.message || "unknown error"}`,
        error,
        details.code || "SUPABASE_NETWORK_ERROR",
      );
    }
  }

  #headers() {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      accept: "application/json",
    };
  }

  #assertConfigured() {
    if (!this.configured) {
      throw new CloudPersistenceError("云数据库尚未配置");
    }
  }
}

module.exports = {CloudPersistenceError, SupabasePersistence};
