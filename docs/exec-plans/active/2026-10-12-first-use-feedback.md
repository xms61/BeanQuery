---
status: draft
last-verified: 2026-10-12
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
4. **Live roaster search.** The roaster list updates as the owner types, after a short pause, instead of on the Search button. The app's script fetches the same page with the new query and swaps in its results, keeping the focus in the box and the query in the address; without scripts, the button still searches.
5. **Statistics page.** A new page, Stats, over the account's own bags, private ones included, and nothing of other accounts':
   - **Origins:** a world map with each country shaded by its number of bags and a tooltip on hover, then countries and regions ranked by bags with the average rating.
   - **Beans:** the altitude spread in 200 m steps, and the varieties, processes and roast degrees, each with counts and the average rating.
   - **Roasters and spending:** roasters ranked by bags and rating, and money spent and price per 100 g by month.
   The map is SVG drawn by the server from Natural Earth's public-domain 1:110m country shapes, simplified and committed once. The charts use Chart.js, served by the app, reading their data from a JSON block in the page, so the content policy stays as it is. A bag's free-text country is matched to a map country by name and common spellings; the ones that match none are listed under the map.

## Progress
- [x] 2026-10-12 Buttons and delete: secondary buttons for privacy, and `GET /bags/:id/delete`, a confirmation page naming the bag
- [ ] Freeze date
- [ ] Theme switch
- [ ] Live roaster search
- [ ] Statistics page

## Decision log
- 2026-10-12: Owner's choices: the freeze date fills itself when a bag is marked frozen and stays editable; delete is a button and a confirmation page, which works without scripts (rejected: keeping the checkbox with a red button, and a browser dialog, which needs the app's script); the theme is a per-account switch on the account page (rejected: following the system only).
- 2026-10-12: The statistics page, by the owner's choices: origins, beans, and roasters and spending (not ratings over time); only the account's own bags; a world map served by the app, with the owner's go-ahead to download Natural Earth's country shapes; and Chart.js 4.5.1 as a new dependency, with the owner's go-ahead, for hover tooltips. Rejected: a ranked list instead of a map, SVG charts without a library, Apache ECharts (five times the size) and uPlot (built for time series).
- 2026-10-12: The phone layout is not a priority for the owner; the deploy's phone check is dropped.

## Surprises
None yet.

## Validation
- `pnpm verify` passes, with tests for each part.
- In the browser: the bag page's buttons, the delete page, a frozen bag's date on its page and in the CSV, and the theme switch in both directions.

## Outcome
Filled in when the plan moves to completed/.
