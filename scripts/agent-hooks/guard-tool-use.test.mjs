import assert from 'node:assert/strict';
import { test } from 'node:test';
import { violations } from './guard-tool-use.mjs';

const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('allows ordinary edits and commands', () => {
  assert.deepEqual(violations(edit('/repo/src/app.ts')), []);
  assert.deepEqual(violations(edit('/repo/.env.example')), []);
  assert.deepEqual(violations(bash('npm run verify && git commit -m "fix: x"')), []);
  assert.deepEqual(violations(bash('cp .env.example .env.example.bak; echo $NODE_ENV; cat .envrc')), []);
  assert.deepEqual(violations(bash('node -e "console.log(process.env.HOME)"')), []);
});

test('blocks edits to env files, git internals, lockfiles and keys', () => {
  const paths = [
    '/repo/.env',
    '/repo/config/.env.local',
    '/repo/.git/config',
    '/repo/package-lock.json',
    '/repo/tls.pem',
  ];
  assert.deepEqual(
    paths.map((path) => violations(edit(path)).length),
    [1, 1, 1, 1, 1],
  );
  assert.match(violations(edit('/repo/.env'))[0], /^Blocked edit of \/repo\/\.env: it holds local secrets/);
});

test('normalizes Windows paths', () => {
  assert.equal(violations({ tool_name: 'Write', tool_input: { file_path: 'C:\\repo\\.env' } }).length, 1);
});

test('blocks shell commands that read or write .env', () => {
  for (const command of ['cat .env', 'source ./.env', 'echo KEY=1 >> .env', 'grep TOKEN config/.env.production']) {
    assert.equal(violations(bash(command)).length, 1, command);
  }
  assert.equal(violations({ tool_name: 'PowerShell', tool_input: { command: 'Get-Content .env' } }).length, 1);
});

test('blocks skipping hooks and force pushes', () => {
  for (const command of [
    'git commit --no-verify -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git push --force origin main',
    'git push -f',
    'git push --force-with-lease',
    'git push origin +main',
  ]) {
    assert.equal(violations(bash(command)).length, 1, command);
  }
  assert.deepEqual(violations(bash('git push -u origin feature/x')), []);
});

test('reads the files in a Codex apply_patch call', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/app.ts',
    '@@',
    '-a',
    '+b',
    '*** Add File: .env',
    '+KEY=1',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(violations({ tool_name: 'apply_patch', tool_input: { command: patch } }), [
    'Blocked edit of .env: it holds local secrets. Add the variable name to .env.example and ask the user to set the value.',
  ]);
});
