import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createManagementClient,
  RocketFlagApiError,
  type PublicFlag,
  type TokenInfo,
} from "@rocketflag/management";
import { describe, expect, it, vi } from "vitest";
import {
  createRocketFlagMcpServer,
  formatMcpError,
  MISSING_TOKEN_MESSAGE,
  startRocketFlagMcpServer,
  validateRocketFlagToken,
} from "../src/index.js";

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

async function createConnectedTestHarness(fetchMock: typeof globalThis.fetch) {
  const managementClient = createManagementClient({
    token: "rf_test_token",
    fetch: fetchMock,
  });
  const mcpServer = createRocketFlagMcpServer(managementClient);
  const mcpClient = new Client({
    name: "rocketflag-mcp-test-client",
    version: "0.1.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcpServer.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return {
    mcpClient,
    mcpServer,
    close: async () => {
      await Promise.all([mcpClient.close(), mcpServer.close()]);
    },
  };
}

function getFirstTextBlock(
  result: Awaited<ReturnType<Client["callTool"]>>,
): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Expected CallToolResult with content array");
  }
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected first content block to be text");
  }
  return first.text;
}

describe("@rocketflag/mcp", () => {
  describe("tool registration and schemas", () => {
    it("registers all 6 tools with exact descriptions and input schemas", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>();
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const { tools } = await harness.mcpClient.listTools();
        expect(tools.map((t) => t.name)).toEqual([
          "whoami",
          "list_flags",
          "get_flag",
          "create_flag",
          "toggle_flag",
          "evaluate_flag",
        ]);

        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        expect(byName.whoami?.description).toBe(
          "Inspect the active RocketFlag API token, its project (ID, name, and whether it is single-environment or multi-environment), the token's permission (read or write), allowed environments, and any stale environment warnings. Call this tool first before creating, toggling, or evaluating flags so you know whether an 'env' parameter is required.",
        );
        expect(byName.whoami?.inputSchema.type).toBe("object");

        expect(byName.list_flags?.description).toBe(
          "List feature flags in the RocketFlag project, optionally filtered by exact flag name.",
        );
        expect(byName.list_flags?.inputSchema.properties).toHaveProperty("name");

        expect(byName.get_flag?.description).toBe(
          "Fetch a single feature flag by its ID. On multi-environment projects, pass 'env' to project the flag to a specific environment.",
        );
        expect(byName.get_flag?.inputSchema.properties).toHaveProperty("id");
        expect(byName.get_flag?.inputSchema.properties).toHaveProperty("env");
        expect(byName.get_flag?.inputSchema.required).toContain("id");

        expect(byName.create_flag?.description).toBe(
          "Create a new feature flag in the RocketFlag project. Requires a Write token. On single-environment projects, use top-level 'enabled', 'trafficPercentage', 'cohorts', or 'audienceId'. On multi-environment projects, pass 'environments' keyed by environment name (omitted environments start disabled at 0%).",
        );
        expect(byName.create_flag?.inputSchema.properties).toHaveProperty("name");
        expect(byName.create_flag?.inputSchema.properties).toHaveProperty(
          "environments",
        );
        expect(byName.create_flag?.inputSchema.required).toContain("name");

        expect(byName.toggle_flag?.description).toBe(
          "Toggle a feature flag on or off (or set an explicit 'enabled' boolean). Requires a Write token. On multi-environment projects, 'env' is required.",
        );
        expect(byName.toggle_flag?.inputSchema.properties).toHaveProperty("id");
        expect(byName.toggle_flag?.inputSchema.properties).toHaveProperty("env");
        expect(byName.toggle_flag?.inputSchema.properties).toHaveProperty(
          "enabled",
        );
        expect(byName.toggle_flag?.inputSchema.required).toContain("id");

        expect(byName.evaluate_flag?.description).toBe(
          "Evaluate whether a feature flag is enabled for a given context via the public RocketFlag Evaluation API (/v1/flags/:id). Supports optional 'env', 'cohort', 'targetingKey', and custom audience 'attributes'.",
        );
        expect(byName.evaluate_flag?.inputSchema.properties).toHaveProperty("id");
        expect(byName.evaluate_flag?.inputSchema.properties).toHaveProperty(
          "attributes",
        );
        expect(byName.evaluate_flag?.inputSchema.required).toContain("id");
      } finally {
        await harness.close();
      }
    });
  });

  describe("whoami tool", () => {
    it("inspects a single-environment write token", async () => {
      const tokenInfo: TokenInfo = {
        id: "TkSingle",
        name: "Single Env Write",
        project: {
          id: "PjSingle",
          name: "Storefront",
          environments: [],
        },
        permission: "write",
        environments: [],
        expiresAt: null,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(tokenInfo));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const result = await harness.mcpClient.callTool({
          name: "whoami",
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const text = getFirstTextBlock(result);
        const parsed = JSON.parse(text) as {
          id: string;
          multiEnvironment: boolean;
          allowedEnvironments: string[];
          staleEnvironments: string[];
          permission: string;
          summary: string;
          warnings: string[];
        };
        expect(parsed.id).toBe("TkSingle");
        expect(parsed.multiEnvironment).toBe(false);
        expect(parsed.allowedEnvironments).toEqual([]);
        expect(parsed.staleEnvironments).toEqual([]);
        expect(parsed.permission).toBe("write");
        expect(parsed.warnings).toEqual([]);
        expect(parsed.summary).toContain("single-environment");
      } finally {
        await harness.close();
      }
    });

    it("inspects a multi-environment write token", async () => {
      const tokenInfo: TokenInfo = {
        id: "TkMulti",
        name: "Multi Env Write",
        project: {
          id: "PjMulti",
          name: "Platform",
          environments: ["dev", "staging", "prod"],
        },
        permission: "write",
        environments: ["dev", "staging"],
        expiresAt: 1798675200000,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(tokenInfo));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const result = await harness.mcpClient.callTool({
          name: "whoami",
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const parsed = JSON.parse(getFirstTextBlock(result)) as {
          multiEnvironment: boolean;
          allowedEnvironments: string[];
          staleEnvironments: string[];
          summary: string;
          warnings: string[];
        };
        expect(parsed.multiEnvironment).toBe(true);
        expect(parsed.allowedEnvironments).toEqual(["dev", "staging"]);
        expect(parsed.staleEnvironments).toEqual([]);
        expect(parsed.warnings).toEqual([]);
        expect(parsed.summary).toContain("multi-environment");
      } finally {
        await harness.close();
      }
    });

    it("surfaces a read-only warning when token permission is read", async () => {
      const tokenInfo: TokenInfo = {
        id: "TkRead",
        name: "Read Only Token",
        project: {
          id: "Pj1",
          name: "Storefront",
          environments: [],
        },
        permission: "read",
        environments: [],
        expiresAt: null,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(tokenInfo));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const result = await harness.mcpClient.callTool({
          name: "whoami",
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const text = getFirstTextBlock(result);
        const parsed = JSON.parse(text) as {
          permission: string;
          warnings: string[];
          summary: string;
        };
        expect(parsed.permission).toBe("read");
        expect(parsed.warnings.length).toBeGreaterThan(0);
        expect(text).toMatch(/read-only|read permission/i);
      } finally {
        await harness.close();
      }
    });

    it("surfaces a stale environment warning when token references removed project environments", async () => {
      const tokenInfo: TokenInfo = {
        id: "TkStale",
        name: "Stale Env Token",
        project: {
          id: "Pj2",
          name: "Platform",
          environments: ["dev", "prod"],
        },
        permission: "write",
        environments: ["dev", "old-qa"],
        expiresAt: null,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(tokenInfo));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const result = await harness.mcpClient.callTool({
          name: "whoami",
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
        const text = getFirstTextBlock(result);
        const parsed = JSON.parse(text) as {
          allowedEnvironments: string[];
          staleEnvironments: string[];
          warnings: string[];
          summary: string;
        };
        expect(parsed.allowedEnvironments).toEqual(["dev"]);
        expect(parsed.staleEnvironments).toEqual(["old-qa"]);
        expect(parsed.warnings.some((w) => w.includes("old-qa"))).toBe(true);
        expect(parsed.summary).toContain("old-qa");
      } finally {
        await harness.close();
      }
    });
  });

  describe("list_flags, get_flag, create_flag, toggle_flag, evaluate_flag tools", () => {
    const sampleFlag: PublicFlag = {
      id: "Fg1",
      name: "new-checkout",
      kind: "flag",
      enabled: true,
      trafficPercentage: 50,
      cohorts: ["beta"],
      audienceId: null,
      updatedAt: 1790726400000,
    };

    it("lists flags with and without name filter", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ flags: [sampleFlag] }))
        .mockResolvedValueOnce(jsonResponse({ flags: [sampleFlag] }));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const unfiltered = await harness.mcpClient.callTool({
          name: "list_flags",
          arguments: {},
        });
        expect(unfiltered.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(unfiltered))).toEqual({
          count: 1,
          flags: [sampleFlag],
        });
        expect(String(fetchMock.mock.calls[0]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags",
        );

        const filtered = await harness.mcpClient.callTool({
          name: "list_flags",
          arguments: { name: "new-checkout" },
        });
        expect(filtered.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(filtered))).toEqual({
          count: 1,
          flags: [sampleFlag],
        });
        expect(String(fetchMock.mock.calls[1]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags?name=new-checkout",
        );
      } finally {
        await harness.close();
      }
    });

    it("gets a flag with and without env, and normalises blank env to undefined", async () => {
      const projectedFlag: PublicFlag = {
        ...sampleFlag,
        id: "Gp1",
        kind: "groupflag",
        environment: "staging",
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(sampleFlag))
        .mockResolvedValueOnce(jsonResponse(projectedFlag))
        .mockResolvedValueOnce(jsonResponse(sampleFlag));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const withoutEnv = await harness.mcpClient.callTool({
          name: "get_flag",
          arguments: { id: "Fg1" },
        });
        expect(withoutEnv.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(withoutEnv))).toEqual(sampleFlag);
        expect(String(fetchMock.mock.calls[0]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags/Fg1",
        );

        const withEnv = await harness.mcpClient.callTool({
          name: "get_flag",
          arguments: { id: "Gp1", env: "staging" },
        });
        expect(withEnv.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(withEnv))).toEqual(projectedFlag);
        expect(String(fetchMock.mock.calls[1]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags/Gp1?env=staging",
        );

        const withBlankEnv = await harness.mcpClient.callTool({
          name: "get_flag",
          arguments: { id: "Fg1", env: "   " },
        });
        expect(withBlankEnv.isError).toBeFalsy();
        expect(String(fetchMock.mock.calls[2]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags/Fg1",
        );
      } finally {
        await harness.close();
      }
    });

    it("creates single-environment and multi-environment flags", async () => {
      const createdSingle: PublicFlag = {
        id: "FgCreated",
        name: "dark-mode",
        kind: "flag",
        enabled: true,
        trafficPercentage: 100,
        cohorts: ["staff"],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const createdMulti: PublicFlag = {
        id: "GpCreated",
        name: "ai-search",
        kind: "groupflag",
        environments: {
          dev: {
            enabled: true,
            trafficPercentage: 100,
            cohorts: [],
            audienceId: null,
            updatedAt: 1790730000000,
          },
          prod: {
            enabled: false,
            trafficPercentage: 0,
            cohorts: [],
            audienceId: null,
            updatedAt: 1790730000000,
          },
        },
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(createdSingle, 201))
        .mockResolvedValueOnce(jsonResponse(createdMulti, 201));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const singleRes = await harness.mcpClient.callTool({
          name: "create_flag",
          arguments: {
            name: "dark-mode",
            enabled: true,
            trafficPercentage: 100,
            cohorts: ["staff"],
            audienceId: null,
          },
        });
        expect(singleRes.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(singleRes))).toEqual(createdSingle);
        expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
          name: "dark-mode",
          enabled: true,
          trafficPercentage: 100,
          cohorts: ["staff"],
          audienceId: null,
        });

        const multiRes = await harness.mcpClient.callTool({
          name: "create_flag",
          arguments: {
            name: "ai-search",
            description: "AI powered search",
            tags: ["ai", "search"],
            environments: {
              dev: { enabled: true, trafficPercentage: 100 },
              prod: { enabled: false, trafficPercentage: 0 },
            },
          },
        });
        expect(multiRes.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(multiRes))).toEqual(createdMulti);
        expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
          name: "ai-search",
          description: "AI powered search",
          tags: ["ai", "search"],
          environments: {
            dev: { enabled: true, trafficPercentage: 100 },
            prod: { enabled: false, trafficPercentage: 0 },
          },
        });
      } finally {
        await harness.close();
      }
    });

    it("toggles flags by flipping state or setting explicit enabled, and normalises blank env", async () => {
      const initialSingle: PublicFlag = {
        ...sampleFlag,
        enabled: false,
      };
      const flippedSingle: PublicFlag = {
        ...sampleFlag,
        enabled: true,
      };
      const initialMulti: PublicFlag = {
        id: "Gp1",
        name: "new-checkout",
        kind: "groupflag",
        environment: "prod",
        enabled: true,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const explicitMulti: PublicFlag = {
        ...initialMulti,
        enabled: false,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(initialSingle))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: flippedSingle }))
        .mockResolvedValueOnce(jsonResponse(initialMulti))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: explicitMulti }));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const flipRes = await harness.mcpClient.callTool({
          name: "toggle_flag",
          arguments: { id: "Fg1", env: "" },
        });
        expect(flipRes.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(flipRes))).toEqual({
          id: "Fg1",
          name: "new-checkout",
          environment: null,
          previous: false,
          current: true,
          changed: true,
          flag: flippedSingle,
        });
        expect(String(fetchMock.mock.calls[0]![0])).toBe(
          "https://api.rocketflag.app/api/v1/flags/Fg1",
        );

        const explicitRes = await harness.mcpClient.callTool({
          name: "toggle_flag",
          arguments: { id: "Gp1", env: "prod", enabled: false },
        });
        expect(explicitRes.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(explicitRes))).toEqual({
          id: "Gp1",
          name: "new-checkout",
          environment: "prod",
          previous: true,
          current: false,
          changed: true,
          flag: explicitMulti,
        });
      } finally {
        await harness.close();
      }
    });

    it("evaluates a flag with context attributes and normalises blank env to undefined", async () => {
      const evalPayload = { id: "Fg1", name: "new-checkout", enabled: true };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(evalPayload))
        .mockResolvedValueOnce(jsonResponse(evalPayload));
      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const res = await harness.mcpClient.callTool({
          name: "evaluate_flag",
          arguments: {
            id: "Fg1",
            env: "staging",
            cohort: "beta-testers",
            targetingKey: "user_99",
            attributes: {
              country: "AU",
              tier: 2,
              internal: true,
            },
          },
        });
        expect(res.isError).toBeFalsy();
        expect(JSON.parse(getFirstTextBlock(res))).toEqual(evalPayload);
        const calledUrl = new URL(String(fetchMock.mock.calls[0]![0]));
        expect(calledUrl.pathname).toBe("/v1/flags/Fg1");
        expect(calledUrl.searchParams.get("env")).toBe("staging");
        expect(calledUrl.searchParams.get("cohort")).toBe("beta-testers");
        expect(calledUrl.searchParams.get("targetingKey")).toBe("user_99");
        expect(calledUrl.searchParams.get("country")).toBe("AU");
        expect(calledUrl.searchParams.get("tier")).toBe("2");
        expect(calledUrl.searchParams.get("internal")).toBe("true");

        const blankEnvRes = await harness.mcpClient.callTool({
          name: "evaluate_flag",
          arguments: {
            id: "Fg1",
            env: "   ",
          },
        });
        expect(blankEnvRes.isError).toBeFalsy();
        const blankEnvUrl = new URL(String(fetchMock.mock.calls[1]![0]));
        expect(blankEnvUrl.searchParams.has("env")).toBe(false);
      } finally {
        await harness.close();
      }
    });
  });

  describe("actionable error handling", () => {
    it("formats read-only 403, environment-restricted 403, 401, 402, 404, 429, and missing env on multi-env toggle_flag with isError: true", async () => {
      const unprojectedGroupFlag: PublicFlag = {
        id: "Gp1",
        name: "new-checkout",
        kind: "groupflag",
        environments: {
          dev: {
            enabled: true,
            trafficPercentage: 100,
            cohorts: [],
            audienceId: null,
            updatedAt: 1790730000000,
          },
        },
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        // 1. Read-only 403
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Insufficient permission",
              detail: "This endpoint requires a token with write permission",
            },
            403,
          ),
        )
        // 2. Environment-restricted 403
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Environment not permitted",
              detail: 'Token cannot access environment "prod"',
            },
            403,
          ),
        )
        // 3. 401 Unauthorized
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Unauthorized",
              detail: "Invalid or expired bearer token",
            },
            401,
          ),
        )
        // 4. 402 Payment Required
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Subscription required",
              detail: "Trial has expired for this organisation",
            },
            402,
          ),
        )
        // 5. 404 Not Found
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Not Found",
              detail: "Flag FgMissing does not exist",
            },
            404,
          ),
        )
        // 6. 429 Rate Limited
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Too Many Requests",
              detail: "Rate limit exceeded for project",
            },
            429,
          ),
        )
        // 7. Missing env on multi-env toggle_flag
        .mockResolvedValueOnce(jsonResponse(unprojectedGroupFlag));

      const harness = await createConnectedTestHarness(fetchMock);

      try {
        const readOnlyRes = await harness.mcpClient.callTool({
          name: "create_flag",
          arguments: { name: "new-flag" },
        });
        expect(readOnlyRes.isError).toBe(true);
        expect(getFirstTextBlock(readOnlyRes)).toBe(
          "Permission denied (403): This RocketFlag API token has read-only permission. Ask the user to create a Write token in the RocketFlag console under Project > Tokens and update ROCKETFLAG_TOKEN.",
        );

        const envForbiddenRes = await harness.mcpClient.callTool({
          name: "get_flag",
          arguments: { id: "Gp1", env: "prod" },
        });
        expect(envForbiddenRes.isError).toBe(true);
        expect(getFirstTextBlock(envForbiddenRes)).toBe(
          'Environment not allowed (403): Token cannot access environment "prod". Call the \'whoami\' tool to see which environments this token is allowed to access.',
        );

        const unauthorizedRes = await harness.mcpClient.callTool({
          name: "whoami",
          arguments: {},
        });
        expect(unauthorizedRes.isError).toBe(true);
        expect(getFirstTextBlock(unauthorizedRes)).toBe(
          "Authentication failed (401): Invalid or expired bearer token. Check that ROCKETFLAG_TOKEN is a valid, unrevoked, non-expired 'rf_...' token.",
        );

        const paymentRes = await harness.mcpClient.callTool({
          name: "list_flags",
          arguments: {},
        });
        expect(paymentRes.isError).toBe(true);
        expect(getFirstTextBlock(paymentRes)).toBe(
          "Plan or trial lock (402): Trial has expired for this organisation. Ask the user to check their organisation's billing or subscription status in the RocketFlag console.",
        );

        const notFoundRes = await harness.mcpClient.callTool({
          name: "get_flag",
          arguments: { id: "FgMissing" },
        });
        expect(notFoundRes.isError).toBe(true);
        expect(getFirstTextBlock(notFoundRes)).toBe(
          "Not found (404): Flag FgMissing does not exist. Call 'list_flags' or 'whoami' to verify the flag ID and environment name.",
        );

        const rateLimitRes = await harness.mcpClient.callTool({
          name: "list_flags",
          arguments: {},
        });
        expect(rateLimitRes.isError).toBe(true);
        expect(getFirstTextBlock(rateLimitRes)).toBe(
          "Rate limited (429): Rate limit exceeded for project. Wait briefly before retrying.",
        );

        const missingEnvToggleRes = await harness.mcpClient.callTool({
          name: "toggle_flag",
          arguments: { id: "Gp1" },
        });
        expect(missingEnvToggleRes.isError).toBe(true);
        expect(getFirstTextBlock(missingEnvToggleRes)).toContain(
          "Cannot toggle a multi-environment flag without specifying an environment (env).",
        );
      } finally {
        await harness.close();
      }
    });

    it("formats other RocketFlagApiError instances with status, errorTitle, detail, and docs URL", () => {
      const apiErrWithDocs = new RocketFlagApiError(500, {
        error: "Internal Server Error",
        detail: "Unexpected database error",
        docs: "https://docs.rocketflag.app/errors#500",
      });
      const formatted = formatMcpError(apiErrWithDocs);
      expect(formatted).toContain("500");
      expect(formatted).toContain("Internal Server Error");
      expect(formatted).toContain("Unexpected database error");
      expect(formatted).toContain("https://docs.rocketflag.app/errors#500");
    });
  });

  describe("missing ROCKETFLAG_TOKEN validation helper", () => {
    it("validates ROCKETFLAG_TOKEN and writes actionable error to stderr + exits 1 when missing or blank", async () => {
      expect(() => validateRocketFlagToken({})).toThrow(MISSING_TOKEN_MESSAGE);
      expect(() =>
        validateRocketFlagToken({ ROCKETFLAG_TOKEN: "   " }),
      ).toThrow(MISSING_TOKEN_MESSAGE);
      expect(
        validateRocketFlagToken({ ROCKETFLAG_TOKEN: "  rf_valid_123  " }),
      ).toBe("rf_valid_123");

      const stderrChunks: string[] = [];
      let exitCode: number | undefined;
      const server = await startRocketFlagMcpServer({
        env: {},
        stderr: {
          write: (msg: string) => {
            stderrChunks.push(msg);
            return true;
          },
        },
        exit: (code: number) => {
          exitCode = code;
        },
      });

      expect(server).toBeNull();
      expect(exitCode).toBe(1);
      expect(stderrChunks.join("")).toContain(MISSING_TOKEN_MESSAGE);
    });
  });
});
