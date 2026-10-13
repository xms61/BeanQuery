import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { buildWorldMap, worldMapModule } from './world-map-build.js';

/**
 * `pnpm map:build --from <ne_110m_admin_0_countries.geojson>`: rebuilds src/stats/world-map.data.ts from a download
 * of Natural Earth's 1:110m countries. Run `pnpm format` after it.
 */
const { values } = parseArgs({ options: { from: { type: 'string' } } });
if (values.from === undefined) {
  console.error('Usage: pnpm map:build --from <ne_110m_admin_0_countries.geojson>');
  process.exit(2);
}
const map = buildWorldMap(JSON.parse(readFileSync(values.from, 'utf8')));
const target = new URL('../../src/stats/world-map.data.ts', import.meta.url);
writeFileSync(target, worldMapModule(map, basename(values.from)));
console.log(`Wrote ${map.countries.length} countries, ${map.width} by ${map.height}.`);
