interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

/**
 * Whether robots.txt lets `userAgent` fetch `path`, by RFC 9309: the groups naming the agent's product token
 * (its first word) apply, else the `*` groups; the longest matching rule wins, and Allow wins a tie.
 */
export function isAllowedByRobots(robotsTxt: string, userAgent: string, path: string): boolean {
  const groups = parseGroups(robotsTxt);
  const token = (userAgent.split(/[\s/,;]/)[0] ?? '').toLowerCase();
  const named = groups.filter((group) => group.agents.includes(token));
  const applying = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));

  let best: Rule | undefined;
  for (const rule of applying.flatMap((group) => group.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const longer = best === undefined || rule.pattern.length > best.pattern.length;
    const tieGoesToAllow = best !== undefined && rule.pattern.length === best.pattern.length && rule.allow;
    if (longer || tieGoesToAllow) best = rule;
  }
  return best?.allow ?? true;
}

function parseGroups(robotsTxt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasAgent || current === undefined) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      // An empty Disallow allows everything, which is the same as no rule.
      if (current !== undefined && value !== '') current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return groups;
}

/** A rule matches a path prefix, where `*` stands for any characters and a final `$` anchors the end. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}
