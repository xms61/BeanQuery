/**
 * The key a roaster name is matched by: lowercase, accents folded, "&" read as "and", apostrophes dropped,
 * other punctuation as spaces. Not unique: different roasters can share a name.
 */
export function roasterNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
