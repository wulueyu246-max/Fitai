"use strict";

const fixture = require("../evaluation/golden/human_grounded_whole_look_v1.json");
const {
  runFrozenReplay,
} = require("../evaluation/human_grounded_whole_look_eval_contract");

const result = runFrozenReplay(fixture);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
