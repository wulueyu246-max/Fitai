"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const SERVER_DIRECTORY = path.resolve(__dirname, "..");
const TEST_DIRECTORY = path.join(SERVER_DIRECTORY, "test");
const ISOLATED_TEST_FILE = "index.test.js";

function listTestFiles(testDirectory = TEST_DIRECTORY) {
  return fs.readdirSync(testDirectory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => path.resolve(testDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function createTestBatches(
  testFiles,
  {isolatedFileName = ISOLATED_TEST_FILE, pathApi = path} = {},
) {
  const isolated = testFiles.filter(
    (testFile) => pathApi.basename(testFile) === isolatedFileName,
  );
  if (isolated.length !== 1) {
    throw new Error(
      `Expected exactly one ${isolatedFileName}; found ${isolated.length}.`,
    );
  }

  const remaining = testFiles.filter(
    (testFile) => pathApi.basename(testFile) !== isolatedFileName,
  );
  return [isolated, remaining].filter((batch) => batch.length > 0);
}

function runTestBatch(
  testFiles,
  {
    spawn = spawnSync,
    executable = process.execPath,
    workingDirectory = SERVER_DIRECTORY,
  } = {},
) {
  const result = spawn(executable, ["--test", ...testFiles], {
    cwd: workingDirectory,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return Number.isInteger(result.status) ? result.status : 1;
}

function main() {
  const batches = createTestBatches(listTestFiles());
  for (const batch of batches) {
    const exitCode = runTestBatch(batch);
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  createTestBatches,
  listTestFiles,
  runTestBatch,
};
