---
name: exec-plan
description: Start, resume or finish an exec plan for work that spans sessions or areas. Use when starting multi-session work, picking up planned work, or closing it out.
---

# Exec plan

The rules and the template are in [docs/PLANS.md](../../../docs/PLANS.md); this is the procedure.

## Start
1. List `docs/exec-plans/active/`. If a plan already covers the work, resume it instead.
2. Copy the template from docs/PLANS.md to `docs/exec-plans/active/YYYY-MM-DD-<short-name>.md`, dated with today's UTC date.
3. Fill in Purpose, Context and Plan. Split the plan into milestones that can each be verified on their own, and write the Validation commands.
4. If the request leaves design choices open, ask the user before writing code, and log the answers in the Decision log.

## Resume
1. Read the plan: Progress, Decision log and Surprises first.
2. Check that the code matches the ticked milestones. Record any drift under Surprises.
3. Continue from the first unticked milestone.

## While working
- Tick milestones and log decisions in the same commits as the code, not at the end.
- Shortcuts go in the [tech-debt tracker](../../../docs/exec-plans/tech-debt-tracker.md) when you take them.

## Finish
1. Run the Validation commands and record the result.
2. Fill in Outcome, move the file to `docs/exec-plans/completed/`, and update links to it.
3. Run `npm run verify`.
