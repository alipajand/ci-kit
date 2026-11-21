# Contributing

Thanks for helping. Issues and pull requests are welcome. For a larger change, open an issue first so we can agree on the approach.

## Setup

Node 22 or newer. There are no runtime dependencies; fast-check (property-based tests) and Prettier (formatting) are dev dependencies.

```bash
npm ci --ignore-scripts
npm test                 # unit and property tests
npm run test:coverage    # the same, failing below 80% line, branch or function coverage
npm run format           # format the code; CI runs npm run format:check
```

```bash
node bin/ci-kit.mjs lint
```

If you change a workflow or a template, also run [actionlint](https://github.com/rhysd/actionlint) and `uvx zizmor==1.31.1 --offline --min-severity medium .github/workflows templates/.github/workflows`.

## Rules

- No runtime dependencies: Node built-ins only.
- Fail closed: a broken config, a failed plan or an unknown answer must lead to running more, never less.
- **Tests are required.** Every new feature and every behavior change comes with tests in `test/`, and every bug fix with a regression test that fails without the fix. A pull request without them isn't merged. CI fails below 80% line, branch or function coverage.
- **Coding style.** Plain ES modules (`.mjs`), Node built-ins only, small pure functions for the decision logic, with a doc comment on each exported function. Formatting is [Prettier](https://prettier.io) with [.prettierrc.json](.prettierrc.json) and [.editorconfig](.editorconfig); CI fails when `npm run format:check` does.
- A behavior change updates the README, RULES.md when a rule changes, the templates when the wiring changes, and CHANGELOG.md under an "Unreleased" heading.
- Pin every action by full commit SHA, with the version as a comment.
- Sign your commits. `main` accepts only signed commits, through a pull request with a passing **CI result**.

## Developer Certificate of Origin

By contributing you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org): that you wrote the change, or otherwise have the right to submit it under the project's MIT license. Add a `Signed-off-by` line to every commit to say so:

```bash
git commit -s -S -m "Describe the change"
```

`-s` adds the sign-off with your Git name and email; `-S` signs the commit.

## Conduct and decisions

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). [GOVERNANCE.md](GOVERNANCE.md) says who decides what, [ROADMAP.md](ROADMAP.md) what's planned, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) how the code fits together.

[AGENTS.md](AGENTS.md) has the same rules in more detail, for people and coding agents alike.

## Releasing

Releases are the owner's call. Bump `version` in package.json and add its CHANGELOG.md section in a pull request. After it merges, push a signed `v<version>` tag on the merge commit. The [release workflow](.github/workflows/release.yml) checks the tag against package.json, main and the changelog, runs the tests, and publishes the release with the tarball, `SHA256SUMS` and a build provenance attestation.

## Reporting a vulnerability

Don't open an issue. See [SECURITY.md](SECURITY.md).
