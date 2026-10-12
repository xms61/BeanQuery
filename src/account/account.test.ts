import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { addBag } from '../bag/manage.js';
import { rebuildCollectiveRatings } from '../coffee/rating.js';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db.js';
import { importRoasters } from '../roaster/import.js';
import {
  accountForSession,
  createInvite,
  deleteAccount,
  normalizeAccountNumber,
  openInviteCount,
  redeemInvite,
  signIn,
  signOut,
  signOutEverywhere,
} from './account.js';
import { createAdmin } from './bootstrap.js';

const fixture = JSON.parse(
  readFileSync(new URL('../contract/fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8'),
);
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const crockford = /^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){4}$/;

function fresh(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

/** A redeemed account: its id and the number its owner was shown. */
function newAccount(db: DatabaseSync, now = day('2026-10-12')) {
  const { code } = createInvite(db, now);
  const redeemed = redeemInvite(db, code, now);
  if (redeemed.status !== 'redeemed') throw new Error('redeem failed');
  return redeemed;
}

describe('account numbers', () => {
  test('are 20 Crockford base32 characters in groups of four, different each time', () => {
    const db = fresh();
    const a = newAccount(db).accountNumber;
    const b = newAccount(db).accountNumber;
    expect(a).toMatch(crockford);
    expect(a).not.toBe(b);
    db.close();
  });

  test('read back ignoring case, spaces and dashes, and with I, L and O read as 1, 1 and 0', () => {
    expect(normalizeAccountNumber('k7qf-3m9x tr2d 8hvw pc4n')).toBe('K7QF3M9XTR2D8HVWPC4N');
    expect(normalizeAccountNumber('K7QF 3M9X TR2D 8HVW PC4N')).toBe('K7QF3M9XTR2D8HVWPC4N');
    expect(normalizeAccountNumber('IL0O 3M9X TR2D 8HVW PC4N')).toBe('1100' + '3M9XTR2D8HVWPC4N');
    expect(normalizeAccountNumber('K7QF 3M9X TR2D 8HVW PC4')).toBeNull();
    expect(normalizeAccountNumber('K7QF 3M9X TR2D 8HVW PC4U')).toBeNull();
  });

  test('are stored only as a SHA-256 hash', () => {
    const db = fresh();
    const { accountId, accountNumber } = newAccount(db);
    const row = db.prepare('SELECT key_hash FROM account WHERE id = ?').get(accountId);
    const expected = createHash('sha256')
      .update(normalizeAccountNumber(accountNumber) as string)
      .digest();
    expect(Buffer.from(row?.key_hash as Uint8Array).equals(expected)).toBe(true);
    const everything = JSON.stringify(db.prepare('SELECT * FROM account').all(), (_, v) =>
      v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v,
    );
    expect(everything).not.toContain(normalizeAccountNumber(accountNumber));
    db.close();
  });
});

describe('invites', () => {
  test('redeem once into a new account, dated by day only, and leave no trace of the invite', () => {
    const db = fresh();
    const { code } = createInvite(db, day('2026-10-12'));
    expect(openInviteCount(db, day('2026-10-12'))).toBe(1);

    const redeemed = redeemInvite(db, code, day('2026-10-13'));
    expect(redeemed).toMatchObject({
      status: 'redeemed',
      accountId: 1,
      accountNumber: expect.stringMatching(crockford),
    });
    expect(db.prepare('SELECT is_admin, created_on, last_seen_on FROM account').all()).toEqual([
      { is_admin: 0, created_on: '2026-10-13', last_seen_on: '2026-10-13' },
    ]);
    expect(db.prepare('SELECT count(*) AS n FROM invite').get()).toEqual({ n: 0 });
    expect(redeemInvite(db, code, day('2026-10-13'))).toEqual({ status: 'invalid' });
    db.close();
  });

  test('expire after 14 days, and stop counting as open', () => {
    const db = fresh();
    const { code, expiresOn } = createInvite(db, day('2026-10-12'));
    expect(expiresOn).toBe('2026-10-26');
    expect(openInviteCount(db, day('2026-10-27'))).toBe(0);
    expect(redeemInvite(db, code, day('2026-10-27'))).toEqual({ status: 'invalid' });
    expect(redeemInvite(db, code, day('2026-10-26'))).toMatchObject({ status: 'redeemed' });
    db.close();
  });

  test('read back ignoring case, spaces and dashes, and store only a hash', () => {
    const db = fresh();
    const { code } = createInvite(db, day('2026-10-12'));
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}( [0-9A-HJKMNP-TV-Z]{4}){2}$/);
    const stored = db.prepare('SELECT code_hash FROM invite').get()?.code_hash as Uint8Array;
    expect(Buffer.from(stored).equals(createHash('sha256').update(code.replace(/ /g, '')).digest())).toBe(true);
    expect(redeemInvite(db, code.toLowerCase().replace(/ /g, '-'), day('2026-10-12'))).toMatchObject({
      status: 'redeemed',
    });
    db.close();
  });

  test('refuse a code that was never issued', () => {
    const db = fresh();
    expect(redeemInvite(db, 'ABCD EFGH JKMN', day('2026-10-12'))).toEqual({ status: 'invalid' });
    expect(redeemInvite(db, 'not a code', day('2026-10-12'))).toEqual({ status: 'invalid' });
    db.close();
  });
});

describe('sessions', () => {
  test('sign in with the account number, and only with it', () => {
    const db = fresh();
    const { accountId, accountNumber } = newAccount(db);
    const session = signIn(db, accountNumber.toLowerCase(), day('2026-10-14'));
    expect(session).toMatchObject({ status: 'signed_in', accountId, expiresAt: '2027-01-12T12:00:00Z' });
    expect(signIn(db, 'K7QF 3M9X TR2D 8HVW PC4N', day('2026-10-14'))).toEqual({ status: 'invalid' });
    expect(signIn(db, 'nonsense', day('2026-10-14'))).toEqual({ status: 'invalid' });
    db.close();
  });

  test('last 90 days, renew on use, and mark the account as seen that day', () => {
    const db = fresh();
    const { accountId, accountNumber } = newAccount(db);
    const session = signIn(db, accountNumber, day('2026-10-14'));
    if (session.status !== 'signed_in') throw new Error('sign in failed');

    expect(accountForSession(db, session.token, day('2027-01-01'))).toBe(accountId);
    expect(db.prepare('SELECT last_seen_on FROM account').get()).toEqual({ last_seen_on: '2027-01-01' });
    // Renewed on 1 January, so still valid in March, 90 days later at most.
    expect(accountForSession(db, session.token, day('2027-03-31'))).toBe(accountId);
    expect(accountForSession(db, session.token, day('2027-07-01'))).toBeNull();
    expect(accountForSession(db, 'not a token', day('2026-10-14'))).toBeNull();
    db.close();
  });

  test('sign out one browser, or everywhere', () => {
    const db = fresh();
    const { accountNumber } = newAccount(db);
    const tokens = [1, 2, 3].map(() => {
      const s = signIn(db, accountNumber, day('2026-10-14'));
      return s.status === 'signed_in' ? s.token : '';
    });
    signOut(db, tokens[0] as string);
    expect(accountForSession(db, tokens[0] as string, day('2026-10-14'))).toBeNull();
    expect(accountForSession(db, tokens[1] as string, day('2026-10-14'))).toBe(1);
    signOutEverywhere(db, 1);
    expect(accountForSession(db, tokens[2] as string, day('2026-10-14'))).toBeNull();
    db.close();
  });

  test('store only a hash of the token', () => {
    const db = fresh();
    const { accountNumber } = newAccount(db);
    const s = signIn(db, accountNumber, day('2026-10-14'));
    const stored = db.prepare('SELECT token_hash FROM session').get()?.token_hash as Uint8Array;
    expect(
      Buffer.from(stored).equals(
        createHash('sha256')
          .update(s.status === 'signed_in' ? s.token : '')
          .digest(),
      ),
    ).toBe(true);
    db.close();
  });
});

describe('deleteAccount', () => {
  test('removes every row the account owns, keeps its pool edits without it, and drops its ratings at the next rebuild', () => {
    const db = fresh();
    importRoasters(db, [{ slug: 'nord-kaffe', name: 'Nord Kaffe', otherNames: [] }]);
    const accounts = [newAccount(db), newAccount(db), newAccount(db)];
    for (const { accountId } of accounts) {
      const bag = structuredClone(fixture.bags[0]);
      bag.personal = { rating: 4 };
      addBag(db, accountId, bag);
    }
    const secret = structuredClone(fixture.bags[1]);
    secret.personal = { private: true };
    addBag(db, 3, secret);
    db.exec(`INSERT INTO roaster_note (account_id, roaster_id, note) VALUES (3, 1, 'Fast shipping');
      INSERT INTO coffee_edit (coffee_id, account_id, field, old_value, new_value, edited_on)
        VALUES (1, 3, 'region', 'Guji', 'Guji, Uraga', '2026-10-12')`);
    signIn(db, accounts[2]?.accountNumber as string, day('2026-10-14'));
    rebuildCollectiveRatings(db);
    expect(db.prepare('SELECT count(*) AS n FROM coffee_rating').get()).toEqual({ n: 1 });
    // The fixture names a grinder, so account 3 has one and its bags point at it through the composite key.
    expect(db.prepare('SELECT count(*) AS n FROM bag WHERE account_id = 3 AND grinder_id IS NOT NULL').get()).toEqual({
      n: 2,
    });

    expect(deleteAccount(db, 3)).toBe(true);
    const left = (table: string) =>
      Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE account_id = 3`).get()?.n);
    expect([left('bag'), left('grinder'), left('roaster_note'), left('session')]).toEqual([0, 0, 0, 0]);
    expect(db.prepare('SELECT count(*) AS n FROM coffee WHERE owner_account_id = 3').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT account_id FROM coffee_edit').all()).toEqual([{ account_id: null }]);
    rebuildCollectiveRatings(db);
    expect(db.prepare('SELECT count(*) AS n FROM coffee_rating').get()).toEqual({ n: 0 });
    expect(deleteAccount(db, 3)).toBe(false);
    db.close();
  });
});

describe('the first admin', () => {
  test('is created by the bootstrap command on an empty database, and can sign in', () => {
    const db = fresh();
    const admin = createAdmin(db, day('2026-10-12'));
    expect(admin.accountNumber).toMatch(crockford);
    expect(db.prepare('SELECT id, is_admin FROM account').all()).toEqual([{ id: admin.accountId, is_admin: 1 }]);
    expect(signIn(db, admin.accountNumber, day('2026-10-12'))).toMatchObject({
      status: 'signed_in',
      accountId: admin.accountId,
    });
    db.close();
  });

  test('is the only way to set is_admin: only the bootstrap and the schema mention it', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? sources(join(dir, entry.name))
          : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
            ? [join(dir, entry.name)]
            : [],
      );
    const src = fileURLToPath(new URL('../', import.meta.url));
    // Any mention fails until it is added here, so a new write in any form gets looked at. Read-only checks, such
    // as the admin tools asking whether an account is an admin, are added by name.
    const mentions = sources(src)
      .filter((path) => readFileSync(path, 'utf8').includes('is_admin'))
      .map((path) => relative(src, path).split(sep).join('/'))
      .sort();
    expect(mentions).toEqual(['account/bootstrap.ts', 'db/migrate.ts']);
  });
});
