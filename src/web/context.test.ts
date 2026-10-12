import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { clientKeyFrom } from './context.js';

/** The key a request gets, from a socket address and an optional X-Forwarded-For header. */
async function keyOf(trustProxy: boolean, remoteAddress: string | undefined, forwardedFor?: string) {
  const app = new Hono();
  app.get('/', (c) => c.text(clientKeyFrom(trustProxy)(c)));
  const headers: Record<string, string> = forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor };
  const response = await app.request('/', { headers }, { incoming: { socket: { remoteAddress } } });
  return response.text();
}

describe('clientKeyFrom', () => {
  test('behind a trusted proxy, takes the last address the proxy appended', async () => {
    expect(await keyOf(true, '127.0.0.1', '198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
    expect(await keyOf(true, '127.0.0.1', ' 203.0.113.9 ')).toBe('203.0.113.9');
  });

  test('without a trusted proxy, ignores the header a client could forge, and uses the socket', async () => {
    expect(await keyOf(false, '203.0.113.9', '198.51.100.7')).toBe('203.0.113.9');
  });

  test('falls back to the socket when the header is missing or empty, and to one shared key without either', async () => {
    expect(await keyOf(true, '203.0.113.9')).toBe('203.0.113.9');
    expect(await keyOf(true, '203.0.113.9', '')).toBe('203.0.113.9');
    expect(await keyOf(false, undefined)).toBe('unknown');
  });
});
