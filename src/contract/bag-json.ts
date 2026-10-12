import { z } from 'zod';

/**
 * The bag JSON contract, `beanquery.bags/v1`, defined once: the importer validates with it, and the JSON Schema in
 * docs/generated/ is generated from it. The spec is docs/product-specs/bag-json-contract.md; change both together.
 */

export interface ContractLimits {
  maxBytes: number;
  maxBags: number;
}

export const pasteLimits: ContractLimits = { maxBytes: 256 * 1024, maxBags: 50 };
export const exportLimits: ContractLimits = { maxBytes: 20 * 1024 * 1024, maxBags: 5000 };

const maxText = 500;
const maxListItems = 20;
const maxNotes = 500;

const text = z.string().max(maxText, `At most ${maxText} characters`);
const name = text.min(1, 'Must not be empty');
const textList = z.array(text).max(maxListItems, `At most ${maxListItems} items`);
const date = z.iso.date({ error: 'A real date as YYYY-MM-DD' });
const wholeFrom0 = z.int().min(0);
const amountFrom0 = z.number().min(0);

const roasterRef = z.strictObject({
  name,
  slug: text.nullable().optional(),
});

const window = z
  .strictObject({ from: wholeFrom0, to: wholeFrom0 })
  .refine((w) => w.from <= w.to, 'from must be at most to');

const coffee = z.strictObject({
  name,
  country: text.nullable(),
  region: text.nullable(),
  farm: text.nullable(),
  producer: text.nullable(),
  varieties: textList,
  process: z.strictObject({
    printed: text.nullable(),
    category: z.enum(['washed', 'natural', 'honey', 'anaerobic', 'other']).nullable(),
  }),
  altitude: z
    .strictObject({
      printed: text.nullable(),
      min_m: wholeFrom0.nullable(),
      max_m: wholeFrom0.nullable(),
    })
    .refine((a) => (a.min_m === null) === (a.max_m === null), 'Give both min_m and max_m, or neither')
    .refine((a) => a.min_m === null || a.max_m === null || a.min_m <= a.max_m, 'min_m must be at most max_m'),
  tasting_notes: textList,
  decaf: z.boolean(),
});

const plan = z
  .strictObject({
    rest: window,
    peak: window,
    portion: window,
    mid_peak: wholeFrom0,
    tubes: wholeFrom0,
    dial_in_g: wholeFrom0,
  })
  // A backwards peak window already has its own error, so mid_peak is only checked against a valid one.
  .refine((p) => p.peak.from > p.peak.to || (p.mid_peak >= p.peak.from && p.mid_peak <= p.peak.to), {
    message: 'mid_peak must be inside the peak window',
    path: ['mid_peak'],
  });

const water = z.strictObject({
  gh: amountFrom0,
  kh: amountFrom0,
  ca: amountFrom0.nullable().optional(),
  mg: amountFrom0.nullable().optional(),
  na: amountFrom0.nullable().optional(),
  k: amountFrom0.nullable().optional(),
  tds: amountFrom0.nullable().optional(),
});

const personal = z.strictObject({
  private: z.boolean().optional(),
  state: z.enum(['sealed', 'open', 'frozen', 'finished']).optional(),
  rating: z.number().min(0).max(5).multipleOf(0.5).nullable().optional(),
  rebuy: z.boolean().nullable().optional(),
  note: text.nullable().optional(),
  bought_on: date.nullable().optional(),
  frozen_on: date.nullable().optional(),
  price: z
    .strictObject({
      cents: wholeFrom0,
      currency: z.string().regex(/^[A-Z]{3}$/, 'An ISO 4217 code in capitals, such as EUR'),
    })
    .nullable()
    .optional(),
  shop: text.nullable().optional(),
});

const bag = z.strictObject({
  roaster: roasterRef,
  coffee,
  harvest: text.nullable(),
  lot: text.nullable(),
  roast: z.strictObject({
    degree: z.enum(['light', 'light-medium', 'medium', 'medium-dark', 'dark']).nullable(),
    assumed: z.boolean(),
    printed: text.nullable(),
  }),
  roast_date: z.strictObject({
    printed: text.nullable(),
    date: date.nullable(),
    status: z.enum(['verified', 'ambiguous', 'missing', 'unlabelled', 'future']),
  }),
  weight: z.strictObject({
    grams: z.int().min(1, 'A whole number above 0').nullable(),
    assumed: z.boolean(),
  }),
  plan: plan.nullable(),
  brew: z
    .strictObject({
      water: water.nullable(),
      // Optional, so documents written before it existed still import.
      water_alt: water.nullable().optional(),
      kettle_c: z.int().min(70).max(100).nullable(),
      grinder: text.nullable(),
      grind: text.nullable(),
    })
    .refine((b) => b.water !== null || b.water_alt == null, {
      message: 'An alternative water needs a main water',
      path: ['water_alt'],
    }),
  personal: personal.optional(),
});

/** The whole document, with the bag limit of a paste or of an export file. */
export function bagsDocument(limits: ContractLimits) {
  return z.strictObject({
    schema: z.literal('beanquery.bags/v1'),
    reference_date: date.nullable().optional(),
    bags: z.array(bag).min(1).max(limits.maxBags, `At most ${limits.maxBags} bags`),
    roaster_notes: z
      .array(z.strictObject({ roaster: roasterRef, note: text }))
      .max(maxNotes)
      .optional(),
    grinders: z
      .array(z.strictObject({ name, note: text.nullable() }))
      .max(maxNotes)
      .optional(),
  });
}

export type BagsDocument = z.infer<ReturnType<typeof bagsDocument>>;

export interface ContractError {
  /** The field, as `bags[0].plan.peak.to`; empty for the document as a whole. */
  path: string;
  message: string;
}

export type ContractResult = { ok: true; value: BagsDocument } | { ok: false; errors: ContractError[] };

/** Validates pasted or uploaded JSON by the contract's import rules, reporting every error by field path. */
export function parseBagsJson(json: string, limits: ContractLimits): ContractResult {
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > limits.maxBytes) {
    return {
      ok: false,
      errors: [{ path: '', message: `At most ${formatBytes(limits.maxBytes)}; this is ${formatBytes(bytes)}` }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [{ path: '', message: `Not valid JSON: ${(error as Error).message}` }] };
  }

  return check(bagsDocument(limits), parsed);
}

export type ContractBag = BagsDocument['bags'][number];

/** A bag's own fields, as the edit form sends them: no roaster or coffee facts, and no private flag. */
const bagFields = bag
  .omit({ roaster: true, coffee: true })
  .extend({ personal: personal.omit({ private: true }).optional() });

export type BagFields = z.infer<typeof bagFields>;

/** Checks one bag typed in by hand, by the same rules as a paste. */
export function parseBag(input: unknown): { ok: true; value: ContractBag } | { ok: false; errors: ContractError[] } {
  return check(bag, input);
}

/** Checks the fields of an edited bag. Coffee facts and the private flag change through their own steps. */
export function parseBagFields(
  input: unknown,
): { ok: true; value: BagFields } | { ok: false; errors: ContractError[] } {
  return check(bagFields, input);
}

export type CoffeeFacts = ContractBag['coffee'];

/** Checks a coffee's facts, as the coffee edit form sends them. */
export function parseCoffee(input: unknown): { ok: true; value: CoffeeFacts } | { ok: false; errors: ContractError[] } {
  return check(coffee, input);
}

function check<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; value: T } | { ok: false; errors: ContractError[] } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
  };
}

/** The JSON Schema an LLM prompt can point at: the contract with the paste limits. */
export function bagsJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://github.com/xms61/BeanQuery/blob/main/docs/generated/bag-json-contract.schema.json',
    title: 'BeanQuery bag JSON contract, beanquery.bags/v1',
    description: 'Generated from src/contract/bag-json.ts by pnpm contract:schema. Do not edit by hand.',
    ...z.toJSONSchema(bagsDocument(pasteLimits), { target: 'draft-2020-12', io: 'input' }),
  };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, index) => (typeof key === 'number' ? `[${key}]` : `${index === 0 ? '' : '.'}${String(key)}`))
    .join('');
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
