const crypto = require("crypto");

class ObjectStorageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ObjectStorageError";
    this.status = status;
    this.code = code;
  }
}

class SupabaseObjectStorage {
  constructor({url, serviceRoleKey, bucket = "user-photos", fetchImpl = fetch}) {
    this.url = String(url || "").replace(/\/$/, "");
    this.serviceRoleKey = String(serviceRoleKey || "");
    this.bucket = bucket;
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.url && this.serviceRoleKey && this.bucket);
  }

  async uploadDataUri({userId, kind, dataUri}) {
    this.#assertConfigured();
    const parsed = parseImageDataUri(dataUri);
    const extension = parsed.mimeType === "image/png" ? "png" : "jpg";
    const objectPath = `users/${encodeURIComponent(userId)}/${kind}-${crypto.randomUUID()}.${extension}`;
    const response = await this.fetch(
      `${this.url}/storage/v1/object/${this.bucket}/${objectPath}`,
      {
        method: "POST",
        headers: {
          ...this.#headers(),
          "content-type": parsed.mimeType,
          "x-upsert": "false",
        },
        body: parsed.bytes,
      },
    );
    if (!response.ok) {
      throw new ObjectStorageError(
        503,
        "PHOTO_STORAGE_UNAVAILABLE",
        `照片存储失败（HTTP ${response.status}）`,
      );
    }
    return {bucket: this.bucket, objectPath};
  }

  async deleteUserObjects(userId) {
    this.#assertConfigured();
    const prefix = `users/${encodeURIComponent(userId)}`;
    const listResponse = await this.fetch(
      `${this.url}/storage/v1/object/list/${this.bucket}`,
      {
        method: "POST",
        headers: {...this.#headers(), "content-type": "application/json"},
        body: JSON.stringify({prefix, limit: 1000, offset: 0}),
      },
    );
    if (!listResponse.ok) {
      throw new ObjectStorageError(
        503,
        "PHOTO_DELETE_UNAVAILABLE",
        "暂时无法读取云端照片，请稍后重试",
      );
    }
    const objects = await listResponse.json();
    const paths = (Array.isArray(objects) ? objects : [])
      .map((item) => item?.name)
      .filter((name) => typeof name === "string" && name.length > 0)
      .map((name) => `${prefix}/${name}`);
    if (paths.length === 0) return 0;
    const deleteResponse = await this.fetch(
      `${this.url}/storage/v1/object/${this.bucket}`,
      {
        method: "DELETE",
        headers: {...this.#headers(), "content-type": "application/json"},
        body: JSON.stringify({prefixes: paths}),
      },
    );
    if (!deleteResponse.ok) {
      throw new ObjectStorageError(
        503,
        "PHOTO_DELETE_UNAVAILABLE",
        "云端照片删除失败，请稍后重试",
      );
    }
    return paths.length;
  }

  #headers() {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
    };
  }

  #assertConfigured() {
    if (!this.configured) {
      throw new ObjectStorageError(
        503,
        "PHOTO_STORAGE_NOT_CONFIGURED",
        "照片对象存储尚未配置",
      );
    }
  }
}

function parseImageDataUri(value) {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(
    typeof value === "string" ? value : "",
  );
  if (!match) {
    throw new ObjectStorageError(
      400,
      "INVALID_PHOTO",
      "照片必须是 JPEG 或 PNG Base64 数据",
    );
  }
  return {mimeType: match[1], bytes: Buffer.from(match[2], "base64")};
}

module.exports = {ObjectStorageError, SupabaseObjectStorage, parseImageDataUri};
