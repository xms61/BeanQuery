#!/usr/bin/env node
// Checks the knowledge base described in docs/KNOWLEDGE_BASE.md: links resolve, every doc is reachable from
// AGENTS.md, docs carry status frontmatter, folder indexes list their docs, exec plans have their sections.
// Exits non-zero on errors. Warnings (stale docs, template placeholders) are the doc-gardening pass's work list.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = 'AGENTS.md';
const ENTRY_MAX_LINES = 100;
const STALE_AFTER_DAYS = 90;
const STATUSES = ['stub', 'draft', 'verified'];
const PLACEHOLDER = 'TODO(template)';
const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'docs/scratch',
  '.claude/worktrees',
]);
// Entry points and agent config: their links are checked, but they need no frontmatter and no inbound link.
const META_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'REVIEW.md', 'TEMPLATE.md', 'CHANGELOG.md']);
const META_DIRS = ['.github/', '.agents/', '.claude/', '.codex/', '.gemini/'];
const INDEXED_DIRS = ['docs/design-docs', 'docs/product-specs'];
const PLAN_SECTIONS = {
  'docs/exec-plans/active': ['Purpose', 'Progress', 'Decision log'],
  'docs/exec-plans/completed': ['Purpose', 'Progress', 'Decision log', 'Outcome'],
};
const DAY_MS = 24 * 60 * 60 * 1000;

function listMarkdown(root, dir = '') {
  const files = [];
  const entries = readdirSync(join(root, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED_DIRS.has(path)) files.push(...listMarkdown(root, path));
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

// meta: entry points and agent config; generated/reference: not hand-written; plan: exec plans; doc: the rest.
function kindOf(path) {
  if (META_FILES.has(path) || META_DIRS.some((dir) => path.startsWith(dir))) return 'meta';
  if (path.startsWith('docs/generated/')) return 'generated';
  if (path.startsWith('docs/references/')) return 'reference';
  if (Object.keys(PLAN_SECTIONS).includes(posix.dirname(path))) return 'plan';
  return 'doc';
}

function withoutInlineCode(line) {
  return line.replace(/`[^`\n]*`/g, '');
}

// The lines outside fenced code blocks, inline code removed, with their 1-based line numbers.
function proseLines(text) {
  const lines = [];
  let fence = null;
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s*(```|~~~)/)?.[1];
    if (marker && (!fence || marker === fence)) {
      fence = fence ? null : marker;
      return;
    }
    if (!fence) lines.push({ number: index + 1, text: withoutInlineCode(line) });
  });
  return lines;
}

function linkTargets(text) {
  const targets = [];
  for (const { text: line } of proseLines(text)) {
    for (const match of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      targets.push(decodeURIComponent(target.split('#')[0]));
    }
  }
  return targets;
}

function resolveLink(fromPath, target) {
  const base = target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(fromPath), target);
  return posix.normalize(base).replace(/\/$/, '');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [key, ...rest] = line.split(':');
    if (rest.length) fields[key.trim()] = rest.join(':').trim();
  }
  return fields;
}

function utcIso(date) {
  return date.toISOString().slice(0, 10);
}

// Dates are UTC, the date CI runs in. One day of slack accepts a date written on a clock ahead of UTC.
function frontmatterProblems(fields, today) {
  if (!fields)
    return {
      errors: ['missing frontmatter; start the file with status (stub, draft or verified) and last-verified'],
      warnings: [],
    };
  const errors = [];
  if (!STATUSES.includes(fields.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  const lastVerified = fields['last-verified'] ?? '';
  const verifiedMs = /^\d{4}-\d{2}-\d{2}$/.test(lastVerified) ? Date.parse(lastVerified) : NaN;
  if (Number.isNaN(verifiedMs)) return { errors: [...errors, 'last-verified must be a YYYY-MM-DD date'], warnings: [] };
  if (lastVerified > utcIso(new Date(today.getTime() + DAY_MS)))
    errors.push("last-verified is in the future; use today's UTC date");
  const ageDays = Math.round((Date.parse(utcIso(today)) - verifiedMs) / DAY_MS);
  const warnings =
    fields.status === 'verified' && ageDays > STALE_AFTER_DAYS
      ? [`verified ${ageDays} days ago; re-check it against the code`]
      : [];
  return { errors, warnings };
}

function reachableFrom(entry, texts) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    for (const target of linkTargets(texts.get(path))) {
      const resolved = resolveLink(path, target);
      if (texts.has(resolved) && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return seen;
}

function indexProblems(dir, texts, statuses) {
  const indexPath = `${dir}/index.md`;
  if (!texts.has(indexPath)) return [`${indexPath}: missing index; add one with a row per doc in ${dir}/`];
  const rowStatus = new Map();
  for (const line of texts
    .get(indexPath)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('|'))) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const link = cells[0]?.match(/\]\(([^)]+)\)/);
    if (link) rowStatus.set(resolveLink(indexPath, link[1]), cells[1]);
  }
  const problems = [];
  for (const path of texts.keys()) {
    if (posix.dirname(path) !== dir || path === indexPath) continue;
    if (!rowStatus.has(path)) problems.push(`${indexPath}: no row for ${path}`);
    else if (rowStatus.get(path) !== statuses.get(path))
      problems.push(
        `${indexPath}: status for ${path} is "${rowStatus.get(path)}", the doc says "${statuses.get(path)}"`,
      );
  }
  return problems;
}

function missingSections(text, sections) {
  const headings = new Set(
    proseLines(text)
      .map(({ text: line }) => line.match(/^##\s+(.+?)\s*$/)?.[1].toLowerCase())
      .filter(Boolean),
  );
  return sections.filter((section) => !headings.has(section.toLowerCase()));
}

function placeholderLines(text) {
  return proseLines(text)
    .filter(({ text: line }) => line.includes(PLACEHOLDER))
    .map(({ number }) => number);
}

export function checkDocs(root, today = new Date()) {
  const errors = [];
  const warnings = [];
  const texts = new Map(listMarkdown(root).map((path) => [path, readFileSync(join(root, path), 'utf8')]));
  if (!texts.has(ENTRY)) return { errors: [`${ENTRY}: missing`], warnings };

  const entryLines = texts.get(ENTRY).trimEnd().split(/\r?\n/).length;
  if (entryLines > ENTRY_MAX_LINES)
    errors.push(`${ENTRY}: ${entryLines} lines, the limit is ${ENTRY_MAX_LINES}; move detail into docs/ and link it`);

  const reachable = reachableFrom(ENTRY, texts);
  const statuses = new Map();
  for (const [path, text] of texts) {
    const kind = kindOf(path);
    if (kind === 'reference') continue;
    for (const target of linkTargets(text)) {
      if (!existsSync(join(root, resolveLink(path, target)))) errors.push(`${path}: broken link to ${target}`);
    }
    warnings.push(...placeholderLines(text).map((line) => `${path}:${line}: template placeholder left`));
    if (kind === 'plan') {
      const missing = missingSections(text, PLAN_SECTIONS[posix.dirname(path)]);
      if (missing.length) errors.push(`${path}: missing sections: ${missing.join(', ')}`);
    }
    if (kind !== 'doc') continue;
    if (!reachable.has(path))
      errors.push(`${path}: not linked from ${ENTRY} or any doc it links to; add it to the map or a related doc`);
    const fields = parseFrontmatter(text);
    statuses.set(path, fields?.status);
    const problems = frontmatterProblems(fields, today);
    errors.push(...problems.errors.map((problem) => `${path}: ${problem}`));
    warnings.push(...problems.warnings.map((problem) => `${path}: ${problem}`));
  }
  for (const dir of INDEXED_DIRS) {
    if (existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory())
      errors.push(...indexProblems(dir, texts, statuses));
  }
  return { errors, warnings };
}

function main() {
  const { errors, warnings } = checkDocs(join(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  if (errors.length) {
    console.error('The doc rules are in docs/KNOWLEDGE_BASE.md.');
    process.exit(1);
  }
  console.log(`Docs OK${warnings.length ? ` (${warnings.length} warnings)` : ''}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
