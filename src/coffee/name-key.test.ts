import { describe, expect, test } from 'vitest';
import { coffeeNameKey } from './name-key.js';

describe('coffeeNameKey', () => {
  test.each([
    ['Gathaithi AA', 'gathaithi aa'],
    ['GATHAITHI  AA', 'gathaithi aa'],
    ['Gathaithi AA [Washed]', 'gathaithi aa'],
    ['Gathaithi AA (Natural Process)', 'gathaithi aa'],
    ['Sasaba [Red Honey]', 'sasaba'],
    ['Ethiopia - Elto [Anaerobic Natural - 72h fermentation]', 'ethiopia elto anaerobic natural 72h fermentation'],
    ['Panama - Elida [Catuai ASD T4D 1304]', 'panama elida catuai asd t4d 1304'],
    ['Éthiopie Café', 'ethiopie cafe'],
    ['La Esperanza & Sons', 'la esperanza and sons'],
  ])('%j becomes %j', (name, key) => {
    expect(coffeeNameKey(name)).toBe(key);
  });

  test('keeps a bracket that names more than the process, because it tells two coffees apart', () => {
    expect(coffeeNameKey('Elida [Catuai ASD]')).not.toBe(coffeeNameKey('Elida [Geisha ASD]'));
  });
});
