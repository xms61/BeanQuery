import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseRoasterList } from './parse.js';

const link = (slug: string, text: string) => `<a class="link-subtle" href="/roaster/${slug}">${text}</a>`;
const listItem = (slug: string, name: string) =>
  `<a href="/roaster/${slug}"><span>${name}</span><img alt="" src="/images/arrow.right.svg"/></a>`;

describe('parseRoasterList', () => {
  test('reads the slug and the link text of each roaster link', () => {
    const html = `<ul><li>${listItem('tanat-coffee', 'Tanat')}</li><li>${listItem('la-cabra', 'La Cabra')}</li></ul>`;
    expect(parseRoasterList(html)).toEqual([
      { slug: 'tanat-coffee', name: 'Tanat', otherNames: [] },
      { slug: 'la-cabra', name: 'La Cabra', otherNames: [] },
    ]);
  });

  test('decodes HTML entities and collapses whitespace in names', () => {
    const html = [
      listItem('black-white', 'Black &amp; White'),
      listItem('adventurers', 'Adventurer&#x27;s &quot;Co&quot;'),
      listItem('hydrangea', ' Hydrangea \n  Coffee&#39;s '),
    ].join('');
    expect(parseRoasterList(html).map((roaster) => roaster.name)).toEqual([
      'Black & White',
      'Adventurer\'s "Co"',
      "Hydrangea Coffee's",
    ]);
  });

  test('takes the A to Z entry as the name when the footer links a slug again, and keeps the other spelling', () => {
    const html = `${listItem('sey', 'Sey')}${listItem('la-cabra', 'La Cabra')}<footer>${link('sey', 'Sey Coffee')}</footer>`;
    expect(parseRoasterList(html)).toEqual([
      { slug: 'sey', name: 'Sey', otherNames: ['Sey Coffee'] },
      { slug: 'la-cabra', name: 'La Cabra', otherNames: [] },
    ]);
  });

  test('ignores links to other pages, coffee pages under a roaster, and links with no text', () => {
    const html = [
      '<a href="/roasters">All</a>',
      '<a href="/roaster/sey/coffee/gatomboya">Gatomboya</a>',
      '<a href="https://sey.coffee">Website</a>',
      '<a href="/roaster/empty"><img alt=""/></a>',
      listItem('sey', 'Sey'),
    ].join('');
    expect(parseRoasterList(html)).toEqual([{ slug: 'sey', name: 'Sey', otherNames: [] }]);
  });

  // A page saved from a browser can carry full URLs, other quotes or upper-case tags instead of the server's markup.
  test.each([
    ['a full URL', '<a href="https://every.coffee/roaster/sey"><span>Sey</span></a>'],
    ['a www URL', '<a href="https://www.every.coffee/roaster/sey">Sey</a>'],
    ['single quotes', "<a class='x' href='/roaster/sey'>Sey</a>"],
    ['upper-case tags', '<A HREF="/roaster/sey">Sey</A>'],
  ])('reads a link written with %s', (_, html) => {
    expect(parseRoasterList(html)).toEqual([{ slug: 'sey', name: 'Sey', otherNames: [] }]);
  });

  test('ignores links to roaster pages on other sites', () => {
    const html = `<a href="https://elsewhere.example/roaster/fake">Fake</a>${listItem('sey', 'Sey')}`;
    expect(parseRoasterList(html).map((roaster) => roaster.slug)).toEqual(['sey']);
  });

  test('stays fast on a hostile upload full of unclosed roaster links', () => {
    const html = '<a href="/roaster/x">x '.repeat(20_000);
    const started = performance.now();
    expect(() => parseRoasterList(html)).toThrow(/no roaster links/i);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test('stays fast on a hostile upload full of opening tags that never close', () => {
    for (const unit of ['<a ', '<a href="/roaster/x" ']) {
      const html = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
      const started = performance.now();
      expect(() => parseRoasterList(html)).toThrow(/no roaster links/i);
      expect([unit, performance.now() - started < 500]).toEqual([unit, true]);
    }
  });

  test('refuses a page with no roaster links, so a changed or challenge page never looks like an empty list', () => {
    expect(() => parseRoasterList('<html><body>Just a moment...</body></html>')).toThrow(/no roaster links/i);
  });

  // The saved copy is every.coffee's data, so it stays in docs/scratch/ (git-ignored) and this test runs only where
  // someone saved it. Save https://every.coffee/roasters there as every-coffee-roasters.html to run it.
  const savedCopy = new URL('../../docs/scratch/every-coffee-roasters.html', import.meta.url);
  test.skipIf(!existsSync(savedCopy))('reads every roaster from the copy saved on 2026-10-07', () => {
    const roasters = parseRoasterList(readFileSync(savedCopy, 'utf8'));

    expect(roasters).toHaveLength(9149);
    expect(new Set(roasters.map((roaster) => roaster.slug)).size).toBe(9149);
    expect(roasters).toContainEqual({ slug: 'sey', name: 'Sey', otherNames: ['Sey Coffee'] });
    expect(roasters.find((roaster) => roaster.slug === 'black-white-coffee-roasters')?.name).toBe(
      'Black & White Coffee Roasters',
    );
    for (const roaster of roasters) {
      expect(roaster.slug).toMatch(/^[a-z0-9-]+$/);
      expect(roaster.name).toMatch(/^\S(.*\S)?$/);
      expect(roaster.name).not.toMatch(/[<>]|&[#a-z0-9]+;/i);
    }
  });
});
