/**
 * The repository's JavaScript workspaces and their dependency graph, read from `package.json`
 * files. A workspace is a directory matched by one of the configured `workspaces` globs (for
 * example `apps/*` or `packages/*`) that holds a `package.json` with a `name`. Its dependencies
 * on other workspaces are any `dependencies`, `devDependencies`, `peerDependencies` or
 * `optionalDependencies` entry naming another workspace, whatever the version protocol
 * (`workspace:*`, `*`, a version), so pnpm, npm, Yarn and Bun workspaces all work.
 *
 * Only single-level globs are expanded (`apps/*`, `tools/cli`); that covers every common layout
 * and keeps the scan bounded.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function expand(root, pattern) {
  const clean = pattern.replace(/\/+$/, "");
  if (!clean.includes("*")) {
    return [clean];
  }
  const parts = clean.split("/");
  const star = parts.findIndex((part) => part.includes("*"));
  if (star !== parts.length - 1 || parts[star] !== "*") {
    throw new Error(`ci-kit workspaces: "${pattern}" is not supported; use a directory or "<dir>/*"`);
  }
  const parent = parts.slice(0, -1).join("/");
  const dir = join(root, parent);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => (parent ? `${parent}/${entry.name}` : entry.name))
    .sort();
}

/** Every workspace with its directory and the workspaces it depends on. */
export function readWorkspaces(root, patterns) {
  const found = [];
  for (const pattern of patterns ?? []) {
    for (const dir of expand(root, pattern)) {
      const manifestPath = join(root, dir, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name !== "string" || manifest.name === "") {
        continue;
      }
      const deps = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      });
      found.push({ name: manifest.name, dir, deps });
    }
  }
  const names = new Set(found.map((ws) => ws.name));
  return found.map((ws) => ({ ...ws, deps: ws.deps.filter((dep) => names.has(dep)) }));
}

/** The workspace that owns `path`: the one with the longest directory prefix. */
export function ownerOf(workspaces, path) {
  let owner = null;
  for (const ws of workspaces) {
    if (path.startsWith(`${ws.dir}/`) && (!owner || ws.dir.length > owner.dir.length)) {
      owner = ws;
    }
  }
  return owner;
}

/** `names` and every workspace depending on one of them, directly or transitively. */
export function withDependents(workspaces, names) {
  const affected = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const ws of workspaces) {
      if (!affected.has(ws.name) && ws.deps.some((dep) => affected.has(dep))) {
        affected.add(ws.name);
        grew = true;
      }
    }
  }
  return affected;
}
