---
status: draft
last-verified: 2026-10-07
---

# Code style

How code in this repo is written. A rule a tool can check belongs in the linter or formatter config, not here; this doc keeps the judgment calls and their reasons.

## Principles
- Small functions with one job, and clear names instead of comments that say what the code does. Comments explain why.
- No speculative abstractions: build for the cases that exist. Three similar lines beat a premature helper.
- Delete dead code instead of keeping it "for later"; git remembers it.
- Prefer boring, well-known libraries and the platform's built-ins. Agents and new people already know them, and their APIs are stable.
- Validate input where it enters the system, and make error messages say what went wrong and how to fix it. The reader is often an agent that will act on the message.
- Structured logs with stable field names. Never log secrets or personal data.
- No emoji or marketing words in code, logs, commits or docs.

## Stack
- TypeScript 7 in strict mode on Node 24, as ES modules ([tsconfig.json](../tsconfig.json)). Relative imports end in `.js`, as `nodenext` module resolution requires, even though the file is `.ts`.
- Biome lints and formats everything ([biome.json](../biome.json)): 2-space indents, single quotes, 120-column lines. `npm run format` fixes what it can.
- Prefer Node built-ins over packages when they do the job, for example `node:sqlite` for the database.
- SQL table and column names are `snake_case` and singular (`bean`, `roaster_id`); TypeScript names follow the usual camelCase and PascalCase.

## Commits and pull requests
- Commit subjects follow `type(scope): summary`, with types feat, fix, docs, refactor, test, chore and ci.
- One logical change per PR, small enough to review in one sitting. Agent PRs follow the same rules as human ones; small changes are where agents succeed most often.
- The PR template asks what was verified and how. "Not checked" is a valid answer; a missing answer is not.
