import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkMergeConflict } from "../src/merge-conflict.mjs";

const sleep = async () => {};

describe("merge conflict", () => {
  it("reports a conflict and a clean pull request", async () => {
    const conflicted = await checkMergeConflict({ sleep, fetchPull: async () => ({ mergeable: false, mergeable_state: "dirty" }) });
    assert.deepEqual(conflicted, { conflict: true, known: true, detail: "mergeable_state dirty" });
    const clean = await checkMergeConflict({ sleep, fetchPull: async () => ({ mergeable: true, mergeable_state: "blocked" }) });
    assert.equal(clean.conflict, false);
    assert.equal(clean.known, true);
  });

  it("polls while GitHub is still computing", async () => {
    const answers = [null, null, false];
    let calls = 0;
    const result = await checkMergeConflict({
      sleep,
      fetchPull: async () => ({ mergeable: answers[calls++], mergeable_state: "dirty" }),
    });
    assert.equal(calls, 3);
    assert.equal(result.conflict, true);
  });

  it("treats no answer and API errors as unknown, not a conflict", async () => {
    const pending = await checkMergeConflict({ sleep, attempts: 2, fetchPull: async () => ({ mergeable: null }) });
    assert.deepEqual(pending, { conflict: false, known: false, detail: "mergeability not computed yet after 2 attempts" });
    const broken = await checkMergeConflict({
      sleep,
      attempts: 1,
      fetchPull: async () => {
        throw new Error("HTTP 502");
      },
    });
    assert.equal(broken.known, false);
    assert.match(broken.detail, /HTTP 502/);
  });
});
