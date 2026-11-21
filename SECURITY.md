# Security policy

ci-kit runs inside other repositories' CI with their workflow token, so a flaw in it can affect them. Please report vulnerabilities privately.

## Reporting a vulnerability

Use **[Report a vulnerability](https://github.com/alipajand/ci-kit/security/advisories/new)** (GitHub private vulnerability reporting). Don't open a public issue, pull request or discussion for a suspected vulnerability.

Include the affected version or commit, a description, steps to reproduce, and the impact you expect. You'll get an acknowledgement within 5 business days. Fixes are released as a new version with a GitHub security advisory, and you're credited unless you ask not to be.

## Supported versions

Only the latest release gets security fixes. Pin a release commit SHA and let Dependabot propose upgrades.

## Scope

In scope:

- the `plan`, `result`, `merge-conflict` and `lint` actions;
- the `ci-kit` CLI;
- the templates;
- this repository's own workflows.

Examples: a way to make CI result pass when a required job didn't run, a token or secret reaching a log, a command or expression injection, or a way to make a workflow run untrusted code.

Out of scope: findings in a repository that uses ci-kit but configures it against [RULES.md](RULES.md), and the third-party actions this repository pins (report those upstream).
