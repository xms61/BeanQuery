---
status: draft
last-verified: 2026-10-07
---

# Core beliefs

How this repository is run so that coding agents can do most of the work safely. When two docs disagree, these decide, and the other doc is fixed in the same change. Each belief links the evidence it rests on.

1. **The repository is the system of record.** A decision made in chat, a ticket or someone's head is invisible to the next agent session. Write it into the doc that owns the topic, in the change that makes it ([OpenAI, Harness engineering](https://openai.com/index/harness-engineering/)).
2. **A map, not a manual.** [AGENTS.md](../../AGENTS.md) stays under 100 lines and points to deeper docs; detail loads only when a task needs it (docs, skills, nested AGENTS.md files). A long instruction file crowds out the task, and when everything is marked important, nothing is ([Claude Code best practices](https://code.claude.com/docs/en/best-practices); [agents.md](https://agents.md/)).
3. **Guarantees live in code, not prose.** A rule that must hold is a hook, a permission, a sandbox limit, a lint rule, a structural test or a CI check. Docs explain why. An instruction is a request; a hook that blocks the action is enforcement ([Extend Claude Code](https://code.claude.com/docs/en/features-overview)).
4. **Every change is checked by something the agent can run itself.** `npm run verify` runs every check in one command, quietly on success and specifically on failure, and each error message says how to fix the problem. Preparing the repo this way matters more than the model: one team raised its agent's success rate from 38% to 69% by fixing its instructions and environment ([.NET runtime](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/); [Böckeler, Harness engineering](https://martinfowler.com/articles/harness-engineering.html)).
5. **Checks are protected.** Agents optimize for green: they have commented out failing tests and removed version bumps to pass builds. Weakening a test or check to pass is never the fix, and reviews look for it ([Spotify, feedback loops](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
6. **Plans before code, and plans are artifacts.** Work that outlives one session gets an exec plan with progress and a decision log, committed next to the code, so anyone can resume it from the repo alone ([OpenAI, ExecPlans](https://developers.openai.com/cookbook/articles/codex_exec_plans)).
7. **The writer doesn't grade its own work.** A separate reviewer in a fresh context checks the diff, tuned to report only what matters; a human stays accountable for the merge ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
8. **Agents get the least access that does the job.** Sandboxes, deny rules and scoped CI tokens. No unattended agent combines private data, untrusted input and a way to send data out ([Willison, the lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)).
9. **One place per fact.** Each fact lives in the doc that owns it; other docs link to it instead of restating it.
10. **A stale doc is a bug, and known debt is written down.** A doc that no longer matches the code is fixed or downgraded to `stub` when found; shortcuts go in the [tech-debt tracker](../exec-plans/tech-debt-tracker.md) when taken. The [doc-gardening pass](../KNOWLEDGE_BASE.md#doc-gardening) catches what changes miss.
11. **Harness parts expire.** Every rule, hook and skill encodes an assumption about what current models get wrong. Review them after model upgrades and delete what no longer prevents a real mistake ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
