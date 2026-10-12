import type { DatabaseSync } from 'node:sqlite';

/**
 * Each account's color theme: `system` follows the device's light or dark preference, `light` and `dark` override
 * it. Saved on the account, so every device shows the same; stored as NULL for `system`.
 */
export type Theme = 'system' | 'light' | 'dark';
export const themes: readonly Theme[] = ['system', 'light', 'dark'];

export function isTheme(value: string): value is Theme {
  return (themes as readonly string[]).includes(value);
}

/** Sets an account's theme. False, and nothing changed, for a value that is not a theme. */
export function setTheme(db: DatabaseSync, accountId: number, theme: string): boolean {
  if (!isTheme(theme)) return false;
  return (
    db.prepare('UPDATE account SET theme = ? WHERE id = ?').run(theme === 'system' ? null : theme, accountId)
      .changes === 1
  );
}

/** An account's theme; `system` when it chose none. */
export function themeOf(db: DatabaseSync, accountId: number): Theme {
  const theme = db.prepare('SELECT theme FROM account WHERE id = ?').get(accountId)?.theme;
  return typeof theme === 'string' && isTheme(theme) ? theme : 'system';
}
