import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { knownJobs, loadConfig, normalizeConfig } from "../src/config.mjs";
import { CONFIG } from "./helpers.mjs";

const base = { jobs: { test: { paths: ["src/**"] } } };

describe("config", () => {
  it("fills in the defaults", () => {
    const config = normalizeConfig(base);
    assert.equal(config.planJob, "changes");
    assert.equal(config.resultJob, "result");
    assert.deepEqual(config.fullBranches, ["main"]);
    assert.equal(config.markdownOnly, false);
    assert.equal(config.remerge, false);
    assert.equal(config.manual, false);
    assert.deepEqual(config.jobs.test, { workspaces: [], paths: ["src/**"] });
  });

  it("reads the fixture", () => {
    assert.deepEqual(knownJobs(CONFIG), [
      "changes",
      "build",
      "test-api",
      "test-web",
      "worker",
      "migrations",
      "e2e",
      "release-gate",
      "result",
    ]);
    assert.equal(CONFIG.manual.pinnedSha, true);
  });

  it("turns markdownOnly: true into no exclusions", () => {
    assert.deepEqual(normalizeConfig({ ...base, markdownOnly: true }).markdownOnly, { exclude: [] });
  });

  const invalid = [
    [{}, /jobs must be an object/],
    [{ jobs: {} }, /at least one planned job/],
    [{ jobs: { test: {} } }, /selects nothing/],
    [{ jobs: { test: { paths: ["x"], other: 1 } } }, /unknown key "other"/],
    [{ ...base, typo: 1 }, /unknown key "typo"/],
    [{ jobs: { "bad id": { paths: ["x"] } } }, /must be a workflow job id/],
    [{ jobs: { a: { workspaces: ["*"] }, b: { workspaces: ["*"] } } }, /only one job/],
    [{ ...base, alwaysRun: ["test"] }, /both jobs and alwaysRun/],
    [{ ...base, remerge: { workflow: "../x" } }, /remerge must be/],
    [{ ...base, manual: { jobs: ["e2e"] } }, /isn't in release.jobs/],
    [{ ...base, noImpact: [""] }, /non-empty strings/],
    [{ ...base, markdownOnly: "yes" }, /markdownOnly must be/],
    [[], /must be a JSON object/],
  ];
  for (const [raw, message] of invalid) {
    it(`rejects ${JSON.stringify(raw)}`, () => {
      assert.throws(() => normalizeConfig(raw), message);
    });
  }

  it("fails on a missing or malformed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-kit-"));
    assert.throws(() => loadConfig(dir), /cannot read/);
    mkdirSync(join(dir, ".github"));
    writeFileSync(join(dir, ".github/ci-kit.json"), "{ nope");
    assert.throws(() => loadConfig(dir), /not valid JSON/);
  });
});
