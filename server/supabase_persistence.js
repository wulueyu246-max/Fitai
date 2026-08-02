class CloudPersistenceError extends Error {
  constructor(message, cause) {
    super(message, {cause});
    this.name = "CloudPersistenceError";
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
    this.url = String(url || "").replace(/\/$/, "");
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
    const response = await this.fetch(endpoint, {headers: this.#headers()});
    if (!response.ok) {
      throw new CloudPersistenceError(
        `云数据库读取失败（HTTP ${response.status}）`,
      );
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows[0]?.payload ? rows[0].payload : null;
  }

  async save(payload) {
    this.#assertConfigured();
    const endpoint = new URL(`${this.url}/rest/v1/${this.table}`);
    endpoint.searchParams.set("on_conflict", "id");
    const response = await this.fetch(endpoint, {
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
      );
    }
  }

  async healthCheck() {
    await this.load();
    return true;
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
