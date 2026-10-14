# Theme

On the account page a user picks System, Light or Dark; it saves as it is picked, for the account, so every page and device shows it.

## Sub-features
- `theme-save`: picking a theme saves it without a button.
- `theme-apply`: every page then carries `data-theme` on `<html>`; System carries none and follows the browser.

## How to get to it (user POV)
- The sidebar's "Account" (`/account`), the "Theme" card.

## Driving it with the built-in browser
Preconditions:
- Signed in. Changes the account's theme; set it back to System at the end.

- **Pick Dark.** On `/account`, `find` "System" to get the theme combobox (the one whose options are System, Light and Dark) and `form_input` it to `dark`. Wait 2 seconds.
- **Applied everywhere.** Navigate to `/stats`. `document.documentElement.getAttribute('data-theme')` is `"dark"`, and a screenshot shows the dark palette.
- **Back to System.** On `/account`, `form_input` the combobox to `system`. On any page, `data-theme` is `null`.

## Gotchas
- `read_page` with `filter: interactive` here lists 400 time zones; use `find`.
- The time zone select next to it does not save on change: it has a Save button, by decision (an arrow key on a closed select fires `change` on Windows).
