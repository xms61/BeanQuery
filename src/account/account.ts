import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// Crockford base32: no I, L, O or U, so nothing on the screen can be misread.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NUMBER_LENGTH = 20; // 100 bits
const INVITE_LENGTH = 12; // 60 bits, enough for a code that lives 14 days
const INVITE_DAYS = 14;
const SESSION_DAYS = 90;

const sha256 = (text: string) => createHash('sha256').update(text).digest();
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const isoTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

function randomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * A code as typed, in its canonical form: case, spaces and dashes ignored, and I, L and O read as 1, 1 and 0, as
 * Crockford base32 does. Null when it is not `length` characters of the alphabet.
 */
function normalizeCode(entered: string, length: number): string | null {
  const code = entered.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (code.length !== length || [...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

export const normalizeAccountNumber = (entered: string) => normalizeCode(entered, NUMBER_LENGTH);

/** A fresh account number, to show once, and the SHA-256 hash that is all the database keeps of it. */
export function newAccountNumber(): { accountNumber: string; keyHash: Buffer } {
  const accountNumber = randomCode(NUMBER_LENGTH);
  return { accountNumber, keyHash: sha256(normalizeAccountNumber(accountNumber) as string) };
}

/** Creates an ordinary account. Accounts carry dates, never times. Only the bootstrap command makes admins. */
function insertAccount(db: DatabaseSync, now: Date): { accountId: number; accountNumber: string } {
  const { accountNumber, keyHash } = newAccountNumber();
  const row = db
    .prepare('INSERT INTO account (key_hash, created_on, last_seen_on) VALUES (?, ?, ?) RETURNING id')
    .get(keyHash, isoDate(now), isoDate(now));
  return { accountId: Number(row?.id), accountNumber };
}

/** Creates a single-use invite, valid 14 days. The code is returned once; only its hash is kept. */
export function createInvite(db: DatabaseSync, now: Date): { code: string; expiresOn: string } {
  const code = randomCode(INVITE_LENGTH);
  const expiresOn = isoDate(addDays(now, INVITE_DAYS));
  db.prepare('INSERT INTO invite (code_hash, expires_on) VALUES (?, ?)').run(
    sha256(normalizeCode(code, INVITE_LENGTH) as string),
    expiresOn,
  );
  return { code, expiresOn };
}

/** How many invites are open, which is all the admin sees of them. */
export function openInviteCount(db: DatabaseSync, now: Date): number {
  return Number(db.prepare('SELECT count(*) AS n FROM invite WHERE expires_on >= ?').get(isoDate(now))?.n);
}

/**
 * Redeems an invite into a new account. The invite is deleted in the same transaction, and nothing links it to the
 * account. An unknown, used or expired code answers `invalid`, all alike.
 */
export function redeemInvite(
  db: DatabaseSync,
  enteredCode: string,
  now: Date,
): { status: 'redeemed'; accountId: number; accountNumber: string } | { status: 'invalid' } {
  const code = normalizeCode(enteredCode, INVITE_LENGTH);
  if (code === null) return { status: 'invalid' };
  db.exec('BEGIN');
  try {
    const used = db
      .prepare('DELETE FROM invite WHERE code_hash = ? AND expires_on >= ?')
      .run(sha256(code), isoDate(now)).changes;
    if (used !== 1) {
      db.exec('ROLLBACK');
      return { status: 'invalid' };
    }
    const account = insertAccount(db, now);
    db.exec('COMMIT');
    return { status: 'redeemed', ...account };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Signs in with an account number. The session token is returned once, for the cookie; only its hash is kept. */
export function signIn(
  db: DatabaseSync,
  enteredNumber: string,
  now: Date,
): { status: 'signed_in'; accountId: number; token: string; expiresAt: string } | { status: 'invalid' } {
  const number = normalizeAccountNumber(enteredNumber);
  if (number === null) return { status: 'invalid' };
  const account = db.prepare('SELECT id FROM account WHERE key_hash = ?').get(sha256(number));
  if (account === undefined) return { status: 'invalid' };
  const token = randomBytes(32).toString('base64url');
  const expiresAt = isoTime(addDays(now, SESSION_DAYS));
  db.prepare('INSERT INTO session (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    Number(account.id),
    expiresAt,
  );
  db.prepare('UPDATE account SET last_seen_on = ? WHERE id = ?').run(isoDate(now), Number(account.id));
  return { status: 'signed_in', accountId: Number(account.id), token, expiresAt };
}

/**
 * The account a session token belongs to, or null when it is unknown or expired. A valid session is renewed for 90
 * days from now, and the account is marked as seen today.
 */
export function accountForSession(db: DatabaseSync, token: string, now: Date): number | null {
  const tokenHash = sha256(token);
  const session = db
    .prepare('SELECT account_id FROM session WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, isoTime(now));
  if (session === undefined) return null;
  db.prepare('UPDATE session SET expires_at = ? WHERE token_hash = ?').run(
    isoTime(addDays(now, SESSION_DAYS)),
    tokenHash,
  );
  db.prepare('UPDATE account SET last_seen_on = ? WHERE id = ?').run(isoDate(now), Number(session.account_id));
  return Number(session.account_id);
}

export function signOut(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM session WHERE token_hash = ?').run(sha256(token));
}

export function signOutEverywhere(db: DatabaseSync, accountId: number): void {
  db.prepare('DELETE FROM session WHERE account_id = ?').run(accountId);
}

/**
 * Deletes an account and every row it owns: bags, private coffees, grinders, roaster notes and sessions. Its edits
 * to pool coffees stay, with the account removed, and its ratings leave the collective rating at the next rebuild.
 */
export function deleteAccount(db: DatabaseSync, accountId: number): boolean {
  return db.prepare('DELETE FROM account WHERE id = ?').run(accountId).changes === 1;
}
