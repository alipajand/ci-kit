# Governance

ci-kit is a small project with one maintainer. This file says who decides what, how decisions are made, and how the project continues if the maintainer can't.

## Roles

| Role | Who | Responsibilities |
|---|---|---|
| Maintainer | Ali Pajand ([@alipajand](https://github.com/alipajand)) | Reviews and merges pull requests. Triages issues. Cuts releases (version bump, signed tag). Responds to vulnerability reports as [SECURITY.md](SECURITY.md) describes. Administers the repository settings and rulesets. Enforces the [code of conduct](CODE_OF_CONDUCT.md). Keeps the [roadmap](ROADMAP.md) current. |
| Contributor | Anyone who opens an issue or a pull request | Follows [CONTRIBUTING.md](CONTRIBUTING.md): tests with every change, the coding style, a DCO sign-off on every commit, and signed commits. |

[CODEOWNERS](.github/CODEOWNERS) lists the maintainer as the owner of every path.

## Decisions

- Changes are proposed as pull requests, or as issues first for anything large. Every change to `main` goes through a pull request with a passing **CI result** and CodeQL, signed commits and no open high-severity code-scanning alert (the `main` ruleset enforces this, with no bypass).
- The maintainer decides whether a change is accepted, guided by the project's rules: fail closed, no runtime dependencies, and least privilege ([RULES.md](RULES.md), [CONTRIBUTING.md](CONTRIBUTING.md)). A declined proposal gets a reason on the issue or pull request.
- Disagreements are discussed in the open on the issue or pull request. The maintainer makes the final call.
- Releases follow semantic versioning. Breaking changes need a major version and an entry in [CHANGELOG.md](CHANGELOG.md) that says how to upgrade.

## Continuity

ci-kit must be able to continue if the maintainer dies, is incapacitated, or stops supporting it:

- **Access.** A successor the maintainer designates through GitHub's [account successor](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-access-to-your-personal-repositories/maintaining-ownership-continuity-of-your-personal-accounts-repositories) setting can take over the repository to create and close issues, accept pull requests and publish releases. Secrets aren't involved: CI uses only the run's temporary `GITHUB_TOKEN`, and releases are signed through GitHub's OIDC identity, not a stored key.
- **Users are never stranded.** Consumers pin release commit SHAs, so existing workflows keep working whatever happens to the repository. The code is MIT-licensed with no runtime dependencies, so anyone can fork it and keep a pinned copy.
- **Bus factor.** The bus factor is 1 today. A second maintainer with admin access would raise it to 2. Contributors who want to help maintain ci-kit are welcome to say so in an issue.

## Changing this document

Governance changes go through a pull request like any other change, and are listed in the changelog.
