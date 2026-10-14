# Sign in

A visitor who isn't signed in is sent to the sign-in page from every app page, enters their account number, and lands in their library.

## Sub-features
- `signin-redirect`: app pages redirect a signed-out visitor to `/sign-in`.
- `signin-number`: the account number, with any spacing or case, signs in.
- `signin-wrong`: a wrong number shows an error and stays on the page.

## How to get to it (user POV)
- Open any app page, such as `/`, while signed out.
- Open `/sign-in` directly.

## Driving it with the built-in browser
Preconditions:
- The doctor passes, and the browser has no session for 127.0.0.1:3077 (a fresh run's browser tab, or sign out first from the account page).

- **Redirect.** Navigate to `http://127.0.0.1:3077/`. The tab ends on `/sign-in` with the heading "Sign in".
- **Sign in.** `find` "Account number", click it, `type` the number from `$RUN/account-number.txt`, press Return. The tab ends on `/` with the heading "Library" and "4 bags" next to it.

## Gotchas
- The page's script fills a hidden time-zone field; without it the account keeps the default zone (UTC in this run), which shifts the toasts' dates.
- Every POST to /sign-in counts toward the rate limit, right or wrong: the 11th within 15 minutes from one client shows "Too many attempts". Restart the server to clear it, since limits are in memory.
- The library opens with "Open, portion and freeze" toasts over the right side for the bags due today; their number grows with the date, since the fixture's roast dates are fixed.
