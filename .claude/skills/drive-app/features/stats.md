# Stats

The Stats page shows the account's own bags only: a world map of origins with country and region rankings, then beans (altitude, varieties, processes, roast degrees) and roasters and spending, with Chart.js charts above the tables.

## Sub-features
- `stats-map`: the server-drawn SVG map shades each origin country.
- `stats-tables`: the rankings, with each bag counted once.
- `stats-charts`: charts drawn by the app's script; each shows only with two or more values.

## How to get to it (user POV)
- The sidebar's "Stats" (`/stats`).

## Driving it with the built-in browser
Preconditions:
- Signed in with at least the 4 seeded bags.

- **Open.** Navigate to `http://127.0.0.1:3077/stats`. The heading reads "Stats" and the line under it counts the account's bags.
- **Sections.** `javascript_tool`: `[...document.querySelectorAll('h2')].map(h => h.textContent.trim())` gives "Origins", "Beans", "Roasters and spending"; `!!document.querySelector('main svg')` is true.
- **Charts.** `document.querySelectorAll('canvas[data-chart]').length` is 2 with the seeded 4 bags (varieties and processes; one altitude bucket and one roast degree draw no chart), and 3 after [paste-a-bag](paste-a-bag.md) adds a second altitude. `read_console_messages` with `onlyErrors` shows no content-policy error.
- **Rankings.** `get_page_text`: Countries lists Ethiopia 2, Panama 2, Peru 1 with all 5 bags (Ethiopia 1, Panama 2, Peru 1 with the seeded 4).

## Gotchas
- With fewer than two values a chart stays hidden; that is intended, not a failed load.
- The bags have no ratings, so every rating column reads "Not rated".
