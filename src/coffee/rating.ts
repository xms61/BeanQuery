import type { DatabaseSync } from 'node:sqlite';

const minimumAccounts = 3;

/**
 * Rebuilds every pool coffee's collective rating in full, as the daily job does. Each account counts once, with the
 * rating of its latest rated bag on the coffee, across harvests. Below 3 accounts a coffee gets no row. Private
 * coffees never get one, and deleted bags and accounts drop out because nothing is kept between rebuilds.
 */
export function rebuildCollectiveRatings(db: DatabaseSync): { rated: number } {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM coffee_rating');
    const rows = db
      .prepare(
        `WITH latest AS (
           SELECT b.coffee_id, b.rating,
                  row_number() OVER (PARTITION BY b.coffee_id, b.account_id ORDER BY b.rated_on DESC, b.id DESC) AS n
           FROM bag b JOIN coffee c ON c.id = b.coffee_id
           WHERE c.owner_account_id IS NULL AND b.rating IS NOT NULL
         )
         SELECT coffee_id, avg(rating) AS mean, count(*) AS accounts FROM latest WHERE n = 1
         GROUP BY coffee_id HAVING count(*) >= ?`,
      )
      .all(minimumAccounts);
    const insert = db.prepare('INSERT INTO coffee_rating (coffee_id, rating_rounded, account_band) VALUES (?, ?, ?)');
    for (const row of rows) {
      const accounts = Number(row.accounts);
      const band = accounts >= 50 ? '50+' : accounts >= 10 ? '10+' : '3+';
      insert.run(Number(row.coffee_id), Math.round(Number(row.mean) * 2) / 2, band);
    }
    db.exec('COMMIT');
    return { rated: rows.length };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
