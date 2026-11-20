import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { globToRegExp, matchesAny } from "../src/glob.mjs";

describe("glob", () => {
  const cases = [
    ["docs/**", "docs/a.md", true],
    ["docs/**", "docs/a/b/c.md", true],
    ["docs/**", "docsx/a.md", false],
    ["docs/", "docs/a/b.md", true],
    ["*.md", "README.md", true],
    ["*.md", "docs/README.md", false],
    ["**/*.md", "docs/README.md", true],
    ["**/*.md", "README.md", true],
    ["apps/*/package.json", "apps/web/package.json", true],
    ["apps/*/package.json", "apps/web/x/package.json", false],
    ["file?.txt", "file1.txt", true],
    ["file?.txt", "file/.txt", false],
    [".env.example", ".env.example", true],
    [".env.example", "xenv.example", false],
    ["a+b(c).md", "a+b(c).md", true],
  ];
  for (const [pattern, path, expected] of cases) {
    it(`${pattern} ${expected ? "matches" : "doesn't match"} ${path}`, () => {
      assert.equal(globToRegExp(pattern).test(path), expected);
    });
  }

  it("matches any of a list, and nothing for none", () => {
    assert.equal(matchesAny(["docs/**", "*.md"], "CHANGELOG.md"), true);
    assert.equal(matchesAny([], "x"), false);
    assert.equal(matchesAny(undefined, "x"), false);
  });

  it("rejects an empty pattern", () => {
    assert.throws(() => globToRegExp(""), /invalid glob/);
  });
});
