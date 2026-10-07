# BeanQuery

A personal coffee bean database: it records the coffees its owner buys, with their details (roaster, roast, water, variety, altitude and more) and ratings. TypeScript on Node 24 with SQLite; it will run as a web app on a Hetzner server.

This file is the map, not the manual: it says which doc to read for which task. The repository is the system of record; what is not written in the repo does not exist for the next session. Read only the docs your task needs.

| Doc | Read when |
| :-- | :-- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Finding where code lives, or changing how parts depend on each other |
| [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md) | Your first task in this repo, or when two docs seem to disagree |
| [docs/design-docs/index.md](docs/design-docs/index.md) | Making a technical decision, or asking why something is built the way it is |
| [docs/PLANS.md](docs/PLANS.md) | Starting work that spans sessions or areas |
| [docs/exec-plans/active/](docs/exec-plans/active/) | Resuming work, or before starting something that may already be planned |
| [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) | Taking a shortcut, or looking for known gaps |
| [docs/CODE_STYLE.md](docs/CODE_STYLE.md) | Writing code, commits or pull requests |
| [docs/TESTING.md](docs/TESTING.md) | Running or writing tests |
| [docs/SECURITY.md](docs/SECURITY.md) | Handling input, secrets or dependencies, or running agents in CI |
| [docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md) | Changing agent config: skills, hooks, permissions, agent workflows |
| [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) | Adding, moving or checking a doc, or gardening the docs |
| [REVIEW.md](REVIEW.md) | Reviewing a pull request |

## Commands
| Task | Command |
| :-- | :-- |
| One-time setup per clone | `npm run setup` (enables the git hooks) |
| Everything a change must pass | `npm run verify` |
| Doc checks | `npm run check:docs` |
| Tracked-files check | `npm run check:files` (`-- --staged` for staged files only) |
| Skills | Edit `.claude/skills/` |
| Tests of the repo scripts | `npm run test:scripts` |
| Install | `npm ci` |
| Run locally | Not yet: the web app's framework is still to be chosen |
| Lint and format | `npm run lint` to check (Biome), `npm run format` to fix |
| Typecheck | `npm run typecheck` |
| Tests, all and one file | `npm test`, `npx vitest run src/db.test.ts` |

## How to work
1. Read the docs your task needs. For work that spans sessions or areas, create or resume an exec plan first ([PLANS.md](docs/PLANS.md)).
2. Plan before code unless the change fits in one sentence. When the request leaves design choices open, ask the user before building.
3. Write or update the test first and watch it fail, then make it pass.
4. Run `npm run verify` before saying you are done. Report what you ran and the result, and say what you could not check.
5. Update the docs that describe changed behavior in the same change, and set their `last-verified` to today's UTC date.

## Boundaries
- **Always:** keep the change to the task; keep secrets in `.env` (`.env.example` lists the names); put scratch notes in `docs/scratch/`, which git ignores.
- **Ask first:** adding a dependency, changing CI workflows or agent config, deleting files you didn't create, pushing to `main` or someone else's branch, migrating data.
- **Never:** commit secrets, home-folder paths or machine names; skip hooks; force-push; weaken, skip or delete a failing test or check to get green; downgrade a dependency to make a build pass.

## Review guidelines
Review pull requests by [REVIEW.md](REVIEW.md): report only P0 and P1 issues (bugs, security, missing tests, requirement gaps) with file and line evidence. CI already enforces format, lint and doc structure.
