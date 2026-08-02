const fs = require("fs");
const path = require("path");

const allowedEventNames = new Set([
  "app_session",
  "brand_page_open",
  "new_user_onboarding_completed",
  "outfit_generated",
  "outfit_plan_favorited",
  "outfit_plan_regenerated",
  "outfit_share_opened",
  "page_dwell",
  "photo_upload_completed",
  "product_click",
  "product_detail_view",
  "product_favorite",
  "product_impression",
  "product_purchase_completed",
  "product_purchase_redirect",
  "purchase_intent",
  "product_try_on",
  "recommendation_feedback_submitted",
  "try_on_result_saved",
  "try_on_result_shared",
  "user_registered",
]);

class AnalyticsStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnalyticsStoreError";
    this.status = 400;
    this.code = "INVALID_ANALYTICS_EVENT";
  }
}

class AnalyticsStore {
  constructor({filePath = null, limit = 100_000, persistence = null} = {}) {
    this.filePath = filePath;
    this.limit = limit;
    this.persistence = persistence;
    this.events = [];
    this.loaded = false;
    this.pendingPersistence = Promise.resolve();
  }

  async initialize() {
    if (this.loaded) return;
    if (this.persistence) {
      const state = await this.persistence.load();
      this.events = Array.isArray(state?.events) ? state.events : [];
      this.loaded = true;
      return;
    }
    this.#ensureLoaded();
  }

  async flush() {
    await this.pendingPersistence;
  }

  record(input) {
    this.#ensureLoaded();
    const event = normalizeEvent(input);
    const existing = this.events.find((item) => item.id === event.id);
    if (existing) {
      return existing;
    }
    this.events.push(event);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    this.#persist();
    return event;
  }

  deleteUser(userId) {
    this.#ensureLoaded();
    const before = this.events.length;
    this.events = this.events.filter((event) => event.userId !== userId);
    this.#persist();
    return before - this.events.length;
  }

  getDashboard({date = new Date()} = {}) {
    this.#ensureLoaded();
    const day = date.toISOString().slice(0, 10);
    const events = this.events.filter((event) => {
      return event.createdAt.slice(0, 10) === day;
    });
    const count = (name) => {
      return events.filter((event) => event.name === name).length;
    };
    const totalCount = (name) => {
      return this.events.filter((event) => event.name === name).length;
    };
    const uniqueUsers = (names) => {
      const accepted = new Set(names);
      return new Set(
        events
          .filter((event) => accepted.has(event.name))
          .map((event) => event.userId),
      ).size;
    };
    const feedback = events.filter((event) => {
      return event.name === "recommendation_feedback_submitted";
    });
    const satisfactionTotal = feedback.reduce((sum, event) => {
      return sum + Number(event.properties.satisfaction || 0);
    }, 0);
    const willingToBuy = feedback.filter((event) => {
      return event.properties.willingToBuy === "true";
    }).length;
    const noPurchaseReasons = {};
    for (const event of feedback) {
      const reason = event.properties.noPurchaseReason;
      if (reason) {
        noPurchaseReasons[reason] = (noPurchaseReasons[reason] || 0) + 1;
      }
    }
    const impressions = count("product_impression");
    const clicks = count("product_click");
    const favorites = count("product_favorite");
    const purchaseRedirects = count("product_purchase_redirect");
    const productDetailViews = count("product_detail_view");
    const purchaseIntents = count("purchase_intent");
    const revenueFor = (name) => {
      return events
        .filter((event) => event.name === name)
        .reduce((sum, event) => {
          const price = Number(event.properties.productPrice || 0);
          const rate = Number(event.properties.commissionRate || 0);
          return sum + (Number.isFinite(price) && Number.isFinite(rate)
            ? price * rate
            : 0);
        }, 0);
    };

    return {
      date: day,
      newUsers: uniqueUsers([
        "new_user_onboarding_completed",
        "user_registered",
      ]),
      activeUsers: uniqueUsers(["app_session"]),
      photoUploadUsers: uniqueUsers(["photo_upload_completed"]),
      outfitGenerationCount: count("outfit_generated"),
      productImpressions: impressions,
      productClicks: clicks,
      productDetailViews,
      purchaseIntents,
      potentialCommission: revenueFor("product_purchase_redirect"),
      confirmedCommission: revenueFor("product_purchase_completed"),
      productFavorites: favorites,
      purchaseRedirects,
      totalProductImpressions: totalCount("product_impression"),
      totalProductClicks: totalCount("product_click"),
      totalProductFavorites: totalCount("product_favorite"),
      totalTryOns: totalCount("product_try_on"),
      totalPurchaseRedirects: totalCount("product_purchase_redirect"),
      totalPurchaseCompleted: totalCount("product_purchase_completed"),
      savedTryOnResults: count("try_on_result_saved"),
      sharedTryOnResults: count("try_on_result_shared"),
      favoritedOutfitPlans: count("outfit_plan_favorited"),
      clickThroughRate: impressions === 0 ? 0 : clicks / impressions,
      favoriteRate: clicks === 0 ? 0 : favorites / clicks,
      purchaseRedirectRate:
        clicks === 0 ? 0 : purchaseRedirects / clicks,
      detailToPurchaseIntentRate:
        productDetailViews === 0 ? 0 : purchaseIntents / productDetailViews,
      feedbackCount: feedback.length,
      averageSatisfaction:
        feedback.length === 0 ? 0 : satisfactionTotal / feedback.length,
      purchaseIntentRate:
        feedback.length === 0 ? 0 : willingToBuy / feedback.length,
      noPurchaseReasons,
      generatedAt: new Date().toISOString(),
    };
  }

  #ensureLoaded() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    this.events = Array.isArray(parsed.events) ? parsed.events : [];
  }

  #persist() {
    const state = {events: JSON.parse(JSON.stringify(this.events))};
    if (this.persistence) {
      this.pendingPersistence = this.pendingPersistence.catch(() => {}).then(() => {
        return this.persistence.save(state);
      });
    }
    if (!this.filePath) {
      return;
    }
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(state),
      {encoding: "utf8", mode: 0o600},
    );
    fs.renameSync(temporaryPath, this.filePath);
  }
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AnalyticsStoreError("事件必须是 JSON 对象");
  }
  if (!allowedEventNames.has(input.name)) {
    throw new AnalyticsStoreError("不支持的事件名称");
  }
  if (
    typeof input.userId !== "string" ||
    input.userId.length < 1 ||
    input.userId.length > 128
  ) {
    throw new AnalyticsStoreError("userId 格式无效");
  }
  const properties = normalizeProperties(input.properties);
  return {
    id:
      typeof input.id === "string" && input.id.length <= 128
        ? input.id
        : `server-event-${Date.now()}`,
    name: input.name,
    userId: input.userId,
    properties,
    createdAt: new Date().toISOString(),
  };
}

function normalizeProperties(value) {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsStoreError("properties 格式无效");
  }
  const entries = Object.entries(value);
  if (entries.length > 30) {
    throw new AnalyticsStoreError("properties 字段过多");
  }
  const result = {};
  for (const [key, item] of entries) {
    if (
      key.length > 64 ||
      typeof item !== "string" ||
      item.length > 500
    ) {
      throw new AnalyticsStoreError("properties 内容无效");
    }
    result[key] = item;
  }
  return result;
}

module.exports = {
  AnalyticsStore,
  AnalyticsStoreError,
};
