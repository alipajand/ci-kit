# Assurance case

This document argues that ci-kit meets its security requirements, and points to the evidence for each claim. Report a gap you find as [SECURITY.md](../SECURITY.md) describes.

## Security requirements

What users can expect from ci-kit:

1. **CI result never passes work that didn't run.** A required job that was skipped, failed, cancelled or never reported fails **CI result**. So does a plan that failed or that doesn't match the event.
2. **The actions don't change anything.** They send only GET requests to the GitHub API, read git history, and write step outputs and the job summary.
3. **Nothing from the event reaches a command line, an API path or an output unchecked.** Commit SHAs, the repository name, the pull request number and the API paths are validated before use.
4. **No token reaches a log, an output or a summary.**
5. **Releases can be verified.** Every release is built in CI from a commit on `main`, with a signed tag, a SHA256SUMS file and a signed build provenance attestation.

What users can't expect:

- ci-kit doesn't make an unsafe workflow safe. It lints for the rules in [RULES.md](../RULES.md), but a repository can configure jobs, permissions and triggers against them.
- ci-kit doesn't protect against a compromised runner, GitHub itself, or a token with more permissions than the workflow grants.
- Only the latest release gets security fixes.

## Threat model

| Actor | Can control | Wants to |
|---|---|---|
| Pull request author, including from a fork | The changed files, the branch name, the pull request title and body, the head commit | Make CI result pass without the required jobs, run code with the workflow's token, or leak a secret |
| Malicious dependency | A development dependency's code | Run code in this repository's CI or in a release |
| Tampered download | A release asset in transit or at rest | Make a user run modified code |

## Trust boundaries

- **The event payload and the checkout are untrusted.** Values from them are validated (`src/github.mjs`: `runContext`, `changedFilesBetween`, `workflowPassedOn`) before they reach git, the API or an output.
- **The configuration is trusted but validated.** `.github/ci-kit.json` comes from the repository being tested. Unknown keys and bad values throw (`src/config.mjs`), and a failed plan runs every job.
- **The GitHub API is trusted over HTTPS** with the run's own token. A non-HTTPS `GITHUB_API_URL` is refused.
- **The runner is trusted.** ci-kit runs inside it and relies on its isolation.

## Secure design principles

- **Fail-safe defaults.** Errors lead to running more jobs, and to failing CI result, never to skipping ([ARCHITECTURE.md](ARCHITECTURE.md), "Design decisions").
- **Least privilege.** The actions need only read permissions. Workflows here set `permissions: {}` or read-only at the top, and give each job only what it uses, with a comment per permission. Checkouts set `persist-credentials: false`.
- **Economy of mechanism.** No runtime dependencies; the decision logic is pure functions; the I/O lives in three small modules.
- **Complete mediation.** CI result re-checks the plan against the event rather than trusting the plan job's outputs.
- **Open design.** The code, the rules and this document are public, and nothing depends on a secret.

## Common weaknesses countered

| Weakness | Countermeasure | Evidence |
|---|---|---|
| OS command and argument injection (CWE-78, CWE-88) | git runs through `execFileSync`/`spawnSync` with an argument array, no shell. Only full commit SHAs reach `git diff`, so a value like `--output=/tmp/x` can't become an option. | `src/github.mjs`, `src/remerge.mjs`; `test/github.test.mjs` ("passes only full commit SHAs to git diff") |
| Server-side request forgery and path traversal (CWE-918, CWE-22) | API paths must match `/repos/<owner>/<name>/…` with plain characters and no `..`, and the base URL must be HTTPS. | `api()` in `src/github.mjs`; `test/properties.test.js` ("refuses any path outside /repos/<owner>/<name>/…") |
| Output injection (CWE-74) | Outputs are written as single lines, so a value can't start a new key. | `setOutputs()` in `src/github.mjs`; `test/github.test.mjs` |
| Expression injection in workflows | `${{ }}` stays out of `action.yml` except `default:` values, and the workflows pass untrusted values through `env:`. | `test/actions.test.mjs`; zizmor in CI |
| Improper input validation (CWE-20) | Unknown configuration keys and bad values throw. | `src/config.mjs`; `test/config.test.mjs` |
| Logic errors that skip required work | Property-based tests check the invariants against generated inputs: a failed or cancelled job never passes, a draft never passes, a job a changed file selects is never skipped. | `test/properties.test.js` |
| Supply-chain compromise (CWE-829) | Actions are pinned by full commit SHA, Dependabot proposes updates after a cooldown, `npm ci --ignore-scripts` runs no install scripts, no dependency cache is restored, and releases carry signed provenance. | `.github/workflows/`, `.github/dependabot.yml`, `ci-kit lint`, zizmor |
| Credential exposure (CWE-532) | The token is only sent in the `authorization` header. No code path logs it. | `src/github.mjs`, `src/action.mjs` |

## Evidence

- **Tests.** `npm run test:coverage` runs the unit and property tests in CI, and fails below 80% line, branch or function coverage.
- **Static analysis.** CodeQL on every pull request and on `main`; actionlint, zizmor and `ci-kit lint` on the workflows.
- **Branch protection.** The `main` ruleset requires a pull request, the CI result and CodeQL checks, signed commits and no open high-severity code-scanning alert, with no bypass.
- **External review.** [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/alipajand/ci-kit) and the [OpenSSF Best Practices badge](https://www.bestpractices.dev/projects/16962).
- **Release verification.** `gh attestation verify ci-kit-<version>.tgz --repo alipajand/ci-kit` and `gh release verify v<version> --repo alipajand/ci-kit`.
