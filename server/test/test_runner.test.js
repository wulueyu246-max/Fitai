"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createTestBatches,
  runTestBatch,
} = require("../scripts/run-tests");

test("test batches isolate index.test.js without dropping POSIX or Windows paths", () => {
  const cases = [
    {
      pathApi: path.posix,
      files: [
        "/repo/server/test/alpha.test.js",
        "/repo/server/test/index.test.js",
        "/repo/server/test/zeta.test.js",
      ],
    },
    {
      pathApi: path.win32,
      files: [
        "C:\\repo\\server\\test\\alpha.test.js",
        "C:\\repo\\server\\test\\index.test.js",
        "C:\\repo\\server\\test\\zeta.test.js",
      ],
    },
  ];

  for (const {pathApi, files} of cases) {
    const batches = createTestBatches(files, {pathApi});
    assert.deepEqual(batches[0], [files[1]]);
    assert.deepEqual(batches[1], [files[0], files[2]]);
    assert.deepEqual(batches.flat().sort(), [...files].sort());
  }
});

test("test batch execution uses the Node executable without a shell", () => {
  const calls = [];
  const status = runTestBatch(["C:\\repo\\test\\index.test.js"], {
    executable: "node-under-test",
    workingDirectory: "C:\\repo",
    spawn(command, args, options) {
      calls.push({command, args, options});
      return {status: 0};
    },
  });

  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "node-under-test");
  assert.deepEqual(calls[0].args, [
    "--test",
    "C:\\repo\\test\\index.test.js",
  ]);
  assert.equal(calls[0].options.cwd, "C:\\repo");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, "inherit");
});
