# Bean tracker: design, data model, intake and accounts

## Purpose
People keep a private record of the coffee bags they buy: what the bag says (roaster, origin, variety, process, altitude, roast degree and date), the rest-and-freeze plan, the water, grinder and grind they used, and a rating.
- **Entering a bag:** paste JSON in the [bag JSON contract](../../product-specs/bag-json-contract.md), which an LLM chat produced from photos of the bag. Or type it in, or start from a coffee in the global pool.
- **Their own bags:** users add, edit and delete them, and set each bag's state (sealed, open, frozen, finished) by hand.
- **Accounts** are anonymous and by invitation, in the style of Mullvad VPN: no username, password or email, only an account number. The owner, as admin, generates invite codes for friends. A user can export all their bags and import them again.

Saving a new bean splits it in two:
- **Bean facts go to the global pool:** roaster, name, origin, producer, varieties, process, altitude and the roaster's tasting notes. Every account can see and reuse them. Every harvest of a coffee is the same pool coffee, and the pool coffee lists each harvest seen on a published bag. A pool coffee never holds rest, peak or freeze times, water, grinder, grind, notes, prices or dates.
- **Everything else goes to the user's personal data:** this bag's harvest and lot, roast date, weight, the plan, the brew settings, the state, the rating and notes. No other account can see these. The admin runs the server and could read them in the database or its backups.
- **The pool shows a collective rating** for each coffee, across all its harvests, combined from every account's personal rating of 0 to 5 beans in half steps. Each account counts once.
  - The rating is rebuilt once a day and shows the mean rounded to half a bean with a rough count ("3+", "10+", "50+"). Below 3 accounts it shows nothing.
  - Ratings carry no account. Someone controlling several accounts could still narrow down another account's rating; the threshold, the rounding and the daily rebuild make that harder, not impossible.
- **A "Keep this bean private" checkbox** on the review form keeps the bean out of the pool entirely. It is never matched against pool coffees, never fills a pool coffee's missing facts, and its rating is not counted.
- **Anyone with a bag on a pool coffee can edit its facts**, and the change shows for every account. Every edit is logged, so the admin can undo a bad one. Re-pasting JSON is gentler: it only fills gaps, and shows each differing value with a button to use it instead.
- **Roasters come from every.coffee.** A weekly fetch of [every.coffee/roasters](https://every.coffee/roasters) takes each roaster's name and the slug in its link, nothing more, for non-commercial use. Users can't register roasters. A bean's roaster must resolve to a registered roaster.
  - The app matches the entered name by its normalized form and by known aliases ("TANAT COFFEE", "Tanat").
  - When several roasters match, for example two roasters with the same name, the user picks one, with a link to each on every.coffee.
  - When nothing matches exactly, the app suggests roasters with similar names. When the user confirms one, the spelling they pasted becomes an alias, so it matches exactly next time.
  - When nothing is close, the bag waits until the admin adds the roaster.

The app reminds users with toasts when they open it. Only bags with a roast date and a plan, and not marked finished, get them:

| Event | Due on | Shown until |
| :-- | :-- | :-- |
| Open, portion and freeze | the day `portion.from` falls on | the user sets the state to `open`, `frozen` or `finished`, or the peak ends |
| Mid-peak check | the day `mid_peak` falls on | the user dismisses it, or 3 days have passed |

The Library's "Coming up" list shows the same events for the next 10 days. The footer links to an Impressum signed "your friendly neighborhood brewer".

Done when a user can, on the deployed desktop web app:
- redeem an invite into an anonymous account;
- paste the JSON for a real bag and save it after review;
- see the bag's plan dates and today's phase, and the toasts from the table above;
- edit and delete their bags and set their state;
- filter their library by roaster, process, variety and rating;
- find a bean saved by a second account in the pool, with its harvests and collective rating, but not one that account kept private;
- export their bags, private ones and personal fields included, to a file that imports into a fresh account with the same rows, with private beans still private.

## Context
- [ARCHITECTURE.md](../../../ARCHITECTURE.md): one layer so far (`src/db.ts`); the layer rule must be enforced once a second layer arrives.
- [Storage choice](../../design-docs/storage-choice.md): SQLite through `node:sqlite` in one file. Its reasoning assumes one person's data, so step 11 revisits it for many accounts.
- [Bag JSON contract](../../product-specs/bag-json-contract.md): the import and export format, and the source of truth for any prompt that produces it.
- [SECURITY.md](../../SECURITY.md): the dependency rules (ask first) and the secret rules. Pasted JSON is untrusted input, even from invited users.
- [CODE_STYLE.md](../../CODE_STYLE.md): SQL names are `snake_case` and singular.
- The owner's planner prompt is kept outside the repo for now. The owner revises it to produce the contract, including a single grind setting; then it gets committed.
- Reference data researched on 2026-10-07:
  - [every.coffee/roasters](https://every.coffee/roasters) lists 9,149 roasters on one page, by name, with stable slugs (`/roaster/tanat-coffee`). Each roaster page links its website, and each product page lists tasting notes, origin, region, variety and producer. Its [terms](https://every.coffee/terms) forbid redistributing or mirroring its data and loads that are unreasonable, but claim no ownership of the underlying facts. Its [robots.txt](https://every.coffee/robots.txt) allows `/roasters` and disallows only `/api/`, accounts, admin and a few data paths.
  - [honestcoffeeguide.com](https://honestcoffeeguide.com/coffee-grind-size-chart/) lists 200+ grinders, each in its own native notation, mapped to microns. The Fellow Ode Gen 2 covers about 275 to 1160 µm in 31 positions.
  - [Beanconqueror](https://github.com/graphefruit/Beanconqueror) is an open-source tracker whose model is a useful checklist. A bean has blend components (country, region, farm, farmer, elevation, variety, processing, harvest), freeze dates and a rating. Water stores a unit next to each mineral.
  - Lotus drops: calcium and magnesium chloride raise GH; sodium and potassium bicarbonate raise KH. All values are ppm as CaCO3.

## Plan
1. **Design.**
   - Desktop screens in Figma, coffee-themed: library, bag detail, add bag (paste JSON, manual entry, or start from the pool), edit bag (with the note that pool facts change for everyone), roasters, the pool (with harvests), the account flows (redeem invite, sign in, account with export) and admin (invites, accounts, roasters, pool coffees and their edit log). Plus toasts and the Impressum.
   - A dark mode as a second mode of the color variables, with every screen shown in both. The dark palette keeps to coffee: brown-black grounds instead of neutral black, crema-colored text, and a brighter cherry for today.
   - Fix the drawn "roaster not registered" state: it offers "Register as a new roaster", which users can no longer do. It should say to ask the admin.

   Verify: the owner reviews the [Figma file](https://www.figma.com/design/ykqcmegfFstYXx8k9TE41u).
2. **Contract.**
   - The [spec](../../product-specs/bag-json-contract.md) is written.
   - Add a JSON Schema file generated from the same definition the importer uses, and fixtures from three real bags.
   - The owner revises the planner prompt to emit the contract, and it gets committed.

   Verify: the fixtures validate; the revised prompt's output for three real bags validates unchanged.
3. **Design docs.** The open questions are answered (see the Decision log). Write design docs for the account model and the web framework. Verify: both design docs have rows in [the design-docs index](../../design-docs/index.md), and `pnpm check:docs` passes.
4. **Database schema and migrations** in `src/db/`, per the draft below, with a small migration runner. Verify with tests on `:memory:`:
   - enums and foreign keys;
   - one roaster per every.coffee slug;
   - one pool coffee per roaster and name, whatever the harvest;
   - a bag can't point at another account's private coffee or grinder;
   - running the migrations twice changes nothing.
5. **Roaster registry from every.coffee.**
   - A job fetches the one page every.coffee/roasters at setup and then weekly. It sends an honest user agent ("BeanQuery roaster sync, weekly, non-commercial") and checks robots.txt first.
   - It reads each `/roaster/<slug>` link's text as the name and upserts the roaster by slug. Names and slugs only: no websites, coffees or other pages.
   - The list lives only in the database, never in this public repo.
   - A roaster that drops off the list stays, because bags may use it.
   - If every.coffee refuses the fetch, the job stops and says so; it never retries with a disguised client. The admin then saves the page from a browser and uploads the file to the same parser.
   - The admin can add a roaster every.coffee lacks.

   Verify:
   - A parser test against a saved copy of the page, kept out of git.
   - One live run either loads the list or stops cleanly on refusal. A refusal is a pass for this step when the saved-copy upload then loads the list.
   - A robots.txt that disallows `/roasters`, and a 403 answer, each stop the job after one request with a message that says to upload a saved copy.
   - A roaster missing from a later list stays, with its bags.
   - Running the import twice gives the same rows.
   - A roaster renamed on every.coffee keeps its id, because its slug is unchanged.
   - Uploading a saved copy gives the same rows as the live run.
   - The admin form adds a roaster that resolves on the next paste.
6. **Domain layer: bags, import and export.**
   - Parse and validate the JSON by the contract's import rules.
   - Resolve the roaster (see Matching). Nothing is saved against an unresolved roaster.
   - Match the grinder by name, and save each bag in one transaction.
   - Add, edit and delete a user's own bags, and set their state.
   - Editing a bag's coffee facts:
     - On a pool coffee, it changes the pool coffee for every account. The user must have a bag on that coffee. Any account can start one, so in practice every account can edit; the protection is the edit log and the admin's undo, not the gate.
     - A rename that would collide with another pool coffee of the same roaster is refused, with an offer to move the bag to that coffee.
     - On the user's private coffee, it edits in place.
   - Re-pasting JSON onto a bag fills the pool coffee's gaps and lists each differing value with a "Use mine" button. Using one is an edit as above.
   - Manual entry and edits enforce the contract's text and list limits.
   - Export writes the contract with every bag's `personal` block filled, and each roaster's slug.

   Verify:
   - Fixture tests.
   - A malformed payload returns errors that name the field.
   - Exporting 60 bags, then importing into an empty account, gives the same values in every contract field. The app's ids, timestamps, `source` and `import_payload` are not compared. One of the bags is private and stays private, and the import creates no pool rows for it.
   - Re-pasting changed coffee facts onto a bag on a pool coffee leaves the pool coffee's existing values unchanged until the user picks "Use mine".
   - Editing a pool coffee's facts changes them for a second account and writes one edit-log row per field. An account with no bag on that coffee can't edit it.
   - A rename onto the name of another pool coffee of the same roaster is refused, the coffee is unchanged, and the user is offered a move of their bag to the other coffee.
   - Deleting a bag leaves its pool coffee in place.
   - Given a fixed "today", the toast events from the Purpose table appear and clear on the right days.
7. **Pool.**
   - Saving a bean publishes its facts unless "Keep this bean private" is ticked. It matches an existing pool coffee when there is one, so a second purchase, a new harvest or a second user doesn't create a duplicate. A published bag's harvest is added to the pool coffee's list.
   - A user can make a published bean private later, from the bag page or by pasting `personal.private: true`.
     - Their bags move to their existing private coffee for that roaster and name, if they have one. Otherwise they move to a new private copy, one of the two cases where bean facts are copied (the other is the admin deleting a pool coffee that bags still use).
     - Their rating leaves the collective rating, and the pool coffee stays for anyone else whose bags use it.
   - A user can publish a private bean later, from the bag page or by pasting `personal.private: false`.
     - The whole private coffee goes through matching (steps 3 to 5 of Matching), with all the user's bags on it.
     - On a match, the bags move to the pool coffee, the private coffee's facts fill its gaps, and the private coffee is deleted. Without one, the private coffee itself becomes the pool coffee.
     - The bags' harvests join the pool coffee's list, and the user's rating joins the collective rating at the next rebuild.
   - The pool is searchable, and a user can start a new bag from a pool coffee.
   - The collective rating counts one rating per account (the latest rated bag's, any harvest). It is rebuilt in full once a day, so deleted bags, beans made private and deleted accounts drop out at the next rebuild.

   Verify:
   - A schema test asserts that `coffee`, `coffee_harvest` and `roaster` have no column for plan, brew, rating, price or date data.
   - Visibility: a private bean is invisible to a second account and a published one is visible. Close-match suggestions never list another account's private coffee.
   - Harvests: two harvests of the same coffee link to one pool coffee that lists both. A private bag's harvest is not listed.
   - Saving a private bean that matches a pool coffee leaves the pool row and its collective rating unchanged.
   - Making a bean private later removes that account from the collective rating at the next rebuild. When the user already has a private coffee with that roaster and name, the bags move into it instead of creating a duplicate.
   - Publishing a private bean later moves all its bags to the matching pool coffee and deletes the private coffee, or turns the private coffee into a pool coffee when nothing matches. Either way the pool lists the bags' harvests, and the rating counts at the next rebuild.
   - The collective rating is hidden at 2 accounts, shown rounded with a count band at 3, and unchanged when one account rates two bags.
8. **Anonymous accounts by invitation, and admin.**
   - Users redeem an invite into an account and sign in with the account number. Sessions, and deleting one's own account.
   - Bootstrap: a server command, run over SSH, creates the first admin account and prints its number once. The same command can create an invite, or a new admin account when the owner loses theirs. No web route can set `is_admin`.
   - Admin tools for the owner:
     - create invites, and see how many are open;
     - list accounts by a short fingerprint of the key hash and the last-seen date, and delete one;
     - add roasters and aliases;
     - edit, merge and delete pool coffees, and undo any edit from a pool coffee's edit log.
   - Deleting or merging a pool coffee never deletes a bag:
     - Deleting a pool coffee that bags still use moves each account's bags to a private copy, as when a user makes the bean private.
     - Merging two pool coffees moves the bags and harvests to the one kept, and deletes the other.
     - `bag.coffee_id` is `ON DELETE RESTRICT`, so nothing removes a coffee from under a bag.

   Verify with tests:
   - key and invite hashing, session expiry, and that sign-in without a valid number or invite is impossible;
   - one account can never read another's rows;
   - a redeemed invite can't be used again and leaves no link to the account it created;
   - deleting an account removes all its rows (bags, private coffees, grinders, roaster notes, sessions), its `coffee_edit` rows stay with `account_id` set to null, and its ratings leave the collective rating at the next rebuild;
   - only the admin reaches admin actions, and no web route sets `is_admin`;
   - the bootstrap command creates a working admin account on an empty database;
   - deleting a used pool coffee keeps every bag, now on private copies; merging keeps every bag and the union of the harvests;
   - undoing an edit restores the old value and logs the undo. Undoing a rename whose old name another pool coffee has taken since is refused with a message.
9. **Web layer.** Pick the framework, add the `db → domain → web` layer rule with its check, then build the screens from step 1, including the toasts and the Impressum. Phase and calendar dates come from the roast date plus the plan's day offsets, in the user's time zone. Verify: `pnpm verify`, plus an end-to-end test of redeem, paste, review, save, a due toast, edit, view, share, export and delete.
10. **Deploy to Hetzner**, in its own exec plan: HTTPS, logs without IP addresses, nightly backups of the SQLite file with a tested restore, and the nightly collective-rating rebuild and weekly roaster import as jobs.
11. **Docs.** Update AGENTS.md, README.md, ARCHITECTURE.md and [storage-choice.md](../../design-docs/storage-choice.md) from "the owner's coffees" to an invite-only multi-user app with a shared pool, plus SECURITY.md for untrusted input, account secrets and admin access. Verify: none of those docs still describes a single owner's database, their `last-verified` dates are updated, and `pnpm check:docs` passes.

## Draft data model
Every table is `STRICT`, in one SQLite file. The "global db" and the "personal db" are two groups of tables rather than two files, because SQLite can't enforce foreign keys between files.

- **Roasters** are one global registry imported from every.coffee: `roaster` has no owner, and every bean points at a registered roaster.
- **Coffees** live in `coffee`. A row with no `owner_account_id` is in the pool, and every account sees it. A row with one is private to that account. A bag points at either kind, so bean facts are stored once. The only copies are made when a published bean is made private later, and when the admin deletes a pool coffee that bags still use.
- **Personal tables** carry `account_id`. Every query on them goes through an account-scoped repository that adds the filter. The schema also enforces it: a trigger on `bag` rejects a `coffee_id` whose `owner_account_id` is set to another account, and `bag` references `grinder` through a composite foreign key `(account_id, grinder_id)`. `bag.coffee_id` is `ON DELETE RESTRICT`.
- **The collective rating** is rebuilt from `bag.rating` once a day for pool coffees. It is never stored on the pool row, and individual ratings never leave `bag`.

Registry and bean facts:

| Table | Holds | Key columns |
| :-- | :-- | :-- |
| `roaster` | A registered roaster | `id`, `name` (as every.coffee spells it), `name_key` (normalized, indexed, not unique), `slug` (unique; the every.coffee slug, or a key the app makes for a roaster the admin added), `source` (`every_coffee` or `admin`). Names and slugs only |
| `roaster_alias` | Other spellings that resolve to a roaster, added when a user confirms a match or by the admin | `alias_key` (normalized), `roaster_id`. Unique on the pair, because one alias can belong to two roasters |
| `coffee` | A coffee as the roaster sells it, across all its harvests | `id`, `owner_account_id` (null when in the pool), `roaster_id`, `name`, `name_key`, `country`, `region`, `farm`, `producer`, `process_printed`, `process_category` (`washed`, `natural`, `honey`, `anaerobic`, `other`, or null for not stated), `altitude_printed`, `altitude_min_m`, `altitude_max_m`, `decaf`. Unique on `roaster_id` and `name_key` among pool rows, and on `owner_account_id`, `roaster_id` and `name_key` among private rows |
| `coffee_harvest` | The harvests seen on published bags of a pool coffee | `coffee_id`, `harvest`. Unique on the pair |
| `coffee_variety` | The varieties of a coffee, so the library can filter by variety | `coffee_id`, `position`, `name` |
| `coffee_tasting_note` | The roaster's tasting notes | `coffee_id`, `position`, `note` |
| `coffee_edit` | The edit log of pool coffees, so the admin can undo | `coffee_id`, `account_id` (`ON DELETE SET NULL`, so deleting an account keeps its edits), `field`, `old_value`, `new_value`, `edited_on`. Only the admin sees who edited |
| `coffee_rating` | The collective rating, rebuilt in full once a day | `coffee_id`, `rating_rounded` (to half a bean), `account_band` (`3+`, `10+` or `50+`). No row below 3 accounts |

Matching a new bean, in order:
1. **Roaster.**
   - An exported bag carries the roaster's `slug`, which resolves it directly.
   - Otherwise resolve the entered roaster by `name_key` and aliases. When several roasters match, the user picks one, with a link to each on every.coffee.
   - When none matches, suggest roasters with similar names. Confirming one stores the pasted spelling as an alias.
   - When nothing is close, the bag can't be saved, and the user is told to ask the admin to add the roaster.
2. **Private beans stop here.** With "Keep this bean private" ticked, the bean is matched only against the user's own private coffees (same roaster and `name_key`). Otherwise a new private coffee is created. It never touches the pool.
3. **Exact match.** Look among that roaster's pool coffees for the same `name_key`, whatever the harvest.
   - On a hit, the bag links to that coffee, so two users with the same bean from the same roaster share one pool coffee and both ratings count toward it.
   - The bag's harvest joins the coffee's harvest list.
   - Missing facts on the pool row are filled from the new bean. A value that differs is kept on the pool row and shown to the user, who can use theirs instead; that is an edit, logged like any other.
4. **Close matches.** Otherwise, offer coffees with similar names ("Gathaithi AA [Washed]" against "Gathaithi AA"), from that roaster's pool coffees and the user's own private coffees only. One click links to one of them.
5. **New coffee.** Otherwise, create the coffee in the pool.

`name_key` lowercases the name, folds accents, and drops punctuation and the process words the roaster put in brackets. The tests pin down which spellings count as the same bean.

Personal:

| Table | Holds | Key columns |
| :-- | :-- | :-- |
| `account` | One anonymous user | `id`, `key_hash` (SHA-256 of the account secret; unique), `is_admin` (set only by the server command), `created_on` and `last_seen_on` (dates, no time) |
| `invite` | An unused invite code from the admin | `code_hash` (SHA-256; unique), `expires_on`. Deleted when redeemed; no column links it to the account it creates. The admin sees only how many are open |
| `session` | Sign-ins | `token_hash`, `account_id`, `expires_at` |
| `roaster_note` | What a user adds to a roaster | `account_id`, `roaster_id`, `note`. Primary key on the pair |
| `grinder` | A user's grinder | `id`, `account_id`, `name`, `note`. Unique on `account_id` and `id`, for the composite foreign key from `bag` |
| `bag` | One bag bought | See the columns below |

The columns of `bag`:
- **Who and what:** `account_id`, `coffee_id`, `harvest`, `lot`.
- **Roast:** `roast_degree`, `roast_degree_assumed`, `roast_date`, `roast_date_printed`, `roast_date_status` (`verified`, `ambiguous`, `missing`, `unlabelled` or `future`).
- **Weight:** `weight_g`, `weight_assumed`.
- **Purchase:** `price_cents`, `currency`, `bought_on`, `shop`, `state` (`sealed`, `open`, `frozen` or `finished`, set by hand).
- **Plan, as day offsets:** `rest_from`, `rest_to`, `peak_from`, `peak_to`, `portion_from`, `portion_to`, `mid_peak`, then `tube_count` and `dial_in_g`.
- **Reminders:** `mid_peak_dismissed`, set when the user dismisses the mid-peak toast.
- **Water:** `water_gh` and `water_kh` (ppm as CaCO3), required whenever water is given. Optional `water_ca`, `water_mg`, `water_na` and `water_k` (ppm as CaCO3) and `water_tds` (ppm).
- **Brew:** `kettle_c`, `grinder_id`, `grind` (one setting, in the grinder's own notation).
- **The user's verdict:** `rating` (0 to 5 in steps of 0.5), `rebuy`, `note`.
- **Provenance:** `source` (`json` or `manual`), `import_payload` (the raw JSON, for audit).

## Accounts
Chosen for version 1:
- An invite code from the admin, redeemed into an account number that only the user sees.
- Export as the only backup.
- Passkeys later.

Invites:
- The admin creates a single-use code that expires after 14 days and sends it to a friend however they like.
- The friend redeems it, and the server shows them a new account number once. The admin never sees it.
- The server deletes the invite on redemption and stores no link between the two. Accounts and open invites carry only dates, never times.
- What that does not stop:
  - The admin knows when they sent each code, so with a few friends they can often guess who redeemed which.
  - The admin runs the server and can read the database.

  So the promise to users is that no other account sees their personal data, not that the admin can't.

Account number:
- A random secret of 100 bits, shown once, as 20 characters of Crockford base32 in groups of four (`K7QF 3M9X TR2D 8HVW PC4N`).
- Crockford base32 skips I, L, O and U, so no character can be misread. Input ignores case, spaces and dashes.
- Digits like Mullvad's would need 31 of them for the same strength. Mullvad's own 16 digits, about 53 bits, rely on rate limits instead.
- Signing in means typing it.
- The database stores only its SHA-256 hash, which can't be reversed for a random secret this long. That needs no server-side pepper, whose loss would lock out every account at once.
- Redeeming asks the user to copy the number, download it as a file or print it, and to tick "I saved it". There is no recovery, by design. A user who loses it gets a new invite and imports their last export.

Passkeys, later: a user could add a passkey (WebAuthn, discoverable credential, random user handle, display name "BeanQuery") and sign in with a fingerprint or face. The server never learns who the user is, and the account number remains the fallback. Version 1 skips them: a session lasts 90 days and renews on use, so friends rarely type the number.

Alternatives considered:
- **A recovery phrase**: the same secret as 10 to 12 words. Easier to write down; otherwise the same.
- **End-to-end encryption**: the strongest privacy, but the server could no longer search, filter or pool anything.
- **Local-only data**: no sync between devices.

Also needed:
- Sessions in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie holding a random token stored as a hash, valid for 90 days and renewed on use, with "sign out everywhere".
- Export as JSON in the contract, with each bag's `personal` block, and as CSV. Import from an export. Deleting the account removes every row it owns.
- Rate limits on sign-in and redemption. Invites replace the sign-up abuse limits a public app would need.
- No IP addresses in logs, no third-party scripts, fonts or analytics, and no bag photos stored.

## Open questions
None right now. All were answered on 2026-10-07; see the Decision log.

## Progress
- [x] 2026-10-07 Research: reference lists, an existing tracker's model, water units, intake options
- [x] 2026-10-07 Owner answered three rounds of questions, and delegated the rest (see Decision log)
- [ ] Design in Figma, reviewed by the owner. Done 2026-10-07: tokens, text styles, components, and the Library, Bag detail and Add bag screens, plus the unregistered-roaster state (which needs the fix in step 1). Still to do: the dark mode (its palette and script are drafted locally; applying it is blocked by the Figma limit), edit bag, the pool, roasters, account flows, admin, toasts and the Impressum
- [ ] Contract: spec written 2026-10-07; JSON Schema, fixtures and the revised prompt still to do
- [ ] Design docs written (accounts, web framework). The open questions were answered 2026-10-07
- [ ] Database schema and migrations
- [ ] Roaster registry imported from every.coffee
- [ ] Bags, import and export in the domain layer
- [ ] Pool, matching and collective rating
- [ ] Accounts by invitation, and admin
- [ ] Web layer and screens
- [ ] Deployed (separate exec plan)
- [ ] Project docs updated for multi-user

## Decision log
- 2026-10-07: Desktop browser first; phone layouts later, because the owner mostly uses a desktop. Rejected: phone-first.
- 2026-10-07: No Claude or other AI API calls at runtime. Bags come in as pasted JSON that follows our schema, or by manual entry, because the owner keeps their own LLM chat and prompt. Rejected: in-app photo upload calling Claude.
- 2026-10-07: The rest, peak, freeze, water, kettle and grind rules stay in the user's LLM prompt; the app stores the result. The app does only date arithmetic: adding the day offsets to the roast date and placing today in a phase. Rejected: reimplementing the rule tables as tested code. Cost: editing a roast date moves the dates, but changing the process does not change the windows until the JSON is pasted again.
- 2026-10-07: One rating per bag, no brew log. Water, grinder and grind are recorded on the bag. Rejected: per-brew logging.
- 2026-10-07: Roasters are their own table, and every coffee links to one roaster.
- 2026-10-07: Multi-user, with anonymous accounts that have no username, password or email, and an export of the user's bags.
- 2026-10-07: Saving a bean publishes its facts to the global pool by default, and the user's own fields stay personal. A "Keep this bean private" checkbox opts out per bean. Rejected: opt-in sharing.
- 2026-10-07: The pool holds bean facts only: no plan, freeze or rest times, water, grinder or grind. It does show a collective rating combined from all accounts' ratings.
- 2026-10-07: A bean's roaster must match a registered roaster before the bean is saved. Rejected: free-text roaster names, and a private roaster list per account.
- 2026-10-07: Two users with the same bean from the same roaster link to the same pool coffee. Rejected: one pool row per contribution.
- 2026-10-07: The JSON contract drops packaging, confidence and flags. A bag holds one grind setting and one water given only as numbers, with no name. So there is no water-profile or per-brewer grind table, and no separate "recommended" and "used" values. Rejected: grind per brewer and fresh or frozen, a named alternative water.
- 2026-10-07: Water is described by general hardness and alkalinity in ppm as CaCO3 (`gh`, `kh`), which works for any water:
  - remineralizing drops and sachets;
  - bottled water, converted from its label (Ca × 2.5 + Mg × 4.1 = GH, HCO3 × 0.82 = KH);
  - filtered tap water, measured with a GH/KH test kit.

  The ions `ca`, `mg`, `na` and `k` and `tds` are optional detail. They are not checked to add up, because Na and K count toward KH only as bicarbonates, as in Lotus drops. Rejected: TDS alone, because waters with very different minerals can share a TDS reading; the four ions alone, because most waters are not known at that detail.
- 2026-10-07: The pool and personal data share one SQLite file, separated by table and by `owner_account_id`, so foreign keys from bags to pool coffees are enforced. Rejected: two database files, because SQLite can't enforce foreign keys across them; one file per account, because of the same limit plus running migrations over every file.
- 2026-10-07: Ratings run from 0 to 5 in steps of 0.5, the same for every account. Rejected: 1 to 10, 0 to 100.
- 2026-10-07: All harvests of a coffee are one pool coffee, and the pool coffee lists every harvest seen. Harvest and lot are recorded per bag. Rejected: one pool coffee per harvest.
- 2026-10-07: Roasters come only from every.coffee's list; users can't register roasters. The admin adds roasters every.coffee lacks.
- 2026-10-07: Access is by invitation from the owner, mostly for friends. Rejected: open sign-up.
- 2026-10-07: The [bag JSON contract](../../product-specs/bag-json-contract.md) is the source of truth, with one grind setting per bag. The owner's prompt is revised to follow it, then committed.
- 2026-10-07: Users add, edit and delete their own bags, and set the state by hand when adding or browsing. Rejected: working the state out from the dates.
- 2026-10-07: Reminders are toasts shown when the app opens. Rejected: email, push notifications, a calendar feed.
- 2026-10-07: The app gets a dark mode alongside the light one. Rejected: light only.
- 2026-10-07: The roaster list is taken by fetching every.coffee/roasters weekly, for non-commercial use: names and slugs only. The fetch stays within robots.txt, and every.coffee is not emailed. If the fetch is refused, the admin uploads a saved copy; the job never disguises itself. Rejected: asking every.coffee for access first, and fetching websites or coffee pages.
- 2026-10-07: Any account with a bag on a pool coffee can edit its facts, for everyone, because the owner can't review every change. A log of every edit lets the admin undo. Re-pasting only fills gaps unless the user picks "Use mine". Rejected: admin-only edits.
- 2026-10-07: No inventory for now: no tube or gram countdown.
- 2026-10-07: The owner delegated the remaining questions. Decided on their behalf:
  - **Roast degree** stays on the bag, not in the pool, because it is often assumed rather than printed and can change between harvests.
  - **No separate opt-out** from the collective rating. "Keep this bean private" already covers it, and one checkbox is simpler.
  - **Deleting an account** leaves its pool coffees and its edits (with the account removed). Its ratings drop out at the next rebuild.
  - **The 3-account threshold** stays, with rounding and count bands. At 2, each of two friends could work out the other's rating.
  - **The owner's existing coffees** need no migration; they are pasted after launch like any bag.
  - **The revised prompt** gets committed as `prompts/coffee-planner.md` once it emits the contract. Friends copy it and change its water and grinder parts to their own gear.
  - **The UI is in English only**, with dates like "18 Sep 2026". "Today" and the toasts follow the browser's time zone.
  - **Grinders** are each user's own list, suggested from their earlier bags. There is no shared list, which also avoids copying honestcoffeeguide.
  - **The account number** is 20 Crockford base32 characters, which is shorter to type than 31 digits.
  - **No passkeys in version 1.** A 90-day session that renews on use keeps sign-ins rare. Revisit if friends ask.
- 2026-10-07: No privacy policy for a friends-only app; a joke Impressum signed "your friendly neighborhood brewer". Revisit if the app ever opens to the public.

## Surprises
- 2026-10-07: every.coffee refuses plain HTTP fetches (403) but loads in a browser. Its product pages carry structured origin, variety and tasting notes, which could fill gaps in a pasted bag if the terms allow it.
- 2026-10-07: In the owner's water table the K column equals KH and Mg plus Ca equals GH. That holds because Lotus potassium is potassium bicarbonate, so potassium is the buffer in these recipes.
- 2026-10-07: The Figma MCP stopped working after about 20 calls: Figma's Starter plan allows 20 MCP tool calls a month. The remaining screens need a Professional plan with a Full seat (200 calls a day), the next month's allowance, or another tool. The Add bag frame is 1240 px tall but its content needs about 1380 px, so the bottom of the review card is cut off until the frame is resized.
- 2026-10-07: A fresh-context review of this plan found eight gaps, all fixed in it the same day:
  - a private bean could leak into the pool through matching;
  - the contract couldn't carry a full export;
  - nothing stopped a bag from pointing at another account's private coffee;
  - the collective rating's privacy claim was too strong and its cache could go stale;
  - roaster and harvest uniqueness didn't hold;
  - the account-number example was weaker than the stated 100 bits;
  - a server pepper could lock out every account;
  - two milestones had no check.

- 2026-10-07: A second review found nine more gaps, also fixed the same day:
  - exports above the paste limits could not import;
  - re-pasting could overwrite shared pool facts;
  - making a bean private could duplicate a private coffee;
  - roaster suggestions were promised but not specified;
  - the every.coffee import relied on a fetch that is blocked;
  - the admin could link friends to accounts by timing;
  - there was no way to create the first admin;
  - admin delete and merge could break bags;
  - toasts had no rules.

## Validation
`pnpm verify` passes. The end-to-end test:
1. redeems an invite into an account;
2. pastes each fixture, one of them with "Keep this bean private" ticked;
3. checks the saved rows, the computed dates, and that the private bean is not in the pool;
4. checks a toast on the portion day, then edits one bag and deletes another;
5. exports, imports into a new account, and compares the two, private bean included.

## Outcome
Filled in when the plan moves to completed/.
