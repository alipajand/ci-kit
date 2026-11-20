# Changelog

Versions follow semantic versioning. Consumers pin a release commit SHA, with the tag as a comment.

## 1.0.0 (2026-11-20)

- `plan`, `result`, `merge-conflict` and `lint` actions, and the `ci-kit` CLI.
- Plan modes: draft, conflict, full, remerge, markdown and impact. Planning is workspace-aware and follows dependents transitively.
- A fail-closed CI result judge, with release jobs and a manual entry point on a pinned SHA.
- Workflow lint rules: permissions, timeout, concurrency, pinned-uses, checkout-credentials, draft-ready, plus the plan and result wiring.
- Starter templates in `templates/.github/`.
