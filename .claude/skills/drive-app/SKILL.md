---
name: drive-app
description: Launch BeanQuery's web app on a fresh seeded database and drive it in a browser the way a user does, with evidence. Use to prove a UI change works (the "end-to-end check the agent can run itself" in docs/TESTING.md), to reproduce a UI bug, or before calling a change to src/web/ done. Not `pnpm verify`, which runs the checks and stays required.
---

# Drive the app

Unit and route tests run the app in memory; this runs the built server on a real SQLite file and drives it in a browser, so layout, the app script, the content policy and redirects are exercised too. The recipes per feature are in [features/README.md](features/README.md). Pick the features your change touches and run every entry point their files list.

## Launch
One run, one folder: pick `docs/scratch/drive-app/<UTC timestamp>`, such as `docs/scratch/drive-app/20261014T094103Z`. Shell variables don't survive between Bash tool calls, so start every command below with `RUN=<that folder>;`, and every command uses `${RUN:?}`, which stops on an empty value instead of writing to the drive root. `docs/scratch/` is git-ignored, so the database, the account number and the evidence never get committed.

1. Build: `pnpm build`.
2. Seed: `node .claude/skills/drive-app/seed.mjs --db ${RUN:?}/beanquery.db --out ${RUN:?}`. It refuses an existing database. It writes the two fixture roasters (Nord Kaffe, Tanat), one admin account with the fixture's first four bags, `${RUN:?}/account-number.txt` and `${RUN:?}/paste-one-bag.json` (the fifth bag).
3. Start, with the Bash tool's `run_in_background`, from the repo root:
   `BEANQUERY_DB=${RUN:?}/beanquery.db SECURE_COOKIES=false PORT=3077 HOST=127.0.0.1 DEFAULT_TIME_ZONE=UTC node dist/web/server.js > ${RUN:?}/server.log 2>&1`
   Keep the task id it returns; cleanup stops that task. Don't use `pnpm start`: it reads `.env`, which may point at a real database.
4. Ready means `${RUN:?}/server.log` has `BeanQuery listening on http://127.0.0.1:3077` and the doctor passes.

Port 3077 is this skill's. One run at a time: if the doctor finds 3077 taken by something you didn't start, stop and tell the user rather than driving it.

## Doctor
Run first, and again after any drive that surprised you:
- `curl -sf http://127.0.0.1:3077/healthz` prints `ok`;
- `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:3077/` prints `303 http://127.0.0.1:3077/sign-in`;
- the last line of `${RUN:?}/server.log` is the listening line for this run, and `${RUN:?}/beanquery.db` exists.

## Drive
Use the built-in browser (`mcp__Claude_Browser__*`; load the `anthropic-skills:built-in-browser` skill first). It reaches `http://127.0.0.1:3077` directly. Open a new tab for each run (`tabs_create`): a tab keeps its console and network log across runs, so an old run's error would show up as this one's. Sign in once per run as [features/sign-in.md](features/sign-in.md) says; the session cookie lasts for the run.
- A click can fail with "Could not get the tab ready for input" when the app window is behind another; retry it once, and ask the user to bring the window forward if it repeats.
- Find elements with `find` by their visible label ("Account number", "Save bag", "Search"); avoid `read_page` with `filter: interactive` on the account page, which lists 400 time zones.
- Read results after the page settles: a click that submits a form returns before the next page loads. Wait a second, or check `location.pathname` first.
- `form_input` parses a JSON-looking value into an object and the field gets `[object Object]`. For JSON, click the textarea, select all, and `type` the text.
- Without a browser (a CLI session with no browser tools), drive the server-rendered pages with `curl` and a cookie jar: POST the form fields each page names, with `Origin: http://127.0.0.1:3077`, since CSRF checks it. That proves routes and redirects, not the app script or layout; say so in the report.

The account number is a test credential for this local database only. Type it from `${RUN:?}/account-number.txt`; don't repeat it in chat or commit it.

## Evidence
Each feature run ends with proof in `${RUN:?}/`, named after the feature file:
- `<feature>.md`: the entry point used, each action, the URL and the page text that shows the result (from `get_page_text` or a `javascript_tool` read of the relevant elements);
- for a change that writes data, a read-only second view of the stored rows: `node -e` with `new DatabaseSync(path, { readOnly: true })` from `node:sqlite`, saved as `<feature>.db.json`;
- `read_console_messages` with `onlyErrors`, and `read_network_requests` for any error, saved in `<feature>.md`. A 400 from a deliberately invalid form is expected; a content-policy error never is.

Screenshots from the browser tools land in the session's tool results, not in `$RUN`; describe what they showed in `<feature>.md`.

## Cleanup
1. Stop the server task with TaskStop and the task id from Launch. Never kill `node` by name: other Node processes on the machine are not this run's.
2. Confirm `curl -s -m 2 http://127.0.0.1:3077/healthz` fails.
3. Delete them: `rm -f "${RUN:?}"/beanquery.db* "${RUN:?}"/account-number.txt`. Keep the evidence files and `server.log`.

## Report
Say which features and entry points ran, what each proved, and which you couldn't reach and why. A product bug found here goes to the user (and into a test that fails without the fix), not into a weaker recipe.
