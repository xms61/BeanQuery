---
name: retro
description: Look back over a coding session and propose changes to the repo's harness (checks, pointers, reviewer rules) that would have prevented its struggles, and harness parts to delete. Use when the user runs /retro, usually after a session that was harder than it should have been.
disable-model-invocation: true
---

# Retro

A session's mistakes are cheapest to fix in the environment, once, rather than in every later session. This proposes those fixes; it changes nothing until the user picks one. The principles are [core beliefs](../../../docs/design-docs/core-beliefs.md) 3 (guarantees live in code), 7 (the reviewer holds the standards) and 11 (harness parts expire). Adapted from Matt Pocock's `retro` skill.

## 1. Read the session
Default to the current session. For an earlier one, read its log: Claude Code keeps one `.jsonl` file per session in the project's folder under `projects/` in the user's Claude config directory; ask the user which one if it isn't clear. Read the record, not your memory of it: list the moments where the work went wrong or slow, each with what happened and roughly where.
- A mistake made and then caught (by a check, a reviewer, the user, or by luck).
- A search that took many calls, or a fact the agent needed and couldn't reach.
- An instruction that was ignored, misread, or turned out wrong.
- A tool call that cost much more than it returned.

A candidate that doesn't trace to one of these moments is generic advice; drop it.

## 2. Send each moment where its fix belongs
| What happened | Fix it with |
| :-- | :-- |
| A mechanical mistake: a banned call, an import shape, a file in the wrong place | A failing check, first in what exists: a Biome rule or plugin ([CODE_STYLE.md](../../../docs/CODE_STYLE.md)), a structural test like `src/layers.test.ts`, `scripts/check-*.mjs`, or the guard hook in `scripts/agent-hooks/` |
| A check exists but didn't run or didn't fail | Wire it into `pnpm verify`, or fix it; never a second check for the same thing |
| A judgement call the reviewer should have caught | A line in [REVIEW.md](../../../REVIEW.md), or in the security reviewer's checklist for security |
| A UI behavior only a person noticed | A recipe or gotcha in the [drive-app feature map](../drive-app/features/README.md), plus a test where one can reach it |
| A file or fact that took long to find | A pointer from a file the agent already reads: the AGENTS.md map, the code map in ARCHITECTURE.md, or the doc that owns the topic |
| A shortcut taken on purpose | A row in the [tech-debt tracker](../../../docs/exec-plans/tech-debt-tracker.md) |
| An instruction that changed nothing, or a hook or rule that blocked good work | Delete it |

Prefer a check to prose: a check fails, a sentence is skimmed. AGENTS.md gets a line only for navigation, and stays under 100 lines.

## 3. Propose
List the candidates most costly first. For each: the moment (quoted or summarized from the record), the fix and the exact file, and what it costs to keep. Then stop and let the user pick. A picked fix is an ordinary change: test first, `pnpm verify`, the reviewer, one PR.

A smooth session has little to teach; say so in one line instead of inventing candidates.
