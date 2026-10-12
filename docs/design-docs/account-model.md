---
status: draft
last-verified: 2026-10-13
---

# Account model: anonymous accounts by invitation

## Decision
BeanQuery accounts are anonymous, in the style of Mullvad VPN: no username, password or email, only an account number. Access is by invitation from the owner, who is the admin. Version 1 has:
- invite codes, redeemed into an account number that only the user sees;
- sign-in by typing the account number, then a 90-day session;
- export of the user's bags as the only backup.

Passkeys come later. The tables are `account`, `invite` and `session` in [src/db/migrate.ts](../../src/db/migrate.ts).

## How it works
**Invites**
- The admin creates a single-use code of 12 Crockford base32 characters (60 bits) that expires after 14 days, and sends it to a friend however they like. An unknown, used or expired code all get the same answer.
- The friend redeems it, and the server shows them a new account number once. The admin never sees it.
- The server deletes the invite on redemption and stores no link between the two. Accounts and open invites carry dates only, never times. The admin sees only how many invites are open.

**The account number**
- A random 100-bit secret, shown once as 20 Crockford base32 characters in groups of four (`K7QF 3M9X TR2D 8HVW PC4N`).
- Crockford base32 leaves out I, L, O and U, so no character can be misread. Input ignores case, spaces and dashes, and reads I, L and O as 1, 1 and 0, as Crockford base32 does, so a misread character still works.
- The database stores only its SHA-256 hash. A random secret this long can't be found from its hash, so no server-side pepper is needed, and losing a pepper can't lock every account out at once.
- Redeeming asks the user to copy the number, download it as a file or print it, and to tick "I saved it". There is no recovery, by design. A user who loses it gets a new invite and imports their last export.

**Sessions**
- An `HttpOnly`, `Secure`, `SameSite=Lax` cookie holds a random token. The server stores the token's hash.
- A session lasts 90 days and renews on use, with "sign out everywhere".
- Sign-in and redemption are rate-limited. Invites replace the sign-up abuse limits a public app would need.

**The admin**
- A server command, run over SSH, creates the first admin account on an empty database and prints its number once: `pnpm admin create-admin`. On a database that has accounts it needs `--another`, for when the owner loses theirs. `pnpm admin create-invite` creates invites.
- No web route can set `is_admin`.
- The admin's tools (`src/admin/`) each check that the acting account is an admin and refuse otherwise:
  - create invites and see how many are open;
  - list accounts by the first 8 hex digits of the key hash, with the created and last-seen dates, and delete any account but their own (they delete their own from the account page, so a list click can't lock out the last admin);
  - add roasters and other spellings of a roaster;
  - edit a pool coffee, see its edit log with who edited, and undo any edit. An undo is logged as an edit, so it can be undone too. Undoing a rename onto a name another pool coffee has taken since is refused;
  - merge two pool coffees of the same roaster: the bags and harvests move to the one kept, whose facts stay as they are;
  - delete a pool coffee: each account's bags move to its own private coffee of that name, or to a private copy, as when a user makes the bean private. No bag is lost.

**Time zone:** each account keeps the IANA time zone its browser reports when signing in, so phases, plan dates and reminders change at the user's midnight. The account page can change it. It is stored on the account, not in a cookie.

**Theme:** System, Light or Dark, picked on the account page and stored on the account, so every device it signs in on shows the same. System, the default, follows the device's light or dark preference; every page's `<html>` carries `data-theme` for the other two, and the stylesheet's dark tokens follow it.

**Export** writes the user's bags as JSON in the [bag JSON contract](../product-specs/bag-json-contract.md), with each bag's `personal` block, and as CSV. The JSON imports back into any account.

**Deleting an account** removes every row it owns. Its edits to pool coffees stay, with the account removed, and its ratings leave the collective rating at the next rebuild.

## What it promises, and what it doesn't
No other account sees a user's personal data. The admin is not kept out:
- The admin runs the server and can read the database and its backups.
- The admin knows when they sent each code, so with a few friends they can often guess who redeemed which.

Logs hold no IP addresses, the pages load no third-party scripts, fonts or analytics, and bag photos are never stored.

## Why
- Friends shouldn't have to hand over an email or invent another password for a coffee log.
- An account number alone is enough for a small invite-only app. 100 bits can't be guessed, unlike Mullvad's 16 digits (about 53 bits), which rely on rate limits.
- Base32 needs 20 characters for 100 bits, where digits would need 31.
- Hashing without a pepper keeps the server's secrets down to none: a backup of the database is all a restore needs.

## Alternatives considered
- **Username and password, or email sign-in:** collects personal data the app doesn't need, and email needs a mail service.
- **A recovery phrase** of 10 to 12 words: the same secret, easier to write down. Otherwise the same as the account number.
- **End-to-end encryption:** the strongest privacy, but the server could no longer search, filter or pool anything.
- **Local-only data:** no sync between devices.
- **Open sign-up:** needs abuse limits and moderation; the app is for friends.

## Revisit when
- Friends ask for an easier sign-in: add passkeys (WebAuthn, discoverable credential, random user handle, display name "BeanQuery"). The account number stays the fallback.
- The app opens to the public: add sign-up limits and a privacy policy, and reconsider the admin's access to personal data.
