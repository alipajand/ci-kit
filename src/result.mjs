/**
 * The result judge: whether a run's job results honour its plan. Meant to be the one required
 * check of a workflow ("CI result"), because a job skipped by its `if:` reports as passing and a
 * required check can't tell "not needed" from "didn't run".
 *
 * It fails unless:
 * - every always-run job succeeded (skipped is accepted under a usable `markdown` plan, and on a
 *   draft, which fails anyway);
 * - every job the plan selected succeeded, and every other planned job was skipped or succeeded;
 * - without a usable plan (the plan job didn't succeed, or its outputs are malformed or contradict
 *   the event), every planned job succeeded;
 * - the release jobs succeeded on a ready pull request into a full branch, and were skipped
 *   everywhere else; on a manual run the `manual.jobs` succeeded and the other release jobs were
 *   skipped;
 * - a manual run with `pinnedSha` names a full lowercase commit SHA that is the run's own commit;
 * - the pull request isn't a draft and has no merge conflict;
 * - every job in `needs` that the configuration doesn't know succeeded.
 * Cancelled, missing and unknown results never pass.
 */

import { knownJobs } from "./config.mjs";
import { planProblems } from "./plan.mjs";

export const PINNED_SHA = /^[0-9a-f]{40}$/;

/**
 * @param {object} config normalised configuration
 * @param {Record<string, { result?: string, outputs?: Record<string, string> }>} needs
 *   `toJSON(needs)` of the result job
 * @param {{ event: string, baseRef: string, draft: boolean, sha?: string, runSha?: string }} context
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function verifyResults(config, needs, context) {
  const lines = [];
  let ok = true;
  const pullRequest = context.event === "pull_request";
  const isDraft = pullRequest && context.draft;
  const manual = config.manual && context.event === config.manual.event;
  const release = pullRequest && config.fullBranches.includes(context.baseRef);

  if (!needs || typeof needs !== "object") {
    return { ok: false, lines: ["FAIL the job results (needs) are missing or not an object."] };
  }

  if (manual && config.manual.pinnedSha) {
    // Never echo the input unless it is a SHA: it would land in the log and the summary.
    if (!PINNED_SHA.test(context.sha ?? "")) {
      ok = false;
      lines.push("FAIL manual run: the sha input isn't a full 40-character lowercase commit SHA.");
    } else if (context.sha !== context.runSha) {
      ok = false;
      lines.push(
        `FAIL manual run: the sha input ${context.sha} isn't the commit the run started on, where its checks are reported.`
      );
    } else {
      lines.push(`Manual run on ${context.sha}.`);
    }
  }

  const planJob = needs[config.planJob];
  let planned = null;
  if (planJob?.result !== "success") {
    lines.push(`Plan (${config.planJob}): ${planJob?.result ?? "missing"}; every job had to run.`);
  } else {
    const problems = planProblems(config, planJob.outputs, context);
    if (problems.length > 0) {
      lines.push(`Plan: unusable (${problems.join("; ")}); every job had to run.`);
    } else {
      planned = planJob.outputs;
      lines.push(`Plan: ${planned.mode} (${planned.reason || "no reason given"}).`);
    }
  }

  const check = (job, shouldRun, why = "") => {
    const result = needs[job]?.result ?? "missing";
    const good = shouldRun ? result === "success" : result === "skipped" || result === "success";
    if (!good) {
      ok = false;
    }
    lines.push(
      `${good ? "ok  " : "FAIL"} ${job}: ${result} (${shouldRun ? "required" : "not needed"}${why})`
    );
  };
  const mustSkip = (job, why) => {
    const result = needs[job]?.result ?? "missing";
    const good = result === "skipped";
    if (!good) {
      ok = false;
    }
    lines.push(`${good ? "skip" : "FAIL"} ${job}: ${result} (${why})`);
  };

  const markdown = planned?.mode === "markdown";
  for (const job of config.alwaysRun) {
    // A draft fails below whatever ran, so an always-run job may skip itself on a draft.
    check(job, !markdown && !isDraft, markdown ? ", Markdown only" : "");
  }
  for (const job of Object.keys(config.jobs)) {
    check(job, planned ? planned[job] === "true" : !isDraft);
  }
  const conflict = planned?.mode === "conflict";
  for (const job of config.release.jobs) {
    if (manual) {
      if (config.manual.jobs.includes(job)) {
        check(job, true, ", manual run");
      } else {
        mustSkip(job, "a manual run skips it");
      }
      continue;
    }
    check(job, release && !isDraft && !conflict);
  }

  const known = new Set(knownJobs(config));
  for (const job of Object.keys(needs)) {
    if (!known.has(job)) {
      check(job, true, ", not in the ci-kit config");
    }
  }

  if (conflict) {
    ok = false;
    lines.push("FAIL merge conflict: no job ran. Push the resolution, or re-run if the base cleared it.");
  }
  if (isDraft) {
    ok = false;
    lines.push("FAIL draft: CI runs once the pull request is marked ready for review.");
  }
  return { ok, lines };
}
