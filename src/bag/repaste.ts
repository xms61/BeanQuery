import type { DatabaseSync } from 'node:sqlite';
import { applyCoffeeEdit } from '../coffee/edit.js';
import type { CloseCoffee } from '../coffee/match.js';
import { coffeeNameKey } from '../coffee/name-key.js';
import { applyMakePrivate, applyPublish } from '../coffee/privacy.js';
import { type ContractError, parseBagsJson, pasteLimits } from '../contract/bag-json.js';
import { readBag } from './export.js';
import {
  bagColumns,
  type CoffeeChoice,
  type CoffeeQuestion,
  type Difference,
  type RoasterQuestion,
  resolveRoaster,
  Saver,
} from './import.js';
import { ratedOn } from './manage.js';

export type RepasteResult =
  | { status: 'saved'; differences: Difference[] }
  | { status: 'needs_roaster'; bags: RoasterQuestion[] }
  | { status: 'needs_coffee'; bags: CoffeeQuestion[] }
  | { status: 'invalid'; errors: ContractError[] }
  | { status: 'not_found' }
  | { status: 'name_taken'; coffeeId: number };

/**
 * Pastes JSON for one bag onto an existing own bag, by the contract's rule for it:
 * - The bag's own fields the JSON carries replace the old ones, and the personal fields it leaves out are kept.
 * - A changed `personal.private` first makes the bean private or publishes it, as from the bag's page. Publishing can
 *   ask about a close pool coffee; the answer comes back as `coffeeChoice`.
 * - The coffee facts then go through matching again, as for a new bean. On a pool coffee they only fill gaps and come
 *   back as differences for "Use mine". On the account's own private coffee they are edited in place.
 */
export function repasteBag(
  db: DatabaseSync,
  accountId: number,
  bagId: number,
  json: string,
  options: { roasterChoice?: number; coffeeChoice?: CoffeeChoice } = {},
): RepasteResult {
  const parsed = parseBagsJson(json, pasteLimits);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  const [pasted, ...rest] = parsed.value.bags;
  if (pasted === undefined || rest.length > 0) {
    const message = `Paste one bag at a time onto a bag; this has ${parsed.value.bags.length}`;
    return { status: 'invalid', errors: [{ path: 'bags', message }] };
  }

  const current = readBag(db, accountId, bagId);
  if (current === undefined) return { status: 'not_found' };
  const wasPrivate = current.personal?.private ?? false;
  const isPrivate = pasted.personal?.private ?? wasPrivate;

  const answer = resolveRoaster(db, pasted.roaster, options.roasterChoice);
  if (!('roaster' in answer))
    return { status: 'needs_roaster', bags: [{ index: 0, entered: pasted.roaster.name, ...answer }] };

  const merged = { ...pasted, personal: { ...current.personal, ...pasted.personal, private: isPrivate } };
  const oldNameKey = db
    .prepare('SELECT c.name_key FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = ?')
    .get(bagId)?.name_key;
  const save = new Saver(db, accountId);
  // After publishing, a paste that still names the same coffee stays on the coffee the move chose, which may be a
  // close match the user picked under another name.
  let published: CloseCoffee | undefined;
  db.exec('BEGIN');
  try {
    if (isPrivate !== wasPrivate) {
      const moved = isPrivate
        ? applyMakePrivate(db, accountId, bagId)
        : applyPublish(db, accountId, bagId, options.coffeeChoice);
      if (moved.status === 'needs_coffee') {
        db.exec('ROLLBACK');
        return moved;
      }
      if (moved.status !== 'saved') throw new Error(`Changing whether the bean is private answered ${moved.status}`);
      // The publish's own differences are not kept: matching the pasted facts below reports them once.
      if (!isPrivate && coffeeNameKey(pasted.coffee.name) === oldNameKey) {
        published = { id: moved.coffeeId, name: pasted.coffee.name, private: false };
      }
    }

    const onCoffee = db
      .prepare('SELECT b.coffee_id, c.roaster_id FROM bag b JOIN coffee c ON c.id = b.coffee_id WHERE b.id = ?')
      .get(bagId);
    const currentCoffeeId = Number(onCoffee?.coffee_id);
    let coffeeId: number;
    if (answer.confirmed) save.alias(pasted.roaster.name, answer.roaster.id);
    if (isPrivate && onCoffee?.roaster_id === answer.roaster.id) {
      const edited = applyCoffeeEdit(db, accountId, currentCoffeeId, pasted.coffee);
      if (edited.status === 'name_taken') {
        db.exec('ROLLBACK');
        return edited;
      }
      if (edited.status !== 'saved') throw new Error(`Editing the bag's own private coffee answered ${edited.status}`);
      coffeeId = currentCoffeeId;
    } else {
      coffeeId = save.coffee(merged, 0, answer.roaster.id, published);
    }

    const values = {
      ...bagColumns(merged, merged.brew.grinder === null ? null : save.grinder(merged.brew.grinder)),
      rated_on: ratedOn(db, bagId, merged.personal.rating ?? null),
    };
    const columns = Object.keys(values);
    db.prepare(
      `UPDATE bag SET coffee_id = ?, import_payload = ?, ${columns.map((column) => `${column} = ?`).join(', ')}
       WHERE id = ? AND account_id = ?`,
    ).run(coffeeId, JSON.stringify(pasted), ...Object.values(values), bagId, accountId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 'saved', differences: save.differences };
}
