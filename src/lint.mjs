/**
 * Structural rules for GitHub Actions workflows, the ones RULES.md lists as checkable. Security
 * analysis (template injection, dangerous triggers, excessive permissions) belongs to zizmor and
 * actionlint, which RULES.md requires alongside this; the overlap here is limited to the two
 * rules every repository needs from day one (pinned actions and checkout credentials).
 *
 * Silence a finding with `"lint": { "ignore": { "<rule>": ["<workflow glob>"] } }` in the config,
 * or with a `# ci-kit-ignore: <rule>` comment on the reported line or the line above it. Give the
 * reason in the same comment.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_PATH, loadConfig } from "./config.mjs";
import { matchesAny } from "./glob.mjs";
import { needsList, readWorkflow, stepAround, usesLines, valueOf } from "./workflow.mjs";

export const RULES = {
  permissions: "The workflow sets top-level `permissions:` (least privilege, usually `contents: read`).",
  timeout: "Every job that runs on a runner sets `timeout-minutes:`.",
  concurrency: "A workflow triggered by pull_request or push sets `concurrency:`.",
  "pinned-uses": "Every action outside this repository is pinned to a full commit SHA.",
  "checkout-credentials": "Every actions/checkout step sets `persist-credentials: false`.",
  "draft-ready": "A workflow that skips drafts also triggers on `ready_for_review`.",
  config: "The ci-kit config is valid.",
  "plan-job": "The planned workflow has the plan job, and it exposes `mode` and every planned job.",
  "plan-guard": "A planned job needs the plan and runs unless the plan succeeded and said skip.",
  "always-run": "An always-run job runs whenever the plan job didn't succeed.",
  "result-job": "The result job runs always() and needs every other job of the workflow.",
  "config-job": "Every job the config names exists in the planned workflow.",
};

const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;

function finding(rule, file, line, message) {
  return { rule, file, line: line === null ? null : line + 1, message };
}

/** Findings for one workflow file's text. `planned` is the config when this is its workflow. */
export function lintWorkflow(file, text, config = null) {
  const wf = readWorkflow(text);
  const found = [];
  const add = (rule, line, message) => found.push(finding(rule, file, line, message));

  if (!wf.top.has("permissions")) {
    add("permissions", 0, "No top-level `permissions:`; the token then gets the repository default.");
  }
  const triggered = wf.triggers.has("pull_request") || wf.triggers.has("push");
  if (triggered && !wf.top.has("concurrency") && !wf.jobs.every((job) => job.keys.has("concurrency"))) {
    add("concurrency", 0, "No `concurrency:`; superseded pull request runs keep running.");
  }
  for (const job of wf.jobs) {
    if (job.keys.has("runs-on") && !job.keys.has("timeout-minutes")) {
      add("timeout", job.line, `Job \`${job.id}\` has no \`timeout-minutes:\` (the default is 6 hours).`);
    }
  }
  for (const { line, ref } of usesLines(wf.lines)) {
    if (ref.startsWith("./") || ref.startsWith("docker://")) {
      if (ref.startsWith("docker://") && !ref.includes("@sha256:")) {
        add("pinned-uses", line, `\`${ref}\` isn't pinned to an image digest.`);
      }
      continue;
    }
    if (!PINNED.test(ref)) {
      add("pinned-uses", line, `\`${ref}\` isn't pinned to a full commit SHA (add the version as a comment).`);
    }
  }
  for (const { line, ref } of usesLines(wf.lines)) {
    if (/^actions\/checkout@/.test(ref) && !/^\s*persist-credentials:\s*false\s*(#.*)?$/m.test(stepAround(wf.lines, line).join("\n"))) {
      add("checkout-credentials", line, "actions/checkout without `persist-credentials: false` leaves the token in .git/config.");
    }
  }
  const types = wf.triggerTypes.get("pull_request");
  if (types && /pull_request\.draft/.test(text) && !types.includes("ready_for_review")) {
    add("draft-ready", 0, "Skips drafts but `pull_request.types` lacks `ready_for_review`, so marking ready runs nothing.");
  }

  if (config) {
    found.push(...lintPlanWiring(file, wf, config));
  }
  return found.filter((f) => !ignoredInline(wf.lines, f));
}

function ignoredInline(lines, f) {
  if (!f.line) {
    return false;
  }
  const marker = new RegExp(`#\\s*ci-kit-ignore:\\s*[^\\n]*\\b${f.rule.replace(/-/g, "\\-")}\\b`);
  return [lines[f.line - 1], lines[f.line - 2]].some((line) => line !== undefined && marker.test(line));
}

function lintPlanWiring(file, wf, config) {
  const found = [];
  const add = (rule, line, message) => found.push(finding(rule, file, line, message));
  const jobs = new Map(wf.jobs.map((job) => [job.id, job]));
  const plan = config.planJob;
  const ifOf = (job) => valueOf(job.keys.get("if")).replace(/\s+/g, " ");
  const failOpen = `needs.${plan}.result != 'success'`;

  const planJob = jobs.get(plan);
  if (!planJob) {
    add("plan-job", 0, `No plan job \`${plan}\`.`);
  } else {
    const outputs = valueOf(planJob.keys.get("outputs"));
    const exposes = (key, value) =>
      new RegExp(`(^|\\n)\\s*${key}:\\s*\\$\\{\\{\\s*${value}\\s*\\}\\}`).test(outputs);
    const escape = (text) => text.replace(/[-.]/g, "\\$&");
    if (!exposes("mode", "steps\\.[\\w-]+\\.outputs\\.mode")) {
      add("plan-job", planJob.line, `Plan job \`${plan}\` doesn't expose output \`mode\` from its plan step.`);
    }
    for (const key of Object.keys(config.jobs)) {
      const id = escape(key);
      if (!exposes(id, `fromJSON\\(steps\\.[\\w-]+\\.outputs\\.jobs\\)(?:\\[["']${id}["']\\]|\\.${id})`)) {
        add(
          "plan-job",
          planJob.line,
          `Plan job \`${plan}\` doesn't expose \`${key}: \${{ fromJSON(steps.<id>.outputs.jobs)['${key}'] }}\`.`
        );
      }
    }
  }

  for (const id of Object.keys(config.jobs)) {
    const job = jobs.get(id);
    if (!job) {
      add("config-job", 0, `The config plans \`${id}\`, which isn't a job here.`);
      continue;
    }
    const guard = ifOf(job);
    const problems = [];
    if (!needsList(job.keys.get("needs")).includes(plan)) {
      problems.push(`doesn't need \`${plan}\``);
    }
    if (!guard.includes("!cancelled()")) {
      problems.push("its `if:` lacks `!cancelled()`");
    }
    if (!guard.includes(failOpen)) {
      problems.push(`its \`if:\` lacks \`${failOpen}\` (it must run when the plan fails)`);
    }
    if (!guard.includes(`needs.${plan}.outputs.${id} != 'false'`)) {
      problems.push(`its \`if:\` lacks \`needs.${plan}.outputs.${id} != 'false'\``);
    }
    if (problems.length > 0) {
      add("plan-guard", job.line, `Job \`${id}\` ${problems.join("; ")}.`);
    }
  }

  for (const id of config.alwaysRun) {
    const job = jobs.get(id);
    if (!job) {
      add("config-job", 0, `The config's alwaysRun names \`${id}\`, which isn't a job here.`);
      continue;
    }
    if (needsList(job.keys.get("needs")).includes(plan) && !ifOf(job).includes(failOpen)) {
      add("always-run", job.line, `Job \`${id}\` needs \`${plan}\` but its \`if:\` lacks \`${failOpen}\`.`);
    }
  }
  for (const id of config.release.jobs) {
    if (!jobs.has(id)) {
      add("config-job", 0, `The config's release.jobs names \`${id}\`, which isn't a job here.`);
    }
  }

  const result = jobs.get(config.resultJob);
  if (!result) {
    add("result-job", 0, `No result job \`${config.resultJob}\`.`);
  } else {
    if (!ifOf(result).includes("always()")) {
      add("result-job", result.line, "The result job's `if:` lacks `always()`, so a failed job skips the judge.");
    }
    const needs = new Set(needsList(result.keys.get("needs")));
    const missing = wf.jobs.map((job) => job.id).filter((id) => id !== config.resultJob && !needs.has(id));
    if (missing.length > 0) {
      add("result-job", result.line, `The result job doesn't need ${missing.map((id) => `\`${id}\``).join(", ")}.`);
    }
  }
  return found;
}

/** Lints every workflow in the repository, with the plan-wiring rules for the configured one. */
export function lintRepository(root, configPath = DEFAULT_CONFIG_PATH) {
  const findings = [];
  let config = null;
  if (existsSync(join(root, configPath))) {
    try {
      config = loadConfig(root, configPath);
    } catch (error) {
      findings.push(finding("config", configPath, null, error.message));
    }
  }
  const dir = join(root, ".github/workflows");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .map((name) => `.github/workflows/${name}`)
    : [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    const planned = config && config.workflow === file ? config : null;
    const ignore = config?.lint.ignore ?? {};
    findings.push(
      ...lintWorkflow(file, text, planned).filter((f) => !matchesAny(ignore[f.rule], f.file))
    );
  }
  if (config && !files.includes(config.workflow)) {
    findings.push(finding("config-job", configPath, null, `The configured workflow ${config.workflow} doesn't exist.`));
  }
  return findings;
}
