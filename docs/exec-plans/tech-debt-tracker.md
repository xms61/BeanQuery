---
status: draft
last-verified: 2026-10-14
---

# Tech-debt tracker

Known shortcuts and gaps, written down when they are taken so they get paid off on purpose. Delete a row in the change that pays it off.

| Added | Area | Debt | Why it was taken | Way out |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | Roasters | An account can keep notes on any of the 9,000 roasters, but the bag JSON contract takes at most 500 roaster notes and 500 grinders per document, so an export with more would not import back | One person keeping over 500 roaster notes is unlikely, and raising the contract's limit changes the published schema | Raise `roaster_notes` and `grinders` to the export limits in `src/contract/bag-json.ts` for export files, or refuse a note past 500 |
