---
status: draft
last-verified: 2026-10-14
---

# Security

## Secrets and machine details
- Secrets live in `.env`, which git ignores, or in the CI secret store. `.env.example` lists every variable name with a comment, never a value.
- What keeps them out of git: `.gitignore`; the tracked-files check (`scripts/check-tracked-files.mjs`) in the pre-commit hook and CI; and gitleaks, in the pre-commit hook when it is installed and in CI over every pull request's commits. The tracked-files check also refuses private keys, databases, archives, build output, `docs/scratch/` and files over 1 MiB.
- What keeps them out of Claude Code's context: the guard hook (`scripts/agent-hooks/guard-tool-use.mjs`) and the deny rules in `.claude/settings.json` ([AGENT_TOOLS.md](AGENT_TOOLS.md)).
- Committed files never reveal a developer's machine: no home-folder paths, user names or host names. Refer to locations by env var.

## The app
BeanQuery is open to the internet but only to invited people. It holds each account's private bags, so its rules are:
- **Untrusted input.** Everything a user sends is untrusted: pastes, uploaded exports, form fields and URLs. So is the every.coffee page an admin imports. A paste or upload is checked against the [bag JSON contract](product-specs/bag-json-contract.md), with its size and bag limits, before anything is saved. Forms are checked by the same Zod definitions. SQL takes values only as `?` parameters. Pages are Hono JSX, which escapes text and attributes, and the content policy allows scripts and styles from the app only, never inline ([web framework](design-docs/web-framework.md)).
- **Account secrets.** An account number is the only key to an account, so it is treated like a password:
  - It is shown once, and only its SHA-256 hash is stored, as for session tokens.
  - It appears in no URL sent to the server, no log and no redirect. The redeem page shows it in its response only, and its download link is a `data:` URL that never leaves the browser.
  - Sign-in and invite redemption are rate-limited. Sessions use `__Host-` cookies that are `HttpOnly`, `Secure` and `SameSite=Lax`, and every form post is checked by its origin ([account model](design-docs/account-model.md)).
- **Account boundaries.** Every query of personal data filters by the signed-in account's id, which comes from the session, never from the request. Another account's bag answers 404, the same as a missing one; the route tests check it.
- **Admin access.** Only `pnpm admin`, run on the server, can make an admin; no web route sets `is_admin`. Each admin tool checks the acting account itself and answers a non-admin with 404. The admin can read the database and its backups; the account page tells users the admin could read the database.
- **Logs and third parties.** Logs hold no IP addresses and no request bodies. Pages load nothing from another site.
- **Reviews.** A change to `src/web/`, `src/account/`, `src/admin/`, input parsing, SQL, sessions, headers, dependencies or the server setup also gets the `security-reviewer` agent's review (CLAUDE.md).

## Coding agents on developer machines
- Instructions are requests; boundaries are guarantees. Each must-never rule in AGENTS.md has a hook, permission, sandbox limit or check behind it where one is possible.
- Claude Code runs shell commands in its sandbox (macOS, Linux and WSL2; native Windows runs them unsandboxed), with network limited to the domains in `.claude/settings.json`.
- Don't run an agent with permission checks bypassed outside a disposable container or VM. People approve almost every prompt they see, so prompts are not a boundary; sandboxes are.
- Keep agent CLIs updated and install packages from lockfiles. Malware has run locally installed agent CLIs with their permission checks switched off to search machines for secrets (the s1ngularity npm attack, 2025).

## Agents in CI
No agent runs in CI today. These rules apply if one is added.
- An agent that holds private data, reads untrusted content (issue and PR text, comments, web pages, dependency files) and can send data out can be steered into leaking it: the lethal trifecta. Every agent workflow removes at least one leg.
- Agent workflows are opt-in, run only for people with write access, skip forks and bots, request the least permissions they need, and pin actions to commit SHAs.
- Untrusted text (issue or PR titles and bodies, comments, branch names) is never interpolated into an agent prompt or a shell command in a workflow. Pass the PR number and let the agent read the rest as data. Interpolated text is how attackers took over CI agents in the "PromptPwnd" attacks (2025).
- AI review is advisory. Branch protection requires the CI checks and a human approval before merge.

## Dependencies
- Ask before adding one. Check that the package exists, is maintained, and is the one you meant: models invent plausible package names, and attackers register them.
- Lockfiles are committed and changed only by the package manager.
- pnpm guards installs; its settings are in `pnpm-workspace.yaml`. It installs no version younger than three days (`minimumReleaseAge`), when most hijacked releases are caught and pulled. It refuses a version published with weaker trust than an earlier one (`trustPolicy`) and transitive dependencies from git or tarball URLs (`blockExoticSubdeps`). Dependency build scripts run only for packages listed under `allowBuilds`, and `strictDepBuilds` fails the install on any other. Add a package there only after reading what its script does.
- When `minimumReleaseAge` refuses a package you need now, wait rather than lowering it. For an urgent security fix, exclude that one package with `minimumReleaseAgeExclude` and say why in the PR.
- Claude Code asks before it edits `pnpm-workspace.yaml` or `.npmrc`, and before any pnpm, npm or npx command that adds, removes, updates or runs packages (the `ask` rules in `.claude/settings.json`).
- Dependabot keeps actions and packages current; review its PRs like any other.

## Reporting a vulnerability
Report it privately through GitHub private vulnerability reporting on the repository, not in a public issue.
