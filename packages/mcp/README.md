# `@rocketflag/mcp`

Model Context Protocol (MCP) server for managing and evaluating [RocketFlag](https://rocketflag.app) feature flags from AI coding assistants such as Claude Code, Cursor, and Antigravity.

## Prerequisites

- **Node.js 22 or newer**
- A RocketFlag project API token (`rf_...`) created in the [RocketFlag console](https://console.rocketflag.app) under **Project > Tokens**. Use a **Write** token if you want your assistant to create or toggle flags, or a **Read** token for read-only inspection and evaluation.

## Setup

### Claude Code

```bash
claude mcp add rocketflag -e ROCKETFLAG_TOKEN=rf_your_token_here -- npx -y @rocketflag/mcp
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "rocketflag": {
      "command": "npx",
      "args": ["-y", "@rocketflag/mcp"],
      "env": {
        "ROCKETFLAG_TOKEN": "rf_your_token_here"
      }
    }
  }
}
```

### Antigravity (`mcp_config.json`)

```json
{
  "mcpServers": {
    "rocketflag": {
      "command": "npx",
      "args": ["-y", "@rocketflag/mcp"],
      "env": {
        "ROCKETFLAG_TOKEN": "rf_your_token_here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ROCKETFLAG_TOKEN` | Yes | Project API token (`rf_...`). Must start with `rf_`. |
| `ROCKETFLAG_API_URL` | No | Override the RocketFlag API base URL (defaults to `https://api.rocketflag.app`). |

## Available MCP Tools

| Tool | Permission | Description |
| --- | --- | --- |
| `whoami` | Read / Write | Inspect the active API token, its project (`id`, `name`, `multiEnvironment`), permission (`read` or `write`), `allowedEnvironments`, and any `staleEnvironments`. Call this first before creating, toggling, or evaluating flags. |
| `list_flags` | Read / Write | List feature flags in the project, optionally filtered by exact `name`. |
| `get_flag` | Read / Write | Fetch a single feature flag by `id` (with optional `env` on multi-environment projects). |
| `create_flag` | Write | Create a feature flag (`name`, `description`, `tags`, single-env state fields, or multi-env `environments` map). |
| `toggle_flag` | Write | Toggle a feature flag on or off by `id` (with optional explicit `enabled` boolean and `env` on multi-environment projects). |
| `evaluate_flag` | Read / Write | Evaluate a feature flag via the public Evaluation API (`/v1/flags/:id`) with optional `env`, `cohort`, `targetingKey`, and custom `attributes`. |

## License

MIT
