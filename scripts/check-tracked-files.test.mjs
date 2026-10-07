import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTrackedFiles, machineNamePatterns } from './check-tracked-files.mjs';

// Home-folder paths are assembled at run time, so this file never contains one itself.
const WINDOWS_HOME = ['C:', 'Users', 'someone', 'notes.txt'].join('\\');
const WINDOWS_HOME_FORWARD = ['C:', 'Users', 'someone', 'notes.txt'].join('/');
const WINDOWS_HOME_JSON = ['C:', 'Users', 'someone', 'notes.txt'].join('\\\\');
const GIT_BASH_HOME = ['', 'c', 'Users', 'someone', 'notes.txt'].join('/');
const MAC_HOME = ['', 'Users', 'someone', 'notes.txt'].join('/');
const LINUX_HOME = ['', 'home', 'someone', 'notes.txt'].join('/');
const HOME_PATH_ERROR = 'home-folder path; refer to the location by an env var instead';

function textFile(path, text) {
  return { path, size: Buffer.byteLength(text), text };
}

function binaryFile(path, size = 10) {
  return { path, size, text: null };
}

test('passes code and docs', () => {
  assert.deepEqual(
    checkTrackedFiles([textFile('src/app.ts', 'export {};\n'), textFile('README.md', '# Readme\n')]),
    [],
  );
});

test('reports key, database and archive files', () => {
  const files = ['tls.pem', 'server.KEY', 'local.sqlite', 'dump.tar.gz'].map((path) => binaryFile(path));
  assert.deepEqual(checkTrackedFiles(files), [
    'tls.pem: .pem files never go in git',
    'server.KEY: .key files never go in git',
    'local.sqlite: .sqlite files never go in git',
    'dump.tar.gz: .gz files never go in git',
  ]);
});

test('reports local notes and build output', () => {
  const files = [textFile('docs/scratch/notes.md', '# Notes'), textFile('dist/app.js', '')];
  assert.deepEqual(checkTrackedFiles(files), [
    'docs/scratch/notes.md: docs/scratch/ holds local notes or build output',
    'dist/app.js: dist/ holds local notes or build output',
  ]);
});

test('reports env files and SSH keys, and allows .env.example', () => {
  const files = ['.env', 'config/.env.production', 'id_ed25519', '.env.example'].map((path) => textFile(path, 'x'));
  assert.deepEqual(checkTrackedFiles(files), [
    '.env: env files hold local settings and secrets; only .env.example is committed',
    'config/.env.production: env files hold local settings and secrets; only .env.example is committed',
    'id_ed25519: SSH keys never go in git',
  ]);
});

test('reports files over 1 MiB, except lockfiles', () => {
  const big = 1024 * 1024 + 1;
  assert.deepEqual(checkTrackedFiles([binaryFile('public/intro.png', big), binaryFile('package-lock.json', big)]), [
    'public/intro.png: 1025 KiB is over the 1 MiB limit',
  ]);
});

test('reports home-folder paths by line', () => {
  const text = [
    'ok',
    WINDOWS_HOME,
    WINDOWS_HOME_FORWARD,
    WINDOWS_HOME_JSON,
    GIT_BASH_HOME,
    `see ${MAC_HOME}`,
    `"${LINUX_HOME}"`,
  ].join('\n');
  assert.deepEqual(
    checkTrackedFiles([textFile('docs/notes.md', text)]),
    [2, 3, 4, 5, 6, 7].map((line) => `docs/notes.md: line ${line}: ${HOME_PATH_ERROR}`),
  );
});

test('allows URLs and the node and runner service accounts', () => {
  const text = [
    'https://example.com/Users/someone/',
    'WORKDIR /home/node/app',
    'cd /home/runner/work/app',
    'wss://host/home/x/',
  ].join('\n');
  assert.deepEqual(checkTrackedFiles([textFile('Dockerfile', text)]), []);
});

test("reports this machine's user and host names, but not longer words that contain them", () => {
  const patterns = machineNamePatterns(['someone', 'box-01', 'ab']);
  const text = ['built by someone', 'on box-01', 'github.com/someone61/app', 'abc'].join('\n');
  assert.deepEqual(checkTrackedFiles([textFile('notes.md', text)], patterns), [
    "notes.md: line 1: this machine's user or host name",
    "notes.md: line 2: this machine's user or host name",
  ]);
});

test('skips content checks for binary files', () => {
  assert.deepEqual(checkTrackedFiles([binaryFile('public/logo.png')]), []);
});
