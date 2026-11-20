# Changelog

Versions follow semantic versioning. Consumers pin a release commit SHA, with the tag as a comment.

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
