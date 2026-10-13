import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Chart.js (MIT), served by the app at /assets/chart.js for the stats page only, so no page loads a script from
 * another site. It is the UMD build, which defines `window.Chart`; the app's script draws the charts from each
 * canvas's `data-chart`. The source-map comment is dropped, since the map isn't served.
 */
const entry = createRequire(import.meta.url).resolve('chart.js');
export const chartScript = readFileSync(join(dirname(entry), 'chart.umd.min.js'), 'utf8').replace(
  /\n\/\/# sourceMappingURL=\S+\s*$/,
  '\n',
);

/** A short hash of the library, put in its URL so an update is fetched despite caching. */
export const chartVersion = createHash('sha256').update(chartScript).digest('hex').slice(0, 10);
