import { isAllowedByRobots } from './robots.js';

export const userAgent = 'BeanQuery roaster sync, weekly, non-commercial';
const site = 'https://every.coffee';
const listPath = '/roasters';

/** every.coffee would not serve the list. The job stops here; it never retries with a disguised client. */
export class RoasterFetchRefused extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(
      `every.coffee refused the roaster fetch: ${reason}. Not retrying. Save ${site}${listPath} from a browser ` +
        'and upload a saved copy instead: pnpm roasters:import --db <database> --file <saved page>.',
      options,
    );
    this.name = 'RoasterFetchRefused';
  }
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Fetches every.coffee/roasters once, after robots.txt allows it. Throws `RoasterFetchRefused` otherwise. */
export async function fetchRoasterPage(fetchFn: FetchFn = fetch): Promise<string> {
  const robots = await get(fetchFn, '/robots.txt');
  // RFC 9309 lets a crawler proceed when robots.txt doesn't exist. Any other failure is read as a refusal.
  if (robots.status !== 404 && robots.status !== 410) {
    if (!robots.ok) throw new RoasterFetchRefused(`robots.txt answered ${robots.status}`);
    if (!isAllowedByRobots(await robots.text(), userAgent, listPath)) {
      throw new RoasterFetchRefused(`robots.txt disallows ${listPath}`);
    }
  }

  const page = await get(fetchFn, listPath);
  if (!page.ok) throw new RoasterFetchRefused(`${listPath} answered ${page.status}`);
  return page.text();
}

async function get(fetchFn: FetchFn, path: string): Promise<Response> {
  try {
    return await fetchFn(`${site}${path}`, { headers: { 'user-agent': userAgent } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RoasterFetchRefused(`${path} failed (${reason})`, { cause: error });
  }
}
