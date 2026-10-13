---
status: draft
last-verified: 2026-10-13
---

# First-use feedback

## Purpose
The owner's first round of feedback from the live app: the bag page's buttons read as buttons, deleting a bag is one clear button and a confirmation, each bag can carry the date it was frozen, and each account can pick light or dark regardless of the system's theme.

## Context
- The live app ([DEPLOY.md](../../DEPLOY.md)); the bag page in [src/web/routes/library.tsx](../../../src/web/routes/library.tsx).
- The [bag JSON contract](../../product-specs/bag-json-contract.md) for the freeze date: adding an optional field keeps `beanquery.bags/v1` documents valid.
- The stylesheet's color tokens in [src/web/assets/style.ts](../../../src/web/assets/style.ts), which switch on `prefers-color-scheme` today.

## Plan
1. **Buttons and delete.** "Make this bean private" and "Publish to the pool" become secondary buttons. The delete card is one red "Delete bag…" button that opens a confirmation page naming the bag, with a red Delete and a Cancel.
2. **Freeze date.** An optional `personal.frozen_on` date in the contract and the `bag` table. Marking a bag frozen (its state, or the toast's "Done: frozen") fills today when it is empty; the edit form and a pasted document can set or change it. Shown on the bag page, and in the JSON export and the CSV.
3. **Theme switch.** System, Light or Dark on the account page, saved for the account so every device shows the same. The stylesheet's dark tokens apply under the system's dark preference unless the account chose Light, and always under Dark.
4. **Live filters and search.** Every filter and search form (the library's filters, the pool, the roasters with their tabs, and the admin lists) applies as soon as it changes: a select at once, a search box after a short pause in typing. The app's script fetches the same page with the new query and swaps in its results, keeping the focus where it was and the query in the address. The Filter and Search buttons are hidden while the script runs; without scripts they still apply the form.
5. **Statistics page.** A new page, Stats, over the account's own bags, private ones included, and nothing of other accounts':
   - **Origins:** a world map with each country shaded by its number of bags and a tooltip on hover, then countries and regions ranked by bags with the average rating.
   - **Beans:** the altitude spread in 200 m steps, and the varieties, processes and roast degrees, each with counts and the average rating.
   - **Roasters and spending:** roasters ranked by bags and rating, and money spent and price per 100 g by month.
   The map is SVG drawn by the server from Natural Earth's public-domain 1:110m country shapes, simplified and committed once. The charts use Chart.js, served by the app, reading their data from a JSON block in the page, so the content policy stays as it is. A bag's free-text country is matched to a map country by name and common spellings; the ones that match none are listed under the map.

## Progress
- [x] 2026-10-12 Buttons and delete: secondary buttons for privacy, and `GET /bags/:id/delete`, a confirmation page naming the bag
- [x] 2026-10-12 Freeze date: `personal.frozen_on` in the contract and migration 6, filled by `setBagState` with the account's date, in the edit form, on the bag page, in the JSON export and the CSV
- [x] 2026-10-13 Theme switch: `account.theme` in migration 7, set on the account page, carried as `data-theme` on every page's `<html>` for the signed-in account
- [x] 2026-10-13 Live filters and search: `data-live` forms on the library, pool, roasters, add-from-pool and admin coffee lists swap their `LiveRegion`s (results, and the roasters' tabs); `data-auto-submit` saves the theme as the select changes. Checked in the browser: selects, typing, focus, the address, the theme both ways
- [x] 2026-10-13 Statistics page, part 1: `/stats` with the world map (Natural Earth v5.1.2, 1:110m, built by `pnpm map:build` into `src/stats/world-map.data.ts`, 68 KB) and every ranking as a table, from `accountStats` in `src/stats/`
- [ ] Statistics page, part 2: the Chart.js charts for altitude, varieties, processes, roast degrees and spending by month

## Decision log
- 2026-10-12: Owner's choices: the freeze date fills itself when a bag is marked frozen and stays editable; delete is a button and a confirmation page, which works without scripts (rejected: keeping the checkbox with a red button, and a browser dialog, which needs the app's script); the theme is a per-account switch on the account page (rejected: following the system only).
- 2026-10-12: Filters and searches apply as they change, everywhere, by the owner's wish; first asked for the roaster search, then for all selections.
- 2026-10-12: The statistics page, by the owner's choices: origins, beans, and roasters and spending (not ratings over time); only the account's own bags; a world map served by the app, with the owner's go-ahead to download Natural Earth's country shapes; and Chart.js 4.5.1 as a new dependency, with the owner's go-ahead, for hover tooltips. Rejected: a ranked list instead of a map, SVG charts without a library, Apache ECharts (five times the size) and uPlot (built for time series).
- 2026-10-12: The freeze date fills only where a bag is marked frozen on its own: the state picker on the bag page and the toast's "Done: frozen", with the account's date. The edit form and a paste save the date as given, blank included, since there a blank is the user's answer. A date stays when the bag leaves the frozen state.
- 2026-10-12: The phone layout is not a priority for the owner; the deploy's phone check is dropped.
- 2026-10-13: Of the selects that save one choice, only the theme saves as it changes. On Windows an arrow key on a closed select fires `change`, so a bag's state would be posted while stepping past Frozen, leaving a freeze date on a bag never frozen, and the time zone would reload on every step through 400 zones; both keep their button. Neither does the admin's merge, which is destructive, nor the selects inside the bag form, which saves as a whole.
- 2026-10-13: The stats page ships in two parts: the map and tables first, then the charts, so each stays reviewable. The map's tooltip is the SVG `<title>` of each country, which needs no script. The map is projected and simplified by our own short build script (Natural Earth projection, Douglas–Peucker) rather than a new dependency such as d3-geo or mapshaper, since it runs once. A bag's country matches Natural Earth's own names for the country (not its sovereign's, which would make Puerto Rico "United States of America"), a short list of common spellings, and each part of a blend such as "Brazil, Ethiopia".
- 2026-10-13: The page's theme reaches the layout through a per-request `AsyncLocalStorage` set by the session middleware, rather than a prop on each of the 30-odd pages. Signed-out pages follow the system.

## Surprises
- 2026-10-13: `.button` sets `display`, which overrode the `hidden` attribute, so the Copy and Print buttons that start hidden for browsers without scripts always showed. The stylesheet now keeps `[hidden]` hidden.
- 2026-10-13: The library's bag count is all the account's bags, not the filtered ones, so it stays outside the live regions.

## Validation
- `pnpm verify` passes, with tests for each part.
- In the browser: the bag page's buttons, the delete page, a frozen bag's date on its page and in the CSV, and the theme switch in both directions.

## Outcome
Filled in when the plan moves to completed/.
