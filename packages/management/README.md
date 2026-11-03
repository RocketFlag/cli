# `@rocketflag/management`

Zero-dependency TypeScript client for the [RocketFlag](https://rocketflag.app) Management API (`/api/v1`) and public Evaluation API (`/v1/flags/:id`). Built on the native `fetch` API in Node.js 22+.

## Installation

```bash
npm install @rocketflag/management
```

## Usage

```ts
import {
  createManagementClient,
  isMultiEnvironmentProject,
  getAllowedEnvironments,
  RocketFlagApiError,
} from "@rocketflag/management";

const client = createManagementClient({
  token: process.env.ROCKETFLAG_TOKEN!,
});

// 1. Inspect the active token and project configuration
const tokenInfo = await client.getToken();
console.log(tokenInfo.project.name, tokenInfo.permission);

if (isMultiEnvironmentProject(tokenInfo)) {
  console.log("Allowed environments:", getAllowedEnvironments(tokenInfo));
}

// 2. List flags (optionally filter by exact name)
const flags = await client.listFlags({ name: "checkout_v2" });

// 3. Create a flag (requires a Write token)
const created = await client.createFlag({
  name: "checkout_v2",
  description: "New checkout flow",
  tags: ["checkout"],
  enabled: true,
  trafficPercentage: 50,
});

// 4. Patch or toggle a flag
const toggled = await client.toggleFlag(created.id, {
  enabled: false,
});

// 5. Evaluate a flag against the public Evaluation API (/v1/flags/:id)
const evaluation = await client.evaluateFlag(created.id, {
  cohort: "user_123",
  targetingKey: "user_123",
  attributes: { plan: "pro", beta: true },
});
console.log(evaluation.enabled);
```

## Multi-Environment Projects

On multi-environment projects (`tokenInfo.project.environments.length > 0`), pass an `env` option when fetching, patching, toggling, or evaluating a flag, and use the `environments` map when creating a flag with initial state:

```ts
const flag = await client.createFlag({
  name: "new_billing",
  environments: {
    staging: { enabled: true, trafficPercentage: 100 },
    production: { enabled: false, trafficPercentage: 0 },
  },
});

await client.toggleFlag(flag.id, { env: "staging", enabled: false });
const stageEval = await client.evaluateFlag(flag.id, { env: "staging" });
```

## Error Handling

API errors throw `RocketFlagApiError` with status code, RFC 7807 / RocketFlag error envelope details (`errorTitle`, `detail`, `docs`), and helper predicates:

- `err.isUnauthorizedError()`: HTTP `401` invalid, revoked, or expired token.
- `err.isReadOnlyTokenError()`: HTTP `403` when a read-only token attempts a write operation (`createFlag`, `patchFlag`, `toggleFlag`).
- `err.isEnvironmentForbiddenError()`: HTTP `403` when a token is restricted from accessing the requested environment.

Network failures throw `RocketFlagNetworkError` with the underlying `cause`.

## License

MIT
