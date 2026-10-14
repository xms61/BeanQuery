# BeanQuery

An invite-only coffee log for a few friends. Each person records the coffee bags they buy: roaster, roast, water, variety, altitude (masl) and more, with a rest-and-freeze plan and their rating.
- **Accounts:** anonymous, opened with an invite code and signed into with an account number. There is no email or password.
- **Sharing:** each account's bags, plans and notes stay private. The bean facts go into a shared pool, unless a bean is kept private, with a collective rating that names no account.

It runs as a small web app on a Hetzner server, backed by SQLite.

## Develop
Needs Node 26 (`.nvmrc`) and pnpm 12 (pinned in `package.json`; install it with `npm install -g pnpm@12`).

```bash
pnpm install          # install
pnpm run setup        # once per clone: enables the git hooks
pnpm verify           # every check a change must pass
```

## Deploy
The app runs as a Docker image on a Hetzner VPS, behind Caddy. Setup, releases, backups and restore are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Contributing, by people and coding agents
[AGENTS.md](AGENTS.md) is the map: it says which doc to read for which task, the commands, and the boundaries. How the docs are kept true is in [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md), and how Claude Code is set up is in [docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md).
