# Library search

Typing in the library's search box narrows the bag list after a short pause, without a reload, keeping the focus in the box and the query in the address.

## Sub-features
- `library-search-live`: typing filters the list in place.
- `library-filters`: the selects (state, roaster, process, rating) apply as soon as they change.
- `library-search-noscript`: without the script, the Filter button submits the form.

## How to get to it (user POV)
- The sidebar's "Library" (`/`), the search box "Search coffee, roaster or origin" above the list.

## Driving it with the built-in browser
Preconditions:
- Signed in at baseline (4 or 5 bags, two of them Panamas).

- **Search.** On `/`, `find` "Search", click it, `type` `Panama`, then wait 2 seconds. The address becomes `/?q=Panama`.
- **Result.** Read the list with `javascript_tool`: `[...document.querySelectorAll('a.coffee')].map(a => a.textContent.trim())` gives exactly the two Panamas, and `document.activeElement.getAttribute('name')` is `q`, so the focus stayed in the box.

## Gotchas
- The list updates after a pause in typing; reading it right away shows the old list.
- The bag count in the heading stays the account's total; it is not the filtered count.
