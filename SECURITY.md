# Security policy

ci-kit runs inside other repositories' CI with their workflow token, so a flaw in it can affect them. Please report vulnerabilities privately.

## Reporting a vulnerability

Use **[Report a vulnerability](https://github.com/alipajand/ci-kit/security/advisories/new)** (GitHub private vulnerability reporting). Don't open a public issue, pull request or discussion for a suspected vulnerability.

Include the affected version or commit, a description, steps to reproduce, and the impact you expect.

## What happens next

1. **Acknowledgement** within 5 business days.
2. **Assessment.** The maintainer reproduces the report, decides whether it's in scope, and rates its severity with CVSS. You hear the outcome either way.
3. **Fix.** The fix is developed in a private fork of the advisory, with a regression test, and reviewed before release. The target is 30 days for a high or critical issue.
4. **Release.** A new version ships with a GitHub security advisory and, where it applies, a CVE. Users are told to move their pinned SHA to the new release.
5. **Credit.** You're credited in the advisory and the changelog unless you ask not to be.

Please keep the report private until the advisory is published.

## Supported versions

Only the latest release gets security fixes. Pin a release commit SHA and let Dependabot propose upgrades.

## Scope

In scope:

- the `plan`, `result`, `merge-conflict` and `lint` actions;
- the `ci-kit` CLI;
- the templates;
- this repository's own workflows.

Examples: a way to make CI result pass when a required job didn't run, a token or secret reaching a log, a command or expression injection, or a way to make a workflow run untrusted code.

What ci-kit does and doesn't promise, and how it defends against these, is in the [assurance case](docs/ASSURANCE_CASE.md).

Out of scope: findings in a repository that uses ci-kit but configures it against [RULES.md](RULES.md), and the third-party actions this repository pins (report those upstream).
