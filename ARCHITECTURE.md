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
| `src/account/` | Anonymous accounts: account numbers, invites, sessions, time zones, deleting an account, and `pnpm admin`, the only code that makes admins |
| `src/admin/` | The owner's tools, each refused to non-admins: invites, the account list and deleting an account, roasters and aliases, and editing, merging, deleting and undoing edits of pool coffees |
| `src/bag/` | One account's bags: import of a pasted or uploaded document, manual entry, edits, re-paste, state, delete, export, the library with phases and filters, the reminders, and the gear: grinders with rename, note and delete |
| `src/coffee/` | Coffees: the name key and close matches, editing facts, "Use mine" and moving a bag, pool search with the pool page and a coffee's page, the collective rating, and making a bean private or public |
| `src/contract/` | The bag JSON contract as one Zod definition: validation by field path, and the generated JSON Schema in `docs/generated/` |
| `src/web/` | The web layer on Hono: the server, sessions and security headers, rate limits, the pages (server-rendered JSX) and their routes |
| `src/layers.test.ts` | The layer rule below, as a test |
| `src/roaster/` | The roaster registry: fetching and parsing every.coffee/roasters, importing it by slug, the admin's own roasters, each account's private roaster notes, and the `pnpm roasters:import` command |
| `src/ops/` | The server's jobs and the restore: an online backup of the database with rotation, a checked restore, the collective-rating rebuild as `pnpm ops`, and the query behind `/healthz` |
| `Dockerfile`, `deploy/` | The deploy image and the VPS's compose file, Caddy site and settings ([hosting and deploy](docs/design-docs/hosting-and-deploy.md)) |
| `scripts/` | Repo tooling: the doc and tracked-file checks, the agent guard hook, setup |
| `docs/` | The system of record ([KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md)) |

## Layers
Three layers, and dependencies point one way: `db → domain → web`.
- **db:** `src/db.ts` and `src/db/`, opening the database and the schema.
- **domain:** `src/account/`, `src/admin/`, `src/bag/`, `src/coffee/`, `src/contract/`, `src/ops/` and `src/roaster/`. They take plain values and an account id, and never see a request.
- **web:** `src/web/`. Only it imports Hono, and it runs no SQL of its own: a route calls a domain function.

`src/layers.test.ts` enforces this, and its failure messages say how to fix the import. A new top-level folder of `src/` fails it until it is given a layer.

## Invariants
- Every database connection is opened with `openDatabase`, so foreign keys are enforced (`src/db.test.ts`).
- Tests never touch a real database file; they use `:memory:` (see [TESTING.md](docs/TESTING.md)).
