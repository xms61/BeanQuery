import { describe, expect, test } from 'vitest';
import { roasterNameKey } from './name-key.js';

describe('roasterNameKey', () => {
  test.each([
    ['TANAT COFFEE', 'tanat coffee'],
    ['Café Résumé', 'cafe resume'],
    ['A&R Espresso Club', 'a and r espresso club'],
    ['Black & White Coffee Roasters', 'black and white coffee roasters'],
    ["Adventurer's Coffee Co", 'adventurers coffee co'],
    ['Adventurer\u2019s Coffee Co.', 'adventurers coffee co'],
    ['  Hydrangea   Coffee-Roasters ', 'hydrangea coffee roasters'],
  ])('%j becomes %j', (name, key) => {
    expect(roasterNameKey(name)).toBe(key);
  });

  test('spellings that differ only in case, accents, spacing or punctuation share a key', () => {
    expect(roasterNameKey('Black and White Coffee Roasters')).toBe(roasterNameKey('BLACK & WHITE  coffee roasters'));
  });
});
