#!/usr/bin/env node
// Claude Code PreToolUse hook (.claude/settings.json); it also understands Codex patches if Codex is added. It blocks edits
// to files an agent must not change and shell commands that bypass the repo's guardrails. Instructions in
// AGENTS.md are requests; this is the enforcement. Exit code 2 blocks the call and sends stderr back to the
// agent, so each message says what to do instead.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKED = 2;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_RULES = [
  {
    test: (path) => /(^|\/)\.env(\.[^/]+)?$/.test(path) && !/(^|\/)\.env\.example$/.test(path),
    reason: 'holds local secrets. Add the variable name to .env.example and ask the user to set the value.',
  },
  {
    test: (path) => /(^|\/)\.git\//.test(path),
    reason: "is git's internal state. Use git commands instead.",
  },
  {
    test: (path) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
    reason: 'is written by the package manager. Change package.json and run the install command instead.',
  },
  {
    test: (path) => /\.(pem|key|p12|pfx)$/i.test(path) || /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/.test(path),
    reason: 'looks like a private key. Keys never go in the repo; ask the user.',
  },
];
const COMMAND_RULES = [
  {
    pattern: /(^|\s)--no-verify(?=\s|$)|\bcore\.hooksPath\s*=/i,
    reason: 'skips the git hooks that check secrets and docs. Fix what the hook reports instead.',
  },
  {
    pattern:
      /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*\s(-f|--force|--force-with-lease)(=\S*)?(?=\s|$)|\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*\s\+\S/,
    reason: 'rewrites shared history. Ask the user to run it.',
  },
  {
    pattern: /(^|[\s'"=/<>])\.env(?!\.example)(\.[\w.-]+)?(?=$|[\s'";|&)<>])/,
    reason:
      'touches .env, which holds local secrets. Read .env.example for the variable names, and ask the user for values.',
  },
];
// Codex sends file edits as one apply_patch call whose patch names each file it adds, updates, deletes or moves to.
const PATCH_PATH = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

function editedPaths(event) {
  const input = event.tool_input ?? {};
  if (event.tool_name === 'apply_patch')
    return [...String(input.command ?? '').matchAll(PATCH_PATH)].map((m) => m[1].trim());
  return [input.file_path, input.notebook_path].filter((path) => typeof path === 'string');
}

function shellCommand(event) {
  return SHELL_TOOLS.has(event.tool_name) ? String(event.tool_input?.command ?? '') : '';
}

export function violations(event) {
  const found = [];
  for (const path of editedPaths(event).map((p) => p.replace(/\\/g, '/'))) {
    const rule = FILE_RULES.find(({ test }) => test(path));
    if (rule) found.push(`Blocked edit of ${path}: it ${rule.reason}`);
  }
  const command = shellCommand(event);
  for (const { pattern, reason } of COMMAND_RULES) {
    if (pattern.test(command)) found.push(`Blocked command: it ${reason}`);
  }
  return found;
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    console.error('guard-tool-use: could not parse the hook input; allowing the call.');
    process.exit(1);
  }
  const found = violations(event);
  if (found.length) {
    console.error(found.join('\n'));
    process.exit(BLOCKED);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
