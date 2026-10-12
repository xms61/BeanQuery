/** One roaster as every.coffee/roasters lists it. Names and slugs only, never websites or coffees. */
export interface RoasterListing {
  slug: string;
  name: string;
  /** Other spellings the same page links this slug with, such as "Sey Coffee" in the footer for "Sey". */
  otherNames: string[];
}

// Relative or full every.coffee links, in either quote and any case, as a browser may save them. The link text is
// capped, so an upload full of unclosed links is still read in linear time.
const roasterLink =
  /<a\b[^>]*?\bhref\s*=\s*(["'])(?:https?:\/\/(?:www\.)?every\.coffee)?\/roaster\/([a-z0-9-]+)\1[^>]*>((?:[^<]|<(?!\/a\s*>)){0,1000}?)<\/a\s*>/gi;

/**
 * Reads every `/roaster/<slug>` link on a saved or fetched copy of every.coffee/roasters. A slug can be linked
 * twice, from the A to Z list and again from the footer; the A to Z entry comes first and gives the name.
 */
export function parseRoasterList(html: string): RoasterListing[] {
  const namesBySlug = new Map<string, string[]>();
  for (const [, , linkSlug, inner] of html.matchAll(roasterLink)) {
    const slug = linkSlug?.toLowerCase();
    const name = textOf(inner ?? '');
    if (slug === undefined || name === '') continue;
    const names = namesBySlug.get(slug) ?? [];
    if (!names.includes(name)) names.push(name);
    namesBySlug.set(slug, names);
  }

  if (namesBySlug.size === 0) {
    throw new Error(
      'Found no roaster links on the page. every.coffee may have changed its markup, or served a challenge page ' +
        'instead of the list. Open the file in a browser to check, and fix parseRoasterList if the markup changed.',
    );
  }

  return [...namesBySlug].map(([slug, names]) => ({
    slug,
    name: names[0] ?? '',
    otherNames: names.slice(1),
  }));
}

function textOf(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (!body.startsWith('#')) return namedEntities[body.toLowerCase()] ?? entity;
    const hex = body[1] === 'x' || body[1] === 'X';
    const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    // An uploaded file is untrusted: an out-of-range number stays as written instead of throwing.
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  });
}
