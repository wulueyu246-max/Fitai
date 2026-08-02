const assert = require("node:assert/strict");
const test = require("node:test");

const {SupabasePersistence} = require("../supabase_persistence");
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
  assert.equal(await storage.deleteUserObjects("user-1"), 1);
  const deletion = calls.find((call) => call.init.method === "DELETE");
  assert.deepEqual(JSON.parse(deletion.init.body).prefixes, [
    "users/user-1/front-one.jpg",
  ]);
});

test("photo parser rejects unsupported content", () => {
  assert.throws(() => parseImageDataUri("data:text/plain;base64,AA=="));
});
