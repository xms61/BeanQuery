import { writeFileSync } from 'node:fs';
import { bagsJsonSchema } from './bag-json.js';

// Run by `pnpm contract:schema` from the repo root after a change to the contract definition.
const target = 'docs/generated/bag-json-contract.schema.json';
writeFileSync(target, `${JSON.stringify(bagsJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${target}`);
