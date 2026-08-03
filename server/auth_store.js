const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class AuthStoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthStoreError";
    this.status = status;
    this.code = code;
  }
}

class AuthStore {
  constructor({filePath = null, sessionDays = 30, persistence = null} = {}) {
    this.filePath = filePath;
    this.sessionDays = sessionDays;
    this.persistence = persistence;
    this.users = [];
    this.sessions = [];
    this.phoneCodes = new Map();
    this.loaded = false;
    this.pendingPersistence = Promise.resolve();
    this.persistenceStatus = persistence ? "connecting" : "disabled";
    this.persistenceError = null;
    this.persistenceDirty = false;
  }

  async initialize({allowDegraded = false} = {}) {
    if (this.loaded) return this.persistenceStatus === "ready";
    if (this.persistence) {
      try {
        const state = await this.persistence.load();
        if (state) {
          this.users = Array.isArray(state.users) ? state.users : [];
          this.sessions = Array.isArray(state.sessions) ? state.sessions : [];
          this.loaded = true;
          this.#dropExpiredSessions();
          this.persistenceStatus = "ready";
          this.persistenceError = null;
          return true;
        }
        this.persistenceStatus = "ready";
        this.persistenceError = null;
      } catch (error) {
        this.#markPersistenceDegraded(error);
        if (allowDegraded) {
          this.#ensureLoaded();
          return false;
        }
        throw new AuthStoreError(
          503,
          "CLOUD_STORE_UNAVAILABLE",
          `云数据库初始化失败：${error.message}`,
        );
      }
    }
    this.#ensureLoaded();
    return this.persistenceStatus === "ready";
  }

  async retryPersistence() {
    if (!this.persistence) return false;
    try {
      const remote = await this.persistence.load();
      const remoteUsers = Array.isArray(remote?.users) ? remote.users : [];
      const remoteSessions = Array.isArray(remote?.sessions) ? remote.sessions : [];
      if (this.persistenceDirty) {
        this.users = mergeByKey(remoteUsers, this.users, "userId");
        this.sessions = mergeByKey(remoteSessions, this.sessions, "tokenHash");
        await this.persistence.save(this.#state());
      } else if (remote) {
        this.users = remoteUsers;
        this.sessions = remoteSessions;
        this.#dropExpiredSessions();
      }
      this.loaded = true;
      this.persistenceDirty = false;
      this.persistenceStatus = "ready";
      this.persistenceError = null;
      return true;
    } catch (error) {
      this.#markPersistenceDegraded(error);
      return false;
    }
  }

  async flush() {
    try {
      await this.pendingPersistence;
    } catch (error) {
      throw new AuthStoreError(
        503,
        "CLOUD_STORE_UNAVAILABLE",
        `用户数据云端保存失败：${error.message}`,
      );
    }
  }

  async register({email, password, nickname}) {
    this.#ensureLoaded();
    const normalizedEmail = validateEmail(email);
    validatePassword(password);
    const normalizedNickname = readRequiredString(
      nickname,
      "nickname",
      40,
    );
    if (this.users.some((user) => user.email === normalizedEmail)) {
      throw new AuthStoreError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "该邮箱已经注册，请直接登录",
      );
    }

    const now = new Date();
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, passwordSalt);
    const user = {
      userId: `user-${crypto.randomUUID()}`,
      email: normalizedEmail,
      nickname: normalizedNickname,
      avatar: null,
      gender: "未设置",
      height: 173,
      weight: 60,
      age: 25,
      bodyType: "匀称体型",
      stylePreference: ["极简", "通勤"],
      budgetMin: 100,
      budgetMax: 1200,
      favoriteBrands: ["UNIQLO", "Nike"],
      wardrobe: emptyWardrobe(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastActiveAt: now.toISOString(),
      passwordSalt,
      passwordHash,
    };
    this.users.push(user);
    const session = this.#createSession(user.userId, now);
    this.#persist();
    return {account: publicAccount(user), session};
  }

  async login({email, password}) {
    this.#ensureLoaded();
    const normalizedEmail = validateEmail(email);
    validatePassword(password);
    const user = this.users.find((candidate) => {
      return candidate.email === normalizedEmail;
    });
    const hash = user
      ? await hashPassword(password, user.passwordSalt)
      : await hashPassword(password, "00000000000000000000000000000000");
    if (!user || !safeEqual(hash, user.passwordHash)) {
      throw new AuthStoreError(
        401,
        "INVALID_CREDENTIALS",
        "邮箱或密码不正确",
      );
    }

    const now = new Date();
    user.lastActiveAt = now.toISOString();
    const session = this.#createSession(user.userId, now);
    this.#persist();
    return {account: publicAccount(user), session};
  }

  requestPhoneCode(phone) {
    this.#ensureLoaded();
    const normalizedPhone = validatePhone(phone);
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    this.phoneCodes.set(normalizedPhone, {
      codeHash: hashToken(code),
      expiresAt: expiresAt.toISOString(),
      attempts: 0,
    });
    return {phone: normalizedPhone, code, expiresAt: expiresAt.toISOString()};
  }

  loginWithPhoneCode({phone, code}) {
    this.#ensureLoaded();
    const normalizedPhone = validatePhone(phone);
    const challenge = this.phoneCodes.get(normalizedPhone);
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      this.phoneCodes.delete(normalizedPhone);
      throw new AuthStoreError(401, "PHONE_CODE_EXPIRED", "验证码无效或已过期");
    }
    challenge.attempts += 1;
    if (challenge.attempts > 5 || !safeTokenEqual(hashToken(String(code || "")), challenge.codeHash)) {
      if (challenge.attempts > 5) this.phoneCodes.delete(normalizedPhone);
      throw new AuthStoreError(401, "PHONE_CODE_INVALID", "验证码无效或已过期");
    }
    this.phoneCodes.delete(normalizedPhone);
    const now = new Date();
    let user = this.users.find((candidate) => candidate.phone === normalizedPhone);
    if (!user) {
      user = {
        userId: `user-${crypto.randomUUID()}`,
        email: "",
        phone: normalizedPhone,
        nickname: `树皮用户 ${normalizedPhone.slice(-4)}`,
        avatar: null,
        gender: "未设置",
        height: 173,
        weight: 60,
        age: 25,
        bodyType: "匀称体型",
        stylePreference: ["极简", "通勤"],
        budgetMin: 100,
        budgetMax: 1200,
        favoriteBrands: ["UNIQLO", "Nike"],
        wardrobe: emptyWardrobe(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastActiveAt: now.toISOString(),
        passwordSalt: null,
        passwordHash: null,
      };
      this.users.push(user);
    }
    user.lastActiveAt = now.toISOString();
    const session = this.#createSession(user.userId, now);
    this.#persist();
    return {account: publicAccount(user), session};
  }

  getAccount(token) {
    this.#ensureLoaded();
    const session = this.#findSession(token);
    const user = this.users.find((candidate) => {
      return candidate.userId === session.userId;
    });
    if (!user) {
      throw new AuthStoreError(401, "SESSION_INVALID", "登录状态已失效");
    }
    user.lastActiveAt = new Date().toISOString();
    this.#persist();
    return publicAccount(user);
  }

  updateProfile(token, input) {
    this.#ensureLoaded();
    const session = this.#findSession(token);
    const user = this.users.find((candidate) => {
      return candidate.userId === session.userId;
    });
    if (!user) {
      throw new AuthStoreError(401, "SESSION_INVALID", "登录状态已失效");
    }

    const normalized = normalizeProfile(input, user);
    Object.assign(user, normalized, {
      updatedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    });
    this.#persist();
    return publicAccount(user);
  }

  getWardrobe(token) {
    this.#ensureLoaded();
    const user = this.#userForToken(token);
    user.lastActiveAt = new Date().toISOString();
    this.#persist();
    return cloneWardrobe(user.wardrobe ?? emptyWardrobe());
  }

  updateWardrobe(token, input) {
    this.#ensureLoaded();
    const user = this.#userForToken(token);
    user.wardrobe = normalizeWardrobe(input);
    user.updatedAt = new Date().toISOString();
    user.lastActiveAt = user.updatedAt;
    this.#persist();
    return cloneWardrobe(user.wardrobe);
  }

  updatePhotoReference(token, kind, imageUrl) {
    this.#ensureLoaded();
    const user = this.#userForToken(token);
    if (!["front", "side", "back", "avatar"].includes(kind)) {
      throw new AuthStoreError(400, "INVALID_PHOTO_KIND", "照片类型无效");
    }
    if (
      typeof imageUrl !== "string" ||
      !imageUrl.startsWith("supabase://user-photos/") ||
      imageUrl.length > 2048
    ) {
      throw new AuthStoreError(400, "INVALID_PHOTO_URL", "照片地址无效");
    }
    if (kind === "avatar") {
      user.avatar = imageUrl;
    } else {
      user.bodyPhotos = {...(user.bodyPhotos || {}), [kind]: imageUrl};
    }
    user.updatedAt = new Date().toISOString();
    user.lastActiveAt = user.updatedAt;
    this.#persist();
    return imageUrl;
  }

  logout(token) {
    this.#ensureLoaded();
    const tokenHash = hashToken(token);
    this.sessions = this.sessions.filter((session) => {
      return session.tokenHash !== tokenHash;
    });
    this.#persist();
  }

  deleteAccount(token) {
    this.#ensureLoaded();
    const user = this.#userForToken(token);
    this.users = this.users.filter((candidate) => {
      return candidate.userId !== user.userId;
    });
    this.sessions = this.sessions.filter((session) => {
      return session.userId !== user.userId;
    });
    this.#persist();
    return {userId: user.userId};
  }

  getStats() {
    this.#ensureLoaded();
    const activeSince = Date.now() - 24 * 60 * 60 * 1000;
    return {
      userCount: this.users.length,
      activeUsers: this.users.filter((user) => {
        return Date.parse(user.lastActiveAt) >= activeSince;
      }).length,
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
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.users = Array.isArray(parsed.users) ? parsed.users : [];
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      this.#dropExpiredSessions();
    } catch (error) {
      throw new AuthStoreError(
        500,
        "USER_STORE_UNAVAILABLE",
        `用户数据无法读取：${error.message}`,
      );
    }
  }

  #createSession(userId, now) {
    this.#dropExpiredSessions();
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + this.sessionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.sessions.push({
      userId,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt,
    });
    return {
      userId,
      token,
      createdAt,
      expiresAt,
      isMock: false,
    };
  }

  #findSession(token) {
    if (typeof token !== "string" || token.length < 20) {
      throw new AuthStoreError(401, "AUTH_REQUIRED", "请先登录");
    }
    this.#dropExpiredSessions();
    const tokenHash = hashToken(token);
    const session = this.sessions.find((candidate) => {
      return candidate.tokenHash === tokenHash;
    });
    if (!session) {
      throw new AuthStoreError(401, "SESSION_INVALID", "登录状态已失效");
    }
    return session;
  }

  #userForToken(token) {
    const session = this.#findSession(token);
    const user = this.users.find((candidate) => {
      return candidate.userId === session.userId;
    });
    if (!user) {
      throw new AuthStoreError(401, "SESSION_INVALID", "登录状态已失效");
    }
    return user;
  }

  #dropExpiredSessions() {
    const now = Date.now();
    this.sessions = this.sessions.filter((session) => {
      return Date.parse(session.expiresAt) > now;
    });
  }

  #persist() {
    const state = this.#state();
    if (this.persistence && this.persistenceStatus === "ready") {
      this.pendingPersistence = this.pendingPersistence.catch(() => {}).then(() => {
        return this.persistence.save(state);
      }).then(() => {
        this.persistenceDirty = false;
      }).catch((error) => {
        this.persistenceDirty = true;
        this.#markPersistenceDegraded(error);
        throw error;
      });
    } else if (this.persistence) {
      this.persistenceDirty = true;
    }
    if (!this.filePath) {
      return;
    }
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, {recursive: true});
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(state, null, 2),
      {encoding: "utf8", mode: 0o600},
    );
    fs.renameSync(temporaryPath, this.filePath);
  }

  #state() {
    return JSON.parse(JSON.stringify({
      users: this.users,
      sessions: this.sessions,
    }));
  }

  #markPersistenceDegraded(error) {
    this.persistenceStatus = "degraded";
    this.persistenceError = {
      code: error?.code || error?.cause?.code || "SUPABASE_UNAVAILABLE",
      message: String(error?.message || "Supabase unavailable").slice(0, 500),
      details: error?.details || null,
    };
  }
}

function mergeByKey(remote, local, key) {
  const merged = new Map();
  for (const item of [...remote, ...local]) {
    if (item?.[key]) merged.set(item[key], item);
  }
  return [...merged.values()];
}

function emptyWardrobe() {
  return {
    favoriteProducts: [],
    outfitPlans: [],
    tryOnHistory: [],
    aiRecommendationHistory: [],
  };
}

function normalizeWardrobe(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthStoreError(400, "INVALID_WARDROBE", "衣柜数据必须是 JSON 对象");
  }
  const normalized = {};
  const limits = {
    favoriteProducts: 200,
    outfitPlans: 100,
    tryOnHistory: 50,
    aiRecommendationHistory: 100,
  };
  for (const [field, limit] of Object.entries(limits)) {
    const value = input[field] ?? [];
    if (
      !Array.isArray(value) ||
      value.length > limit ||
      value.some((item) => !item || typeof item !== "object" || Array.isArray(item))
    ) {
      throw new AuthStoreError(400, "INVALID_WARDROBE", `${field} 格式无效`);
    }
    normalized[field] = value;
  }
  const encoded = JSON.stringify(normalized);
  if (Buffer.byteLength(encoded, "utf8") > 2 * 1024 * 1024) {
    throw new AuthStoreError(413, "WARDROBE_TOO_LARGE", "衣柜数据不能超过 2 MB");
  }
  return JSON.parse(encoded);
}

function cloneWardrobe(value) {
  return JSON.parse(JSON.stringify(normalizeWardrobe(value)));
}

function publicAccount(user) {
  return {
    userId: user.userId,
    email: user.email,
    phone: user.phone ?? null,
    avatar: user.avatar,
    nickname: user.nickname,
    gender: user.gender,
    height: user.height,
    weight: user.weight,
    age: user.age,
    bodyType: user.bodyType,
    stylePreference: [...user.stylePreference],
    budgetPreference: {
      min: user.budgetMin,
      max: user.budgetMax,
    },
    budgetMin: user.budgetMin,
    budgetMax: user.budgetMax,
    favoriteBrands: [...user.favoriteBrands],
    createdAt: user.createdAt,
  };
}

function normalizeProfile(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      "用户资料必须是 JSON 对象",
    );
  }
  const budget = input.budgetPreference;
  const normalized = {
    avatar: readOptionalString(
      input.avatar ?? input.avatarBase64,
      "avatar",
      8 * 1024 * 1024,
      current.avatar,
    ),
    nickname: readRequiredString(
      input.nickname ?? input.displayName ?? current.nickname,
      "nickname",
      40,
    ),
    gender: readOptionalString(
      input.gender,
      "gender",
      20,
      current.gender,
    ),
    height: readNumber(input.height, "height", 40, 260, current.height),
    weight: readNumber(input.weight, "weight", 10, 500, current.weight),
    age: readNumber(input.age, "age", 13, 120, current.age, true),
    bodyType: readRequiredString(
      input.bodyType ?? current.bodyType,
      "bodyType",
      60,
    ),
    stylePreference: readStringList(
      input.stylePreference ?? input.likedStyles,
      "stylePreference",
      current.stylePreference,
    ),
    budgetMin: readNumber(
      input.budgetMin ?? budget?.min,
      "budgetMin",
      0,
      1_000_000,
      current.budgetMin,
    ),
    budgetMax: readNumber(
      input.budgetMax ?? budget?.max,
      "budgetMax",
      0,
      1_000_000,
      current.budgetMax,
    ),
    favoriteBrands: readStringList(
      input.favoriteBrands,
      "favoriteBrands",
      current.favoriteBrands,
    ),
  };
  if (normalized.budgetMin > normalized.budgetMax) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      "最低预算不能高于最高预算",
    );
  }
  return normalized;
}

function readRequiredString(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      `${field} 必须是 1-${maxLength} 个字符`,
    );
  }
  return value.trim();
}

function readOptionalString(value, field, maxLength, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      `${field} 格式无效`,
    );
  }
  return value;
}

function readNumber(value, field, min, max, fallback, integer = false) {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      `${field} 必须在 ${min}-${max} 之间`,
    );
  }
  return integer ? Math.round(number) : number;
}

function readStringList(value, field, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((item) => {
      return typeof item !== "string" || item.trim().length > 40;
    })
  ) {
    throw new AuthStoreError(
      400,
      "INVALID_PROFILE",
      `${field} 格式无效`,
    );
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function validateEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    throw new AuthStoreError(400, "INVALID_EMAIL", "请输入有效邮箱");
  }
  return email;
}

function validatePhone(value) {
  const phone = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  if (!/^\+?[0-9]{7,15}$/.test(phone)) {
    throw new AuthStoreError(400, "INVALID_PHONE", "请输入有效手机号");
  }
  return phone;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new AuthStoreError(
      400,
      "INVALID_PASSWORD",
      "密码长度必须为 8-128 位",
    );
  }
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey.toString("hex"));
      }
    });
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "", "hex");
  const rightBuffer = Buffer.from(right || "", "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  return leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readBearerToken(header) {
  if (typeof header !== "string") {
    return "";
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? "";
}

module.exports = {
  AuthStore,
  AuthStoreError,
  readBearerToken,
};
