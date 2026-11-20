import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.mjs";
import { isMarkdownOnly, planJobs, planProblems } from "../src/plan.mjs";
import { CONFIG, PLANNED, WORKSPACES } from "./helpers.mjs";

function selected(changedFiles, extra = {}, config = CONFIG) {
  const plan = planJobs(config, {
    event: "pull_request",
    baseRef: "develop",
    changedFiles,
    workspaces: WORKSPACES,
    ...extra,
  });
  return {
    mode: plan.mode,
    jobs: Object.entries(plan.jobs)
      .filter(([, run]) => run)
      .map(([job]) => job)
      .sort(),
  };
}

describe("plan", () => {
  it("runs no planned job for files no job reads", () => {
    assert.deepEqual(selected(["docs/a.md", ".env.example", "scripts/ci/x.mjs"]), {
      mode: "impact",
      jobs: [],
    });
  });

  it("follows the workspace graph transitively", () => {
    assert.deepEqual(selected(["packages/shared/index.ts"]).jobs, ["test-api", "test-web"]);
    assert.deepEqual(selected(["packages/ui/button.tsx"]).jobs, ["test-web"]);
    assert.deepEqual(selected(["apps/worker/main.py"]).jobs, ["worker"]);
  });

  it('gives the "*" job only workspaces no other job names', () => {
    assert.deepEqual(selected(["apps/api/a.ts"]).jobs, ["test-api"]);
    assert.deepEqual(selected(["apps/web/a.tsx"]).jobs, ["test-web"]);
  });

  it("selects path jobs and the workspaces that read a path", () => {
    assert.deepEqual(selected(["db/migrations/0001.sql"]).jobs, ["migrations", "test-api"]);
    assert.deepEqual(selected(["db/seed.sql"]).jobs, ["test-api"]);
    assert.deepEqual(selected(["scripts/db/run.ts"]).jobs, ["migrations"]);
  });

  it("runs everything for a file nothing places, and says which", () => {
    const plan = planJobs(CONFIG, {
      event: "pull_request",
      baseRef: "develop",
      changedFiles: ["docs/a.md", "pnpm-lock.yaml"],
      workspaces: WORKSPACES,
    });
    assert.equal(plan.mode, "full");
    assert.equal(plan.reason, "outside any mapped path: pnpm-lock.yaml");
    assert.deepEqual(selected(["tools/new.ts"]), { mode: "full", jobs: PLANNED });
  });

  it("runs everything on a release, a push, any other event or without a base", () => {
    assert.deepEqual(selected(["docs/a.md"], { baseRef: "main" }), { mode: "full", jobs: PLANNED });
    assert.equal(selected(["docs/a.md"], { event: "push", baseRef: "develop" }).mode, "full");
    assert.equal(selected(["docs/a.md"], { event: "push", baseRef: "main" }).mode, "full");
    for (const event of ["workflow_dispatch", "schedule", "merge_group", "pull_request_target", ""]) {
      assert.equal(selected(["docs/a.md"], { event }).mode, "full", event);
    }
    assert.deepEqual(selected(null), { mode: "full", jobs: PLANNED });
  });

  it("runs nothing on a draft or a conflict, whatever changed", () => {
    assert.deepEqual(selected(["pnpm-lock.yaml"], { draft: true }), { mode: "draft", jobs: [] });
    assert.equal(selected(["docs/a.md"], { draft: true, baseRef: "main" }).mode, "draft");
    assert.deepEqual(selected(["apps/api/a.ts"], { conflict: true }), { mode: "conflict", jobs: [] });
    assert.equal(selected([], { conflict: true, baseRef: "main" }).mode, "conflict");
    assert.equal(selected([], { conflict: true, draft: true }).mode, "draft");
    assert.equal(selected(["docs/a.md"], { event: "push", baseRef: "main", conflict: true }).mode, "full");
  });

  describe("Markdown only", () => {
    const markdown = ["docs/a.md", "README.md", "apps/api/README.md", "packages/ui/CHANGELOG.markdown"];

    it("skips everything, even the always-run jobs", () => {
      assert.deepEqual(selected(markdown), { mode: "markdown", jobs: [] });
      assert.equal(
        planJobs(CONFIG, { event: "pull_request", baseRef: "develop", changedFiles: ["docs/a.md"] }).reason,
        "Markdown only: docs/a.md"
      );
    });

    it("doesn't count excluded Markdown, other files or an empty change", () => {
      assert.equal(selected(["apps/web/content/guide.md"]).mode, "impact");
      assert.equal(selected([...markdown, ".env.example"]).mode, "impact");
      assert.equal(selected(["docs/a.mdx"]).mode, "impact");
      assert.equal(selected([]).mode, "impact");
    });

    it("never applies to a release, a push, a draft, a conflict or another event", () => {
      assert.equal(selected(markdown, { baseRef: "main" }).mode, "full");
      assert.equal(selected(markdown, { event: "push", baseRef: "develop" }).mode, "full");
      assert.equal(selected(markdown, { draft: true }).mode, "draft");
      assert.equal(selected(markdown, { conflict: true }).mode, "conflict");
      assert.equal(selected(markdown, { event: "workflow_dispatch" }).mode, "full");
    });

    it("is off unless configured", () => {
      const off = normalizeConfig({ jobs: { test: { paths: ["src/**"] } }, noImpact: ["*.md"] });
      assert.equal(isMarkdownOnly(off, ["README.md"]), false);
      assert.equal(selected(["README.md"], {}, off).mode, "impact");
    });
  });

  describe("re-merge of a tested head", () => {
    const previous = "a".repeat(40);
    const code = ["apps/api/a.ts", "apps/web/b.tsx"];
    const remerge = (edited) => ({ remerge: { previous, edited } });

    it("runs nothing when the hand edits select no job", () => {
      assert.deepEqual(selected(code, remerge(["docs/API.md"])), { mode: "remerge", jobs: [] });
      assert.deepEqual(selected(code, remerge([])), { mode: "remerge", jobs: [] });
      const plan = planJobs(CONFIG, {
        event: "pull_request",
        baseRef: "develop",
        changedFiles: code,
        workspaces: WORKSPACES,
        remerge: { previous, edited: ["docs/API.md", "CHANGELOG.md"] },
      });
      assert.equal(
        plan.reason,
        "re-merge of aaaaaaaaa, which passed CI, with develop; edited by hand: docs/API.md, CHANGELOG.md"
      );
    });

    it("plans the whole change when a hand edit selects a job or nothing places it", () => {
      assert.deepEqual(selected(code, remerge(["apps/web/b.tsx"])), {
        mode: "impact",
        jobs: ["test-api", "test-web"],
      });
      assert.equal(selected([...code, "pnpm-lock.yaml"], remerge(["pnpm-lock.yaml"])).mode, "full");
    });

    it("never skips a release, a draft, a conflict or a push", () => {
      assert.equal(selected(code, { ...remerge([]), baseRef: "main" }).mode, "full");
      assert.equal(selected(code, { ...remerge([]), draft: true }).mode, "draft");
      assert.equal(selected(code, { ...remerge([]), conflict: true }).mode, "conflict");
      assert.equal(selected(code, { ...remerge([]), event: "push", baseRef: "main" }).mode, "full");
    });
  });
});

describe("plan problems", () => {
  const READY = { event: "pull_request", baseRef: "develop", draft: false };
  const outputs = (mode, run = []) => ({
    mode,
    reason: "test",
    ...Object.fromEntries(PLANNED.map((job) => [job, String(run.includes(job))])),
  });

  it("accepts what the planner produces", () => {
    for (const [mode, context] of [
      ["impact", READY],
      ["markdown", READY],
      ["remerge", READY],
      ["conflict", READY],
      ["draft", { ...READY, draft: true }],
    ]) {
      assert.deepEqual(planProblems(CONFIG, outputs(mode), context), [], mode);
    }
    assert.deepEqual(planProblems(CONFIG, outputs("full", PLANNED), { ...READY, baseRef: "main" }), []);
  });

  it("refuses malformed outputs", () => {
    assert.deepEqual(planProblems(CONFIG, undefined, READY), ["no outputs"]);
    assert.match(planProblems(CONFIG, { ...outputs("impact"), mode: "fast" }, READY)[0], /mode is "fast"/);
    assert.match(planProblems(CONFIG, { ...outputs("impact"), worker: "yes" }, READY)[0], /worker is "yes"/);
  });

  it("refuses a plan that contradicts its event", () => {
    const expect = (mode, run, context, message) =>
      assert.match(planProblems(CONFIG, outputs(mode, run), context).join("; "), message);
    expect("draft", [], READY, /isn't a draft/);
    expect("impact", [], { ...READY, baseRef: "main" }, /must run every job/);
    expect("markdown", [], { ...READY, baseRef: "main" }, /must run every job/);
    expect("markdown", ["worker"], READY, /a markdown plan selects worker/);
    expect("remerge", [], { event: "push", baseRef: "develop", draft: false }, /must run every job/);
    expect("full", ["worker"], READY, /a full plan skips/);
    expect("full", PLANNED, { ...READY, draft: true }, /full for a draft/);
    expect("conflict", [], { event: "push", baseRef: "main", draft: false }, /isn't a ready pull request/);
    expect("impact", [], { event: "workflow_dispatch", baseRef: "develop", draft: false }, /must run every job/);
  });

  it("refuses a mode the config turned off", () => {
    const off = normalizeConfig({ jobs: { test: { paths: ["src/**"] } } });
    const out = { mode: "markdown", reason: "x", test: "false" };
    assert.match(planProblems(off, out, READY).join(), /markdownOnly is off/);
    assert.match(planProblems(off, { ...out, mode: "remerge" }, READY).join(), /remerge is off/);
  });
});
