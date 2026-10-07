---
status: draft
last-verified: 2026-10-07
---

# Testing

## Principles
- Test first: write or update the test, watch it fail for the right reason, then make it pass. A test that has never failed proves nothing.
- `npm run verify` runs every check a change must pass, locally and in CI. When it gets slow, add a fast subset for the edit loop; don't drop checks from `verify`.
- Tests never use the network or real user data. Use in-memory or temp-dir stores and stubs.
- Quiet on success, specific on failure: a failing test names the case and the expected and actual values. Thousands of lines of passing output bury the one line an agent needs.
- Never weaken, skip or delete a failing test to get green. If the test is wrong, fix it in its own commit and say why in the PR.
- A behavior that a unit test can't reach (a UI flow, a deploy) gets an end-to-end check the agent can run itself, such as a browser test or a screenshot to compare.

## Stack
- Vitest ([vitest.config.ts](../vitest.config.ts)) runs `src/**/*.test.ts`. Each test file sits next to the module it tests.
- `npm test` runs all of them; `npx vitest run src/db.test.ts` runs one file, and `npx vitest` re-runs on save.
- Database tests open `openDatabase(':memory:')`, a fresh in-memory SQLite database per test, and never a real file.
- No coverage threshold yet.

## Repo scripts
The checks in `scripts/` have their own tests, next to each script as `*.test.mjs`, run by `npm run test:scripts` (Node's built-in test runner). They build their fixtures in temp directories.
