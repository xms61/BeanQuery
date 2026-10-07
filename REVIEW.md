# Review guidelines

For AI reviewers (the Claude Code `reviewer` subagent) and for people. Keep it short: a long review brief dilutes the rules that matter.

## Report
- Only issues that matter: bugs, security problems, data loss, behavior the change claims but doesn't deliver, and new behavior without a test. Label each **P0** (must fix before merge) or **P1** (should fix before merge).
- Each finding gives the file and line, the situation in which it goes wrong, and a suggested fix.
- At most three P2 nits, and only when they hurt readability. If the change is sound, say so in one line instead of looking for something to report.

## Skip
- Anything CI enforces: formatting, lint, doc structure, tracked-file rules.
- Generated files, lockfiles and `docs/scratch/`.
- Style preferences that [docs/CODE_STYLE.md](docs/CODE_STYLE.md) doesn't state.

## Always check
- Tests: new behavior has a test that fails without the change, and no test or check was weakened, skipped or deleted to get green.
- Secrets and machine details: none in code, logs, docs or fixtures ([docs/SECURITY.md](docs/SECURITY.md)).
- Docs: changed behavior is reflected in the doc the [AGENTS.md](AGENTS.md) map points to.
- Agent and CI config: changes to `.github/workflows/`, `.claude/`, `.githooks/` or `scripts/agent-hooks/` are flagged for a human reviewer, and must never let untrusted text (issues, PR descriptions, comments) reach an agent that holds secrets.

## Re-reviews
Report only new findings and whether earlier ones were fixed. Don't repeat resolved points.
