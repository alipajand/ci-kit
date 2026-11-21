# Contributing

Thanks for helping. Issues and pull requests are welcome. For a larger change, open an issue first so we can agree on the approach.

## Setup

Node 22 or newer. The only dependency is fast-check, a dev dependency for the property-based tests.

```bash
npm ci --ignore-scripts
npm test
```

```bash
node bin/ci-kit.mjs lint
```

If you change a workflow or a template, also run [actionlint](https://github.com/rhysd/actionlint) and `uvx zizmor==1.31.1 --offline --min-severity medium .github/workflows templates/.github/workflows`.

## Rules

- No runtime dependencies: Node built-ins only.
- Fail closed: a broken config, a failed plan or an unknown answer must lead to running more, never less.
- Add or update tests next to the change.
- A behavior change updates the README, RULES.md when a rule changes, the templates when the wiring changes, and CHANGELOG.md under an "Unreleased" heading.
- Pin every action by full commit SHA, with the version as a comment.
- Sign your commits. `main` accepts only signed commits, through a pull request with a passing **CI result**.

[AGENTS.md](AGENTS.md) has the same rules in more detail, for people and coding agents alike.

## Releasing

Releases are the owner's call. Bump `version` in package.json and add its CHANGELOG.md section in a pull request. After it merges, push a signed `v<version>` tag on the merge commit. The [release workflow](.github/workflows/release.yml) checks the tag against package.json, main and the changelog, runs the tests, and publishes the release with the tarball, `SHA256SUMS` and a build provenance attestation.

## Reporting a vulnerability

Don't open an issue. See [SECURITY.md](SECURITY.md).
