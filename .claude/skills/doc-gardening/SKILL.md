---
name: doc-gardening
description: Bring the docs and agent instructions back in line with the code - re-verify stale docs, fix drift, file debt, close finished plans. Use before a release, after a large change, or when asked to garden the docs.
---

# Doc gardening

The doc rules are in [docs/KNOWLEDGE_BASE.md](../../../docs/KNOWLEDGE_BASE.md); this is the procedure.

1. Run `pnpm check:docs`. Its warnings are the first work: re-verify each stale doc, and fill or remove each template placeholder.
2. For each doc in the AGENTS.md map, compare what it claims (commands, paths, names, rules, the code map in ARCHITECTURE.md) with the code.
   - The doc is wrong and the code is right: fix the doc and set `last-verified` to today's UTC date.
   - The code looks wrong: add a row to the [tech-debt tracker](../../../docs/exec-plans/tech-debt-tracker.md). A gardening pass doesn't change behavior.
   - The doc can't be fixed now: set its status to `stub` so nobody relies on it.
3. Check that the instructions still earn their place. AGENTS.md stays under 100 lines. Remove rules that no longer prevent a real mistake, workarounds for an older model's limits, and skills or hooks nobody uses.
4. Move finished exec plans to `docs/exec-plans/completed/`, and delete tech-debt rows that are paid off.
5. Run `pnpm verify`. Open one PR per area, titled `docs(<area>): <summary>`.
