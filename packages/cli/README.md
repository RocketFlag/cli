# `rocketflag` CLI

Official command-line interface for managing and evaluating [RocketFlag](https://rocketflag.app) feature flags from your terminal or CI pipelines.

## Installation & Quickstart

Requires **Node.js 22 or newer**. Run directly with `npx rocketflag` or install globally with `npm install -g rocketflag`.

```bash
# 1. Authenticate with your project API token (rf_...)
npx rocketflag login

# 2. Initialise .rocketflag.json in your repository
npx rocketflag init

# 3. Create a feature flag (requires a Write token)
npx rocketflag flags create checkout_v2 --enabled

# 4. Toggle the flag on or off
npx rocketflag flags toggle <flag_id>

# 5. Evaluate the flag via the public Evaluation API
npx rocketflag flags eval <flag_id>
```

## Commands

### `rocketflag login`

Validates a project API token (`rf_...`) against `GET /api/v1/token` and saves it to `~/.config/rocketflag/config.json` with directory permissions `0700` and file permissions `0600`.

```bash
rocketflag login [--token <rf_...>] [--api-url <url>] [--json]
```

### `rocketflag whoami`

Displays the active API token, permission (`read` or `write`), project name and ID, single-environment vs multi-environment mode, allowed environments, and any stale environment warnings.

```bash
rocketflag whoami [--token <rf_...>] [--api-url <url>] [--json]
```

### `rocketflag init`

Writes `.rocketflag.json` in the current working directory with `{ "projectId": "..." }` (and `"defaultEnv"` on multi-environment projects). Never writes tokens or secrets to `.rocketflag.json`.

```bash
rocketflag init [--env <env>] [--token <rf_...>] [--api-url <url>] [--json]
```

### `rocketflag flags list`

Lists all flags in the project or filters by exact flag name.

```bash
rocketflag flags list [--name <exact>] [--token <rf_...>] [--api-url <url>] [--json]
```

### `rocketflag flags get <id>`

Fetches details for a single flag by ID.

```bash
rocketflag flags get <id> [--env <env>] [--token <rf_...>] [--api-url <url>] [--json]
```

### `rocketflag flags create <name>`

Creates a new feature flag. Requires a **Write** token.

```bash
rocketflag flags create <name> \
  [--description <text>] \
  [--tag <tag>...] \
  [--enabled] \
  [--percentage <0-100>] \
  [--cohort <cohort>...] \
  [--audience <audienceId>] \
  [--env <env>] \
  [--json]
```

### `rocketflag flags toggle <id>`

Flips a flag's `enabled` state (or sets it explicitly with `--on` or `--off`). Requires a **Write** token.

```bash
rocketflag flags toggle <id> [--env <env>] [--on | --off] [--json]
```

### `rocketflag flags eval <id>`

Evaluates a flag against the public Evaluation API (`GET /v1/flags/:id`).

```bash
rocketflag flags eval <id> \
  [--env <env>] \
  [--cohort <cohort>] \
  [--key <targetingKey>] \
  [--attr <key=value>...] \
  [--json]
```

## Configuration & Precedence

- **API Token:** `--token` > `ROCKETFLAG_TOKEN` > `~/.config/rocketflag/config.json` (`XDG_CONFIG_HOME` and `ROCKETFLAG_CONFIG_DIR` are respected).
- **Target Environment:** `--env` > `ROCKETFLAG_ENV` > `.rocketflag.json` (`defaultEnv`, discovered in the current or parent directories).
- **API URL:** `--api-url` > `ROCKETFLAG_API_URL` > `~/.config/rocketflag/config.json` (`apiUrl`) > `https://api.rocketflag.app`.

## JSON Output & Exit Codes

Pass `--json` to any command for machine-readable JSON output on `stdout`. Diagnostics and errors are written to `stderr`.

| Exit Code | Constant | Meaning |
| --- | --- | --- |
| `0` | `EXIT_OK` | Command succeeded. |
| `1` | `EXIT_ERROR` | Network error, `404` not found, or unexpected API error. |
| `2` | `EXIT_USAGE` | Invalid CLI arguments, missing required flags, or invalid `--env` usage. |
| `3` | `EXIT_AUTH` | Missing token, `401` unauthorised, `403` read-only token on write command, or `403` forbidden environment. |

## License

MIT
