import { describe, expect, test } from 'vitest';
import { styleSheet } from './style.js';

/** The tokens one `:root` block defines, as `name → #RRGGBB`. */
function tokens(selector: string): Record<string, string> {
  const start = styleSheet.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in the stylesheet`);
  const block = styleSheet.slice(start, styleSheet.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every text color the stylesheet sets, on the background it sits on: [text token, background token, where]. */
const textPairs: [string, string, string][] = [
  ['ink-default', 'bg-surface', 'body text on cards'],
  ['ink-default', 'bg-ground', 'body text'],
  ['ink-muted', 'bg-surface', 'muted text and table headers on cards'],
  ['ink-muted', 'bg-ground', 'muted text'],
  ['ink-muted', 'bg-sunk', 'sidebar links and quiet pills'],
  ['accent-cherry', 'bg-surface', '"Today" in Coming up, and errors on cards'],
  ['accent-cherry', 'bg-ground', 'errors on the page'],
  ['ink-inverse', 'accent-cherry', 'the danger button'],
  ['ink-inverse', 'ink-default', 'the primary button'],
  ['phase-resting', 'phase-resting-bg', 'the Resting pill'],
  ['phase-rested-ink', 'phase-resting-bg', 'the Rested pill'],
  ['phase-peak', 'phase-peak-bg', 'the Peak pill'],
  ['phase-past', 'phase-past-bg', 'the Past pill'],
  ['phase-rested-ink', 'bg-surface', 'rest dates on the bag page'],
  ['freeze-default', 'bg-surface', 'portion and freeze dates on the bag page'],
  ['phase-peak', 'bg-surface', 'peak dates on the bag page'],
  ['phase-peak', 'bg-ground', '.ok messages on the page'],
];

test('the danger button uses --ink-inverse for its text, the color the contrast check covers', () => {
  expect(styleSheet).toMatch(/\.button\.danger \{[^}]*color: var\(--ink-inverse\)/);
});

describe('text colors meet WCAG AA (4.5:1) in both themes', () => {
  for (const [theme, selector] of [
    ['light', ':root'],
    ['dark', ':root[data-theme="dark"]'],
  ] as const) {
    test(theme, () => {
      const palette = tokens(selector);
      const failing = textPairs.flatMap(([text, background, where]) => {
        const [fg, bg] = [palette[text], palette[background]];
        if (fg === undefined || bg === undefined) return [`${where}: --${text} or --${background} is not defined`];
        const ratio = contrast(fg, bg);
        return ratio >= 4.5 ? [] : [`${where}: --${text} on --${background} is ${ratio.toFixed(2)}:1`];
      });
      expect(failing, `Darken or lighten the text token in style.ts (${theme}) until each reaches 4.5:1`).toEqual([]);
    });
  }
});
