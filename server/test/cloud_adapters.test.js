const assert = require("node:assert/strict");
const test = require("node:test");

const {SupabasePersistence} = require("../supabase_persistence");
const {SupabaseUserPersistence} = require("../supabase_user_persistence");
const {AuthStore} = require("../auth_store");
const {
  SupabaseObjectStorage,
  parseImageDataUri,
} = require("../supabase_storage");

test("cloud persistence uses an isolated record and service credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({url: String(url), init});
    if (init.method === "POST") return new Response(null, {status: 201});
    return Response.json([{payload: {users: [{userId: "user-1"}]}}]);
  };
  const persistence = new SupabasePersistence({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    recordId: "auth",
    fetchImpl,
  });

  assert.equal((await persistence.load()).users[0].userId, "user-1");
  await persistence.save({users: []});
  assert.match(calls[0].url, /id=eq.auth/);
  assert.equal(calls[0].init.headers.apikey, "server-only-key");
  assert.equal(JSON.parse(calls[1].init.body).id, "auth");
});

test("private object storage uploads and deletes user-scoped photos", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({url: String(url), init});
    if (String(url).includes("/object/list/")) {
      return Response.json([{name: "front-one.jpg"}]);
    }
    return new Response(null, {status: 200});
  };
  const storage = new SupabaseObjectStorage({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    fetchImpl,
  });

  const uploaded = await storage.uploadDataUri({
    userId: "user-1",
    kind: "front",
    dataUri: "data:image/jpeg;base64,AA==",
  });
  assert.match(uploaded.objectPath, /^users\/user-1\/front-/);
  assert.match(uploaded.imageUrl, /^supabase:\/\/user-photos\/users\/user-1\/front-/);
  assert.equal(await storage.deleteUserObjects("user-1"), 1);
  const deletion = calls.find((call) => call.init.method === "DELETE");
  assert.deepEqual(JSON.parse(deletion.init.body).prefixes, [
    "users/user-1/front-one.jpg",
  ]);
});

test("photo parser rejects unsupported content", () => {
  assert.throws(() => parseImageDataUri("data:text/plain;base64,AA=="));
});

test("normalized user persistence synchronizes profile wardrobe favorites and history", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({url: String(url), init});
    return new Response(null, {status: init.method === "POST" ? 201 : 204});
  };
  const runtimePersistence = {
    load: async () => ({users: [{userId: "deleted-user"}], sessions: []}),
    save: async (state) => calls.push({runtimeState: state}),
  };
  const persistence = new SupabaseUserPersistence({
    runtimePersistence,
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    fetchImpl,
  });
  await persistence.load();
  await persistence.save({
    sessions: [{tokenHash: "private-session-hash"}],
    users: [{
      userId: "user-1",
      email: "person@example.com",
      nickname: "Person",
      avatar: "data:image/jpeg;base64,AA==",
      gender: "unspecified",
      height: 170,
      weight: 60,
      bodyType: "balanced",
      bodyPhotos: {front: "supabase://user-photos/users/user-1/front.jpg"},
      wardrobe: {
        favoriteProducts: [{
          id: "product-1",
          name: "Shirt",
          imageUrl: "https://example.com/shirt.jpg",
          category: "top",
          color: "white",
          season: "spring",
          brand: "Brand",
        }],
        outfitPlans: [{id: "plan-1", title: "Work outfit"}],
        tryOnHistory: [{id: "try-1", title: "Try on"}],
        aiRecommendationHistory: [{id: "ai-1", prompt: "work"}],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }],
  });

  const postBodies = calls
    .filter((call) => call.init?.method === "POST")
    .map((call) => ({url: call.url, body: JSON.parse(call.init.body)}));
  assert.ok(postBodies.some((call) => call.url.includes("/users?")));
  assert.ok(postBodies.some((call) => call.url.includes("/body_profiles?")));
  assert.ok(postBodies.some((call) => call.url.includes("/wardrobe?")));
  assert.ok(postBodies.some((call) => call.url.includes("/favorites?")));
  assert.ok(postBodies.some((call) => call.url.includes("/history?")));
  const userRow = postBodies.find((call) => call.url.includes("/users?")).body[0];
  assert.equal(userRow.avatar, null, "Base64 avatars must not be persisted");
  const profileRow = postBodies.find(
    (call) => call.url.includes("/body_profiles?"),
  ).body[0];
  assert.equal(
    profileRow.front_image_url,
    "supabase://user-photos/users/user-1/front.jpg",
  );
  assert.ok(calls.some((call) => call.url?.includes("id=eq.deleted-user")));
  assert.equal(
    calls.find((call) => call.url?.includes("/users?"))?.init.headers.apikey,
    "server-only-key",
  );
});

test("auth store degrades on startup and reconnects without exiting", async () => {
  let attempts = 0;
  const persistence = {
    load: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("fetch failed");
        error.code = "ENOTFOUND";
        throw error;
      }
      return {users: [], sessions: []};
    },
    save: async () => {},
  };
  const store = new AuthStore({persistence});

  assert.equal(await store.initialize({allowDegraded: true}), false);
  assert.equal(store.persistenceStatus, "degraded");
  assert.equal(store.persistenceError.code, "ENOTFOUND");
  assert.equal(await store.retryPersistence(), true);
  assert.equal(store.persistenceStatus, "ready");
});
