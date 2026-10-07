---
status: draft
last-verified: 2026-10-07
---

# Knowledge base

How the docs in this repo are laid out, checked and kept true. The principles behind it are in [core beliefs](design-docs/core-beliefs.md).

## Layout
| Path | Holds | Written by |
| :-- | :-- | :-- |
| [AGENTS.md](../AGENTS.md) | The map: which doc to read for which task, the commands, the boundaries. Under 100 lines | Hand |
| [CLAUDE.md](../CLAUDE.md) | Imports AGENTS.md, plus the few notes only Claude Code needs | Hand |
| [REVIEW.md](../REVIEW.md) | What reviewers, human or AI, report and skip | Hand |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Code map, layers and invariants | Hand |
| `docs/*.md` | One doc per cross-cutting topic: style, testing, security, plans, agent tools | Hand |
| [docs/design-docs/](design-docs/index.md) | Technical decisions, listed in the folder's index | Hand |
| [docs/exec-plans/](PLANS.md) | Active and completed exec plans, and the tech-debt tracker | Hand, as the work happens |
| `.claude/skills/` | Procedures Claude Code loads on demand ([AGENT_TOOLS.md](AGENT_TOOLS.md)) | Hand |
| `docs/scratch/` | Local notes; git ignores it | Anyone; never committed |

## Growing the docs
Add a doc when a topic needs rules that more than one change will rely on, not before. Common next docs:
- `docs/product-specs/` with an `index.md`, once there is user-facing behavior to pin down. The doc checks enforce its index like the design docs'.
- `docs/RELIABILITY.md` (errors, timeouts, logging), `docs/FRONTEND.md` and `docs/DESIGN.md` (UI), once that code exists.
- `docs/references/` for a library's llms.txt or similar, copied from the source and not edited, when the library is newer than the models' training data.
- `docs/generated/` for reference that scripts produce, such as a database schema. Never edit it by hand.
- A nested `AGENTS.md` inside a folder whose code has its own rules. Every agent reads the closest one to the file it edits, so it loads only when that folder is touched.

Every new doc gets frontmatter, a row in the AGENTS.md map or a link from a related doc, and one owner topic that no other doc restates.

## Doc metadata
Every hand-written doc starts with this frontmatter. Exceptions: the root entry files (AGENTS.md, CLAUDE.md, README.md, REVIEW.md, CHANGELOG.md), agent config under `.claude/` and `.github/`, and exec plans.

```md
---
status: draft
last-verified: YYYY-MM-DD
---
```

- `stub`: a skeleton with placeholders. Don't rely on it; fill it in once the code it describes exists.
- `draft`: written, but not checked against the code, or the code doesn't exist yet.
- `verified`: checked against the code on `last-verified`. For docs of principles, the owner confirmed it.

Set `last-verified` to today's UTC date (`date -u +%F`) whenever you check a doc against the code, including when a change makes you edit it.

## What the doc checks enforce
`pnpm check:docs` runs in `verify`, the pre-commit hook and CI, and fails on:
- a relative link to a file or folder that doesn't exist, in any Markdown file, skills and agent config included;
- a doc that can't be reached by following links from AGENTS.md (exec plans, generated and reference files are exempt);
- missing or invalid frontmatter, or a `last-verified` date more than a day ahead of UTC;
- a doc in `docs/design-docs/` or `docs/product-specs/` without a row in that folder's `index.md`, or a row whose status differs from the doc's;
- an exec plan without its required sections ([PLANS.md](PLANS.md));
- an AGENTS.md longer than 100 lines.

It warns, without failing, about `verified` docs last verified more than 90 days ago and about `TODO(template)` placeholders left from the template. Those warnings are the gardening pass's first work.

## Doc gardening
A pass that keeps the docs true to the code, run before each release, after a large change, or when asked. The procedure is the [doc-gardening skill](../.claude/skills/doc-gardening/SKILL.md): give it to any agent as its task.
