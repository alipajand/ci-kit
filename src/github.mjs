/**
 * The GitHub Actions environment: the event context, step outputs and summaries, action inputs,
 * the REST API and git. Node built-ins only, so no action needs an install.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** An action input (`with:`), as the runner passes it: `INPUT_<NAME>`. */
export function input(name, fallback = "") {
  const value = process.env[`INPUT_${name.toUpperCase()}`];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

/** The event payload, or an empty object outside Actions. */
export function eventPayload() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || !existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * The run's context. `baseRef` is the pull request's base branch, or the branch a push or a manual
 * run is on. A called workflow (`workflow_call`) sees its caller's event.
 */
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function runContext(env = process.env, payload = eventPayload()) {
  const event = env.GITHUB_EVENT_NAME ?? "";
  const pull = payload.pull_request ?? null;
  return {
    event,
    baseRef: event === "pull_request" ? (pull?.base?.ref ?? env.GITHUB_BASE_REF ?? "") : (env.GITHUB_REF_NAME ?? ""),
    draft: event === "pull_request" && pull?.draft === true,
    prNumber: Number.isSafeInteger(pull?.number) && pull.number > 0 ? pull.number : null,
    before: payload.before ?? "",
    after: payload.after ?? "",
    repository: REPOSITORY.test(env.GITHUB_REPOSITORY ?? "") ? env.GITHUB_REPOSITORY : "",
    runSha: env.GITHUB_SHA ?? "",
  };
}

/** Single-line value for `$GITHUB_OUTPUT`: newlines would start a new key. */
const oneLine = (value) => String(value).replace(/[\r\n]+/g, " ");

/** Appends `key=value` lines to `$GITHUB_OUTPUT` (and prints them outside Actions). */
export function setOutputs(outputs) {
  const text = Object.entries(outputs)
    .map(([key, value]) => `${key}=${oneLine(value)}`)
    .join("\n");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${text}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

/** Appends Markdown to the job summary, when there is one. */
export function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

const API_PATH = /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+(\?[A-Za-z0-9_=&.-]*)?$/;

/**
 * A GET against the REST API with the run's token. Only `/repos/<owner>/<name>/…` paths made of
 * plain characters are allowed, so nothing read from the event file can redirect or extend the
 * request.
 */
export async function api(path, token = process.env.GITHUB_TOKEN) {
  if (!API_PATH.test(path) || path.includes("..")) {
    throw new Error("refusing an unexpected API path");
  }
  const base = new URL(process.env.GITHUB_API_URL || "https://api.github.com");
  if (base.protocol !== "https:") {
    throw new Error("GITHUB_API_URL must be https");
  }
  const url = new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base.origin);
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path.split("?")[0]}`);
  }
  return response.json();
}

/** Whether a run of `workflow` (a file name) succeeded on `sha`. */
export async function workflowPassedOn({ repository, workflow, sha, token }) {
  if (!repository || !/^[0-9a-f]{40,64}$/.test(sha)) {
    return false;
  }
  const body = await api(
    `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?head_sha=${sha}&status=success&per_page=1`,
    token
  );
  return Number(body.total_count) > 0;
}

/** `git rev-parse`, or "" when the revision doesn't exist (a shallow checkout). */
export function revParse(root, rev) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const COMMIT_SHA = /^[0-9a-f]{40,64}$/;

/**
 * The files changed between two commits, or null when either is unknown or isn't a full commit
 * SHA (the values come from the event payload, so nothing else reaches git's command line).
 * `threeDot` compares `head` with its merge base with `base`, as a pull request's "Files changed"
 * does.
 */
export function changedFilesBetween(root, base, head, { threeDot = false } = {}) {
  if (!COMMIT_SHA.test(base ?? "") || /^0+$/.test(base) || !COMMIT_SHA.test(head ?? "")) {
    return null;
  }
  const range = threeDot ? [`${base}...${head}`] : [base, head];
  try {
    return execFileSync("git", ["diff", "--name-only", "--no-renames", ...range], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}
