#!/usr/bin/env node
/**
 * ci-kit command line. The same commands the actions run, for local use and for workflows that
 * prefer a pinned checkout of ci-kit over `uses:`.
 *
 *   ci-kit lint   [--root <dir>] [--config <path>]
 *   ci-kit plan   [--root <dir>] [--config <path>]          (reads the Actions environment)
 *   ci-kit result [--root <dir>] [--config <path>] [--sha <sha>]  (NEEDS='${{ toJSON(needs) }}')
 *   ci-kit merge-conflict [--fail]                           (GITHUB_TOKEN, the event payload)
 */

import { resolve } from "node:path";
import { runLint, runMergeConflict, runPlan, runResult } from "../src/commands.mjs";
import { DEFAULT_CONFIG_PATH } from "../src/config.mjs";
import { eventPayload } from "../src/github.mjs";

const USAGE = "usage: ci-kit lint|plan|result|merge-conflict [--root <dir>] [--config <path>] [--sha <sha>] [--fail]";

function arg(args, name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

async function main(argv) {
  const [command, ...args] = argv;
  const root = resolve(arg(args, "root", process.cwd()));
  const configPath = arg(args, "config", DEFAULT_CONFIG_PATH);
  const token = process.env.GITHUB_TOKEN ?? "";
  switch (command) {
    case "lint":
      return runLint({ root, configPath });
    case "plan":
      return runPlan({ root, configPath, token, payload: eventPayload() });
    case "result":
      return runResult({ root, configPath, needsJson: process.env.NEEDS, sha: arg(args, "sha", process.env.PINNED_SHA ?? ""), payload: eventPayload() });
    case "merge-conflict":
      return runMergeConflict({ token, fail: args.includes("--fail"), payload: eventPayload() });
    default:
      process.stderr.write(`${USAGE}\n`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
);
