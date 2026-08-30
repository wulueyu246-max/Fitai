"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.PRODUCT_PROVIDER = "mock";
process.env.AI_FORCE_MOCK = "true";
process.env.RENDER = "true";
process.env.ENABLE_AI_RERANKER_LATENCY_PROBE = "false";
process.env.INTERNAL_PROBE_TOKEN =
  "route-test-ai-probe-token-at-least-32-characters";

const {app} = require("../index");

test("registered AI latency probe is hidden when disabled and health stays ready", async () => {
  const originalInfo = console.info;
  console.info = () => {};
  const server = app.listen(0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const probeResponse = await fetch(
      `${baseUrl}/internal/probes/ai-reranker-latency-v1`,
      {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: "{}",
      },
    );
    assert.equal(probeResponse.status, 404);
    assert.deepEqual(await probeResponse.json(), {error: "NOT_FOUND"});

    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).status, "ok");
  } finally {
    console.info = originalInfo;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
