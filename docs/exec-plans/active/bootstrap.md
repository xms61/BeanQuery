# Bootstrap the repository from the template

## Purpose
Turn the template into this project's repository: the stack chosen and set up, `npm run verify` running the stack's checks locally and in CI, the docs describing this project instead of placeholders, and only the agents the team uses configured. Done when `npm run check:docs` reports no template placeholders and CI is green.

## Context
- [AGENTS.md](../../../AGENTS.md): the commands table and boundaries to fill in.
- [AGENT_TOOLS.md](../../AGENT_TOOLS.md): which agent reads which file, and how to remove one.
- [ARCHITECTURE.md](../../../ARCHITECTURE.md), [CODE_STYLE.md](../../CODE_STYLE.md), [TESTING.md](../../TESTING.md), [SECURITY.md](../../SECURITY.md): the docs with `TODO(template)` placeholders.
- `npm run check:docs` lists every placeholder left, by file and line.

## Plan
1. Interview the owner, one question at a time: what the project does and for whom; the stack and runtime; where it will run; which coding agents the team uses; whether AI review should run in CI. Record the answers in the Decision log.
2. Remove the agents the team doesn't use, following AGENT_TOOLS.md.
3. Set up the stack: dependencies, formatter, linter, typecheck and test runner, with one passing test. Fill in the AGENTS.md commands table, add the checks to the `verify` script, and add `cache: npm` to the CI setup-node step once there are dependencies.
4. Update `copilot-setup-steps.yml` (and the Codex cloud setup script, if used) so cloud agents can run `npm run verify`.
5. Fill in README.md, ARCHITECTURE.md and the Stack sections of CODE_STYLE.md and TESTING.md. Once there are two layers, enforce the dependency direction with a lint rule or a structural test.
6. Replace the remaining placeholders, then delete TEMPLATE.md.

## Progress
- [x] Owner interviewed, answers logged (2026-10-07)
- [x] Unused agents removed: Codex, Gemini CLI, Cursor, Copilot and the Claude CI workflows (2026-10-07)
- [x] Stack set up; `verify` runs lint (Biome), typecheck (tsc) and tests (Vitest) (2026-10-07)
- [x] Cloud agent setup updated: not needed, no cloud agents are used (2026-10-07)
- [x] README.md, ARCHITECTURE.md, CODE_STYLE.md and TESTING.md filled in (2026-10-07)
- [x] No template placeholders left; TEMPLATE.md deleted (2026-10-07)
- [ ] First commit pushed, `main` protected, CI green

## Decision log
- 2026-10-07: BeanQuery is a personal coffee bean database: beans bought, their details (roaster, roast, water, variety, altitude and more) and ratings.
- 2026-10-07: Claude Code is the only agent. `.claude/skills/` is the skills source; `.agents/` and the sync-skills mirror script are gone.
- 2026-10-07: No AI review in CI; `claude.yml` and `claude-review.yml` are deleted. Review runs locally through the `reviewer` subagent.
- 2026-10-07: TypeScript on Node 24, with Biome for lint and format and Vitest for tests. `@types/node` is pinned to 24 to match the runtime.
- 2026-10-07: SQLite through the built-in `node:sqlite`, not DuckDB ([storage choice](../../design-docs/storage-choice.md)).
- 2026-10-07: Will run as a web app on a Hetzner server. The web framework and deployment are left to their own exec plan.

## Surprises
- 2026-10-07: Biome's recommended rules flagged the template scripts: three needed formatting and one `forEach` callback returned a value. Fixed in place; script tests still pass.
- 2026-10-07: Vitest's default include pattern matches `scripts/*.test.mjs`, which use `node:test`. `vitest.config.ts` limits it to `src/`.

## Validation
`npm run verify` passes with the stack's checks included, `npm run check:docs` prints no placeholder warnings, and CI is green on the pull request that finishes this plan.

## Outcome
Filled in when the plan moves to completed/.
