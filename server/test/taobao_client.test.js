const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {TaobaoApiClient, signTaobaoRequest} = require("../taobao_client");

test("Taobao client signs official parameters without logging secrets or signatures", async () => {
  let requestBody = "";
  const logs = [];
  const client = new TaobaoApiClient({
    appKey: "public-test-key",
    appSecret: "private-test-secret",
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return new Response(JSON.stringify({ok_response: {}}), {status: 200});
    },
    logger: {info: (...args) => logs.push(args), warn: (...args) => logs.push(args)},
  });
  await client.call("taobao.test.method", {q: "上衣"}, {requestId: "request-1"});
  const body = Object.fromEntries(new URLSearchParams(requestBody));
  const {sign, ...unsigned} = body;
  assert.equal(sign, signTaobaoRequest(unsigned, "private-test-secret"));
  assert.equal(requestBody.includes("private-test-secret"), false);
  const logged = JSON.stringify(logs);
  assert.equal(logged.includes("private-test-secret"), false);
  assert.equal(logged.includes(sign), false);
  assert.equal(logged.includes("public-test-key"), false);
});

test("Taobao client maps permission errors to a safe code without leaking response text", async () => {
  const client = new TaobaoApiClient({
    appKey: "key",
    appSecret: "secret",
    maxRetries: 1,
    fetchImpl: async () => new Response(JSON.stringify({
      error_response: {code: 27, sub_code: "isv.permission-api-package-limit", sub_msg: "sensitive details"},
    }), {status: 200}),
    logger: {warn() {}},
  });
  await assert.rejects(
    () => client.call("taobao.test.method"),
    (error) => error.code === "TAOBAO_PERMISSION_DENIED" && !error.message.includes("sensitive"),
  );
});

test("Flutter source contains no Taobao server credential variables", () => {
  const root = path.resolve(__dirname, "..", "..", "lib");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      if (entry.isFile() && entry.name.endsWith(".dart")) files.push(target);
    }
  };
  visit(root);
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("TAOBAO_APP_SECRET"), false);
  assert.equal(source.includes("TAOBAO_APP_KEY"), false);
});
