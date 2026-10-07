---
status: draft
last-verified: 2026-10-07
---

# Architecture

BeanQuery is a TypeScript app on Node 26 that keeps its data in one SQLite file ([storage choice](docs/design-docs/storage-choice.md)). It will run as a web app on a Hetzner server; the web framework is not chosen yet. Keep this doc to what a reader can't see quickly from the code: the parts, which way dependencies point, and the rules that hold everywhere.

## Code map
| Path | Holds |
| :-- | :-- |
| `src/` | Application code, with each test next to its module as `*.test.ts` |
| `src/db.ts` | Opens the SQLite database with foreign keys on |
| `scripts/` | Repo tooling: the doc and tracked-file checks, the agent guard hook, setup |
| `docs/` | The system of record ([KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md)) |

## Layers
There is one layer so far: data access (`src/db.ts`). When a second layer arrives (domain logic, then the web layer), name the layers here with the one direction dependencies may point, for example `db → domain → web`, and enforce it with a structural test or a Biome import rule whose failure message says how to fix the import. A rule written only here will be broken.

## Invariants
- Every database connection is opened with `openDatabase`, so foreign keys are enforced (`src/db.test.ts`).
- Tests never touch a real database file; they use `:memory:` (see [TESTING.md](docs/TESTING.md)).
