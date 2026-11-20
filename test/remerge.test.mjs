import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { findRemerge } from "../src/remerge.mjs";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "ci-kit-remerge-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" },
    }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git("init", "-q", "-b", "develop");
  git("config", "commit.gpgsign", "false");
  write("docs/a.md", "one\n");
  write("src/a.ts", "a\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return { root, git, write };
}

describe("re-merge detection", () => {
  it("finds a clean re-merge and a hand-resolved document conflict", async () => {
    const { root, git, write } = repo();
    git("checkout", "-q", "-b", "feature");
    write("src/a.ts", "feature\n");
    write("docs/a.md", "feature\n");
    git("commit", "-qam", "feature");
    const tested = git("rev-parse", "HEAD");
    git("checkout", "-q", "develop");
    write("docs/a.md", "develop\n");
    write("src/b.ts", "b\n");
    git("add", ".");
    git("commit", "-qm", "develop moves");
    const baseTip = git("rev-parse", "HEAD");
    git("checkout", "-q", "feature");
    try {
      git("merge", "-q", "develop");
    } catch {
      // The document conflicts; resolve it by hand.
    }
    write("docs/a.md", "resolved\n");
    git("add", ".");
    git("commit", "-qm", "merge develop", "--no-edit");
    const head = git("rev-parse", "HEAD");

    const found = await findRemerge({ root, head, baseTip, passed: async (sha) => sha === tested });
    assert.deepEqual(found, { previous: tested, edited: ["docs/a.md"] });

    const untested = await findRemerge({ root, head, baseTip, passed: async () => false });
    assert.equal(untested.previous, null);
    assert.match(untested.why, /no passing CI run/);

    const failing = await findRemerge({ root, head, baseTip, passed: async () => { throw new Error("api"); } });
    assert.equal(failing.previous, null);
  });

  it("refuses a head that isn't a merge, or merges something off the base", async () => {
    const { root, git, write } = repo();
    const base = git("rev-parse", "HEAD");
    write("src/a.ts", "x\n");
    git("commit", "-qam", "plain");
    const plain = await findRemerge({ root, head: git("rev-parse", "HEAD"), baseTip: base, passed: async () => true });
    assert.match(plain.why, /isn't a merge/);

    git("checkout", "-q", "-b", "other", base);
    write("src/c.ts", "c\n");
    git("add", ".");
    git("commit", "-qm", "other");
    git("checkout", "-q", "develop");
    git("merge", "-q", "--no-edit", "other");
    const offBase = await findRemerge({ root, head: git("rev-parse", "HEAD"), baseTip: base, passed: async () => true });
    assert.match(offBase.why, /isn't on the base branch/);
  });
});
