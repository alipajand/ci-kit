import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(import.meta.dirname, "..");

describe("action metadata", () => {
  // The runner evaluates `${{ }}` anywhere in action.yml, descriptions included, and refuses to
  // load the action when the expression names a context it doesn't have (steps, needs).
  for (const action of ["plan", "result", "merge-conflict", "lint"]) {
    it(`${action}/action.yml uses expressions only in defaults`, () => {
      const lines = readFileSync(join(ROOT, action, "action.yml"), "utf8").split("\n");
      const bad = lines.filter((line) => line.includes("${{") && !/^\s*default: \$\{\{ github\.token \}\}$/.test(line));
      assert.deepEqual(bad, []);
    });
  }
});
