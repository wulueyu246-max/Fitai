const crypto = require("crypto");
const {normalizeSupabaseUrl} = require("./supabase_network");

class ProductClickStoreError extends Error {
  constructor(message, {cause, status = 400, code = "INVALID_PRODUCT_CLICK"} = {}) {
    super(message, {cause});
    this.name = "ProductClickStoreError";
    this.status = status;
    this.code = code;
  }
}

class ProductClickStore {
  constructor({supabaseUrl = "", serviceRoleKey = "", fetchImpl = fetch} = {}) {
    this.supabaseUrl = supabaseUrl ? normalizeSupabaseUrl(supabaseUrl) : "";
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.fetch = fetchImpl;
    this.clicks = [];
  }

  get usesCloudDatabase() {
    return Boolean(this.supabaseUrl && this.serviceRoleKey);
  }

  async record({
    userId,
    productId,
    platform,
    clickTime = new Date(),
    idempotencyKey = "",
  }) {
    const click = {
      id: idempotencyKey ? stableUuid(idempotencyKey) : crypto.randomUUID(),
      user_id: requireText(userId, "user_id"),
      product_id: requireText(productId, "product_id"),
      platform: requireText(platform, "platform"),
      click_time: normalizeDate(clickTime),
    };

    if (!this.usesCloudDatabase) {
      const existing = this.clicks.find((item) => item.id === click.id);
      if (existing) return existing;
      this.clicks.push(click);
      return click;
    }

    const response = await this.fetch(
      `${this.supabaseUrl}/rest/v1/product_click_events`,
      {
        method: "POST",
        headers: {
          ...this.#headers(),
          "content-type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(click),
      },
    );
    if (!response.ok) {
      throw new ProductClickStoreError(
        `商品点击写入失败（HTTP ${response.status}）`,
        {status: 502, code: "PRODUCT_CLICK_STORAGE_FAILED"},
      );
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : click;
  }

  async countForProduct(productId) {
    const normalizedProductId = requireText(productId, "product_id");
    if (!this.usesCloudDatabase) {
      return this.clicks.filter(
        (click) => click.product_id === normalizedProductId,
      ).length;
    }

    const endpoint = new URL(
      `${this.supabaseUrl}/rest/v1/product_click_events`,
    );
    endpoint.searchParams.set("product_id", `eq.${normalizedProductId}`);
    endpoint.searchParams.set("select", "id");
    const response = await this.fetch(endpoint, {
      headers: {
        ...this.#headers(),
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    if (!response.ok) {
      throw new ProductClickStoreError(
        `商品点击统计失败（HTTP ${response.status}）`,
        {status: 502, code: "PRODUCT_CLICK_STORAGE_FAILED"},
      );
    }
    const contentRange = response.headers.get("content-range") || "";
    const total = Number(contentRange.split("/").pop());
    return Number.isInteger(total) && total >= 0 ? total : 0;
  }

  #headers() {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      accept: "application/json",
    };
  }
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProductClickStoreError(`${field} 不能为空`);
  }
  return value.trim();
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ProductClickStoreError("click_time 无效");
  }
  return date.toISOString();
}

function stableUuid(value) {
  const hex = crypto.createHash("sha256").update(String(value)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

module.exports = {ProductClickStore, ProductClickStoreError};
