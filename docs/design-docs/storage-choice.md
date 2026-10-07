---
status: draft
last-verified: 2026-10-07
---

# Storage: SQLite through node:sqlite

## Decision
BeanQuery stores its data in one SQLite file, opened with Node's built-in `node:sqlite` module ([src/db.ts](../../src/db.ts)). Every connection turns on foreign keys, which SQLite leaves off by default.

## Why
- The workload is transactional: adding a bean, editing its details, recording a rating. Each touches a few rows. SQLite is built for that; DuckDB is built for analytical scans over large columnar data, and only one process at a time can open its file for writing.
- The data is small (one person's coffee purchases), so analytical speed doesn't matter. Filtering by roaster, variety or altitude is plain SQL either way.
- One file on the Hetzner server is easy to back up and copy, and needs no database server.
- `node:sqlite` ships with Node 24, so there is no native dependency to build or keep updated. It is still marked release candidate and prints an experimental warning. If its API changes, `better-sqlite3` has nearly the same synchronous API.

## Revisit when
- Analysis outgrows SQL over SQLite: DuckDB can attach the SQLite file read-only and query it without migrating.
- More than one machine needs to write at once: move to Postgres.
