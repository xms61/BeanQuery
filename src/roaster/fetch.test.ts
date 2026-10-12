import { describe, expect, test } from 'vitest';
import { fetchRoasterPage, RoasterFetchRefused, userAgent } from './fetch.js';

interface Call {
  url: string;
  userAgent: string | null;
}

/** A stand-in for every.coffee: answers by path and records each request. */
function fakeSite(answers: Record<string, Response | (() => never)>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url: url.href, userAgent: new Headers(init?.headers).get('user-agent') });
    const answer = answers[url.pathname];
    if (answer === undefined) return new Response('not found', { status: 404 });
    if (typeof answer === 'function') return answer();
    return answer;
  };
  return { calls, fetchFn };
}

const page = '<a href="/roaster/sey"><span>Sey</span></a>';
const allowAll = 'User-agent: *\nAllow: /\nDisallow: /api/';

describe('fetchRoasterPage', () => {
  test('checks robots.txt, then fetches /roasters, both with an honest user agent', async () => {
    const site = fakeSite({ '/robots.txt': new Response(allowAll), '/roasters': new Response(page) });

    await expect(fetchRoasterPage(site.fetchFn)).resolves.toBe(page);
    expect(site.calls).toEqual([
      { url: 'https://every.coffee/robots.txt', userAgent },
      { url: 'https://every.coffee/roasters', userAgent },
    ]);
    expect(userAgent).toBe('BeanQuery roaster sync, weekly, non-commercial');
  });

  test('a robots.txt that disallows /roasters stops after one request and says to upload a saved copy', async () => {
    const site = fakeSite({ '/robots.txt': new Response('User-agent: *\nDisallow: /roasters') });

    const result = fetchRoasterPage(site.fetchFn);
    await expect(result).rejects.toThrow(RoasterFetchRefused);
    await expect(result).rejects.toThrow(/robots\.txt.*upload a saved copy/s);
    expect(site.calls).toHaveLength(1);
  });

  test('a 403 on robots.txt stops after one request and says to upload a saved copy', async () => {
    const site = fakeSite({ '/robots.txt': new Response('Forbidden', { status: 403 }) });

    await expect(fetchRoasterPage(site.fetchFn)).rejects.toThrow(/403.*upload a saved copy/s);
    expect(site.calls).toHaveLength(1);
  });

  test('a 403 on the page stops without retrying and says to upload a saved copy', async () => {
    const site = fakeSite({
      '/robots.txt': new Response(allowAll),
      '/roasters': new Response('Forbidden', { status: 403 }),
    });

    await expect(fetchRoasterPage(site.fetchFn)).rejects.toThrow(/403.*upload a saved copy/s);
    expect(site.calls).toHaveLength(2);
  });

  test('a missing robots.txt allows the fetch, as RFC 9309 says', async () => {
    const site = fakeSite({ '/roasters': new Response(page) });

    await expect(fetchRoasterPage(site.fetchFn)).resolves.toBe(page);
    expect(site.calls).toHaveLength(2);
  });

  test('a network failure stops the job and says to upload a saved copy', async () => {
    const site = fakeSite({
      '/robots.txt': () => {
        throw new TypeError('fetch failed');
      },
    });

    await expect(fetchRoasterPage(site.fetchFn)).rejects.toThrow(/fetch failed.*upload a saved copy/s);
    expect(site.calls).toHaveLength(1);
  });
});
