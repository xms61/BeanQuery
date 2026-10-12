import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The design's fonts, Familjen Grotesk and JetBrains Mono, served at /assets/fonts/<file>. Both are under the SIL Open
 * Font License (the OFL-*.txt files beside them). The files are the variable-weight Latin and Latin Extended subsets
 * from Fontsource 5.3.0, about 90 KB in all; other scripts fall back to the system's fonts.
 *
 * The folder is found from the package root, so this module finds it from `src/web/assets/` in tests and from
 * `dist/web/assets/` when built, which tsc doesn't copy binary files into.
 */
const folder = new URL('../../../src/web/assets/fonts/', import.meta.url);

const latin =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, ' +
  'U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const latinExtended =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, ' +
  'U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const faces = [
  {
    family: 'Familjen Grotesk',
    weights: '400 700',
    file: 'familjen-grotesk-latin-ext-wght-normal.woff2',
    range: latinExtended,
  },
  { family: 'Familjen Grotesk', weights: '400 700', file: 'familjen-grotesk-latin-wght-normal.woff2', range: latin },
  {
    family: 'JetBrains Mono',
    weights: '100 800',
    file: 'jetbrains-mono-latin-ext-wght-normal.woff2',
    range: latinExtended,
  },
  { family: 'JetBrains Mono', weights: '100 800', file: 'jetbrains-mono-latin-wght-normal.woff2', range: latin },
].map((face) => {
  const bytes = readFileSync(new URL(face.file, folder));
  return { ...face, bytes, version: createHash('sha256').update(bytes).digest('hex').slice(0, 10) };
});

/** The font files by name. Only these are served; any other name is not found. */
export const fontFiles: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map(
  faces.map((face) => [face.file, face.bytes]),
);

/** The `@font-face` rules for the stylesheet, each file linked by a hash of its bytes, as the stylesheet is. */
export const fontFaces = faces
  .map(
    (face) => `@font-face {
  font-family: '${face.family}';
  font-style: normal;
  font-weight: ${face.weights};
  font-display: swap;
  src: url('/assets/fonts/${face.file}?v=${face.version}') format('woff2');
  unicode-range: ${face.range};
}`,
  )
  .join('\n');
