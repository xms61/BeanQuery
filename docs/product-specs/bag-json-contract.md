---
status: draft
last-verified: 2026-10-07
---

# Bag JSON contract, `beanquery.bags/v1`

The format BeanQuery imports and exports bags in. A user pastes it from an LLM chat, and the export writes it, so an export imports back into any account. This contract is the source of truth: a prompt that produces the JSON follows it, never the other way round. Nothing here is implemented yet; the [bean tracker plan](../exec-plans/active/2026-10-07-bean-tracker.md) schedules it.

## Example
```json
{
  "schema": "beanquery.bags/v1",
  "reference_date": "2026-10-07",
  "bags": [
    {
      "roaster": { "name": "TANAT COFFEE", "slug": "tanat-coffee" },
      "coffee": {
        "name": "Gathaithi AA",
        "country": "Kenya", "region": "Nyeri", "farm": null, "producer": "Gathaithi Cooperative",
        "varieties": ["Batian", "Ruiru 11", "SL28", "SL34"],
        "process": { "printed": "Washed", "category": "washed" },
        "altitude": { "printed": null, "min_m": null, "max_m": null },
        "tasting_notes": ["Redcurrant", "Sencha tea", "Orange"],
        "decaf": false
      },
      "harvest": null,
      "lot": null,
      "roast": { "degree": "light", "assumed": true, "printed": null },
      "roast_date": { "printed": "18/09/26", "date": "2026-09-18", "status": "verified" },
      "weight": { "grams": 250, "assumed": false },
      "plan": {
        "rest": { "from": 28, "to": 35 },
        "peak": { "from": 30, "to": 60 },
        "portion": { "from": 28, "to": 30 },
        "mid_peak": 45,
        "tubes": 16,
        "dial_in_g": 10
      },
      "brew": {
        "water": { "gh": 60, "kh": 25, "ca": 60, "mg": 0, "na": 0, "k": 25, "tds": null },
        "kettle_c": 99,
        "grinder": "Fellow Ode Gen 2",
        "grind": "4.1"
      },
      "personal": {
        "private": false, "state": "sealed", "rating": null, "rebuy": null, "note": null,
        "bought_on": "2026-09-22", "price": { "cents": 1390, "currency": "EUR" }, "shop": "tanat.coffee"
      }
    }
  ],
  "roaster_notes": [{ "roaster": { "name": "Tanat Coffee", "slug": "tanat-coffee" }, "note": "Valveless bags" }],
  "grinders": [{ "name": "Fellow Ode Gen 2", "note": "Stock burrs, zeroed at chirp" }]
}
```

## Fields
`null` means unknown or not stated, and `[]` is an empty list. Text printed on the bag is kept verbatim. Required fields must be present; an optional field may be left out.

**Top level**

| Field | Type | Required | Meaning |
| :-- | :-- | :-- | :-- |
| `schema` | `"beanquery.bags/v1"` | yes | The contract version |
| `reference_date` | date or null | no | The day the plan was made. Informational only; the app always works from today |
| `bags` | list of bags, at least 1 | yes | One entry per bag |
| `roaster_notes` | list of `{ roaster, note }` | no | The user's own notes on roasters, with `roaster` shaped like a bag's `roaster`. Written by export |
| `grinders` | list of `{ name, note }` | no | The user's grinders. Written by export |

**A bag**

| Field | Type | Required | Meaning |
| :-- | :-- | :-- | :-- |
| `roaster.name` | text | yes | The roaster as printed. Must resolve to a roaster in the registry before the bag is saved |
| `roaster.slug` | text or null | no | The roaster's every.coffee slug, or the registry's own key for a roaster the admin added. Export writes it, and import resolves the roaster by it before trying the name |
| `coffee.name` | text | yes | The coffee's name as printed, without the roaster's name |
| `coffee.country`, `region`, `farm`, `producer` | text or null | yes | As printed |
| `coffee.varieties` | list of text | yes | As printed, in printed order |
| `coffee.process.printed` | text or null | yes | The exact process wording |
| `coffee.process.category` | `washed`, `natural`, `honey`, `anaerobic`, `other` or null | yes | The process family; null when no process is stated |
| `coffee.altitude.printed` | text or null | yes | As printed |
| `coffee.altitude.min_m`, `max_m` | whole metres or null | yes | Both the same for a single value. `min_m` is at most `max_m` |
| `coffee.tasting_notes` | list of text | yes | The roaster's notes as printed |
| `coffee.decaf` | true or false | yes | True only when the bag says decaf |
| `harvest` | text or null | yes | This bag's harvest as printed, for example `2025/26`. Every harvest of a coffee belongs to the same coffee |
| `lot` | text or null | yes | This bag's lot, only when labelled as the coffee's lot. Not a batch number beside the roast date |
| `roast.degree` | `light`, `light-medium`, `medium`, `medium-dark`, `dark` or null | yes | The roast degree |
| `roast.assumed` | true or false | yes | True when the degree was assumed, not printed |
| `roast.printed` | text or null | yes | The printed wording |
| `roast_date.printed` | text or null | yes | The date as printed |
| `roast_date.date` | date or null | yes | The roast date, only when it is unambiguous. Null puts the bag in relative mode: day offsets without calendar dates |
| `roast_date.status` | `verified`, `ambiguous`, `missing`, `unlabelled` or `future` | yes | Why `date` is or isn't set |
| `weight.grams` | whole number above 0, or null | yes | The net weight |
| `weight.assumed` | true or false | yes | True when the weight was assumed |
| `plan` | object or null | yes | Null when there is no plan, for example when typed in by hand |
| `plan.rest`, `peak`, `portion` | `{ from, to }` | in a plan | Day offsets from the roast date, whole numbers from 0. `from` is at most `to`; a single day has both the same |
| `plan.mid_peak` | whole number | in a plan | The day of the mid-peak check, inside the peak window |
| `plan.tubes`, `dial_in_g` | whole numbers from 0 | in a plan | Frozen 15 g tubes, and the grams left for the fresh dial-in |
| `brew.water` | object or null | yes | The water used |
| `brew.water.gh`, `kh` | numbers from 0 | in a water | General hardness and alkalinity in ppm as CaCO3. These describe any water |
| `brew.water.ca`, `mg`, `na`, `k` | numbers from 0, or null | no | The ions in ppm as CaCO3, when known. They are not checked to add up to GH and KH |
| `brew.water.tds` | number from 0, or null | no | Total dissolved solids in ppm |
| `brew.kettle_c` | whole number from 70 to 100, or null | yes | Kettle temperature in °C |
| `brew.grinder` | text or null | yes | Matched by name to one of the user's grinders, or added as a new one |
| `brew.grind` | text or null | yes | The one grind setting for this bag, in the grinder's own notation, for example `"4.1"`. This is the only grind setting the app stores |
| `personal` | object | no | The user's own fields. An LLM leaves it out; export fills it |
| `personal.private` | true or false | no, default false | True keeps the bean out of the pool entirely |
| `personal.state` | `sealed`, `open`, `frozen` or `finished` | no, default `sealed` | Set by hand; the app never changes it |
| `personal.rating` | 0 to 5 in steps of 0.5, or null | no | The user's rating |
| `personal.rebuy` | true, false or null | no | Would buy again |
| `personal.note` | text or null | no | The user's notes |
| `personal.bought_on` | date or null | no | Purchase date |
| `personal.price` | `{ cents, currency }` or null | no | Whole cents and an ISO 4217 code such as `EUR` |
| `personal.shop` | text or null | no | Where it was bought |

Dates are `YYYY-MM-DD`.

## Import rules
- **Strict validation.** A payload with an unknown field, a wrong type or a value out of range is rejected as a whole. Each error names the field by its path (`bags[0].plan.peak.to`) and says what is allowed.
- **Limits.**

  | Limit | Pasted JSON | Export file, through Import |
  | :-- | :-- | :-- |
  | Size | 256 KB | 20 MB |
  | Bags | 50 | 5,000 |

  - Every text value is at most 500 characters. `varieties` and `tasting_notes` have at most 20 items, and `roaster_notes` and `grinders` at most 500 entries.
  - Manual entry and edits enforce the same text and list limits, so every export imports back.
- **Untrusted input.** Every text value is stored as plain text and escaped wherever it is shown.
- **Save as one.** Bags are saved in one transaction after the user reviews them. A bag whose roaster does not resolve stops the save until it does.
- **Pasting onto an existing bag** replaces the bag's own fields that the JSON carries, and keeps the `personal` fields it leaves out.
  - The `coffee` facts go through matching again, as for a new bean. On a pool coffee they fill gaps, and each differing value is shown with a "Use mine" button. Using one edits the pool coffee for every account, as a manual edit does. On the user's private coffee they are edited in place.
  - `personal.private: true` on a published bag makes the bean private, and `false` on a private one publishes it.
- **Dates come from offsets.** The app adds the plan's offsets to `roast_date.date` and works out today's phase. It never recomputes the windows.

- **Not carried.** The app's own bookkeeping (row ids, timestamps, whether a bag came from JSON or manual entry, the raw pasted payload) is not part of the contract. An export and its re-import match on every field above.

## Versions
A change that makes a valid v1 payload invalid, or changes a field's meaning, needs `beanquery.bags/v2`. The app keeps importing every version it has ever exported.
