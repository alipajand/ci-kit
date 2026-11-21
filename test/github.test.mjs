import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { api, runContext } from "../src/github.mjs";

describe("github", () => {
  it("drops a malformed repository or pull request number from the run context", () => {
    const pr = (number) => ({ pull_request: { number, base: { ref: "main" } } });
    const env = { GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "owner/repo" };
    assert.equal(runContext(env, pr(7)).prNumber, 7);
    assert.equal(runContext(env, pr(7)).repository, "owner/repo");
    for (const bad of ["7", 0, -1, 1.5, "../7", null]) {
      assert.equal(runContext(env, pr(bad)).prNumber, null, String(bad));
    }
    for (const bad of ["owner/repo/extra", "owner", "own er/repo", "owner/../x", "https://x/y"]) {
      assert.equal(runContext({ ...env, GITHUB_REPOSITORY: bad }, pr(7)).repository, "", bad);
    }
  });

  it("refuses an API path outside /repos/<owner>/<name>/ before any request", async () => {
    for (const bad of [
      "/user",
      "//evil.example/repos/a/b/pulls/1",
      "/repos/a/b/../../user",
      "/repos/a/b/pulls/1#x",
      "/repos/a b/c/pulls/1",
      "/repos/a/b/pulls/1?x=<y>",
    ]) {
      await assert.rejects(api(bad, "t"), /unexpected API path/, bad);
    }
  });

  it("requires an https API base", async () => {
    const saved = process.env.GITHUB_API_URL;
    process.env.GITHUB_API_URL = "http://api.example";
    try {
      await assert.rejects(api("/repos/a/b/pulls/1", "t"), /must be https/);
    } finally {
      if (saved === undefined) delete process.env.GITHUB_API_URL;
      else process.env.GITHUB_API_URL = saved;
    }
  });
});
