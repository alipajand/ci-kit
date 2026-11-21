// Property-based tests: invariants checked against generated inputs, not hand-picked cases.
// fast-check prints a seed and the smallest failing input when a property breaks; replay it with
// `fc.assert(property, { seed, path })`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { normalizeConfig } from "../src/config.mjs";
import { api } from "../src/github.mjs";
import { globToRegExp, matchesAny } from "../src/glob.mjs";
import { AGENT_INSTRUCTIONS, MODES, isMarkdownOnly, planJobs } from "../src/plan.mjs";
import { verifyResults } from "../src/result.mjs";

const RUNS = { numRuns: 300 };

// A path segment: no `/`, no glob wildcards, but every character a regular expression treats
// specially, so escaping bugs show up.
const segment = fc
  .array(fc.constantFrom(..."abcXYZ019._-+()[]{}^$|\\ é"), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""))
  .filter((text) => text !== "." && text !== "..");
const path = fc.array(segment, { minLength: 1, maxLength: 5 }).map((parts) => parts.join("/"));
const markdownName = segment.map((name) => `${name}.md`);

const CONFIG = normalizeConfig({
  fullBranches: ["main"],
  jobs: {
    api: { paths: ["api/**"] },
    web: { paths: ["web/**"] },
  },
  noImpact: ["docs/**", "*.md"],
  alwaysRun: ["lint"],
  markdownOnly: true,
});
const JOBS = Object.keys(CONFIG.jobs);

describe("properties", () => {
  describe("glob", () => {
    it("a pattern without wildcards matches exactly its own path", () => {
      fc.assert(
        fc.property(path, segment, (p, extra) => {
          const re = globToRegExp(p);
          assert.equal(re.test(p), true);
          assert.equal(re.test(`${p}/${extra}`), false);
          assert.equal(re.test(`${extra}/${p}`), false);
          assert.equal(re.test(`${p}${extra}`), false);
        }),
        RUNS
      );
    });

    it("`dir/` matches everything under dir and nothing under a sibling", () => {
      fc.assert(
        fc.property(segment, path, segment, (dir, rest, suffix) => {
          assert.equal(matchesAny([`${dir}/`], `${dir}/${rest}`), true);
          assert.equal(matchesAny([`${dir}/`], `${dir}${suffix}/${rest}`), false);
        }),
        RUNS
      );
    });

    it("`*` never crosses a `/`, `**/` reaches any depth", () => {
      fc.assert(
        fc.property(path, markdownName, (dir, name) => {
          assert.equal(matchesAny(["*.md"], `${dir}/${name}`), false);
          assert.equal(matchesAny(["*.md"], name), true);
          assert.equal(matchesAny(["**/*.md"], `${dir}/${name}`), true);
        }),
        RUNS
      );
    });
  });

  describe("Markdown-only plans", () => {
    const docs = fc.array(
      fc.tuple(fc.constantFrom("docs", "guides/a", "notes"), markdownName).map(([d, n]) => `${d}/${n}`),
      { minLength: 1, maxLength: 6 }
    );
    const agentFile = fc
      .tuple(
        fc.array(segment, { maxLength: 3 }),
        fc.constantFrom("AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md")
      )
      .map(([dirs, name]) => [...dirs, name].join("/"));

    it("plain Markdown files are Markdown-only, in any order", () => {
      fc.assert(
        fc.property(docs, (files) => {
          assert.equal(isMarkdownOnly(CONFIG, files), true);
          assert.equal(isMarkdownOnly(CONFIG, [...files].reverse()), true);
        }),
        RUNS
      );
    });

    it("an agent instruction file anywhere in the change is never Markdown-only", () => {
      fc.assert(
        fc.property(docs, agentFile, fc.nat(), (files, agent, at) => {
          assert.equal(matchesAny(AGENT_INSTRUCTIONS, agent), true);
          const change = [...files];
          change.splice(at % (change.length + 1), 0, agent);
          assert.equal(isMarkdownOnly(CONFIG, change), false);
        }),
        RUNS
      );
    });

    it("one file that isn't Markdown makes the change not Markdown-only", () => {
      fc.assert(
        fc.property(docs, path, fc.nat(), (files, other, at) => {
          fc.pre(!/\.(md|markdown)$/i.test(other));
          const change = [...files];
          change.splice(at % (change.length + 1), 0, other);
          assert.equal(isMarkdownOnly(CONFIG, change), false);
        }),
        RUNS
      );
    });
  });

  describe("plan", () => {
    const changedFiles = fc.option(
      fc.array(fc.oneof(path, path.map((p) => `api/${p}`), path.map((p) => `web/${p}`)), {
        maxLength: 6,
      }),
      { nil: null }
    );
    const input = fc.record({
      event: fc.constantFrom("pull_request", "push", "schedule", "workflow_dispatch", "merge_group", ""),
      baseRef: fc.constantFrom("main", "develop", "feature", ""),
      draft: fc.boolean(),
      conflict: fc.boolean(),
      changedFiles,
    });

    it("always returns a known mode and a decision for every job", () => {
      fc.assert(
        fc.property(input, (i) => {
          const plan = planJobs(CONFIG, i);
          assert.ok(MODES.includes(plan.mode), plan.mode);
          assert.deepEqual(Object.keys(plan.jobs).sort(), [...JOBS].sort());
        }),
        RUNS
      );
    });

    it("skips a job only on a pull request outside fullBranches", () => {
      fc.assert(
        fc.property(input, (i) => {
          const plan = planJobs(CONFIG, i);
          if (Object.values(plan.jobs).some((run) => !run)) {
            assert.equal(i.event, "pull_request");
            assert.ok(!CONFIG.fullBranches.includes(i.baseRef) || i.draft || i.conflict, plan.reason);
          }
        }),
        RUNS
      );
    });

    it("never skips a job a changed file selects", () => {
      fc.assert(
        fc.property(input, (i) => {
          const plan = planJobs(CONFIG, i);
          if (plan.mode !== "impact") {
            return;
          }
          for (const file of i.changedFiles) {
            for (const job of JOBS) {
              if (matchesAny(CONFIG.jobs[job].paths, file)) {
                assert.equal(plan.jobs[job], true, `${file} selects ${job}`);
              }
            }
          }
        }),
        RUNS
      );
    });
  });

  describe("result", () => {
    const outcome = fc.constantFrom("success", "skipped", "failure", "cancelled", "missing");
    const needs = fc
      .record({
        plan: fc.record({ result: outcome, mode: fc.constantFrom(...MODES), runs: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }) }),
        jobs: fc.dictionary(fc.constantFrom(...JOBS, "lint", "extra"), outcome),
      })
      .map(({ plan, jobs }) => {
        const n = {
          changes: {
            result: plan.result,
            outputs: { mode: plan.mode, reason: "generated", api: String(plan.runs[0]), web: String(plan.runs[1]) },
          },
        };
        for (const [job, result] of Object.entries(jobs)) {
          if (result !== "missing") {
            n[job] = { result };
          }
        }
        return n;
      });
    const context = fc.record({
      event: fc.constantFrom("pull_request", "push"),
      baseRef: fc.constantFrom("main", "develop"),
      draft: fc.boolean(),
    });

    it("fails closed: a failed or cancelled job never passes", () => {
      fc.assert(
        fc.property(needs, context, (n, ctx) => {
          const bad = Object.values(n).some((job) => job.result === "failure" || job.result === "cancelled");
          if (bad) {
            assert.equal(verifyResults(CONFIG, n, ctx).ok, false);
          }
        }),
        RUNS
      );
    });

    it("fails closed: a draft never passes", () => {
      fc.assert(
        fc.property(needs, (n) => {
          const ctx = { event: "pull_request", baseRef: "develop", draft: true };
          assert.equal(verifyResults(CONFIG, n, ctx).ok, false);
        }),
        RUNS
      );
    });
  });

  describe("API client", () => {
    it("refuses any path outside /repos/<owner>/<name>/… before sending a request", async () => {
      const realFetch = globalThis.fetch;
      let sent = 0;
      globalThis.fetch = async () => {
        sent += 1;
        return new Response("{}", { status: 200 });
      };
      try {
        await fc.assert(
          fc.asyncProperty(fc.string({ maxLength: 40 }), async (tail) => {
            const candidates = [
              `/repos/o/r/../${tail}`,
              `/repos/o/r/x#${tail}`,
              `/repos/o/r/x y${tail}`,
              `https://evil.example/repos/o/r/${tail}`,
              `//evil.example/repos/o/r/x${tail}`,
              `/user/${tail}`,
            ];
            if (!tail.startsWith("/repos/")) {
              candidates.push(tail);
            }
            for (const candidate of candidates) {
              await assert.rejects(api(candidate, "token"), /refusing an unexpected API path/, candidate);
            }
          }),
          RUNS
        );
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.equal(sent, 0);
    });
  });
});
