# Changelog

Versions follow semantic versioning. Consumers pin a release commit SHA, with the tag as a comment.

## 1.3.0 (2026-11-27)

- An opt-in `exactPlan` setting requires the result judge to see a successful, usable plan and exactly the planned job outcomes. The default keeps the all-jobs fallback.
- Lint accepts GitHub's self-repository syntax (`uses: $/path`) as this repository's own code, like `./path`. RULES.md rule 1 recommends it for in-repo actions.
- ci-kit's own CI references its actions as `$/plan`, `$/result`, `$/merge-conflict` and `$/lint`, which clears zizmor's `self-repository` notes. A scoped `.github/actionlint.yaml` ignore covers actionlint 1.7.12, which doesn't know the syntax yet.
- The plan passes only full commit SHAs from the event payload to `git diff`, so a malformed `before`/`after` value can't reach git's command line as an option.
- CI checks formatting with Prettier (`npm run format:check`, a new dev dependency) and fails below 80% line, branch or function test coverage (`npm run test:coverage`). The code is reformatted to match.
- New GOVERNANCE.md, ROADMAP.md, CODE_OF_CONDUCT.md (Contributor Covenant 2.0), docs/ARCHITECTURE.md and a security assurance case (docs/ASSURANCE_CASE.md). SECURITY.md describes the vulnerability response process. CONTRIBUTING.md adds the test policy, the coding style and the Developer Certificate of Origin sign-off.

## 1.2.1 (2026-11-20)

- Releases are published by a release workflow from a signed `v*` tag. Each one is immutable and carries the npm-packed tarball, `SHA256SUMS` and a signed SLSA build provenance attestation (`gh attestation verify`).
- Property-based tests with fast-check (the one dev dependency) for the glob matcher, Markdown-only detection, the plan, the fail-closed result judge and the API path guard.
- package.json lists the published `files`. Dependabot also watches npm.
- No change to the actions or the CLI.

## 1.2.0 (2026-11-20)

- New CodeQL workflow (the `actions` and `javascript-typescript` languages, `security-extended` queries) and an OpenSSF Scorecard workflow.
- Actions upgraded: checkout v7.0.1 and setup-node v7.1.0, in the workflows and the template.
- New SECURITY.md, CONTRIBUTING.md, CODEOWNERS, issue forms and a pull request template.
- The GitHub API client only accepts plain `/repos/<owner>/<name>/…` paths over https. A malformed repository name or pull request number in the run context is dropped before any request is made (CodeQL `js/file-access-to-http`).
- Lint escapes every regular-expression metacharacter in job ids and rule names (CodeQL `js/incomplete-sanitization`).
- README: version pinning guidance replaces the private-repository note, and the CLI examples pass `--allow-git=all` for npm 12.

## 1.1.0 (2026-11-20)

- Agent instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot instructions and prompts, `.claude/`, `.cursor/`, `.windsurf/`) never count as Markdown-only, so a change to one always runs the always-run jobs.
- The template gains an `agents` job: agent-readiness-action with the agent-context-doctor audit and a no-drop baseline, plus advisory agent-pr-reviewer-lite annotations. ci-kit runs the same job on itself.
- RULES.md gains the agent instruction rules (22–26).
- AGENTS.md and CLAUDE.md for agents working on ci-kit.

## 1.0.0 (2026-11-20)

- `plan`, `result`, `merge-conflict` and `lint` actions, and the `ci-kit` CLI.
- Plan modes: draft, conflict, full, remerge, markdown and impact. Planning is workspace-aware and follows dependents transitively.
- A fail-closed CI result judge, with release jobs and a manual entry point on a pinned SHA.
- Workflow lint rules: permissions, timeout, concurrency, pinned-uses, checkout-credentials, draft-ready, plus the plan and result wiring.
- Starter templates in `templates/.github/`.
