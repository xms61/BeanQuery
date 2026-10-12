import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { bagsJsonSchema, exportLimits, parseBagsJson, pasteLimits } from './bag-json.js';

const spec = readFileSync(new URL('../../docs/product-specs/bag-json-contract.md', import.meta.url), 'utf8');
const specExample = /```json\n([\s\S]*?)\n```/.exec(spec)?.[1] ?? '';

/** The spec's example, as a fresh object to change one field of. */
function example(): { bags: Record<string, unknown>[] } & Record<string, unknown> {
  return JSON.parse(specExample);
}

type Doc = ReturnType<typeof example>;
// The tests break the example on purpose, so a bag is reached into loosely rather than through the contract's types.
// biome-ignore lint/suspicious/noExplicitAny: deliberately untyped test data
type LooseBag = Record<string, any>;

function firstBag(document: Doc): LooseBag {
  const bag = document.bags[0];
  if (bag === undefined) throw new Error('The example has no bag');
  return bag;
}

function errorsOf(document: unknown, limits = pasteLimits) {
  const result = parseBagsJson(JSON.stringify(document), limits);
  return result.ok ? [] : result.errors;
}

describe('parseBagsJson', () => {
  test('accepts the example in the contract spec', () => {
    const result = parseBagsJson(specExample, pasteLimits);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.value.bags[0]?.coffee.name).toBe('Gathaithi AA');
  });

  test('accepts a bag an LLM wrote: no personal block, no slug, no plan, no water', () => {
    const document = example();
    const bag = firstBag(document);
    delete bag.personal;
    delete bag.roaster.slug;
    bag.plan = null;
    bag.brew.water = null;
    delete document.roaster_notes;
    delete document.grinders;
    delete document.reference_date;
    expect(errorsOf(document)).toEqual([]);
  });

  test("accepts the owner's real bags, from the planner prompt on 2026-10-12", () => {
    const fixture = readFileSync(new URL('./fixtures/owner-bags-2026-10-12.json', import.meta.url), 'utf8');
    const result = parseBagsJson(fixture, pasteLimits);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok && result.value.bags).toHaveLength(5);
  });

  test("accepts the JSON template in the planner prompt, so the prompt can't drift from the contract", () => {
    const prompt = readFileSync(new URL('../../prompts/coffee-planner.md', import.meta.url), 'utf8');
    const template = /```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? '';
    const result = parseBagsJson(template, pasteLimits);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  test('accepts an alternative water, which is optional so documents without it still import', () => {
    const document = example();
    firstBag(document).brew.water_alt = { gh: 60, kh: 20, ca: 40, mg: 20, na: 0, k: 20, tds: null };
    expect(errorsOf(document)).toEqual([]);
    firstBag(document).brew.water_alt = null;
    expect(errorsOf(document)).toEqual([]);
  });

  test('rejects an alternative water without a main water', () => {
    const document = example();
    firstBag(document).brew.water = null;
    firstBag(document).brew.water_alt = { gh: 60, kh: 20 };
    expect(errorsOf(document)).toEqual([{ path: 'bags[0].brew.water_alt', message: expect.stringMatching(/water/) }]);
  });

  test('rejects text that is not JSON, and says so', () => {
    expect(parseBagsJson('{"schema": ', pasteLimits)).toEqual({
      ok: false,
      errors: [{ path: '', message: expect.stringMatching(/^Not valid JSON/) }],
    });
  });

  test.each([
    ['an unknown field', (d: Doc) => (firstBag(d).coffee.packaging = 'valve'), 'bags[0].coffee', /packaging/],
    ['a missing required field', (d: Doc) => delete firstBag(d).coffee.region, 'bags[0].coffee.region', /./],
    ['a wrong type', (d: Doc) => (firstBag(d).weight.grams = '250'), 'bags[0].weight.grams', /number/],
    ['another schema version', (d: Doc) => (d.schema = 'beanquery.bags/v2'), 'schema', /beanquery\.bags\/v1/],
    ['no bags', (d: Doc) => (d.bags = []), 'bags', /1/],
    [
      'a process outside the list',
      (d: Doc) => (firstBag(d).coffee.process.category = 'wet-hulled'),
      'bags[0].coffee.process.category',
      /washed/,
    ],
    [
      'a roast degree outside the list',
      (d: Doc) => (firstBag(d).roast.degree = 'cinnamon'),
      'bags[0].roast.degree',
      /light/,
    ],
    [
      'an impossible date',
      (d: Doc) => (firstBag(d).roast_date.date = '2026-02-30'),
      'bags[0].roast_date.date',
      /date/i,
    ],
    [
      'a date in another format',
      (d: Doc) => (firstBag(d).roast_date.date = '18/09/26'),
      'bags[0].roast_date.date',
      /date/i,
    ],
    ['a weight of 0', (d: Doc) => (firstBag(d).weight.grams = 0), 'bags[0].weight.grams', /0/],
    ['a fractional weight', (d: Doc) => (firstBag(d).weight.grams = 250.5), 'bags[0].weight.grams', /int/i],
    [
      'a plan window backwards',
      (d: Doc) => (firstBag(d).plan.peak = { from: 60, to: 30 }),
      'bags[0].plan.peak',
      /from.*to/,
    ],
    ['a mid-peak outside the peak', (d: Doc) => (firstBag(d).plan.mid_peak = 70), 'bags[0].plan.mid_peak', /peak/],
    ['a negative offset', (d: Doc) => (firstBag(d).plan.rest.from = -1), 'bags[0].plan.rest.from', /0/],
    ['water without kh', (d: Doc) => delete firstBag(d).brew.water.kh, 'bags[0].brew.water.kh', /./],
    ['a kettle below 70', (d: Doc) => (firstBag(d).brew.kettle_c = 60), 'bags[0].brew.kettle_c', /70/],
    [
      'altitude min above max',
      (d: Doc) => (firstBag(d).coffee.altitude = { printed: null, min_m: 2000, max_m: 1800 }),
      'bags[0].coffee.altitude',
      /min_m/,
    ],
    [
      'altitude with only one bound',
      (d: Doc) => (firstBag(d).coffee.altitude = { printed: null, min_m: 1800, max_m: null }),
      'bags[0].coffee.altitude',
      /both/,
    ],
    ['a rating off the half steps', (d: Doc) => (firstBag(d).personal.rating = 3.3), 'bags[0].personal.rating', /0\.5/],
    ['a rating above 5', (d: Doc) => (firstBag(d).personal.rating = 5.5), 'bags[0].personal.rating', /5/],
    [
      'a state outside the list',
      (d: Doc) => (firstBag(d).personal.state = 'opened'),
      'bags[0].personal.state',
      /sealed/,
    ],
    [
      'a lower-case currency',
      (d: Doc) => (firstBag(d).personal.price.currency = 'eur'),
      'bags[0].personal.price.currency',
      /ISO 4217/,
    ],
    ['text over 500 characters', (d: Doc) => (firstBag(d).coffee.farm = 'x'.repeat(501)), 'bags[0].coffee.farm', /500/],
    [
      '21 varieties',
      (d: Doc) => (firstBag(d).coffee.varieties = Array(21).fill('SL28')),
      'bags[0].coffee.varieties',
      /20/,
    ],
    ['an empty coffee name', (d: Doc) => (firstBag(d).coffee.name = ''), 'bags[0].coffee.name', /./],
  ])('rejects %s, naming the field', (_, change, path, message) => {
    const document = example();
    change(document);
    const errors = errorsOf(document);
    expect(errors).toContainEqual({ path, message: expect.stringMatching(message) });
  });

  test('reports every error at once, not just the first', () => {
    const document = example();
    firstBag(document).weight.grams = 0;
    firstBag(document).brew.kettle_c = 101;
    expect(errorsOf(document).map((error) => error.path)).toEqual(['bags[0].weight.grams', 'bags[0].brew.kettle_c']);
  });

  test('a backwards peak window is one error, not also a mid-peak error', () => {
    const document = example();
    firstBag(document).plan.peak = { from: 60, to: 30 };
    expect(errorsOf(document).map((error) => error.path)).toEqual(['bags[0].plan.peak']);
  });

  test('a paste holds at most 50 bags, and an export file 5,000', () => {
    const document = example();
    document.bags = Array.from({ length: 51 }, () => firstBag(example()));

    expect(errorsOf(document, pasteLimits)).toEqual([{ path: 'bags', message: expect.stringMatching(/50/) }]);
    expect(errorsOf(document, exportLimits)).toEqual([]);
  });

  test('a paste is at most 256 KB, checked before parsing', () => {
    const text = `${specExample}${' '.repeat(256 * 1024)}`;
    expect(parseBagsJson(text, pasteLimits)).toEqual({
      ok: false,
      errors: [{ path: '', message: expect.stringMatching(/256 KB/) }],
    });
    expect(parseBagsJson(text, exportLimits)).toMatchObject({ ok: true });
  });

  test('rejects a __proto__ key instead of letting it through', () => {
    const text = specExample.replace('"decaf": false', '"decaf": false, "__proto__": { "admin": true }');
    expect(parseBagsJson(text, pasteLimits)).toMatchObject({ ok: false });
  });
});

describe('bagsJsonSchema', () => {
  test('the committed JSON Schema is the one generated from the definition', () => {
    const committed = readFileSync(
      new URL('../../docs/generated/bag-json-contract.schema.json', import.meta.url),
      'utf8',
    );
    // Regenerate with: pnpm contract:schema
    expect(JSON.parse(committed)).toEqual(bagsJsonSchema());
  });

  test('is strict and carries the paste limits an LLM writes for', () => {
    const schema = JSON.stringify(bagsJsonSchema());
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).toContain('"maxItems":50');
    expect(schema).toContain('"maxLength":500');
  });
});
