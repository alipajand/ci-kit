import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { readWorkspaces } from "../src/workspaces.mjs";

export const FIXTURE = join(import.meta.dirname, "fixtures/monorepo");
export const CONFIG = loadConfig(FIXTURE);
export const WORKSPACES = readWorkspaces(FIXTURE, CONFIG.workspaces);
export const PLANNED = Object.keys(CONFIG.jobs).sort();
