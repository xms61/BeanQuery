#!/usr/bin/env node
// One-time setup per clone: points git at the hooks in .githooks/ and marks them executable, in the working
// tree and in the index, so a commit made on Windows still gives clones on macOS and Linux runnable hooks.
import { execFileSync } from 'node:child_process';
import { chmodSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = '.githooks';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    console.error('Not a git repository yet. Run: git init -b main, then npm run setup again.');
    process.exit(1);
  }
  git(['config', 'core.hooksPath', HOOKS_DIR]);
  for (const name of readdirSync(HOOKS_DIR)) {
    const path = `${HOOKS_DIR}/${name}`;
    chmodSync(path, 0o755);
    git(['add', '--chmod=+x', path]);
  }
  console.log(`Git hooks enabled from ${HOOKS_DIR}/ (staged as executable). Next: npm run verify`);
}

main();
