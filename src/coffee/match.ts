import type { DatabaseSync } from 'node:sqlite';

export interface CloseCoffee {
  id: number;
  name: string;
  private: boolean;
}

/**
 * Whether two coffee name keys are close: one has every word of the other, plus more ("gathaithi aa" and
 * "gathaithi aa lot 2"). Keys that differ in a word, such as two lot numbers, are not close, because that word
 * usually marks a different coffee.
 */
export function isCloseName(a: string, b: string): boolean {
  if (a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const longerWords = new Set(longer.split(' '));
  const shorterWords = shorter.split(' ').filter(Boolean);
  return (
    shorterWords.length > 0 && shorterWords.length < longerWords.size && shorterWords.every((w) => longerWords.has(w))
  );
}

/**
 * The coffees a new bean's name is close to: the roaster's pool coffees and the account's own private coffees, never
 * another account's private ones. In id order.
 */
export function closeCoffees(db: DatabaseSync, accountId: number, roasterId: number, nameKey: string): CloseCoffee[] {
  return db
    .prepare(
      `SELECT id, name, name_key, owner_account_id FROM coffee
       WHERE roaster_id = ? AND (owner_account_id IS NULL OR owner_account_id = ?)
       ORDER BY id`,
    )
    .all(roasterId, accountId)
    .filter((row) => isCloseName(nameKey, String(row.name_key)))
    .map((row) => ({ id: Number(row.id), name: String(row.name), private: row.owner_account_id !== null }));
}
