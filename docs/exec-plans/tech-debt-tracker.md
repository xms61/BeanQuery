---
status: draft
last-verified: 2026-10-12
---

# Tech-debt tracker

Known shortcuts and gaps, written down when they are taken so they get paid off on purpose. Delete a row in the change that pays it off.

| Added | Area | Debt | Why it was taken | Way out |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | Layers | `src/roaster/` imports `src/db.ts` and `src/db/`, so a second layer exists, but no check enforces which way imports may point | The web framework, and with it the layer names, is chosen in step 9 of the [bean tracker plan](active/2026-10-07-bean-tracker.md) | Step 9 adds the `db → domain → web` rule with a structural test, and moves `src/roaster/` into the domain layer |
| 2026-10-12 | Roasters | A saved copy of every.coffee/roasters is uploaded with `pnpm roasters:import --file`, and the admin adds roasters and aliases through `src/admin/`; neither has a screen | There is no web layer yet | Step 9 of the bean tracker plan adds the admin upload and add-roaster forms on top of the same functions |
