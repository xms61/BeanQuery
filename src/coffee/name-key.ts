import { roasterNameKey } from '../roaster/name-key.js';

// Words that only describe the process. A bracket made of nothing else is the roaster labelling the process, not
// part of the coffee's name, so "Gathaithi AA [Washed]" and "Gathaithi AA" are the same coffee.
const processWords = new Set([
  'washed',
  'natural',
  'naturals',
  'honey',
  'anaerobic',
  'process',
  'processed',
  'fully',
  'double',
  'semi',
  'pulped',
  'dry',
  'wet',
  'hulled',
  'sun',
  'dried',
  'carbonic',
  'maceration',
  'thermal',
  'shock',
  'fermented',
  'fermentation',
  'experimental',
  'black',
  'red',
  'yellow',
  'white',
]);

/**
 * The key a coffee's name is matched by within one roaster: lowercase, accents folded, punctuation dropped, as for
 * roasters, and brackets dropped when they hold only process words. Brackets that say more stay, because they can
 * tell two coffees apart ("Elida [Catuai ASD]" and "Elida [Geisha ASD]").
 */
export function coffeeNameKey(name: string): string {
  const withoutProcess = name.replace(/[[(]([^\])]*)[\])]/g, (_, inner: string) => {
    const words = roasterNameKey(inner).split(' ').filter(Boolean);
    return words.length > 0 && words.every((word) => processWords.has(word)) ? ' ' : ` ${inner} `;
  });
  return roasterNameKey(withoutProcess);
}
