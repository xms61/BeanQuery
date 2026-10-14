---
status: draft
last-verified: 2026-10-14
---

# Storage: SQLite through node:sqlite

## Decision
BeanQuery stores its data in one SQLite file, opened with Node's built-in `node:sqlite` module ([src/db.ts](../../src/db.ts)). Every connection turns on foreign keys, which SQLite leaves off by default.

## Why
- The workload is transactional: adding a bean, editing its details, recording a rating. Each touches a few rows. SQLite is built for that; DuckDB is built for analytical scans over large columnar data, and only one process at a time can open its file for writing.
- The data is small, so analytical speed doesn't matter: a few friends' bags, the shared pool of coffees, and the roaster registry. That is thousands of rows, not millions. Filtering by roaster, variety or altitude is plain SQL either way.
- Many accounts share one writer. SQLite allows one write at a time, and `node:sqlite` is synchronous, so the app's requests write one after another, each in a few milliseconds. The nightly jobs run in their own processes, and every connection waits up to 5 s for a lock (`busy_timeout`) instead of failing. Each account's rows carry its `account_id`, and every query of personal data filters by it.
- One file on the Hetzner server is easy to back up and copy, and needs no database server.
- `node:sqlite` ships with Node 26 without an experimental warning, so there is no native dependency to build or keep updated. If its API changes, `better-sqlite3` has nearly the same synchronous API.

## Revisit when
- Analysis outgrows SQL over SQLite: DuckDB can attach the SQLite file read-only and query it without migrating.
- More than one machine needs to write at once, or writes queue long enough for users to notice: move to Postgres.
