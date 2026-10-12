---
status: draft
last-verified: 2026-10-12
---

# Architecture

BeanQuery is a TypeScript app on Node 26 that keeps its data in one SQLite file ([storage choice](docs/design-docs/storage-choice.md)). It will run as a web app on a Hetzner server; the web framework is not chosen yet. Keep this doc to what a reader can't see quickly from the code: the parts, which way dependencies point, and the rules that hold everywhere.

## Code map
| Path | Holds |
| :-- | :-- |
| `src/` | Application code, with each test next to its module as `*.test.ts` |
| `src/db.ts` | Opens the SQLite database with foreign keys on |
| `src/db/migrate.ts` | The schema, as numbered migrations applied once each by `migrate` |
| `src/bag/` | Importing a pasted or uploaded document into one account, and exporting an account's bags |
| `src/coffee/` | The coffee name key that pool matching uses |
| `src/contract/` | The bag JSON contract as one Zod definition: validation by field path, and the generated JSON Schema in `docs/generated/` |
| `src/roaster/` | The roaster registry: fetching and parsing every.coffee/roasters, importing it by slug, the admin's own roasters, and the `pnpm roasters:import` command |
| `scripts/` | Repo tooling: the doc and tracked-file checks, the agent guard hook, setup |
| `docs/` | The system of record ([KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md)) |

## Layers
Data access is `src/db.ts` and `src/db/`. The roaster registry (`src/roaster/`) is the first domain code and imports from them; the rule that enforces the direction comes with the web layer (see the [tech-debt tracker](docs/exec-plans/tech-debt-tracker.md)). When it comes, name the layers here with the one direction dependencies may point, for example `db → domain → web`, and enforce it with a structural test or a Biome import rule whose failure message says how to fix the import. A rule written only here will be broken.

## Invariants
- Every database connection is opened with `openDatabase`, so foreign keys are enforced (`src/db.test.ts`).
- Tests never touch a real database file; they use `:memory:` (see [TESTING.md](docs/TESTING.md)).
