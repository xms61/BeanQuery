---
status: draft
last-verified: 2026-10-12
---

# Deploy

How BeanQuery gets onto the owner's VPS and stays current. Why it is built this way: [hosting and deploy](design-docs/hosting-and-deploy.md). Commands marked *owner machine* run in the repo on the development machine; the others run on the VPS over SSH as the `deploy` user. Real domains, addresses and folders go in `.env` files and on the VPS, never in this doc.

## Status
Not deployed yet. The image, the compose file, the Caddy site and the timers are in the repo ([deploy plan](exec-plans/active/2026-10-12-deploy.md)). The first deploy waits for the ysto change below and the owner's run of this runbook.

## What runs where
- **The VPS** is the one that runs ysto, set up by ysto's runbook (its `docs/DEPLOY.md`): Ubuntu with Docker, keys-only SSH, ufw and the Hetzner firewall allowing 22, 80 and 443 only, and unattended security updates. Nothing in that setup changes.
- **ysto's Caddy** serves HTTPS for both apps. It joins the Docker network `edge` and imports the site files in `/opt/caddy-sites/`, one of which is BeanQuery's.
- **BeanQuery** runs from `/opt/beanquery/compose.yml`: the image from GHCR, with no published port, on `edge`. Its database is the `beanquery_data` volume; its backups go to `/srv/beanquery/backups`.
- **systemd timers** on the host run the nightly backup, the nightly rating rebuild and the weekly roaster fetch, each in the running container.
- **GitHub** builds and publishes the image when the owner starts the release workflow. It holds no credentials for the VPS.

## One-time setup
### 1. The domain
Add an `A` record (and `AAAA`) for BeanQuery's name, such as `beans` under a domain the owner has, pointing at the VPS's addresses, as ysto's runbook describes for its own domain. On Cloudflare, keep it **DNS only**. Check with `nslookup <domain>` before the first start, so Caddy can get the certificate.

### 2. ysto's Caddy, shared
This needs ysto's release that lets its Caddy import site files and join `edge`. Then, once:
```bash
docker network create edge
sudo mkdir -p /opt/caddy-sites && sudo chown deploy:deploy /opt/caddy-sites
```
Update ysto's deploy files and restart it as its runbook says. ysto keeps working with the sites folder empty.

### 3. Folders and settings
```bash
sudo mkdir -p /opt/beanquery /srv/beanquery/backups
sudo chown deploy:deploy /opt/beanquery
sudo chown 1000:1000 /srv/beanquery/backups && sudo chmod 700 /srv/beanquery/backups
```
*Owner machine*: copy the deploy files over:
```bash
scp deploy/compose.yml deploy@<server>:/opt/beanquery/
scp deploy/.env.example deploy@<server>:/opt/beanquery/.env
scp deploy/beanquery.caddy deploy@<server>:/opt/caddy-sites/
scp -r deploy/systemd deploy@<server>:beanquery-units
```
On the VPS:
- In `/opt/beanquery/.env`, set `PUBLIC_ORIGIN` to `https://<domain>`. The other defaults match the folders above.
- In `/opt/caddy-sites/beanquery.caddy`, replace `beans.example.org` with the domain.

### 4. The image
The first release makes the GHCR package `ghcr.io/xms61/beanquery` ([Release and update](#release-and-update)). It is private at first: in its package settings on GitHub, set the visibility to public once. The image holds no data and no secret, and CI checks that it holds no database or `.env` file.

### 5. First start
```bash
cd /opt/beanquery
docker compose pull
docker compose up -d
docker compose ps
```
Then have Caddy load the new site, from ysto's folder: `cd /opt/ysto && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`. Check:
```bash
curl -fsS https://<domain>/healthz
```
It answers `ok`. If not, `docker compose logs beanquery` shows the app's errors, and `docker compose logs caddy` (in `/opt/ysto`) shows certificate problems.

### 6. The admin and the roasters
```bash
cd /opt/beanquery
docker compose exec beanquery node dist/account/cli.js create-admin --db /data/beanquery.db
docker compose exec beanquery node dist/roaster/cli.js --db /data/beanquery.db
```
The first prints the admin's account number once: sign in with it at `https://<domain>` and keep it safe. The second loads the roaster registry from every.coffee. Invites are made on the admin page from then on.

### 7. The timers
```bash
sudo install -m 644 -o root -g root ~/beanquery-units/beanquery-*.service ~/beanquery-units/beanquery-*.timer /etc/systemd/system/
rm -r ~/beanquery-units
sudo systemctl daemon-reload
sudo systemctl enable --now beanquery-backup.timer beanquery-ratings.timer beanquery-roasters.timer
systemctl list-timers 'beanquery-*'
```
Run the backup once by hand and check that a file appears: `sudo systemctl start beanquery-backup.service && sudo ls /srv/beanquery/backups`.

## Checks after setup
- Sign in at `https://<domain>` from a computer and a phone. Paste a bag and see it in the library.
- `curl -sI http://<domain>` redirects to HTTPS, and `curl -sI https://<domain>/sign-in` shows `content-security-policy` and `strict-transport-security`.
- ysto still answers on its own domain.
- *Owner machine*: `nmap -Pn -p- <domain>` shows only 22, 80 and 443 open.
- The [restore drill](#restore-drill) passes.
- After a night, `journalctl -u beanquery-backup -u beanquery-ratings` shows both jobs, and a new backup is in the folder.

## Routines
### Release and update
1. Merge the PR that sets the new `version` in `package.json`.
2. *Owner machine*: `gh workflow run release.yml -f version=<version>`. It reruns CI, publishes `ghcr.io/xms61/beanquery:<version>` and `:latest` for amd64 and arm64, tags `v<version>` and creates the GitHub release.
3. On the VPS: `cd /opt/beanquery && docker compose pull && docker compose up -d`. Migrations run when the app starts.

To roll back, set `BEANQUERY_VERSION=<older version>` in `/opt/beanquery/.env` and run `docker compose up -d`. An older version starts on a newer schema without checking it, so if the update added a migration, also restore the backup from before the update ([Restore](#restore)). Remove the setting again to follow `latest`.

When `deploy/compose.yml`, `deploy/beanquery.caddy` or a timer changes in a release, copy it over again (step 3) first. After a site change, reload Caddy (step 5). After a timer change, install the units and reload systemd as in step 7, through `sudo systemctl daemon-reload`; copying alone changes nothing.

### Restore drill
Try last night's backup without touching the live database, after the first night and then every few months:
```bash
cd /opt/beanquery
latest=$(sudo ls /srv/beanquery/backups | tail -1)
docker compose run --rm --no-deps beanquery sh -c "node dist/ops/cli.js restore --db /tmp/drill.db --from /backups/$latest && node -e \"
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/tmp/drill.db', { readOnly: true });
  console.log(db.prepare('SELECT (SELECT count(*) FROM account) AS accounts, (SELECT count(*) FROM bag) AS bags').get());\""
```
To compare, run the same `node -e` query on the live file in the running app: `docker compose exec beanquery node -e "..."` with `/data/beanquery.db` in place of `/tmp/drill.db`. The counts should match, less whatever users added since the backup. The drill writes only to the container's `/tmp`, which is gone when it ends.

### Restore
For real, when the live database is lost or damaged:
```bash
cd /opt/beanquery
docker compose stop beanquery
docker compose run --rm --no-deps beanquery node dist/ops/cli.js restore --db /data/beanquery.db --from /backups/<file>
docker compose start beanquery
```
The restore checks the backup first and keeps the replaced file as `/data/beanquery.db.replaced-<time>`. It refuses while a `-journal` file sits beside the database, which a crash leaves behind: start and stop the app once, so SQLite settles it, then restore. Everything since the backup is lost; users can import their own JSON exports again.

### Logs and disk
- `docker compose logs -f beanquery`: the app logs its start and unexpected errors only, never requests or addresses. Docker keeps 3 files of 10 MB.
- `journalctl -u 'beanquery-*'`: the jobs.
- `docker image prune -f` after updates removes old images. The backups folder holds 14 files of the database's size.
- The backups stay on the VPS, by the owner's choice: a lost server loses them too.
