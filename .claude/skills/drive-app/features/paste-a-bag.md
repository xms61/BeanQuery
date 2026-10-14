# Paste a bag

A user pastes the bag JSON their LLM chat wrote, checks it, sees a preview with the bean facts, and saves it; the bag gets its own page with the rest, peak and freeze plan.

## Sub-features
- `paste-check`: Check validates against the `beanquery.bags/v1` contract and shows a preview.
- `paste-invalid`: invalid JSON shows "The JSON doesn't fit the contract" with the reason.
- `paste-save`: Save bag stores the bag and opens its page.
- `paste-private`: "Keep this bean private" keeps the coffee out of the pool.

## How to get to it (user POV)
- The sidebar's "Add bag", which opens the "Paste JSON" tab at `/add`.

## Driving it with the built-in browser
Preconditions:
- Signed in at baseline: 4 bags, and no bag named "Ethiopia - Elto [Hamasho 72h]".

- **Open.** Navigate to `http://127.0.0.1:3077/add`. The heading reads "Add bag".
- **Paste.** `find` "textbox" (the only one), click it, press `ctrl+a`, and `type` the compact JSON of `$RUN/paste-one-bag.json` (print it with `node -e "process.stdout.write(JSON.stringify(require('./' + process.argv[1])))" $RUN/paste-one-bag.json`).
- **Check.** `find` "Check" and click it. After the page settles, the URL is `/add/check`, the page says "Valid beanquery.bags/v1 with 1 bag", and a card shows Tanat and the coffee "Ethiopia - Elto [Hamasho 72h]".
- **Save.** `find` "Save bag" and click it. The tab ends on `/bags/<id>` titled "Ethiopia - Elto [Hamasho 72h]", showing Tanat, "Roasted 29 Sept", the rest, peak and mid-peak dates, and the grinder "Fellow Ode Gen 2" at "4.2".
- **Confirm.** Navigate to `/`. The library says "5 bags" and lists the coffee. Read the rows back from the database (the skill's Evidence section): bag 5 is that coffee, roaster Tanat, roast date 2026-09-29.

## Gotchas
- `form_input` turns the JSON into `[object Object]`; type it instead.
- Clicking Check returns before the reload; reading the page at once shows the previous result.
- The fixture spells the roaster "TANAT"; the seed registers "Tanat", and the paste matches it by its normalized name. A roaster the seed didn't register gets a question instead of a preview.
- Saving the same document twice adds a second bag on the same pool coffee; that is intended, not a duplicate bug.
