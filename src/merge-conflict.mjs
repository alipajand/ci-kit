/**
 * Whether a pull request conflicts with its base branch, so a workflow can stop before doing any
 * work.
 *
 * GitHub says `pull_request` workflows don't run on a conflicted pull request, but it computes
 * mergeability lazily: a run started by `ready_for_review` or a push can begin before GitHub
 * knows, and then tests a stale merge commit. This asks the API, polling while `mergeable` is
 * still `null`. An unknown answer (still computing after every attempt, or an API error) counts as
 * no conflict, with a warning: GitHub refuses to merge a conflicted pull request anyway, so an
 * unanswered question must not block CI.
 */

/**
 * @param {{ fetchPull: () => Promise<{ mergeable?: boolean | null, mergeable_state?: string }>,
 *   attempts?: number, sleep?: (ms: number) => Promise<void>, intervalMs?: number }} input
 * @returns {Promise<{ conflict: boolean, known: boolean, detail: string }>}
 */
export async function checkMergeConflict({
  fetchPull,
  attempts = 20,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  intervalMs = 3000,
}) {
  let detail = "mergeability not computed yet";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let pull;
    try {
      pull = await fetchPull();
    } catch (error) {
      detail = `API error: ${error instanceof Error ? error.message : String(error)}`;
      pull = null;
    }
    if (pull && typeof pull.mergeable === "boolean") {
      // `mergeable` reports merge conflicts only: a blocked or behind branch is still mergeable.
      const state = pull.mergeable_state ?? "unknown";
      return { conflict: !pull.mergeable, known: true, detail: `mergeable_state ${state}` };
    }
    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }
  return { conflict: false, known: false, detail: `${detail} after ${attempts} attempts` };
}
