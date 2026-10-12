import { describe, expect, test } from 'vitest';
import { RateLimiter } from './rate-limit.js';

describe('RateLimiter', () => {
  test('allows max attempts per client in a window, then refuses until the window ends', () => {
    const limiter = new RateLimiter(3, 60_000);
    const at = (seconds: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, seconds));

    expect([1, 2, 3, 4].map((s) => limiter.attempt('a', at(s)))).toEqual([true, true, true, false]);
    expect(limiter.attempt('b', at(5))).toBe(true);
    expect(limiter.attempt('a', at(59))).toBe(false);
    expect(limiter.attempt('a', at(61))).toBe(true);
  });
});
