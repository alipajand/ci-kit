import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { FIXTURE } from "./helpers.mjs";

const CLI = join(import.meta.dirname, "../bin/ci-kit.mjs");

/** The fixture monorepo as a git repository, checked out as GitHub's merge of a pull request. */
function pullRequestCheckout(changes) {
  const root = mkdtempSync(join(tmpdir(), "ci-kit-cmd-"));
  cpSync(FIXTURE, root, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env }).trim();
  git("init", "-q", "-b", "develop");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "feature");
  for (const [path, text] of Object.entries(changes)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", ".");
  git("commit", "-qm", "change");
  const head = git("rev-parse", "HEAD");
  git("checkout", "-q", "--detach", base);
  git("merge", "-q", "--no-ff", "--no-edit", head);
  return { root, base, head };
}

function run(command, root, { payload, env = {}, args = [] }) {
  const out = mkdtempSync(join(tmpdir(), "ci-kit-out-"));
  const eventPath = join(out, "event.json");
  writeFileSync(eventPath, JSON.stringify(payload));
  writeFileSync(join(out, "output"), "");
  const result = spawnSync(process.execPath, [CLI, command, "--root", root, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: join(out, "output"),
      GITHUB_STEP_SUMMARY: join(out, "summary"),
      ...env,
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(join(out, "output"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  );
  return { status: result.status, stdout: result.stdout, outputs };
}

const pr = (base, head, extra = {}) => ({
  pull_request: { number: 7, draft: false, base: { ref: "develop", sha: base }, head: { sha: head }, ...extra },
});

describe("commands", () => {
  it("plans a pull request from the merge checkout", () => {
    const { root, base, head } = pullRequestCheckout({ "apps/api/a.ts": "a\n" });
    // No GITHUB_REPOSITORY: the conflict and re-merge lookups are skipped, with a warning.
    const result = run("plan", root, { payload: pr(base, head), env: { GITHUB_EVENT_NAME: "pull_request" } });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.outputs.mode, "impact");
    assert.deepEqual(JSON.parse(result.outputs.jobs), { "test-api": true, "test-web": false, worker: false, migrations: false });
    assert.equal(result.outputs.reason, "affects api");
  });

  it("plans a Markdown-only pull request, and a checkout of the head itself", () => {
    const { root, base, head } = pullRequestCheckout({ "docs/guide.md": "# Guide\n" });
    const merged = run("plan", root, { payload: pr(base, head), env: { GITHUB_EVENT_NAME: "pull_request" } });
    assert.equal(merged.outputs.mode, "markdown");
    execFileSync("git", ["checkout", "-q", head], { cwd: root });
    const direct = run("plan", root, { payload: pr(base, head), env: { GITHUB_EVENT_NAME: "pull_request" } });
    assert.equal(direct.outputs.mode, "markdown");
  });

  it("plans everything on a push and fails on a broken config", () => {
    const { root, base, head } = pullRequestCheckout({ "apps/api/a.ts": "a\n" });
    const push = run("plan", root, {
      payload: { before: base, after: head },
      env: { GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "develop" },
    });
    assert.equal(push.outputs.mode, "full");
    writeFileSync(join(root, ".github/ci-kit.json"), "{}");
    const broken = run("plan", root, { payload: pr(base, head), env: { GITHUB_EVENT_NAME: "pull_request" } });
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /::error::ci-kit config: jobs must be an object/);
  });

  it("judges a run through NEEDS", () => {
    const needs = {
      changes: { result: "success", outputs: { mode: "markdown", reason: "x", "test-api": "false", "test-web": "false", worker: "false", migrations: "false" } },
      build: { result: "skipped" },
      "test-api": { result: "skipped" },
      "test-web": { result: "skipped" },
      worker: { result: "skipped" },
      migrations: { result: "skipped" },
      e2e: { result: "skipped" },
      "release-gate": { result: "skipped" },
    };
    const payload = { pull_request: { number: 7, draft: false, base: { ref: "develop" } } };
    const env = { GITHUB_EVENT_NAME: "pull_request", NEEDS: JSON.stringify(needs) };
    assert.equal(run("result", FIXTURE, { payload, env }).status, 0);
    const failed = run("result", FIXTURE, { payload, env: { ...env, NEEDS: JSON.stringify({ ...needs, worker: { result: "failure" } }) } });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /^FAIL worker: failure/m);
    assert.equal(run("result", FIXTURE, { payload, env: { ...env, NEEDS: "nope" } }).status, 1);
  });

  it("reports no conflict outside a pull request, and lint findings with annotations", () => {
    const outside = run("merge-conflict", FIXTURE, { payload: {}, env: { GITHUB_EVENT_NAME: "push" } });
    assert.equal(outside.status, 0);
    assert.equal(outside.outputs.conflict, "false");
    const lint = run("lint", FIXTURE, { payload: {} });
    assert.equal(lint.status, 1);
    assert.match(lint.stdout, /::error file=\.github\/ci-kit\.json,title=ci-kit config-job::/);
  });

  it("prints usage for an unknown command", () => {
    assert.equal(run("nope", FIXTURE, { payload: {} }).status, 2);
  });
});
