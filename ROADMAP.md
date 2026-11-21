# Roadmap

What ci-kit intends to do, and not do, through the end of 2027. Plans can change; when they do, this file changes in the same pull request.

## Planned

- **Stable 1.x.** Keep the action inputs and outputs, the configuration format and the CLI backwards compatible. Anything that has to break waits for 2.0, with upgrade notes in [CHANGELOG.md](CHANGELOG.md).
- **Merge queues.** Plan `merge_group` runs from the queued changes instead of always running everything.
- **More lint rules.** Check more of [RULES.md](RULES.md) automatically, for example a job-level `permissions:` block on every job that needs write access.
- **Configuration schema.** Publish a JSON Schema for `.github/ci-kit.json` so editors can validate it.
- **Supply chain.** Keep every release signed with build provenance, keep the OpenSSF Scorecard and Best Practices results current, and adopt the newer GitHub Actions security features as they ship.
- **Documentation.** Add worked examples for monorepos (workspaces and dependents) and for release jobs.

## Not planned

- Running or scheduling jobs. ci-kit decides which jobs a change needs and checks the results. GitHub Actions runs the jobs.
- Other CI systems. ci-kit is for GitHub Actions only.
- Runtime dependencies. The actions keep running on Node built-ins, with nothing to install.
- Publishing to npm. ci-kit ships as GitHub Actions and a CLI run from a pinned commit.
- Weakening the fail-closed design. No option will let a missing or failed job pass CI result.
