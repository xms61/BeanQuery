---
status: draft
last-verified: 2026-10-12
---

# Hosting and deploy

## Context
BeanQuery runs for invited users on the owner's Hetzner VPS, which already runs the owner's ysto game behind Caddy. The repo is public, so its CI must hold no credentials for the server. The data is one SQLite file ([storage choice](storage-choice.md)). The runbook is [DEPLOY.md](../DEPLOY.md). The plan and its decisions are in the [deploy plan](../exec-plans/active/2026-10-12-deploy.md).

## Decision
**The image.** The [Dockerfile](../../Dockerfile) follows ysto's:
- Three stages on `node:26-alpine`, pinned by digest: the production dependencies and the TypeScript build, both made on the build platform since neither depends on the CPU, and the runtime.
- The runtime holds `dist/`, the production dependencies and the font files, which the app reads from `src/web/assets/fonts/` because tsc copies no binary files. npm, corepack and yarn are removed. It runs as the non-root `node` user under `tini`, with a `HEALTHCHECK` on `/healthz`.
- [.dockerignore](../../.dockerignore) is an allowlist, so a database, a backup or a `.env` can't enter the image.

**The services.** [deploy/compose.yml](../../deploy/compose.yml) runs the app with no published port, a read-only root, a tmpfs `/tmp`, no capabilities, `no-new-privileges`, 512 MB of memory, and logs rotated at 3 files of 10 MB.
- The database lives in the `beanquery_data` volume at `/data`, and the nightly backups in a host folder mounted at `/backups`.
- The compose file sets `HOST`, `PORT`, `BEANQUERY_DB`, `TRUST_PROXY` and `SECURE_COOKIES` itself, so a copied `.env` can't change them.
- **Shared Caddy:** ysto's Caddy already holds ports 80 and 443, so it serves both apps. It joins the external Docker network `edge`, which the app joins too, and imports site files from a folder. BeanQuery's site file is [deploy/beanquery.caddy](../../deploy/beanquery.caddy). Caddy gets the certificate, redirects HTTP to HTTPS and proxies to `beanquery:3000`; the app sets its own security headers, HSTS included.
- **No addresses in logs:** the site has no access log, and the app logs no requests, only unexpected errors. Client addresses reach the app in `X-Forwarded-For` for the rate limits, which keep them in memory only.

**Release and deploy.** As in ysto, the owner starts a release workflow from main, which publishes `ghcr.io/xms61/beanquery`. Over SSH, the owner then runs `docker compose pull && docker compose up -d` on the VPS. CI's `docker` job builds the image on every pull request, starts it hardened, runs the server commands in it, checks that it holds no database or `.env`, and runs Trivy, pinned by version and checksum. Dependabot keeps the base image's digest current.

**Jobs.** systemd timers on the host run the nightly backup (14 kept, on the VPS), the nightly collective-rating rebuild and the weekly roaster fetch, each as a command in the running container (`pnpm ops`, [src/ops/](../../src/ops/)).

## Alternatives considered
- **A separate Caddy in front of both apps:** rejected by the owner. It is the cleanest split, but moves a running part of ysto.
- **Editing ysto's Caddyfile by hand on the VPS:** rejected. The server would drift from both repos.
- **Building the image on the VPS:** rejected. It skips the scan, and the VPS would need the build tools.
- **Timers inside the app:** rejected. `node:sqlite` is synchronous, so a long roaster fetch would hold up requests.
- **Backups off the server:** declined by the owner for now. A lost server loses its backups too; each user's JSON export is the other copy.

## Consequences
- Every deploy is a manual step by the owner.
- A change to ysto's Caddy setup can take BeanQuery offline too, and the other way round.
- The image is public and safe to be: it holds no data and no secret.
