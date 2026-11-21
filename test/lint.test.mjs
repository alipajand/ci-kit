import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { normalizeConfig } from "../src/config.mjs";
import { RULES, lintRepository, lintWorkflow } from "../src/lint.mjs";
import { needsList, readWorkflow } from "../src/workflow.mjs";

const ROOT = join(import.meta.dirname, "..");
const SHA = "a".repeat(40);
const TEMPLATE = readFileSync(join(ROOT, "templates/.github/workflows/ci.yml"), "utf8");
const TEMPLATE_CONFIG = normalizeConfig(
  JSON.parse(readFileSync(join(ROOT, "templates/.github/ci-kit.json"), "utf8"))
);

const rules = (text, config = null) =>
  lintWorkflow(".github/workflows/x.yml", text, config).map((f) => f.rule);

const GOOD = `name: x
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions:
  contents: read
concurrency:
  group: x
jobs:
  build:
    if: github.event.pull_request.draft != true
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@${SHA} # v6
        with:
          persist-credentials: false
      - uses: ./local
      - uses: $/local
      - uses: docker://alpine@sha256:${"b".repeat(64)}
`;

describe("workflow reader", () => {
  it("reads triggers, types, jobs and needs in every form", () => {
    const wf = readWorkflow(`on: [push, pull_request]
jobs:
  a:
    runs-on: x
  b:
    needs: a
  c:
    needs: [a, "b"]
  d:
    needs:
      [
        a,
        c,
      ]
  e:
    needs:
      - a
      - d
`);
    assert.deepEqual([...wf.triggers], ["push", "pull_request"]);
    const needs = Object.fromEntries(wf.jobs.map((job) => [job.id, needsList(job.keys.get("needs"))]));
    assert.deepEqual(needs, { a: [], b: ["a"], c: ["a", "b"], d: ["a", "c"], e: ["a", "d"] });
    const block = readWorkflow(`"on":\n  pull_request:\n    types:\n      - opened\n  workflow_dispatch:\n`);
    assert.deepEqual([...block.triggers], ["pull_request", "workflow_dispatch"]);
    assert.deepEqual(block.triggerTypes.get("pull_request"), ["opened"]);
  });
});

describe("lint rules", () => {
  it("documents every rule it reports", () => {
    for (const rule of Object.keys(RULES)) {
      assert.ok(RULES[rule].length > 10, rule);
    }
  });

  it("passes a workflow that follows the rules", () => {
    assert.deepEqual(rules(GOOD), []);
  });

  it("requires permissions, concurrency and timeouts", () => {
    assert.deepEqual(rules(GOOD.replace("permissions:\n  contents: read\n", "")), ["permissions"]);
    assert.deepEqual(rules(GOOD.replace("concurrency:\n  group: x\n", "")), ["concurrency"]);
    assert.deepEqual(rules(GOOD.replace("    timeout-minutes: 5\n", "")), ["timeout"]);
    // A called workflow needs no concurrency of its own: the caller's would be cancelled.
    const called = GOOD.replace(/on:\n(?: {2,}.*\n)+/, "on:\n  workflow_call:\n").replace("concurrency:\n  group: x\n", "");
    assert.deepEqual(rules(called), []);
  });

  it("requires pinned actions and images", () => {
    assert.deepEqual(rules(GOOD.replace(`checkout@${SHA}`, "checkout@v6")), ["pinned-uses"]);
    assert.deepEqual(rules(GOOD.replace(/alpine@sha256:\w+/, "alpine:3")), ["pinned-uses"]);
  });

  it("requires persist-credentials: false on every checkout", () => {
    assert.deepEqual(rules(GOOD.replace("persist-credentials: false", "fetch-depth: 0")), ["checkout-credentials"]);
    assert.deepEqual(rules(GOOD.replace("persist-credentials: false", "persist-credentials: true")), ["checkout-credentials"]);
  });

  it("requires ready_for_review when drafts are skipped", () => {
    assert.deepEqual(rules(GOOD.replace(", ready_for_review", "")), ["draft-ready"]);
  });

  it("honours an inline ignore with its reason", () => {
    const ignored = GOOD.replace(
      `      - uses: actions/checkout@${SHA} # v6`,
      `      # ci-kit-ignore: pinned-uses (trusted first-party tag, reviewed)\n      - uses: actions/checkout@v6`
    );
    assert.deepEqual(rules(ignored), []);
  });
});

describe("plan wiring", () => {
  it("passes the template", () => {
    assert.deepEqual(lintWorkflow("t.yml", TEMPLATE, TEMPLATE_CONFIG), []);
  });

  const broken = (from, to) => {
    assert.ok(TEMPLATE.includes(from), from);
    return lintWorkflow("t.yml", TEMPLATE.replace(from, to), TEMPLATE_CONFIG).map((f) => `${f.rule}: ${f.message}`);
  };

  it("requires the plan job to expose mode and every planned job", () => {
    assert.match(broken("      mode: ${{ steps.plan.outputs.mode }}\n", "").join(), /expose output `mode`/);
    assert.match(
      broken("      migrations: ${{ fromJSON(steps.plan.outputs.jobs)['migrations'] }}\n", "").join(),
      /plan-job: .*migrations/
    );
  });

  it("requires every planned job's guard to fail open", () => {
    const guard = "needs.changes.result != 'success' || needs.changes.outputs.test-api != 'false'";
    assert.match(broken(guard, "needs.changes.outputs.test-api != 'false'").join(), /plan-guard: .*must run when the plan fails/);
    assert.match(broken(guard, "needs.changes.result != 'success'").join(), /plan-guard: .*outputs\.test-api != 'false'/);
    assert.match(
      broken("${{ !cancelled() && github.event.pull_request.draft != true && (needs.changes.result != 'success' || needs.changes.outputs.migrations", "${{ github.event.pull_request.draft != true && (needs.changes.result != 'success' || needs.changes.outputs.migrations").join(),
      /plan-guard: Job `migrations` its `if:` lacks `!cancelled\(\)`/
    );
  });

  it("requires the always-run job to run when the plan failed", () => {
    assert.match(
      broken("(needs.changes.result != 'success' || needs.changes.outputs.mode != 'markdown')", "needs.changes.outputs.mode != 'markdown'").join(),
      /always-run: /
    );
  });

  it("requires the result job to run always() and need every job", () => {
    assert.match(broken("    if: always()\n    needs: [changes, build,", "    needs: [changes, build,").join(), /result-job: .*always\(\)/);
    assert.match(broken("needs: [changes, build, agents, test-api, test-web, migrations, e2e]", "needs: [changes, build, agents, test-api, test-web, migrations]").join(), /result-job: .*`e2e`/);
  });

  it("requires every configured job to exist", () => {
    const config = normalizeConfig({ ...JSON.parse(readFileSync(join(ROOT, "templates/.github/ci-kit.json"), "utf8")), alwaysRun: ["build", "typecheck"] });
    assert.match(lintWorkflow("t.yml", TEMPLATE, config).map((f) => f.message).join(), /alwaysRun names `typecheck`/);
  });
});

describe("repositories", () => {
  it("passes ci-kit itself and the template", () => {
    assert.deepEqual(lintRepository(ROOT), []);
    assert.deepEqual(lintRepository(join(ROOT, "templates")), []);
  });

  it("reports a broken config, a missing workflow and honours config ignores", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-kit-lint-"));
    mkdirSync(join(dir, ".github/workflows"), { recursive: true });
    writeFileSync(join(dir, ".github/workflows/a.yml"), GOOD.replace("    timeout-minutes: 5\n", ""));
    writeFileSync(join(dir, ".github/ci-kit.json"), "{");
    assert.deepEqual(lintRepository(dir).map((f) => f.rule).sort(), ["config", "timeout"]);
    writeFileSync(
      join(dir, ".github/ci-kit.json"),
      JSON.stringify({ jobs: { t: { paths: ["x"] } }, lint: { ignore: { timeout: [".github/workflows/a.yml"] } } })
    );
    const found = lintRepository(dir);
    assert.deepEqual(found.map((f) => f.rule), ["config-job"]);
    assert.match(found[0].message, /ci\.yml doesn't exist/);
  });
});
