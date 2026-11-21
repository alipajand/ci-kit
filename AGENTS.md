# AGENTS.md: ci-kit

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot) working in this repository.

ci-kit plans which CI jobs a change needs and judges, at the end of a run, whether every job ran as planned. Read [README.md](README.md) for what it does and [RULES.md](RULES.md) for the workflow rules it enforces.

## Commands

```bash
npm ci --ignore-scripts       # dev dependencies only: fast-check and Prettier
npm test                      # node --test: test/**/*.test.mjs and the property tests (*.test.js)
npm run test:coverage         # what CI runs: fails below 80% line, branch or function coverage
npm run format                # Prettier; CI runs npm run format:check
node bin/ci-kit.mjs lint      # ci-kit's own workflow rules, on this repository
```

CI also runs actionlint and `uvx zizmor==1.31.1 --offline --min-severity medium .github/workflows templates/.github/workflows`. Run them when you change a workflow or a template.

## Layout

- `src/`: the logic. `plan.mjs` (modes and job selection), `result.mjs` (the fail-closed judge), `config.mjs` (`.github/ci-kit.json` validation), `lint.mjs` and `workflow.mjs` (workflow rules), `merge-conflict.mjs`, `remerge.mjs`, `workspaces.mjs`, `glob.mjs`, `github.mjs` (Actions I/O), `commands.mjs` (wires I/O to logic).
- `plan/`, `result/`, `merge-conflict/`, `lint/`: one JavaScript action each (`action.yml` plus a two-line `index.mjs`).
- `bin/ci-kit.mjs`: the CLI.
- `templates/.github/`: the starter config and workflow consumers copy.
- `test/`: `node:test` suites; `test/fixtures/monorepo/` is a small workspace repository.

## Rules

- No runtime dependencies. Node built-ins only, Node 22+. Consumers run the actions without installing anything. fast-check (property tests) and Prettier (formatting) are the only dev dependencies.
- Fail closed. A broken config, a failed plan or an unknown answer must lead to running more, never less. CI result must never pass a skipped job that should have run.
- Keep `${{ }}` out of `action.yml` everywhere except `default:` values: the runner evaluates it even in descriptions (`test/actions.test.mjs`).
- Pin every action by full commit SHA with the tag as a comment, and every `docker://` image by digest.
- Never print a token, and never echo an input into a log or summary before validating its shape.
- A behavior change updates the README (modes, config table, what CI result requires), RULES.md when a rule changes, the templates when wiring changes, and CHANGELOG.md.
- Add or update tests next to the change; a bug fix gets a regression test. `npm run test:coverage`, `npm run format:check` and `node bin/ci-kit.mjs lint` must pass before a commit.
- Commits are signed (`-S`) and signed off (`-s`, the [DCO](CONTRIBUTING.md#developer-certificate-of-origin)). Don't rewrite pushed history or move a release tag unless the owner asks.

## Safety boundaries

- Never commit secrets, tokens or credentials, and never print one in a log, test or summary.
- Don't edit `test/fixtures/` to make a test pass. Fix the code.
- Don't weaken a lint rule to clear a finding. Use `# ci-kit-ignore: <rule> <reason>` on the line, or fix the workflow.
- Don't push to `main`, force-push, move or create tags, or change repository settings without the owner's explicit request. Releases (tags, version bumps) are the owner's decision.
- Don't add a network call outside `src/github.mjs`, and only to the GitHub API the run's token can reach.

## Reporting back

When you finish, report what changed, the commands you ran with their results (`npm run test:coverage`, `npm run format:check`, `node bin/ci-kit.mjs lint`, actionlint, zizmor), and anything you skipped or couldn't verify. Don't claim a check passed unless it ran.
