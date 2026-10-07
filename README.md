# BeanQuery

A personal database of the coffee beans I buy: roaster, roast, water, variety, altitude (masl) and more, plus how I rated each one. It will run as a small web app on a Hetzner server, backed by SQLite.

## Develop
Needs Node 26 (`.nvmrc`) and pnpm 12 (pinned in `package.json`; install it with `npm install -g pnpm@12`).

```bash
pnpm install          # install
pnpm run setup        # once per clone: enables the git hooks
pnpm verify           # every check a change must pass
```

## Contributing, by people and coding agents
[AGENTS.md](AGENTS.md) is the map: it says which doc to read for which task, the commands, and the boundaries. How the docs are kept true is in [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md), and how Claude Code is set up is in [docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md).
