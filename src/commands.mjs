/**
 * The four commands, shared by the actions (`plan/`, `result/`, `merge-conflict/`, `lint/`) and
 * the `ci-kit` CLI. Each returns an exit code; any thrown error fails the step, which is always
 * the safe direction (a failed plan makes the judge require every job).
 */

import { loadConfig } from "./config.mjs";
import { api, changedFilesBetween, revParse, runContext, setOutputs, summary, workflowPassedOn } from "./github.mjs";
import { lintRepository } from "./lint.mjs";
import { checkMergeConflict } from "./merge-conflict.mjs";
import { planJobs } from "./plan.mjs";
import { findRemerge } from "./remerge.mjs";
import { verifyResults } from "./result.mjs";
import { readWorkspaces } from "./workspaces.mjs";

const log = (line) => process.stdout.write(`${line}\n`);

async function conflictOf(context, token, attempts = 20, intervalMs = 3000) {
  if (context.event !== "pull_request" || !context.prNumber || !context.repository) {
    return { conflict: false, known: false, detail: "not a pull request" };
  }
  return checkMergeConflict({
    attempts,
    intervalMs,
    fetchPull: () => api(`/repos/${context.repository}/pulls/${context.prNumber}`, token),
  });
}

/** The comparison for a pull request: base, head and the pull request's own head commit. */
function pullRequestRange(root, payload) {
  const head = revParse(root, "HEAD");
  const second = revParse(root, "HEAD^2");
  const prHead = payload.pull_request?.head?.sha ?? "";
  if (second && (!prHead || second === prHead)) {
    // The default checkout: GitHub's merge of the head into the base branch's current tip.
    return { base: revParse(root, "HEAD^1"), head, prHead: second, threeDot: false };
  }
  // A checkout of the head itself: compare from the merge base with the base branch.
  return { base: payload.pull_request?.base?.sha ?? "", head, prHead: "", threeDot: true };
}

export async function runPlan({ root, configPath, token, payload, env = process.env }) {
  const config = loadConfig(root, configPath);
  const context = runContext(env, payload);
  let conflict = false;
  if (context.event === "pull_request" && !context.draft) {
    const found = await conflictOf(context, token);
    conflict = found.conflict;
    if (!found.known) {
      log(`::warning::Couldn't tell whether the pull request conflicts (${found.detail}); planning as usual.`);
    }
  }

  let changedFiles = null;
  let remerge = null;
  if (context.event === "pull_request") {
    const range = pullRequestRange(root, payload);
    changedFiles = changedFilesBetween(root, range.base, range.head, { threeDot: range.threeDot });
    if (config.remerge && range.prHead && range.base) {
      const found = await findRemerge({
        root,
        head: range.prHead,
        baseTip: range.base,
        passed: (sha) =>
          workflowPassedOn({
            repository: context.repository,
            workflow: config.remerge.workflow,
            sha,
            token,
          }),
      });
      if (found.previous) {
        remerge = found;
      } else {
        log(`Not a re-merge of a tested head: ${found.why}.`);
      }
    }
  } else if (context.event === "push") {
    changedFiles = changedFilesBetween(root, context.before, context.after);
  }

  const plan = planJobs(config, {
    event: context.event,
    baseRef: context.baseRef,
    draft: context.draft,
    conflict,
    changedFiles,
    workspaces: readWorkspaces(root, config.workspaces),
    remerge,
  });
  setOutputs({ mode: plan.mode, reason: plan.reason, jobs: JSON.stringify(plan.jobs) });
  const rows = Object.entries(plan.jobs).map(([job, run]) => `| ${job} | ${run ? "runs" : "skipped"} |`);
  summary(
    [`### ci-kit plan: \`${plan.mode}\``, "", plan.reason, "", "| Job | Plan |", "| --- | --- |", ...rows].join("\n")
  );
  log(`mode=${plan.mode} (${plan.reason})`);
  return 0;
}

export function runResult({ root, configPath, needsJson, sha, payload, env = process.env }) {
  const config = loadConfig(root, configPath);
  let needs;
  try {
    needs = JSON.parse(needsJson ?? "");
  } catch {
    log("FAIL the job results (needs) are not valid JSON.");
    return 1;
  }
  const context = runContext(env, payload);
  const result = verifyResults(config, needs, { ...context, sha });
  for (const line of result.lines) {
    log(line);
  }
  summary([`### ci-kit result: ${result.ok ? "pass" : "fail"}`, "", "```", ...result.lines, "```"].join("\n"));
  return result.ok ? 0 : 1;
}

export async function runMergeConflict({ token, fail, payload, env = process.env, attempts, intervalMs }) {
  const context = runContext(env, payload);
  if (context.event !== "pull_request") {
    setOutputs({ conflict: "false" });
    return 0;
  }
  const found = await conflictOf(context, token, attempts, intervalMs);
  if (found.conflict) {
    log(
      `::${fail ? "error" : "notice"}::Pull request #${context.prNumber} has a merge conflict (${found.detail}). ` +
        "Push the resolution, or re-run this workflow if the base branch cleared it."
    );
  } else if (!found.known) {
    log(`::warning::Couldn't tell whether #${context.prNumber} conflicts (${found.detail}); continuing.`);
  }
  setOutputs({ conflict: String(found.conflict) });
  return found.conflict && fail ? 1 : 0;
}

export function runLint({ root, configPath }) {
  const findings = lintRepository(root, configPath);
  for (const f of findings) {
    log(`::error file=${f.file}${f.line ? `,line=${f.line}` : ""},title=ci-kit ${f.rule}::${f.message}`);
  }
  if (findings.length === 0) {
    log("ci-kit lint: no findings.");
  } else {
    summary(
      [
        `### ci-kit lint: ${findings.length} finding${findings.length === 1 ? "" : "s"}`,
        "",
        "| Rule | File | Finding |",
        "| --- | --- | --- |",
        ...findings.map((f) => `| ${f.rule} | ${f.file}${f.line ? `:${f.line}` : ""} | ${f.message} |`),
      ].join("\n")
    );
  }
  return findings.length === 0 ? 0 : 1;
}
