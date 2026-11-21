/**
 * The repository's ci-kit configuration (`.github/ci-kit.json` by default) and its validation.
 * A configuration error always throws: the plan then fails, and the result judge requires every
 * job, so a broken configuration can never skip one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globToRegExp } from "./glob.mjs";

export const DEFAULT_CONFIG_PATH = ".github/ci-kit.json";

const DEFAULTS = {
  workflow: ".github/workflows/ci.yml",
  planJob: "changes",
  resultJob: "result",
  fullBranches: ["main"],
  workspaces: [],
  workspaceInputs: {},
  noImpact: [],
  alwaysRun: [],
  alwaysRunPaths: [],
  markdownOnly: false,
  remerge: false,
  release: { jobs: [] },
  manual: false,
  lint: { ignore: {} },
};

const KEYS = new Set([...Object.keys(DEFAULTS), "$schema", "jobs"]);
const JOB_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const fail = (message) => {
  throw new Error(`ci-kit config: ${message}`);
};

const stringList = (value, where) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    fail(`${where} must be a list of non-empty strings`);
  }
  return value;
};

const globList = (value, where) => {
  for (const pattern of stringList(value, where)) {
    globToRegExp(pattern);
  }
  return value;
};

/** Validates a parsed configuration and fills in the defaults. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("must be a JSON object");
  }
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) {
      fail(`unknown key "${key}"`);
    }
  }
  const config = { ...DEFAULTS, ...raw };
  for (const key of ["workflow", "planJob", "resultJob"]) {
    if (typeof config[key] !== "string" || config[key] === "") {
      fail(`${key} must be a non-empty string`);
    }
  }
  stringList(config.fullBranches, "fullBranches");
  globList(config.workspaces, "workspaces");
  globList(config.noImpact, "noImpact");
  stringList(config.alwaysRun, "alwaysRun");
  globList(config.alwaysRunPaths, "alwaysRunPaths");

  if (!config.jobs || typeof config.jobs !== "object" || Array.isArray(config.jobs)) {
    fail("jobs must be an object of job id → selector");
  }
  const jobs = {};
  let wildcard = 0;
  for (const [job, selector] of Object.entries(config.jobs)) {
    if (!JOB_NAME.test(job)) {
      fail(`job id "${job}" must be a workflow job id`);
    }
    if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
      fail(`jobs.${job} must be an object`);
    }
    for (const key of Object.keys(selector)) {
      if (key !== "workspaces" && key !== "paths") {
        fail(`jobs.${job} has unknown key "${key}"`);
      }
    }
    const workspaces = selector.workspaces ? stringList(selector.workspaces, `jobs.${job}.workspaces`) : [];
    const paths = selector.paths ? globList(selector.paths, `jobs.${job}.paths`) : [];
    if (workspaces.length === 0 && paths.length === 0) {
      fail(`jobs.${job} selects nothing: give it workspaces, paths or both`);
    }
    if (workspaces.includes("*")) {
      wildcard += 1;
    }
    jobs[job] = { workspaces, paths };
  }
  if (Object.keys(jobs).length === 0) {
    fail("jobs must name at least one planned job");
  }
  if (wildcard > 1) {
    fail('only one job may claim the "*" workspace');
  }
  config.jobs = jobs;

  if (typeof config.workspaceInputs !== "object" || Array.isArray(config.workspaceInputs)) {
    fail("workspaceInputs must be an object of workspace name → globs");
  }
  for (const [name, patterns] of Object.entries(config.workspaceInputs)) {
    globList(patterns, `workspaceInputs.${name}`);
  }

  if (config.markdownOnly !== false) {
    if (config.markdownOnly === true) {
      config.markdownOnly = { exclude: [] };
    } else if (typeof config.markdownOnly !== "object" || Array.isArray(config.markdownOnly)) {
      fail("markdownOnly must be false, true or { exclude: [globs] }");
    } else {
      config.markdownOnly = {
        exclude: globList(config.markdownOnly.exclude ?? [], "markdownOnly.exclude"),
      };
    }
  }

  if (config.remerge !== false) {
    if (
      !config.remerge ||
      typeof config.remerge !== "object" ||
      typeof config.remerge.workflow !== "string" ||
      !/^[\w.-]+\.ya?ml$/.test(config.remerge.workflow)
    ) {
      fail('remerge must be false or { "workflow": "<file name>.yml" }');
    }
  }

  if (!config.release || typeof config.release !== "object") {
    fail("release must be { jobs: [job ids] }");
  }
  config.release = { jobs: stringList(config.release.jobs ?? [], "release.jobs") };

  if (config.manual !== false) {
    const manual = config.manual;
    if (!manual || typeof manual !== "object" || Array.isArray(manual)) {
      fail("manual must be false or an object");
    }
    config.manual = {
      event: manual.event ?? "workflow_dispatch",
      jobs: stringList(manual.jobs ?? [], "manual.jobs"),
      pinnedSha: manual.pinnedSha === true,
    };
    if (typeof config.manual.event !== "string") {
      fail("manual.event must be an event name");
    }
    for (const job of config.manual.jobs) {
      if (!config.release.jobs.includes(job)) {
        fail(`manual.jobs names "${job}", which isn't in release.jobs`);
      }
    }
  }

  const ignore = config.lint?.ignore ?? {};
  if (typeof ignore !== "object" || Array.isArray(ignore)) {
    fail("lint.ignore must be an object of rule → workflow globs");
  }
  for (const [rule, patterns] of Object.entries(ignore)) {
    globList(patterns, `lint.ignore.${rule}`);
  }
  config.lint = { ignore };

  const seen = new Map();
  for (const [group, names] of [
    ["jobs", Object.keys(jobs)],
    ["alwaysRun", config.alwaysRun],
    ["release.jobs", config.release.jobs],
    ["planJob", [config.planJob]],
    ["resultJob", [config.resultJob]],
  ]) {
    for (const name of names) {
      if (seen.has(name)) {
        fail(`job "${name}" is in both ${seen.get(name)} and ${group}`);
      }
      seen.set(name, group);
    }
  }
  return config;
}

/** Reads and validates the configuration at `path`, relative to `root`. */
export function loadConfig(root, path = DEFAULT_CONFIG_PATH) {
  let text;
  try {
    text = readFileSync(join(root, path), "utf8");
  } catch (error) {
    fail(`cannot read ${path} (${error.code ?? error.message})`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message})`);
  }
  return normalizeConfig(raw);
}

/** Every job id the configuration knows, in a stable order. */
export const knownJobs = (config) => [
  config.planJob,
  ...config.alwaysRun,
  ...Object.keys(config.jobs),
  ...config.release.jobs,
  config.resultJob,
];
