import type { ContractBag, ContractError } from '../contract/bag-json.js';

/**
 * The bag form, shared by entering a bag by hand, starting one from the pool and editing one. Its fields are named by
 * their contract path (`coffee.region`, `plan.peak.to`), so a contract error points back at its field. The form only
 * shapes what was typed; the contract check in the domain decides what is valid, so a typo such as "25O" for a number
 * is passed on as text and comes back as that field's error.
 */
export type FormValues = Record<string, string>;

type Kind = 'text' | 'number' | 'date' | 'check' | 'select' | 'textarea';
interface Field {
  name: string;
  label: string;
  kind: Kind;
  options?: [string, string][];
  hint?: string;
}

const select = (values: string[], label: (value: string) => string = (v) => v): [string, string][] => [
  ['', 'Not stated'],
  ...values.map((value): [string, string] => [value, label(value)]),
];
const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const ratings = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'];

const roasterFields: Field[] = [{ name: 'roaster.name', label: 'Roaster', kind: 'text', hint: 'a registered roaster' }];

const coffeeFields: Field[] = [
  { name: 'coffee.name', label: 'Coffee', kind: 'text' },
  { name: 'coffee.country', label: 'Country', kind: 'text' },
  { name: 'coffee.region', label: 'Region', kind: 'text' },
  { name: 'coffee.producer', label: 'Producer', kind: 'text' },
  { name: 'coffee.farm', label: 'Farm', kind: 'text' },
  { name: 'coffee.varieties', label: 'Varieties', kind: 'text', hint: 'separated by commas' },
  {
    name: 'coffee.process.category',
    label: 'Process',
    kind: 'select',
    options: select(['washed', 'natural', 'honey', 'anaerobic', 'other'], capital),
  },
  { name: 'coffee.process.printed', label: 'Process, as printed', kind: 'text' },
  { name: 'coffee.altitude.printed', label: 'Altitude, as printed', kind: 'text' },
  { name: 'coffee.altitude.min_m', label: 'Altitude from, m', kind: 'number' },
  { name: 'coffee.altitude.max_m', label: 'Altitude to, m', kind: 'number' },
  { name: 'coffee.tasting_notes', label: 'Roaster’s notes', kind: 'text', hint: 'separated by commas' },
  { name: 'coffee.decaf', label: 'Decaf', kind: 'check' },
];

const bagFields: Field[] = [
  { name: 'roast_date.date', label: 'Roast date', kind: 'date' },
  { name: 'roast_date.printed', label: 'Roast date, as printed', kind: 'text' },
  {
    name: 'roast.degree',
    label: 'Roast degree',
    kind: 'select',
    options: select(['light', 'light-medium', 'medium', 'medium-dark', 'dark'], capital),
  },
  { name: 'roast.printed', label: 'Roast, as printed', kind: 'text' },
  { name: 'roast.assumed', label: 'Roast degree assumed', kind: 'check' },
  { name: 'weight.grams', label: 'Weight, g', kind: 'number' },
  { name: 'weight.assumed', label: 'Weight assumed', kind: 'check' },
  { name: 'harvest', label: 'Harvest', kind: 'text' },
  { name: 'lot', label: 'Lot', kind: 'text' },
  {
    name: 'personal.state',
    label: 'State',
    kind: 'select',
    options: ['sealed', 'open', 'frozen', 'finished'].map((s): [string, string] => [s, capital(s)]),
  },
  { name: 'personal.bought_on', label: 'Bought on', kind: 'date' },
  { name: 'personal.price.amount', label: 'Price', kind: 'number', hint: 'such as 13.90' },
  { name: 'personal.price.currency', label: 'Currency', kind: 'text', hint: 'such as EUR' },
  { name: 'personal.shop', label: 'Shop', kind: 'text' },
];

const planFields: Field[] = [
  { name: 'plan.rest.from', label: 'Rest from', kind: 'number' },
  { name: 'plan.rest.to', label: 'Rest to', kind: 'number' },
  { name: 'plan.peak.from', label: 'Peak from', kind: 'number' },
  { name: 'plan.peak.to', label: 'Peak to', kind: 'number' },
  { name: 'plan.portion.from', label: 'Portion and freeze from', kind: 'number' },
  { name: 'plan.portion.to', label: 'Portion and freeze to', kind: 'number' },
  { name: 'plan.mid_peak', label: 'Mid-peak check', kind: 'number' },
  { name: 'plan.tubes', label: 'Tubes', kind: 'number' },
  { name: 'plan.dial_in_g', label: 'Fresh dial-in, g', kind: 'number' },
];

const minerals = ['gh', 'kh', 'ca', 'mg', 'na', 'k', 'tds'] as const;
const mineralLabel = { gh: 'GH', kh: 'KH', ca: 'Ca', mg: 'Mg', na: 'Na', k: 'K', tds: 'TDS' };
const waterFields = (prefix: 'water' | 'water_alt', label: string): Field[] =>
  minerals.map((mineral) => ({
    name: `brew.${prefix}.${mineral}`,
    label: `${label}, ${mineralLabel[mineral]}`,
    kind: 'number',
  }));

const brewFields: Field[] = [
  ...waterFields('water', 'Water'),
  ...waterFields('water_alt', 'Alternative water'),
  { name: 'brew.kettle_c', label: 'Kettle, °C', kind: 'number' },
  { name: 'brew.grinder', label: 'Grinder', kind: 'text' },
  { name: 'brew.grind', label: 'Grind', kind: 'text' },
];

const verdictFields: Field[] = [
  {
    name: 'personal.rating',
    label: 'Rating',
    kind: 'select',
    options: [['', 'Not rated'], ...ratings.map((r): [string, string] => [r, `${r} of 5`])],
  },
  {
    name: 'personal.rebuy',
    label: 'Would buy again',
    kind: 'select',
    options: [
      ['', 'Not decided'],
      ['yes', 'Yes'],
      ['no', 'No'],
    ],
  },
  { name: 'personal.note', label: 'Your notes', kind: 'textarea' },
];

const allFields = [
  ...roasterFields,
  ...coffeeFields,
  ...bagFields,
  ...planFields,
  ...brewFields,
  ...verdictFields,
  { name: 'personal.private', label: 'Keep this bean private', kind: 'check' as const },
];
const fieldNames = new Set([...allFields.map((field) => field.name), 'roast_date.status']);

/** The form's own fields from a posted body; anything else is dropped. */
export function readForm(body: Record<string, unknown>): FormValues {
  const values: FormValues = {};
  for (const [name, value] of Object.entries(body)) {
    if (fieldNames.has(name) && typeof value === 'string') values[name] = value;
  }
  return values;
}

/** A bag's form values, for editing it. */
export function bagToForm(bag: ContractBag): FormValues {
  const values: FormValues = {};
  const put = (name: string, value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined || value === false) return;
    values[name] = value === true ? 'yes' : String(value);
  };
  put('roaster.name', bag.roaster.name);
  Object.assign(values, coffeeToForm(bag.coffee));
  put('roast_date.date', bag.roast_date.date);
  put('roast_date.printed', bag.roast_date.printed);
  put('roast_date.status', bag.roast_date.status);
  put('roast.degree', bag.roast.degree);
  put('roast.printed', bag.roast.printed);
  put('roast.assumed', bag.roast.assumed);
  put('weight.grams', bag.weight.grams);
  put('weight.assumed', bag.weight.assumed);
  put('harvest', bag.harvest);
  put('lot', bag.lot);
  if (bag.plan !== null) {
    const { plan } = bag;
    for (const window of ['rest', 'peak', 'portion'] as const) {
      put(`plan.${window}.from`, plan[window].from);
      put(`plan.${window}.to`, plan[window].to);
    }
    put('plan.mid_peak', plan.mid_peak);
    put('plan.tubes', plan.tubes);
    put('plan.dial_in_g', plan.dial_in_g);
  }
  for (const prefix of ['water', 'water_alt'] as const) {
    const water = bag.brew[prefix];
    for (const mineral of minerals) put(`brew.${prefix}.${mineral}`, water?.[mineral]);
  }
  put('brew.kettle_c', bag.brew.kettle_c);
  put('brew.grinder', bag.brew.grinder);
  put('brew.grind', bag.brew.grind);
  const personal = bag.personal ?? {};
  put('personal.state', personal.state);
  put('personal.bought_on', personal.bought_on);
  if (personal.price) {
    put('personal.price.amount', (personal.price.cents / 100).toFixed(2));
    put('personal.price.currency', personal.price.currency);
  }
  put('personal.shop', personal.shop);
  put('personal.rating', personal.rating);
  put('personal.rebuy', personal.rebuy === null || personal.rebuy === undefined ? null : personal.rebuy ? 'yes' : 'no');
  put('personal.note', personal.note);
  put('personal.private', personal.private);
  return values;
}

/** A coffee's facts as form values, for the admin's facts form and inside a bag's. */
export function coffeeToForm(coffee: ContractBag['coffee']): FormValues {
  const values: FormValues = {};
  const put = (name: string, value: string | number | boolean | null) => {
    if (value === null || value === false || value === '') return;
    values[name] = value === true ? 'yes' : String(value);
  };
  put('coffee.name', coffee.name);
  put('coffee.country', coffee.country);
  put('coffee.region', coffee.region);
  put('coffee.producer', coffee.producer);
  put('coffee.farm', coffee.farm);
  put('coffee.varieties', coffee.varieties.join(', '));
  put('coffee.process.category', coffee.process.category);
  put('coffee.process.printed', coffee.process.printed);
  put('coffee.altitude.printed', coffee.altitude.printed);
  put('coffee.altitude.min_m', coffee.altitude.min_m);
  put('coffee.altitude.max_m', coffee.altitude.max_m);
  put('coffee.tasting_notes', coffee.tasting_notes.join(', '));
  put('coffee.decaf', coffee.decaf);
  return values;
}

/** Text as typed, trimmed; nothing for an empty field. */
const textOf = (value: string | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

/** A number as typed, with a decimal comma allowed; nothing for an empty field; the text itself when it is no number. */
function numberOf(value: string | undefined): number | string | null {
  const text = textOf(value);
  if (text === null) return null;
  const normal = text.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : text;
}

const listOf = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

/** The whole bag in the contract's shape, from the form, for entering one by hand. */
export function formToBag(values: FormValues): Record<string, unknown> {
  const has = (name: string) => values[name] === 'yes';
  const window = (name: string) => ({
    from: numberOf(values[`plan.${name}.from`]),
    to: numberOf(values[`plan.${name}.to`]),
  });
  const planNames = planFields.map((field) => field.name);
  const water = (prefix: string) => {
    if (minerals.every((mineral) => textOf(values[`brew.${prefix}.${mineral}`]) === null)) return null;
    return Object.fromEntries(minerals.map((mineral) => [mineral, numberOf(values[`brew.${prefix}.${mineral}`])]));
  };
  const date = textOf(values['roast_date.date']);
  const kept = values['roast_date.status'];
  const amount = textOf(values['personal.price.amount']);
  const rebuy = values['personal.rebuy'];
  return {
    roaster: { name: textOf(values['roaster.name']) ?? '' },
    coffee: {
      name: textOf(values['coffee.name']) ?? '',
      country: textOf(values['coffee.country']),
      region: textOf(values['coffee.region']),
      farm: textOf(values['coffee.farm']),
      producer: textOf(values['coffee.producer']),
      varieties: listOf(values['coffee.varieties']),
      process: {
        printed: textOf(values['coffee.process.printed']),
        category: textOf(values['coffee.process.category']),
      },
      altitude: {
        printed: textOf(values['coffee.altitude.printed']),
        min_m: numberOf(values['coffee.altitude.min_m']),
        max_m: numberOf(values['coffee.altitude.max_m']),
      },
      tasting_notes: listOf(values['coffee.tasting_notes']),
      decaf: has('coffee.decaf'),
    },
    harvest: textOf(values.harvest),
    lot: textOf(values.lot),
    roast: {
      degree: textOf(values['roast.degree']),
      assumed: has('roast.assumed'),
      printed: textOf(values['roast.printed']),
    },
    roast_date: {
      printed: textOf(values['roast_date.printed']),
      date,
      // A typed date is a checked one. Without one, a bag keeps why it has none, as the LLM recorded it.
      status:
        date !== null
          ? 'verified'
          : kept === 'ambiguous' || kept === 'unlabelled' || kept === 'future'
            ? kept
            : 'missing',
    },
    weight: { grams: numberOf(values['weight.grams']), assumed: has('weight.assumed') },
    plan: planNames.every((name) => textOf(values[name]) === null)
      ? null
      : {
          rest: window('rest'),
          peak: window('peak'),
          portion: window('portion'),
          mid_peak: numberOf(values['plan.mid_peak']),
          tubes: numberOf(values['plan.tubes']),
          dial_in_g: numberOf(values['plan.dial_in_g']),
        },
    brew: {
      water: water('water'),
      water_alt: water('water_alt'),
      kettle_c: numberOf(values['brew.kettle_c']),
      grinder: textOf(values['brew.grinder']),
      grind: textOf(values['brew.grind']),
    },
    personal: {
      private: has('personal.private'),
      state: textOf(values['personal.state']) ?? 'sealed',
      rating: numberOf(values['personal.rating']),
      rebuy: rebuy === 'yes' ? true : rebuy === 'no' ? false : null,
      note: textOf(values['personal.note']),
      bought_on: textOf(values['personal.bought_on']),
      price:
        amount === null
          ? null
          : { cents: centsOf(amount), currency: (textOf(values['personal.price.currency']) ?? '').toUpperCase() },
      shop: textOf(values['personal.shop']),
    },
  };
}

/** "13.90" or "13,9" as 1390 cents; the text itself when it is no amount, so the check names the price. */
function centsOf(amount: string): number | string {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(amount);
  if (match === null) return amount;
  return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}

/** The edit form's two halves: the bag's own fields, without the roaster and the private flag, and its coffee. */
export function formToEdit(values: FormValues): { fields: Record<string, unknown>; coffee: unknown } {
  const { roaster: _roaster, coffee, personal, ...fields } = formToBag(values);
  const { private: _private, ...own } = personal as Record<string, unknown>;
  return { fields: { ...fields, personal: own }, coffee };
}

/** A contract error's field, for people: the form label when the path is a field of the form. */
export function errorLabel(path: string): string {
  const name = path.replace(/^personal\.price\.cents$/, 'personal.price.amount');
  const field = allFields.find((f) => f.name === name);
  if (field !== undefined) return field.label;
  if (path.startsWith('plan')) return 'Plan';
  if (path.startsWith('brew.water_alt')) return 'Alternative water';
  if (path.startsWith('brew.water')) return 'Water';
  if (path.startsWith('coffee.altitude')) return 'Altitude';
  return path === '' ? 'The bag' : path;
}

export function FormErrors(props: { errors: ContractError[] }) {
  return (
    <div class="problem" role="alert">
      <h2>Some fields need a change</h2>
      <ul class="small">
        {props.errors.map((error) => (
          <li>
            <strong>{errorLabel(error.path)}:</strong> {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Input(props: { field: Field; values: FormValues }) {
  const { field, values } = props;
  const value = values[field.name] ?? '';
  const id = `field-${field.name.replaceAll('.', '-')}`;
  if (field.kind === 'check') {
    return (
      <label class="check">
        <input type="checkbox" name={field.name} value="yes" checked={value === 'yes'} /> {field.label}
      </label>
    );
  }
  return (
    <label class={field.kind === 'textarea' ? 'field span' : 'field'} for={id}>
      <span>
        {field.label}
        {field.hint && <span class="muted"> ({field.hint})</span>}
      </span>
      {field.kind === 'select' ? (
        <select id={id} name={field.name}>
          {(field.options ?? []).map(([option, text]) => (
            <option value={option} selected={option === value}>
              {text}
            </option>
          ))}
        </select>
      ) : field.kind === 'textarea' ? (
        <textarea id={id} name={field.name} rows={4} maxlength={500}>
          {value}
        </textarea>
      ) : (
        <input
          id={id}
          type={field.kind === 'date' ? 'date' : 'text'}
          name={field.name}
          value={value}
          inputmode={field.kind === 'number' ? 'decimal' : undefined}
          maxlength={500}
        />
      )}
    </label>
  );
}

function Group(props: { title: string; note?: string; fields: Field[]; values: FormValues }) {
  return (
    <fieldset class="form-group">
      <legend>
        {props.title}
        {props.note && <span class="muted small"> {props.note}</span>}
      </legend>
      <div class="form-grid">
        {props.fields.map((field) => (
          <Input field={field} values={props.values} />
        ))}
      </div>
    </fieldset>
  );
}

/** The bag's fields, grouped as on the bag page. The roaster only when entering a new bag. */
export function BagFormFields(props: { values: FormValues; withRoaster: boolean; inPool?: boolean }) {
  const { values } = props;
  return (
    <>
      {values['roast_date.status'] && (
        <input type="hidden" name="roast_date.status" value={values['roast_date.status']} />
      )}
      {props.withRoaster && (
        <Group title="Roaster" note="must be a registered roaster" fields={roasterFields} values={values} />
      )}
      <Group
        title="Bean facts"
        note={props.inPool === false ? 'your private coffee' : 'shared in the pool'}
        fields={coffeeFields}
        values={values}
      />
      <Group title="Your bag" note="only you see this" fields={bagFields} values={values} />
      <Group title="Plan" note="days after roasting; leave empty for none" fields={planFields} values={values} />
      <Group title="Brew" note="water in ppm as CaCO3" fields={brewFields} values={values} />
      <Group title="Your verdict" fields={verdictFields} values={values} />
    </>
  );
}

/** A coffee's facts alone, for the admin's edit form. */
export function CoffeeFormFields(props: { values: FormValues }) {
  return <Group title="Bean facts" note="shared in the pool" fields={coffeeFields} values={props.values} />;
}

/** The verdict fields alone, for the bag page's rating form. */
export function VerdictFields(props: { values: FormValues }) {
  return (
    <div class="form-grid">
      {verdictFields.map((field) => (
        <Input field={field} values={props.values} />
      ))}
    </div>
  );
}
