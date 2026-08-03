const crypto = require("crypto");

const {CloudPersistenceError} = require("./supabase_persistence");
const {normalizeSupabaseUrl} = require("./supabase_network");

class SupabaseUserPersistence {
  constructor({runtimePersistence, url, serviceRoleKey, fetchImpl = fetch}) {
    this.runtimePersistence = runtimePersistence;
    this.url = normalizeSupabaseUrl(url);
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.fetch = fetchImpl;
    this.knownUserIds = new Set();
  }

  async load() {
    const state = await this.runtimePersistence.load();
    this.knownUserIds = new Set(
      (Array.isArray(state?.users) ? state.users : [])
        .map((user) => user?.userId)
        .filter(Boolean),
    );
    return state;
  }

  async save(state) {
    // Keep sessions and password hashes in the server-only runtime record.
    await this.runtimePersistence.save(state);
    const users = Array.isArray(state?.users) ? state.users : [];
    const currentIds = new Set(users.map((user) => user.userId));

    for (const userId of this.knownUserIds) {
      if (!currentIds.has(userId)) {
        await this.#delete("users", "id", userId);
      }
    }
    for (const user of users) {
      await this.#syncUser(user);
    }
    this.knownUserIds = currentIds;
  }

  async #syncUser(user) {
    const userId = user.userId;
    const wardrobe = user.wardrobe || {};
    const favoriteProducts = arrayOfObjects(wardrobe.favoriteProducts);

    await this.#upsert("users", [{
      id: userId,
      email: user.email || null,
      nickname: user.nickname,
      avatar: persistentPhotoReference(user.avatar),
      gender: user.gender || null,
      phone: user.phone || null,
      created_at: user.createdAt,
      updated_at: user.updatedAt || user.createdAt,
    }]);
    await this.#upsert("body_profiles", [{
      id: `body-${userId}`,
      user_id: userId,
      height: user.height,
      weight: user.weight,
      shoulder_width: user.shoulderWidth ?? null,
      waist: user.waist ?? null,
      hip: user.hip ?? null,
      body_type: user.bodyType || null,
      front_image_url: persistentPhotoReference(user.bodyPhotos?.front),
      side_image_url: persistentPhotoReference(user.bodyPhotos?.side),
      back_image_url: persistentPhotoReference(user.bodyPhotos?.back),
      updated_at: user.updatedAt || new Date().toISOString(),
    }]);

    await this.#replaceChildren("favorites", userId, favoriteProducts.map(
      (product, index) => ({
        id: stableId("favorite", userId, product.id || index),
        user_id: userId,
        product_id: String(product.id || product.product_id || `product-${index}`),
        product_json: product,
        created_at: product.createdAt || user.updatedAt || user.createdAt,
      }),
    ));
    await this.#replaceChildren("wardrobe", userId, favoriteProducts.map(
      (product, index) => ({
        id: stableId("wardrobe", userId, product.id || index),
        user_id: userId,
        image_url: product.imageUrl || product.image || product.image_url || null,
        category: product.category || null,
        color: product.color || null,
        season: product.season || null,
        brand: product.brand || null,
        item_json: product,
        created_at: product.createdAt || user.updatedAt || user.createdAt,
      }),
    ));

    const historyRows = [
      ...historyItems(userId, "outfit_plan", wardrobe.outfitPlans),
      ...historyItems(userId, "try_on", wardrobe.tryOnHistory),
      ...historyItems(
        userId,
        "ai_recommendation",
        wardrobe.aiRecommendationHistory,
      ),
    ];
    await this.#replaceChildren("history", userId, historyRows);
  }

  async #replaceChildren(table, userId, rows) {
    await this.#delete(table, "user_id", userId);
    if (rows.length > 0) await this.#upsert(table, rows);
  }

  async #delete(table, column, value) {
    const endpoint = new URL(`${this.url}/rest/v1/${table}`);
    endpoint.searchParams.set(column, `eq.${value}`);
    const response = await this.fetch(endpoint, {
      method: "DELETE",
      headers: this.#headers(),
    });
    await assertResponse(response, `Supabase ${table} delete`);
  }

  async #upsert(table, rows) {
    const endpoint = new URL(`${this.url}/rest/v1/${table}`);
    endpoint.searchParams.set("on_conflict", "id");
    const response = await this.fetch(endpoint, {
      method: "POST",
      headers: {
        ...this.#headers(),
        "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    await assertResponse(response, `Supabase ${table} upsert`);
  }

  #headers() {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      accept: "application/json",
    };
  }
}

function arrayOfObjects(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function historyItems(userId, type, value) {
  return arrayOfObjects(value).map((item, index) => ({
    id: stableId(type, userId, item.id || index),
    user_id: userId,
    prompt: String(item.prompt || item.title || item.scene || ""),
    result_json: item,
    history_type: type,
    created_at: item.createdAt || item.created_at || new Date().toISOString(),
  }));
}

function stableId(type, userId, value) {
  return crypto
    .createHash("sha256")
    .update(`${type}:${userId}:${value}`)
    .digest("hex");
}

function persistentPhotoReference(value) {
  return typeof value === "string" && !value.startsWith("data:")
    ? value
    : null;
}

async function assertResponse(response, operation) {
  if (response.ok) return;
  let detail = "";
  try {
    const body = await response.json();
    detail = typeof body?.message === "string" ? `: ${body.message}` : "";
  } catch (_) {
    // Supabase can return an empty body for gateway failures.
  }
  throw new CloudPersistenceError(
    `${operation} failed (HTTP ${response.status})${detail}`,
  );
}

module.exports = {SupabaseUserPersistence, persistentPhotoReference};
