/**
 * Whether a pull request's head only re-merges an earlier head with the base branch, so a run
 * whose code CI already tested (a document conflict resolved, a clean "Update branch") can skip
 * the test jobs. It holds when:
 * - the head is a merge whose first parent is the earlier head and whose second parent is a
 *   commit of the base branch (an ancestor of `baseTip`), as `git merge origin/<base>` or GitHub's
 *   "Update branch" makes it;
 * - CI passed on the earlier head (`passed`);
 * - the head differs from git's own merge of its parents (`git merge-tree`, conflicts left
 *   marked) only in `edited`, the files resolved or changed by hand.
 * The planner then decides whether `edited` needs a job. Any failure finds nothing, and the pull
 * request is planned as usual.
 */

import { spawnSync } from "node:child_process";

/**
 * @param {{ root: string, head: string, baseTip: string,
 *   passed: (sha: string) => Promise<boolean> }} input
 * @returns {Promise<{ previous: string, edited: string[] } | { previous: null, why: string }>}
 */
export async function findRemerge({ root, head, baseTip, passed }) {
  const git = (...args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const parents = git("rev-list", "--parents", "-n", "1", head);
  const [, previous, merged, ...more] =
    parents.status === 0 ? parents.stdout.trim().split(" ") : [];
  if (!previous || !merged || more.length > 0) {
    return { previous: null, why: "the head isn't a merge of two commits" };
  }
  if (git("merge-base", "--is-ancestor", merged, baseTip).status !== 0) {
    return { previous: null, why: "the merged commit isn't on the base branch" };
  }
  const auto = git("merge-tree", "--write-tree", "--no-messages", previous, merged);
  const tree = auto.status === 0 || auto.status === 1 ? auto.stdout.split("\n")[0].trim() : "";
  if (!/^[0-9a-f]{40,64}$/.test(tree)) {
    return { previous: null, why: "git merge-tree failed (needs git 2.38 or later)" };
  }
  const diff = git("diff", "--name-only", "--no-renames", tree, head);
  if (diff.status !== 0) {
    return { previous: null, why: "git diff failed" };
  }
  const ok = await Promise.resolve()
    .then(() => passed(previous))
    .catch(() => false);
  if (!ok) {
    return { previous: null, why: `no passing CI run on ${previous.slice(0, 9)}` };
  }
  const edited = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { previous, edited };
}
