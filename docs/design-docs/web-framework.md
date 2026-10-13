---
status: draft
last-verified: 2026-10-13
---

# Web framework: Hono, rendering pages on the server

## Decision
The web layer uses [Hono](https://hono.dev) on Node through `@hono/node-server`. Pages are rendered on the server with Hono's JSX and sent as plain HTML. The forms work without JavaScript. A small script of our own adds the few interactions that need it, such as the paste preview and the toasts. No client-side framework.

The owner chose it on 2026-10-12. Step 9 of the [bean tracker plan](../exec-plans/active/2026-10-07-bean-tracker.md) installs it and builds the screens.

## How it fits
- **Layers:** `db → domain → web`. Hono and anything HTTP-shaped stay in the web layer. The domain layer takes plain values and an account id, and never sees a request. Step 9 adds the check that enforces the direction ([ARCHITECTURE.md](../../ARCHITECTURE.md)).
- **Sessions:** the cookie and token rules of the [account model](account-model.md), written with Hono's cookie helpers. No session library.
- **Forms:** Hono's CSRF middleware checks the `Origin` and `Sec-Fetch-Site` of every form post, on top of `SameSite=Lax` cookies. `PUBLIC_ORIGIN` pins the origin behind the proxy. Nothing changes state on a GET.
- **Limits and failures:** bodies over 1 MB are refused before parsing, except an export upload to `/import`, which may be 21 MB. Sign-in allows 10 attempts per quarter hour and invite redemption 5 per hour, per client, counted in memory only. An unexpected error shows a generic page and is logged without the request.
- **Headers:** `secureHeaders` with a CSP of `'self'` only (no inline scripts or styles), HSTS, and `Cache-Control: no-store` on every page.
- **Input:** Hono's validator runs the same Zod definitions as the domain layer. The web layer checks only the shape of a request, and the domain enforces the contract.
- **Assets:** fonts, styles and the script are served from the app itself, so pages load nothing from a third party. Their URLs carry a hash of their content, so they can be cached for a year. The stats page alone also loads [Chart.js](https://www.chartjs.org) (MIT), read from its package and served at `/assets/chart.js`. Each chart's data is in its canvas's `data-chart` attribute, escaped by JSX, so no inline script is needed, and each chart's table holds the same numbers for a browser without scripts.
- **Tests:** Hono apps answer `app.request()` in-process, so route tests need no server and no network.

## Why
- **Small and few dependencies:** Hono has no runtime dependencies of its own. That keeps the supply chain short, which matters under the install rules in [SECURITY.md](../SECURITY.md).
- **Web standards:** handlers take a `Request` and return a `Response`, so the code reads like the platform and outlives the framework.
- **Server-rendered HTML:** this suits a desktop-first app made of lists, a detail page and forms. It needs no build step for the client and no hydration. It also keeps text from pasted JSON in one escaping path, because JSX escapes by default.
- **Typed routes and validators** without a code generator.

## Alternatives considered
- **Fastify with templates:** mature, with a large plugin ecosystem, but more moving parts. Templates escape less safely by default than JSX.
- **SvelteKit:** rich client interactivity, at the cost of a build step and a larger dependency tree. The screens don't need it.
- **Astro:** made for content sites with islands of interactivity. Sessions and many forms are not its focus.
- **Express:** familiar, but older APIs, and it needs more middleware for the same result.

## Revisit when
- A screen needs heavy client-side state, such as live filtering of thousands of bags without a round trip. Add a small island there before switching frameworks.
- Phone layouts arrive and want offline use. A service worker works with any of these choices.
