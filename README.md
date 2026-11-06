# RocketFlag CLI, MCP Server, and Management Client

Official command-line interface, Model Context Protocol (MCP) server, and TypeScript Management API client for [RocketFlag](https://rocketflag.app).

## Packages in this Monorepo

| Package | Description |
| --- | --- |
| [`@rocketflag/cli`](./packages/cli) | Command-line interface (`rocketflag` / `npx @rocketflag/cli`) for authenticating, initialising repositories, and managing or evaluating feature flags from the terminal or CI pipelines. |
| [`@rocketflag/mcp`](./packages/mcp) | Model Context Protocol (MCP) server (`npx -y @rocketflag/mcp`) exposing RocketFlag tools to AI coding assistants such as Claude Code, Cursor, and Antigravity. |
| [`@rocketflag/management`](./packages/management) | Zero-dependency TypeScript client for the RocketFlag Management API (`/api/v1`) and public Evaluation API (`/v1/flags/:id`). |

## Quickstart: First Flag in 2 Minutes

Requires **Node.js 22 or newer** and a project API token (`rf_...`) created in the [RocketFlag console](https://console.rocketflag.app) under **Project > Tokens**.

```bash
# Install globally (or run with npx @rocketflag/cli)
npm install -g @rocketflag/cli

# 1. Authenticate and save your token to ~/.config/rocketflag/config.json (0600)
rocketflag login

# 2. Initialise .rocketflag.json in your repository
rocketflag init

# 3. Create a feature flag (requires a Write token; enables in defaultEnv at 100% rollout)
rocketflag flags create checkout_v2 --enabled

# 4. Toggle the flag on or off (pass <id> from the create output)
rocketflag flags toggle <flag_id>

# 5. Evaluate the flag via the public Evaluation API
rocketflag flags eval <flag_id>
```

## AI Agent Integration (`@rocketflag/mcp`)

Add the RocketFlag MCP server to Claude Code with a single command:

```bash
claude mcp add rocketflag -e ROCKETFLAG_TOKEN=rf_your_token_here -- npx -y @rocketflag/mcp
```

See [`packages/mcp/README.md`](./packages/mcp/README.md) for Cursor and Antigravity configuration examples and tool documentation.

## Repository Development

This workspace uses npm workspaces and TypeScript project references (`tsc -b`).

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

## Documentation

Full guides and API reference are available at [docs.rocketflag.app](https://docs.rocketflag.app/dev/cli-and-mcp/).

## License

MIT
