const assert = require("node:assert/strict");
const test = require("node:test");

const {ProductClickStore} = require("../product_click_store");

test("records and counts product clicks in local mode", async () => {
  const store = new ProductClickStore();

  await store.record({
    userId: "user-1",
    productId: "coat-001",
    platform: "mock-catalog",
    idempotencyKey: "click-1",
  });
  await store.record({
    userId: "user-2",
    productId: "coat-001",
    platform: "mock-catalog",
    idempotencyKey: "click-2",
  });

  assert.equal(await store.countForProduct("coat-001"), 2);
  assert.equal(await store.countForProduct("shoe-001"), 0);
});

test("does not count a retried click event twice", async () => {
  const store = new ProductClickStore();
  const event = {
    userId: "user-1",
    productId: "coat-001",
    platform: "mock-catalog",
    idempotencyKey: "same-event-id",
  };

  const first = await store.record(event);
  const retry = await store.record(event);

  assert.equal(first.id, retry.id);
  assert.equal(await store.countForProduct("coat-001"), 1);
});
