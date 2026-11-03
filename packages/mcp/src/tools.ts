import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RocketFlagManagementClient } from "@rocketflag/management";
import { z } from "zod";
import {
  formatToolError,
  formatToolSuccess,
  formatWhoamiPayload,
} from "./format.js";

export function normalizeOptionalEnv(env?: string): string | undefined {
  if (env === undefined) {
    return undefined;
  }
  const trimmed = env.trim();
  return trimmed === "" ? undefined : trimmed;
}

const environmentPatchSchema = z.object({
  enabled: z.boolean().optional(),
  trafficPercentage: z.number().optional(),
  cohorts: z.array(z.string()).optional(),
  audienceId: z.string().nullable().optional(),
});

const contextValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export function registerRocketFlagTools(
  server: McpServer,
  client: RocketFlagManagementClient,
): void {
  server.registerTool(
    "whoami",
    {
      description:
        "Inspect the active RocketFlag API token, its project (ID, name, and whether it is single-environment or multi-environment), the token's permission (read or write), allowed environments, and any stale environment warnings. Call this tool first before creating, toggling, or evaluating flags so you know whether an 'env' parameter is required.",
      inputSchema: {},
    },
    async () => {
      try {
        const info = await client.getToken();
        return formatToolSuccess(formatWhoamiPayload(info));
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "list_flags",
    {
      description:
        "List feature flags in the RocketFlag project, optionally filtered by exact flag name.",
      inputSchema: {
        name: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const name = normalizeOptionalEnv(args.name);
        const flags = await client.listFlags({ name });
        return formatToolSuccess({
          count: flags.length,
          flags,
        });
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "get_flag",
    {
      description:
        "Fetch a single feature flag by its ID. On multi-environment projects, pass 'env' to project the flag to a specific environment.",
      inputSchema: {
        id: z.string(),
        env: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const env = normalizeOptionalEnv(args.env);
        const flag = await client.getFlag(args.id, { env });
        return formatToolSuccess(flag);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "create_flag",
    {
      description:
        "Create a new feature flag in the RocketFlag project. Requires a Write token. On single-environment projects, use top-level 'enabled', 'trafficPercentage', 'cohorts', or 'audienceId'. On multi-environment projects, pass 'environments' keyed by environment name (omitted environments start disabled at 0%).",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        enabled: z.boolean().optional(),
        trafficPercentage: z.number().optional(),
        cohorts: z.array(z.string()).optional(),
        audienceId: z.string().nullable().optional(),
        environments: z.record(z.string(), environmentPatchSchema).optional(),
      },
    },
    async (args) => {
      try {
        const flag = await client.createFlag(args);
        return formatToolSuccess(flag);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "toggle_flag",
    {
      description:
        "Toggle a feature flag on or off (or set an explicit 'enabled' boolean). Requires a Write token. On multi-environment projects, 'env' is required.",
      inputSchema: {
        id: z.string(),
        env: z.string().optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        const env = normalizeOptionalEnv(args.env);
        const result = await client.toggleFlag(args.id, {
          env,
          enabled: args.enabled,
        });
        return formatToolSuccess({
          id: result.flag.id,
          name: result.flag.name,
          environment: result.flag.environment ?? env ?? null,
          previous: result.previous,
          current: result.current,
          changed: result.changed,
          flag: result.flag,
        });
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "evaluate_flag",
    {
      description:
        "Evaluate whether a feature flag is enabled for a given context via the public RocketFlag Evaluation API (/v1/flags/:id). Supports optional 'env', 'cohort', 'targetingKey', and custom audience 'attributes'.",
      inputSchema: {
        id: z.string(),
        env: z.string().optional(),
        cohort: contextValueSchema.optional(),
        targetingKey: z.union([z.string(), z.number()]).optional(),
        attributes: z.record(z.string(), contextValueSchema).optional(),
      },
    },
    async (args) => {
      try {
        const env = normalizeOptionalEnv(args.env);
        const result = await client.evaluateFlag(args.id, {
          env,
          cohort: args.cohort,
          targetingKey: args.targetingKey,
          attributes: args.attributes,
        });
        return formatToolSuccess(result);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );
}
