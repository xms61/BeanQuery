---
status: draft
last-verified: 2026-10-07
---

# Agent tools

Which files configure the coding agent and how to extend them. This repo is set up for Claude Code only. Instructions live in [AGENTS.md](../AGENTS.md), which [CLAUDE.md](../CLAUDE.md) imports, so another agent can be added later without rewriting them.

## Claude Code
| File | Purpose |
| :-- | :-- |
| [CLAUDE.md](../CLAUDE.md) | Imports AGENTS.md (an import instead of a symlink, because symlinks break on Windows checkouts), plus notes only Claude Code needs |
| [AGENTS.md](../AGENTS.md) | The map, commands and boundaries |
| [REVIEW.md](../REVIEW.md) | What the reviewer subagent and people report and skip |
| [.claude/settings.json](../.claude/settings.json) | Permissions, sandbox and the guard hook |
| [.claude/agents/reviewer.md](../.claude/agents/reviewer.md) | Fresh-context review subagent |
| `.claude/skills/` | Procedures loaded on demand: [exec-plan](../.claude/skills/exec-plan/SKILL.md), [doc-gardening](../.claude/skills/doc-gardening/SKILL.md) |
| [scripts/agent-hooks/guard-tool-use.mjs](../scripts/agent-hooks/guard-tool-use.mjs) | Blocks edits to `.env`, keys, lockfiles and `.git/`, and commands that skip hooks, force-push or touch `.env` |

**Notes:** the sandbox works on macOS, Linux and WSL2; on native Windows, commands run unsandboxed and the permission rules and hook still apply. Personal settings go in `.claude/settings.local.json`, which git ignores. To scope rules to one folder, add a nested `AGENTS.md` there.

**CI:** no agent runs in CI. To add Claude review on pull requests later, run `/install-github-app` in Claude Code and follow the rules in [SECURITY.md](SECURITY.md#agents-in-ci).

## Adding another agent
Point it at AGENTS.md rather than writing a second instruction file, keep `.env` and keys out of its context with its ignore file or settings, and give it the guard hook if it supports hooks. If it reads skills from a different folder, decide which folder is the source and mirror the other with a checked script.

## Optional additions
- **MCP servers:** add them in `.mcp.json` and give each the narrowest scope that works. Every server's tools cost context, and every server is code you run.
- **Agent telemetry:** Claude Code exports OpenTelemetry when `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an OTLP endpoint are set. Put them in user or managed settings, not the repo, and leave prompt and tool-content logging off: it sends source code to the telemetry backend.
- **Harder verification gate:** a Claude Code `Stop` hook that runs `pnpm verify` blocks a turn from ending while checks fail. It is slower and costs more per session; add it when agents often stop before verifying.
