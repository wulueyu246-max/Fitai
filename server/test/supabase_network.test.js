const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDirectSupabaseFetch,
  diagnoseSupabaseConnection,
  getSupabaseErrorDetails,
  normalizeSupabaseUrl,
  resolveSupabaseConfig,
} = require("../supabase_network");

test("normalizes quoted Supabase project URLs and removes one REST suffix", () => {
  assert.equal(
    normalizeSupabaseUrl('  "https://project.supabase.co/rest/v1/"  '),
    "https://project.supabase.co",
  );
  assert.equal(
    resolveSupabaseConfig({SUPABASE_URL: "https://project.supabase.co"}).url,
    "https://project.supabase.co",
  );
});

test("rejects duplicate REST paths without stopping configuration parsing", () => {
  const result = resolveSupabaseConfig({
    SUPABASE_URL: "https://project.supabase.co/rest/v1/rest/v1",
  });
  assert.equal(result.url, "");
  assert.equal(result.errorCode, "SUPABASE_URL_DUPLICATE_REST_PATH");
});

test("direct Supabase fetch always uses its own dispatcher", async () => {
  const dispatcher = {name: "direct-supabase-agent"};
  let received;
  const directFetch = createDirectSupabaseFetch({
    dispatcher,
    timeoutMs: 1000,
    fetchImpl: async (input, init) => {
      received = {input, init};
      return new Response(null, {status: 204});
    },
  });

  await directFetch("https://project.supabase.co");
  assert.equal(received.init.dispatcher, dispatcher);
  assert.ok(received.init.signal instanceof AbortSignal);
});

test("diagnostics report DNS and HTTP status without logging credentials", async () => {
  const logs = [];
  const result = await diagnoseSupabaseConnection({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-secret-value",
    fetchImpl: async (input) => new Response(null, {
      status: String(input).includes("/rest/v1/") ? 200 : 404,
    }),
    lookup: async () => [{address: "203.0.113.1", family: 4}],
    logger: {
      info: (message, details) => logs.push({message, details}),
      error: (message, details) => logs.push({message, details}),
    },
  });

  assert.equal(result.rootStatus, 404);
  assert.equal(result.restStatus, 200);
  assert.equal(result.dns[0].family, 4);
  assert.equal(JSON.stringify(logs).includes("server-only-secret-value"), false);
});

test("network error details preserve the underlying transport cause", () => {
  const cause = Object.assign(new Error("name resolution failed"), {
    name: "ConnectError",
    code: "ENOTFOUND",
    errno: -3008,
    hostname: "project.supabase.co",
  });
  const error = new TypeError("fetch failed", {cause});
  assert.deepEqual(getSupabaseErrorDetails(error), {
    name: "TypeError",
    message: "fetch failed",
    causeName: "ConnectError",
    causeMessage: "name resolution failed",
    code: "ENOTFOUND",
    errno: "-3008",
    hostname: "project.supabase.co",
  });
});
