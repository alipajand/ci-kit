# Architecture

ci-kit is a set of JavaScript (Node 22+) modules with no runtime dependencies. Four thin GitHub Actions and one CLI run the same commands.

## Components

```
plan/ result/ merge-conflict/ lint/   action.yml + index.mjs: runAction("<command>")
bin/ci-kit.mjs                         the CLI: the same commands from argv and the environment
        │
src/action.mjs                         reads action inputs, runs a command, sets the exit code
src/commands.mjs                       runPlan, runResult, runMergeConflict, runLint: I/O to logic
        │
        ├── src/github.mjs             all I/O: event payload, run context, outputs, summary,
        │                              the REST API client (GET only, path allowlist), git
        ├── src/config.mjs             loads and validates .github/ci-kit.json, fills defaults
        ├── src/plan.mjs               plan modes and job selection (pure)
        ├── src/result.mjs             the fail-closed result judge (pure)
        ├── src/lint.mjs, workflow.mjs workflow rules and a minimal workflow YAML reader (pure)
        ├── src/remerge.mjs            "this head only re-merges a tested head" detection (git)
        ├── src/merge-conflict.mjs     polls the API for mergeability
        ├── src/workspaces.mjs         package workspaces and their dependents
        └── src/glob.mjs               path globs
```

The decision logic (`plan`, `result`, `lint`, `config`, `glob`, `workspaces`) is pure: plain data in, plain data out. The modules that touch the outside world (`github.mjs`, `remerge.mjs`, `merge-conflict.mjs`) are small and validate what they read.

## Data flow in a workflow run

1. **Plan job** (`ci-kit/plan`). Reads the event payload and run context, the changed files (`git diff` between validated commit SHAs) and the configuration. It asks the API whether the pull request conflicts and, with `remerge`, whether the previous head passed CI. It outputs a `mode`, a `reason` and one `true`/`false` per planned job.
2. **Planned jobs** run on `needs.changes.result != 'success' || needs.changes.outputs.<job> != 'false'`, so a failed or missing plan runs them: an error leads to running more, never less.
3. **Result job** (`ci-kit/result`) runs `if: always()` with `toJSON(needs)`. It re-checks the plan against the event, then requires every job's result to match the plan. A missing, failed, cancelled or unexpected result fails it. This is the one required check.
4. **Lint** (`ci-kit/lint`) checks the workflow files and their wiring to the configuration statically.

## Design decisions

- **Fail closed.** Any error in the plan makes the judge require every job. A configuration error throws. Unknown results never pass. See [RULES.md](../RULES.md).
- **Actions, not a reusable workflow,** so each repository keeps its own jobs and runners (README, "Why actions, not a reusable workflow").
- **No runtime dependencies,** so an action runs without an install step and has a small supply-chain surface. fast-check and Prettier are development-only.
- **Read-only.** The actions only read: the API client sends GET requests, and git is used to read history. Outputs go to `$GITHUB_OUTPUT` as single-line values.

The security side of these choices is in [ASSURANCE_CASE.md](ASSURANCE_CASE.md).
