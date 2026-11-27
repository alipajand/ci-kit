import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.mjs";
import { verifyResults } from "../src/result.mjs";
import { CONFIG, PLANNED } from "./helpers.mjs";

const success = { result: "success" };
const skipped = { result: "skipped" };
const failure = { result: "failure" };
const cancelled = { result: "cancelled" };
const READY = { event: "pull_request", baseRef: "develop", draft: false };
const DRAFT = { ...READY, draft: true };
const RELEASE = { ...READY, baseRef: "main" };
const SHA = "b".repeat(40);
const MANUAL = { event: "workflow_dispatch", baseRef: "develop", draft: false, sha: SHA, runSha: SHA };
const RELEASE_JOBS = CONFIG.release.jobs;

const plan = (mode, run = []) => ({
  result: "success",
  outputs: { mode, reason: "test", ...Object.fromEntries(PLANNED.map((j) => [j, String(run.includes(j))])) },
});
const needs = (changes, results = {}) => ({
  changes,
  build: success,
  ...Object.fromEntries([...PLANNED, ...RELEASE_JOBS].map((job) => [job, skipped])),
  ...results,
});
const ran = (jobs) => Object.fromEntries(jobs.map((job) => [job, success]));
const verdict = (n, context) => {
  const result = verifyResults(CONFIG, n, context);
  return { ok: result.ok, text: result.lines.join("\n") };
};

describe("result", () => {
  describe("ordinary pull requests", () => {
    it("passes when every planned job succeeded and the rest were skipped", () => {
      const result = verdict(needs(plan("impact", ["worker"]), ran(["worker"])), READY);
      assert.equal(result.ok, true, result.text);
      assert.match(result.text, /^Plan: impact \(test\)\.$/m);
    });

    it("fails when a planned job was skipped, failed, cancelled or is missing", () => {
      for (const outcome of [skipped, failure, cancelled]) {
        assert.equal(verdict(needs(plan("impact", ["worker"]), { worker: outcome }), READY).ok, false);
      }
      const missing = needs(plan("impact", ["worker"]), { worker: success });
      delete missing.worker;
      assert.equal(verdict(missing, READY).ok, false);
    });

    it("fails when a job the plan skipped ran and failed, or when the build failed", () => {
      assert.equal(verdict(needs(plan("impact"), { worker: failure }), READY).ok, false);
      assert.equal(verdict(needs(plan("impact"), { build: failure }), READY).ok, false);
      assert.equal(verdict(needs(plan("impact"), { build: skipped }), READY).ok, false);
    });

    it("fails when a release job ran outside a release", () => {
      for (const job of RELEASE_JOBS) {
        assert.equal(verdict(needs(plan("impact"), { [job]: failure }), READY).ok, false, job);
      }
    });

    it("requires every job when the plan failed or is unusable", () => {
      const failed = verdict(needs({ result: "failure" }), READY);
      assert.equal(failed.ok, false);
      assert.match(failed.text, /^Plan \(changes\): failure; every job had to run\.$/m);
      const all = needs({ result: "failure" }, ran(PLANNED));
      assert.equal(verdict(all, READY).ok, true);
      const bad = verdict(needs(plan("full", ["worker"]), ran(["worker"])), READY);
      assert.equal(bad.ok, false);
      assert.match(bad.text, /unusable \(a full plan skips/);
    });

    it("requires success from a job the config doesn't know", () => {
      assert.equal(verdict(needs(plan("impact"), { extra: skipped }), READY).ok, false);
      const result = verdict(needs(plan("impact"), { extra: success }), READY);
      assert.equal(result.ok, true, result.text);
      assert.match(result.text, /extra: success \(required, not in the ci-kit config\)/);
    });

    it("refuses needs that aren't an object", () => {
      assert.equal(verifyResults(CONFIG, null, READY).ok, false);
    });
  });

  describe("exactPlan", () => {
    const exact = normalizeConfig({ ...CONFIG, exactPlan: true });
    it("requires a boolean in the configuration", () => {
      assert.throws(() => normalizeConfig({ ...CONFIG, exactPlan: "false" }), /exactPlan must be a boolean/);
    });
    it("accepts a selected success and an explicit skip for every deselected job", () => {
      const good = needs(plan("impact", ["worker"]), ran(["worker"]));
      assert.equal(verifyResults(exact, good, READY).ok, true);
      const extra = { ...good, [PLANNED.find((id) => id !== "worker")]: success };
      assert.equal(verifyResults(CONFIG, extra, READY).ok, true);
      assert.equal(verifyResults(exact, extra, READY).ok, false);
    });

    it("refuses a missing, failed or unusable plan even if every workload succeeded", () => {
      for (const changes of [undefined, failure, plan("full", ["worker"])]) {
        const all = needs(changes, ran(PLANNED));
        assert.equal(verifyResults(CONFIG, all, READY).ok, true);
        assert.equal(verifyResults(exact, all, READY).ok, false);
      }
    });
  });

  describe("Markdown-only pull requests", () => {
    it("passes with the always-run jobs skipped", () => {
      const result = verdict(needs(plan("markdown"), { build: skipped }), READY);
      assert.equal(result.ok, true, result.text);
      assert.match(result.text, /^ok {3}build: skipped \(not needed, Markdown only\)$/m);
    });

    it("fails when a job that ran anyway failed", () => {
      assert.equal(verdict(needs(plan("markdown"), { build: failure }), READY).ok, false);
    });

    it("discards a markdown plan on a release", () => {
      const result = verdict(needs(plan("markdown"), { build: skipped, ...ran(RELEASE_JOBS) }), RELEASE);
      assert.equal(result.ok, false);
      assert.match(result.text, /mode markdown for an event that must run every job/);
    });
  });

  describe("pull requests into a full branch", () => {
    const FULL = needs(plan("full", PLANNED), ran([...PLANNED, ...RELEASE_JOBS]));

    it("passes when every job and every release job passed", () => {
      const result = verdict(FULL, RELEASE);
      assert.equal(result.ok, true, result.text);
    });

    it("fails when a release job failed or was skipped", () => {
      for (const job of RELEASE_JOBS) {
        for (const outcome of [failure, skipped, cancelled]) {
          assert.equal(verdict({ ...FULL, [job]: outcome }, RELEASE).ok, false, `${job} ${outcome.result}`);
        }
      }
    });
  });

  describe("drafts and conflicts", () => {
    it("always fails a draft and says why", () => {
      const result = verdict(needs({ result: "skipped" }, { build: failure }), DRAFT);
      assert.equal(result.ok, false);
      assert.match(result.text, /^FAIL draft: /m);
      // Nothing else is reported as missing on a draft.
      assert.doesNotMatch(result.text, /FAIL worker/);
    });

    it("always fails a conflict, into either branch", () => {
      for (const context of [READY, RELEASE]) {
        const result = verdict(needs(plan("conflict"), { build: failure }), context);
        assert.equal(result.ok, false);
        assert.match(result.text, /^FAIL merge conflict/m);
        for (const job of RELEASE_JOBS) {
          assert.match(result.text, new RegExp(`^ok {3}${job}: skipped`, "m"));
        }
      }
    });
  });

  describe("manual runs", () => {
    const FULL = needs(plan("full", PLANNED), { ...ran(PLANNED), e2e: success });

    it("passes with the manual jobs passed and the other release jobs skipped", () => {
      const result = verdict(FULL, MANUAL);
      assert.equal(result.ok, true, result.text);
      assert.match(result.text, /^skip release-gate: skipped \(a manual run skips it\)$/m);
    });

    it("fails unless the other release jobs were skipped", () => {
      assert.equal(verdict({ ...FULL, "release-gate": success }, MANUAL).ok, false);
    });

    it("fails unless the sha is a full SHA and the run's own commit, and never echoes it", () => {
      const bad = verdict(FULL, { ...MANUAL, sha: "main; echo pwned" });
      assert.equal(bad.ok, false);
      assert.doesNotMatch(bad.text, /pwned/);
      const other = verdict(FULL, { ...MANUAL, runSha: "c".repeat(40) });
      assert.equal(other.ok, false);
      assert.match(other.text, /isn't the commit the run started on/);
    });

    it("refuses a plan other than full", () => {
      const result = verdict(needs(plan("impact"), { e2e: success }), MANUAL);
      assert.equal(result.ok, false);
      assert.match(result.text, /must run every job/);
    });
  });
});
