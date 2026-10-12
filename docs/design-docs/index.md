---
status: draft
last-verified: 2026-10-12
---

# Design docs

Technical decisions and why they were made, one doc per decision, named after it (for example `storage-choice.md`). Each doc gets a row here; the doc checks fail when a row is missing or its status differs from the doc's.

| Doc | Status | Summary |
| :-- | :-- | :-- |
| [Account model](account-model.md) | draft | Anonymous accounts by invitation: account numbers, sessions, the admin, and what that does and doesn't promise |
| [Core beliefs](core-beliefs.md) | draft | How the repo is run so that agents can do most of the work safely |
| [Storage choice](storage-choice.md) | draft | SQLite through node:sqlite, not DuckDB, and when to revisit |
