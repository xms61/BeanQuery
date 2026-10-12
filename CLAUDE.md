@AGENTS.md

## Claude Code
- Skills live in `.claude/skills/`. Claude Code is the only agent this repo is set up for, so there is no shared copy to sync.
- Before you call a non-trivial change done, have the `reviewer` subagent review the diff in a fresh context.
- When the change touches `src/web/`, `src/account/`, `src/admin/`, input parsing, SQL, sessions, headers, dependencies or the server setup, also have the `security-reviewer` subagent review it. Both can run in parallel.
- Shared permissions, sandbox and hooks are in `.claude/settings.json`. Personal overrides go in `.claude/settings.local.json`, which git ignores.
