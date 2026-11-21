# ci-kit

[![CI](https://github.com/alipajand/ci-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/alipajand/ci-kit/actions/workflows/ci.yml)
[![CodeQL](https://github.com/alipajand/ci-kit/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/alipajand/ci-kit/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/alipajand/ci-kit/badge)](https://scorecard.dev/viewer/?uri=github.com/alipajand/ci-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Change-aware CI for GitHub Actions. ci-kit decides which jobs a pull request needs, and checks at the end that every job ran as planned. This makes one required check, **CI result**, safe to lean on: a job skipped by mistake can't pass as "not needed".

It ships as four JavaScript actions and a CLI (Node 22+, no runtime dependencies), configured by one file, `.github/ci-kit.json`. A playbook, [RULES.md](RULES.md), covers the workflow rules the linter checks and the ones it can't.

| Action | What it does |
| --- | --- |
| `ci-kit/plan` | Reads the change, prints a plan: a `mode`, a `reason`, and `jobs` (planned job id → true/false). |
| `ci-kit/result` | Judges `toJSON(needs)` against the plan and fails unless every job ran as required. This is the one required check. |
| `ci-kit/merge-conflict` | Asks GitHub whether the pull request conflicts with its base, polling while `mergeable` is still being computed. |
| `ci-kit/lint` | Checks the repository's workflows against the rules in RULES.md, and checks the config against the planned workflow. |

## Why actions, not a reusable workflow

A reusable workflow renames every check to `caller / job`, which breaks required-check names, and it hides the job graph from the repository using it. With actions, each repository keeps its own `ci.yml`, its own job names and its own steps. ci-kit owns only the decisions: what to run, and whether the run is good enough to merge.

## Modes

`plan` picks the first mode that applies, in this order:

| Mode | When | Planned jobs |
| --- | --- | --- |
| `draft` | A draft pull request. | none. CI result fails, so a draft can't merge. |
| `conflict` | The pull request conflicts with its base. | none. CI result fails until the conflict is resolved. |
| `full` | A pull request into, or a push to, a branch in `fullBranches`, any other event, or a pull request with no usable comparison base. | all |
| `remerge` | (`remerge` on) The head merges the base into an earlier head that passed this workflow, and any hand edits made during the merge select no planned job. | none. Always-run jobs still run. |
| `markdown` | (`markdownOnly` on) Every changed file is Markdown, none is excluded, and none is an agent instruction file (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot instructions and prompts, `.claude/`, `.cursor/`, `.windsurf/`). | none, and the always-run jobs are skipped too. |
| `full` | A changed file sits outside every workspace, job path, `noImpact` glob and `alwaysRunPaths` glob. | all |
| `impact` | Otherwise. | the jobs whose workspaces or paths the change affects |

Anything ci-kit can't decide plans everything, and a plan that failed counts as "run everything". Only `impact`, `remerge` and `markdown` can skip work, and only on a ready pull request into a branch outside `fullBranches`.

## Adopting ci-kit

1. Copy [templates/.github/ci-kit.json](templates/.github/ci-kit.json) and [templates/.github/workflows/ci.yml](templates/.github/workflows/ci.yml) into the repository, then rename the jobs and steps to match it.
2. Pin every `alipajand/ci-kit/*@…` reference to a release commit SHA, keeping the tag as a comment (`@<sha> # v1.0.0`). Dependabot's `github-actions` ecosystem then proposes upgrades.
3. Wire each planned job the way the template does, and let `ci-kit lint` confirm the wiring:
   - the plan job exposes `mode` and one output per planned job: `<job>: ${{ fromJSON(steps.plan.outputs.jobs)['<job>'] }}`;
   - a planned job `needs` the plan job and runs `if: ${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.<job> != 'false') }}`. This is fail-open: a failed or skipped plan runs the job;
   - an always-run job skips only on a Markdown-only plan: `needs.changes.result != 'success' || needs.changes.outputs.mode != 'markdown'`;
   - the result job runs `if: always()`, `needs` every other job, and passes `needs: ${{ toJSON(needs) }}` to `ci-kit/result`.
4. Run `npx --yes --allow-git=all github:alipajand/ci-kit#<sha> lint` (or the `lint` action) until it's clean.
5. In branch protection or a ruleset, make **CI result** the only required check of each protected branch. Remove the job-level required checks, because a skipped job counts as passing.

### Versions

Pin a release commit SHA, never a tag or a branch: `alipajand/ci-kit/plan@<sha> # v1.2.1`. Release tags are immutable. Every release commit and tag is signed, and [CHANGELOG.md](CHANGELOG.md) lists what changed. Dependabot's `github-actions` ecosystem proposes upgrades.

From 1.2.1, the [release workflow](.github/workflows/release.yml) publishes each release from its tag. Every release is immutable and carries the packed tarball, its `SHA256SUMS`, and a signed SLSA build provenance attestation. To verify a download:

```bash
gh attestation verify ci-kit-1.2.1.tgz --repo alipajand/ci-kit
gh release verify v1.2.1 --repo alipajand/ci-kit
```

## Configuration

`.github/ci-kit.json`. Unknown keys are errors. Any configuration error fails the plan, and CI result then requires every job.

| Key | Default | Meaning |
| --- | --- | --- |
| `workflow` | `.github/workflows/ci.yml` | The planned workflow, checked by `lint`. |
| `planJob` | `changes` | The job that runs `ci-kit/plan`. |
| `resultJob` | `result` | The job that runs `ci-kit/result`. |
| `fullBranches` | `["main"]` | Base branches whose pull requests and pushes run every job. |
| `workspaces` | `[]` | Workspace directories: `apps/api` or `apps/*`. Each directory needs a `package.json`. A dependency on another workspace makes the dependent affected too, transitively. |
| `jobs` | required | Planned job id → `{ "workspaces": [names], "paths": [globs] }`. A job runs when an affected workspace is in its list, or when a changed file matches its paths. One job may claim `"*"`: every affected workspace no other job names. |
| `workspaceInputs` | `{}` | Workspace name → globs outside its directory that also affect it, such as `db/**`. |
| `noImpact` | `[]` | Globs that select no job: docs, `.gitignore`, example env files. |
| `alwaysRun` | `[]` | Jobs that run on every non-draft plan except `markdown`. Required by CI result. |
| `alwaysRunPaths` | `[]` | Globs that only the always-run jobs check, such as CI scripts or the config itself. |
| `markdownOnly` | `false` | `true`, or `{ "exclude": [globs] }` for Markdown that something tests, such as help content that a build renders. Agent instruction files are always excluded: an agent acts on them, so they run the always-run jobs, where the agent checks belong. |
| `remerge` | `false` | `{ "workflow": "ci.yml" }`: the workflow file whose earlier passing run counts. Needs `actions: read`. |
| `release` | `{ "jobs": [] }` | Jobs that run only on a ready pull request into a full branch, such as e2e or a release gate. They are required there and optional elsewhere. |
| `manual` | `false` | `{ "event": "workflow_dispatch", "jobs": [release jobs], "pinnedSha": true }`: a manual entry point that runs some release jobs. With `pinnedSha`, the run fails unless its checkout matches the `sha` input given to `ci-kit/result`. |
| `lint.ignore` | `{}` | Rule → workflow globs where that rule is off. |

Globs are anchored at the repository root: `*` stays within one path segment, `**` crosses segments, `?` matches one character, and a trailing `/` means everything below.

## What CI result requires

- **Plan job**: if it didn't succeed, or its outputs don't fit the event (a skipping mode on a full branch, say), there is no usable plan and every planned job is required.
- **Always-run jobs**: success, except on a `markdown` plan or a draft.
- **Planned jobs**: success when the plan says true. A job the plan didn't need may be skipped or succeed. With no usable plan, all of them are required.
- **Release jobs**: success on a ready pull request into a full branch; elsewhere skipped or success. On a manual run, `manual.jobs` must succeed and the other release jobs must be skipped.
- **Any other job in `needs`**: success.
- A `draft` or `conflict` plan always fails.

It prints one line per job (`ok`, `FAIL`) and a summary table.

## Agent checks

The template's `agents` job, an always-run job, uses three tools that work the same way (deterministic, no LLM):

- [agent-readiness-action](https://github.com/alipajand/agent-readiness-action) scores how ready the repository is for AI coding agents. With `context-audit`, it also audits the agent instruction files with its bundled [agent-context-doctor](https://github.com/alipajand/agent-context-doctor). Set `min-score` to the current score, and keep `max-score-drop: 0` on pull requests so no change lowers it. `context-fail-on: medium` fails on unsafe or contradictory instructions.
- [agent-pr-reviewer-lite](https://github.com/alipajand/agent-pr-reviewer-lite) annotates the files in a pull request that a human should review before merge. It's advisory in the template, and its config (`agent-pr-reviewer-lite.config.json`) is read from the base, so a pull request can't change its own review. To make it a gate, drop the `exit 0`.
- [agent-readiness-kit](https://github.com/alipajand/agent-readiness-kit) is the CLI behind the score. Run it locally (`ark audit`, `ark fix`) to see what's missing.

The reviewer installs from GitHub at a pinned commit. npm 12 refuses git dependencies unless `--allow-git=all` is passed, so the template passes it.

## CLI

```bash
npx --yes --allow-git=all github:alipajand/ci-kit#<sha> lint [--root .] [--config .github/ci-kit.json]
```

npm 12 refuses git-hosted packages unless `--allow-git=all` is passed, which is why the flag is there.

`plan`, `result` (reads `NEEDS`, and `PINNED_SHA` or `--sha`) and `merge-conflict [--fail]` read the same environment GitHub Actions sets: `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`, `GITHUB_REPOSITORY`, `GITHUB_TOKEN`.

## Developing

```bash
npm ci --ignore-scripts
npm test
```

The tests include property-based tests ([fast-check](https://fast-check.dev), the only dev dependency) for the glob matcher, the plan, the result judge and the API client.

```bash
node bin/ci-kit.mjs lint
```

ci-kit's own CI runs its own actions at the commit under test (`uses: $/plan`), then actionlint, zizmor and the agent checks. CodeQL and OpenSSF Scorecard run separately. See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute, [SECURITY.md](SECURITY.md) to report a vulnerability, and [CHANGELOG.md](CHANGELOG.md) for releases.
