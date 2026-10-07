#!/usr/bin/env node
// Blocks what must never reach the repository: env files and private keys, databases and archives, build
// output and local notes, files over the size limit, and text that reveals a developer's machine (home-folder
// paths, the local user and host names). The rules and their reasons are in docs/SECURITY.md. CI checks every
// tracked file; the pre-commit hook passes --staged to check only what is about to be committed.
import { execFileSync } from 'node:child_process';
import { hostname, userInfo } from 'node:os';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;
const MIN_MACHINE_NAME_LENGTH = 3;
const SIZE_LIMIT_EXEMPT = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const FORBIDDEN_EXTENSIONS = new Set([
  'pem',
  'key',
  'p12',
  'pfx',
  'sqlite',
  'sqlite3',
  'db',
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'tgz',
]);
const FORBIDDEN_DIRS = ['docs/scratch/', 'node_modules/', 'dist/', 'build/', 'coverage/'];
const FORBIDDEN_NAMES = [
  [/^\.env(\..+)?$/, 'env files hold local settings and secrets; only .env.example is committed'],
  [/^id_(rsa|dsa|ecdsa|ed25519)/, 'SSH keys never go in git'],
];
// Written with escaped slashes so this file never matches its own patterns. The node and runner accounts
// belong to Docker images and CI runners, not to anyone's machine.
const HOME_PATH_PATTERNS = [
  /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s'"`]+/i,
  /\/[A-Za-z]\/Users\/[^/\s'"`]+\//i,
  /(?<![\w.-])\/(?:Users|home)\/(?!(?:node|runner)\/)[^/\s'"`]+\//,
];

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function forbiddenNameReason(name) {
  if (name === '.env.example') return null;
  return FORBIDDEN_NAMES.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function machineNamePatterns(names) {
  return names
    .filter((name) => name.length >= MIN_MACHINE_NAME_LENGTH)
    .map((name) => new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'i'));
}

// Errors name the line, never the matched text, so the output doesn't repeat what it found.
function contentErrors(text, machinePatterns) {
  const errors = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (HOME_PATH_PATTERNS.some((pattern) => pattern.test(line)))
      errors.push(`line ${index + 1}: home-folder path; refer to the location by an env var instead`);
    if (machinePatterns.some((pattern) => pattern.test(line)))
      errors.push(`line ${index + 1}: this machine's user or host name`);
  });
  return errors;
}

// A file is { path, size, text }, where text is null for binary content.
function fileErrors(file, machinePatterns) {
  const name = posix.basename(file.path);
  const extension = extensionOf(name);
  const dir = FORBIDDEN_DIRS.find((prefix) => file.path.startsWith(prefix));
  const nameReason = forbiddenNameReason(name);
  const errors = [];
  if (FORBIDDEN_EXTENSIONS.has(extension)) errors.push(`.${extension} files never go in git`);
  if (dir) errors.push(`${dir} holds local notes or build output`);
  if (nameReason) errors.push(nameReason);
  if (file.size > MAX_BYTES && !SIZE_LIMIT_EXEMPT.has(name))
    errors.push(`${Math.ceil(file.size / 1024)} KiB is over the 1 MiB limit`);
  if (file.text !== null) errors.push(...contentErrors(file.text, machinePatterns));
  return errors.map((error) => `${file.path}: ${error}`);
}

export function checkTrackedFiles(files, machinePatterns = []) {
  return files.flatMap((file) => fileErrors(file, machinePatterns));
}

function git(args, maxBuffer = MAX_READ_BYTES) {
  return execFileSync('git', args, { maxBuffer });
}

function listedPaths(staged) {
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '-z'];
  return git(args).toString('utf8').split('\0').filter(Boolean);
}

// Reads the index, not the working tree, so the check sees exactly what gets committed.
function indexedFile(path) {
  const size = Number(
    git(['cat-file', '-s', `:${path}`])
      .toString('utf8')
      .trim(),
  );
  if (size > MAX_READ_BYTES) return { path, size, text: null };
  const bytes = git(['cat-file', 'blob', `:${path}`]);
  const isBinary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  return { path, size, text: isBinary ? null : bytes.toString('utf8') };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--staged')) {
    console.error('usage: node scripts/check-tracked-files.mjs [--staged]');
    process.exit(2);
  }
  const staged = args.includes('--staged');
  // CI runners have throwaway names such as "runner", which would only match ordinary words.
  const patterns = process.env.CI ? [] : machineNamePatterns([userInfo().username, hostname()]);
  const errors = checkTrackedFiles(listedPaths(staged).map(indexedFile), patterns);
  for (const error of errors) console.error(`error: ${error}`);
  if (errors.length) {
    console.error('Unstage these files (git restore --staged <file>) or remove the text. Rules: docs/SECURITY.md.');
    process.exit(1);
  }
  console.log(`Tracked files OK (${staged ? 'staged files' : 'all tracked files'}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
