@AGENTS.md

## Claude Code
- Skills live in `.claude/skills/`. Claude Code is the only agent this repo is set up for, so there is no shared copy to sync.
- Before you call a non-trivial change done, have the `reviewer` subagent review the diff in a fresh context.
- Shared permissions, sandbox and hooks are in `.claude/settings.json`. Personal overrides go in `.claude/settings.local.json`, which git ignores.
