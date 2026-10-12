import { describe, expect, test } from 'vitest';
import { isAllowedByRobots } from './robots.js';

const agent = 'BeanQuery roaster sync, weekly, non-commercial';

describe('isAllowedByRobots', () => {
  test('allows /roasters under the robots.txt every.coffee served on 2026-10-07', () => {
    const robots = [
      'User-Agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin/',
      'Disallow: /account/',
      'Disallow: /login',
      'Disallow: /cafe/*/data',
      '',
      'Sitemap: https://every.coffee/sitemap.xml',
    ].join('\r\n');
    expect(isAllowedByRobots(robots, agent, '/roasters')).toBe(true);
    expect(isAllowedByRobots(robots, agent, '/api/roasters')).toBe(false);
    expect(isAllowedByRobots(robots, agent, '/cafe/blue/data')).toBe(false);
  });

  test.each([
    ['User-agent: *\nDisallow: /roasters', false],
    ['User-agent: *\nDisallow: /', false],
    ['User-agent: *\nDisallow:', true],
    ['User-agent: *\nDisallow: /\nAllow: /roasters', true],
    ['User-agent: *\nDisallow: /roast*', false],
    ['User-agent: *\nDisallow: /roasters$', false],
    ['User-agent: *\nDisallow: /roasters/$', true],
    ['# nothing here\nUser-agent: * # everyone\nDisallow: /roasters # no', false],
    ['', true],
  ])('%j gives allowed=%s for /roasters', (robots, allowed) => {
    expect(isAllowedByRobots(robots, agent, '/roasters')).toBe(allowed);
  });

  test('a group naming BeanQuery overrides the * group', () => {
    const robots = 'User-agent: BeanQuery\nDisallow: /roasters\n\nUser-agent: *\nAllow: /';
    expect(isAllowedByRobots(robots, agent, '/roasters')).toBe(false);
  });

  test('a group naming another bot does not apply', () => {
    const robots = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /';
    expect(isAllowedByRobots(robots, agent, '/roasters')).toBe(true);
  });

  test('several user-agent lines can share one group', () => {
    const robots = 'User-agent: GPTBot\nUser-agent: *\nDisallow: /roasters';
    expect(isAllowedByRobots(robots, agent, '/roasters')).toBe(false);
  });
});

describe('isAllowedByRobots, edge cases', () => {
  test('Allow wins a tie between rules of the same length, in either order', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /roasters\nAllow: /roasters', agent, '/roasters')).toBe(true);
    expect(isAllowedByRobots('User-agent: *\nAllow: /roasters\nDisallow: /roasters', agent, '/roasters')).toBe(true);
  });

  test('reads a robots.txt with bare CR line endings', () => {
    expect(isAllowedByRobots('User-agent: *\rDisallow: /roasters\r', agent, '/roasters')).toBe(false);
  });
});
