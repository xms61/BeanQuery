---
status: draft
last-verified: 2026-10-12
---

# Tech-debt tracker

Known shortcuts and gaps, written down when they are taken so they get paid off on purpose. Delete a row in the change that pays it off.

| Added | Area | Debt | Why it was taken | Way out |
| :-- | :-- | :-- | :-- | :-- |
| 2026-10-12 | Roasters | An account can keep notes on any of the 9,000 roasters, but the bag JSON contract takes at most 500 roaster notes and 500 grinders per document, so an export with more would not import back | One person keeping over 500 roaster notes is unlikely, and raising the contract's limit changes the published schema | Raise `roaster_notes` and `grinders` to the export limits in `src/contract/bag-json.ts` for export files, or refuse a note past 500 |
| 2026-10-12 | Web | The pages use the system's fonts, not Familjen Grotesk and JetBrains Mono from the designs | Serving the font files from the app means downloading them, which needs the owner's go-ahead | Add the two OFL font files under `src/web/assets/`, served by the app, with `@font-face` rules |
| 2026-10-12 | Web | The light colors were sampled from the exported PNGs, because the light Figma variables were never exported | The Figma MCP allowance is used up | Export the light collection with a Scripter script and replace the values in `src/web/assets/style.ts` |
