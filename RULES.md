# CI rules

The rules every GitHub Actions setup using ci-kit follows. **Lint** marks the ones `ci-kit lint` checks. **zizmor** and **actionlint** mark the ones those tools check. Run all three in CI, because none of them covers the others.

## Supply chain

1. **Pin every action to a full commit SHA**, with the tag as a comment: `uses: actions/checkout@<40-hex sha> # v6.1.0`. Pin Docker images by `@sha256:` digest. A tag can be moved; a SHA can't. *Lint (`pinned-uses`), zizmor.*
2. **Let Dependabot propose upgrades**, with a cooldown so a freshly compromised release isn't adopted the day it ships:

   ```yaml
   - package-ecosystem: github-actions
     directory: /
     schedule: { interval: weekly }
     cooldown: { default-days: 7 }
   ```

3. **Pin tool versions** run with `pipx run`, `uvx` or `npx` (`zizmor==1.31.1`, not `zizmor`).

## Permissions and credentials

4. **Set top-level `permissions: contents: read`**, and grant more per job, with a comment saying why (`pull-requests: read # the merge-conflict check`). *Lint (`permissions`), zizmor.*
5. **Set `persist-credentials: false` on every checkout.** A step that needs to push gets its own token explicitly. *Lint (`checkout-credentials`), zizmor.*
6. **Never interpolate untrusted context into `run:`.** Pass `github.event.*`, `github.head_ref` and similar through `env:` and quote the variable. *zizmor.*
7. **No `pull_request_target` or `workflow_run` running pull request code.** *zizmor.*
8. **Never echo secrets or untrusted inputs to logs or summaries.** Validate the shape of an input (a 40-hex SHA, say) before printing it.

## Cost and speed

9. **Every job sets `timeout-minutes`.** The default is six hours. *Lint (`timeout`).*
10. **Set `concurrency` per pull request with `cancel-in-progress`**, and per commit for pushes, so a newer push cancels an older run but one merge never cancels another's validation. *Lint (`concurrency`).*
11. **Run only what the change needs.** Map jobs to workspaces and paths in `.github/ci-kit.json`, and skip Markdown-only and re-merge pull requests. Anything unmapped runs everything.
12. **Pin runner images** (`ubuntu-24.04`, not `ubuntu-latest`), so an image upgrade is a change you make, not one that happens to you.

## Drafts

13. **Trigger on `ready_for_review` and `converted_to_draft`.** A workflow that skips drafts but doesn't trigger on `ready_for_review` never runs when the draft is marked ready. Moving a pull request back to draft cancels the in-flight run. *Lint (`draft-ready`).*
14. **A draft fails CI result**, so it can't be merged by accident. Its jobs don't run.

## Required checks

15. **Make one check required: CI result.** A skipped job counts as passing, so a required job check is one bad `if:` away from waving a pull request through. *Lint (`result-job`).*
16. **CI result runs `if: always()` and `needs` every job.** It fails unless each job ran as the plan required, and it fails closed: no usable plan means every job was required. *Lint (`result-job`).*
17. **Planned jobs fail open.** They run unless the plan succeeded and said skip: `!cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.<job> != 'false')`. *Lint (`plan-guard`).*
18. **Always-run jobs run whenever the plan didn't succeed.** *Lint (`always-run`).*
19. **The config and the workflow agree.** Every job the config names exists, and the plan job exposes each planned job. *Lint (`config`, `plan-job`, `config-job`).*

## Release branches

20. **A pull request into a release branch runs everything**, release jobs included, and so does a push to it: the merged commit isn't the one the pull request tested.
21. **A manual run has its own entry point** (`workflow_dispatch`) that runs named release jobs on a pinned commit. It never reuses the pull request path. The pinned SHA must match the run's checkout. Otherwise its checks report on a different commit from the one they tested.

## Silencing a rule

Turn a rule off for some workflows with `"lint": { "ignore": { "<rule>": ["<glob>"] } }`, or for one line with `# ci-kit-ignore: <rule> <reason>` on that line or the line above. Always give the reason.
