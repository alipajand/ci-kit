/**
 * Which planned jobs a change needs, and whether a plan is consistent with its event.
 *
 * Modes, checked in this order:
 * - `draft`: a draft pull request. Selects no job; the always-run job fails on a draft instead.
 * - `conflict`: a ready pull request GitHub can't merge. Selects no job; the run fails.
 * - `full`: every planned job. A pull request into or a push to one of `fullBranches`, any push,
 *   any other event (a schedule, a manual run, a merge queue), a missing comparison base, or a
 *   changed file nothing in the configuration places.
 * - `remerge`: the pull request's head only re-merges an earlier head that passed CI with the base
 *   branch, and the files edited by hand in that merge select no job. Selects no job.
 * - `markdown`: every changed file is Markdown no job builds (`markdownOnly`), and none is an agent
 *   instruction file. Selects no job, and the always-run jobs are skipped too.
 * - `impact`: the jobs the changed files select.
 *
 * Only `impact`, `remerge` and `markdown` can skip work, and only on a ready pull request into a
 * branch outside `fullBranches`. Everything else fails towards running.
 */

import { matchesAny } from "./glob.mjs";
import { ownerOf, withDependents } from "./workspaces.mjs";

export const MODES = ["draft", "conflict", "remerge", "markdown", "full", "impact"];

const MARKDOWN = /\.(md|markdown)$/i;

const allJobs = (config, value) =>
  Object.fromEntries(Object.keys(config.jobs).map((job) => [job, value]));

const list = (paths) => `${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ", …" : ""}`;

/**
 * Agent instruction files. They are Markdown, but an agent acts on them, so a change to one is
 * never Markdown-only: the always-run jobs (where the agent checks live) still run.
 */
export const AGENT_INSTRUCTIONS = [
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/CLAUDE.local.md",
  "**/GEMINI.md",
  ".github/copilot-instructions.md",
  ".github/instructions/",
  ".github/prompts/",
  ".claude/",
  ".cursor/",
  ".windsurf/",
];

/** Whether `changedFiles` is a non-empty list of Markdown files the configuration lets skip CI. */
export function isMarkdownOnly(config, changedFiles) {
  if (!config.markdownOnly || !changedFiles || changedFiles.length === 0) {
    return false;
  }
  return changedFiles.every(
    (path) =>
      MARKDOWN.test(path) &&
      !matchesAny(AGENT_INSTRUCTIONS, path) &&
      !matchesAny(config.markdownOnly.exclude, path)
  );
}

/**
 * @param {object} config normalised configuration
 * @param {{ event: string, baseRef?: string, draft?: boolean, conflict?: boolean,
 *   changedFiles: string[] | null, workspaces?: { name: string, dir: string, deps: string[] }[],
 *   remerge?: { previous: string, edited: string[] } | null }} input
 * @returns {{ mode: string, reason: string, jobs: Record<string, boolean> }}
 */
export function planJobs(config, input) {
  const {
    event,
    baseRef = "",
    draft = false,
    conflict = false,
    changedFiles,
    workspaces = [],
    remerge = null,
  } = input;
  const pullRequest = event === "pull_request";
  if (pullRequest && draft) {
    return { mode: "draft", reason: "draft pull request", jobs: allJobs(config, false) };
  }
  if (pullRequest && conflict) {
    return { mode: "conflict", reason: "merge conflict", jobs: allJobs(config, false) };
  }
  if (config.fullBranches.includes(baseRef) && (pullRequest || event === "push")) {
    const what = pullRequest ? "pull request into" : "push to";
    return { mode: "full", reason: `${what} ${baseRef}`, jobs: allJobs(config, true) };
  }
  if (!pullRequest) {
    return { mode: "full", reason: `${event || "unknown"} event`, jobs: allJobs(config, true) };
  }
  if (!Array.isArray(changedFiles)) {
    return { mode: "full", reason: "no comparison base", jobs: allJobs(config, true) };
  }

  if (remerge) {
    const edits = selectJobs(config, remerge.edited, workspaces);
    if (!edits.unplaced.length && Object.values(edits.jobs).every((run) => !run)) {
      const edited = remerge.edited;
      return {
        mode: "remerge",
        reason: `re-merge of ${remerge.previous.slice(0, 9)}, which passed CI, with ${baseRef}; ${
          edited.length > 0 ? `edited by hand: ${list(edited)}` : "no hand edits"
        }`,
        jobs: allJobs(config, false),
      };
    }
  }

  if (isMarkdownOnly(config, changedFiles)) {
    return {
      mode: "markdown",
      reason: `Markdown only: ${list(changedFiles)}`,
      jobs: allJobs(config, false),
    };
  }

  const selection = selectJobs(config, changedFiles, workspaces);
  if (selection.unplaced.length > 0) {
    return {
      mode: "full",
      reason: `outside any mapped path: ${list(selection.unplaced)}`,
      jobs: allJobs(config, true),
    };
  }
  return { mode: "impact", reason: selection.reason, jobs: selection.jobs };
}

/** The jobs `changedFiles` select, and the files nothing places. */
export function selectJobs(config, changedFiles, workspaces = []) {
  const owners = new Set();
  const unplaced = [];
  const inputs = Object.entries(config.workspaceInputs);
  const jobPaths = Object.values(config.jobs).flatMap((selector) => selector.paths);
  for (const path of changedFiles) {
    let placed = false;
    const owner = ownerOf(workspaces, path);
    if (owner) {
      owners.add(owner.name);
      placed = true;
    }
    for (const [name, patterns] of inputs) {
      if (matchesAny(patterns, path)) {
        owners.add(name);
        placed = true;
      }
    }
    if (
      !placed &&
      !matchesAny(jobPaths, path) &&
      !matchesAny(config.noImpact, path) &&
      !matchesAny(config.alwaysRunPaths, path)
    ) {
      unplaced.push(path);
    }
  }
  const affected = withDependents(workspaces, [...owners]);
  const named = new Set(
    Object.values(config.jobs).flatMap((selector) => selector.workspaces.filter((n) => n !== "*"))
  );
  const jobs = {};
  for (const [job, selector] of Object.entries(config.jobs)) {
    const byWorkspace = selector.workspaces.some((name) =>
      name === "*" ? [...affected].some((ws) => !named.has(ws)) : affected.has(name)
    );
    const byPath = changedFiles.some((path) => matchesAny(selector.paths, path));
    jobs[job] = byWorkspace || byPath;
  }
  const names = [...affected].sort();
  return {
    jobs,
    unplaced,
    reason: names.length > 0 ? `affects ${names.join(", ")}` : "no workspace affected",
  };
}

/**
 * Problems with a plan job's outputs: missing or malformed values, or a plan that contradicts its
 * event. Any problem discards the plan, and the result judge then requires every job.
 *
 * @param {object} config
 * @param {Record<string, string> | undefined} outputs the plan job's outputs (strings)
 * @param {{ event: string, baseRef: string, draft: boolean }} context
 * @returns {string[]}
 */
export function planProblems(config, outputs, { event, baseRef, draft }) {
  if (!outputs || typeof outputs !== "object") {
    return ["no outputs"];
  }
  const problems = [];
  if (!MODES.includes(outputs.mode)) {
    problems.push(`mode is ${JSON.stringify(outputs.mode ?? null)}`);
  }
  const jobIds = Object.keys(config.jobs);
  for (const job of jobIds) {
    if (outputs[job] !== "true" && outputs[job] !== "false") {
      problems.push(`${job} is ${JSON.stringify(outputs[job] ?? null)}`);
    }
  }
  if (problems.length > 0) {
    return problems;
  }
  const selected = jobIds.filter((job) => outputs[job] === "true");
  const skipped = jobIds.filter((job) => outputs[job] !== "true");
  const pullRequest = event === "pull_request";
  const isDraft = pullRequest && draft;
  const scoped = pullRequest && !draft && !config.fullBranches.includes(baseRef);
  const selectsNothing = (mode) => {
    if (selected.length > 0) {
      problems.push(`a ${mode} plan selects ${selected.join(", ")}`);
    }
  };
  switch (outputs.mode) {
    case "draft":
      if (!isDraft) {
        problems.push("mode draft for a change that isn't a draft pull request");
      }
      selectsNothing("draft");
      break;
    case "conflict":
      if (!pullRequest || draft) {
        problems.push("mode conflict for a change that isn't a ready pull request");
      }
      selectsNothing("conflict");
      break;
    case "remerge":
    case "markdown":
      if (!scoped) {
        problems.push(`mode ${outputs.mode} for an event that must run every job`);
      }
      if (outputs.mode === "markdown" && !config.markdownOnly) {
        problems.push("mode markdown, but markdownOnly is off");
      }
      if (outputs.mode === "remerge" && !config.remerge) {
        problems.push("mode remerge, but remerge is off");
      }
      selectsNothing(outputs.mode);
      break;
    case "impact":
      if (!scoped) {
        problems.push("mode impact for an event that must run every job");
      }
      break;
    case "full":
      if (isDraft) {
        problems.push("mode full for a draft pull request");
      }
      if (skipped.length > 0) {
        problems.push(`a full plan skips ${skipped.join(", ")}`);
      }
      break;
  }
  return problems;
}
