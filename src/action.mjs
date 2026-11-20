/** Shared entry for the JavaScript actions: runs one command with the action's inputs. */

import { resolve } from "node:path";
import { runLint, runMergeConflict, runPlan, runResult } from "./commands.mjs";
import { DEFAULT_CONFIG_PATH } from "./config.mjs";
import { eventPayload, input } from "./github.mjs";

export function runAction(command) {
  const root = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const configPath = input("config", DEFAULT_CONFIG_PATH);
  const token = input("token", process.env.GITHUB_TOKEN ?? "");
  const run = async () => {
    switch (command) {
      case "plan":
        return runPlan({ root, configPath, token, payload: eventPayload() });
      case "result":
        return runResult({ root, configPath, needsJson: input("needs"), sha: input("sha"), payload: eventPayload() });
      case "merge-conflict":
        return runMergeConflict({ token, fail: input("fail", "true") === "true", payload: eventPayload() });
      case "lint":
        return runLint({ root, configPath });
      default:
        throw new Error(`unknown command ${command}`);
    }
  };
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stdout.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
