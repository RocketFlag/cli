import { describe, expect, it, vi } from "vitest";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
  RocketFlagApiError,
  RocketFlagManagementClient,
  RocketFlagNetworkError,
  type CliSessionUser,
  type PublicFlag,
  type PublicProject,
  type TokenInfo,
} from "../src/index.js";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

describe("@rocketflag/management", () => {
  describe("environment helper functions", () => {
    const singleEnvToken: TokenInfo = {
      id: "Tk1",
      name: "Single Env Token",
      project: {
        id: "Pj1",
        name: "Single Project",
        environments: [],
      },
      permission: "write",
      environments: [],
      expiresAt: null,
    };

    const unrestrictedMultiEnvToken: TokenInfo = {
      id: "Tk2",
      name: "All Envs Token",
      project: {
        id: "Pj2",
        name: "Multi Project",
        environments: ["dev", "staging", "prod"],
      },
      permission: "write",
      environments: [],
      expiresAt: 1798675200000,
    };

    const restrictedMultiEnvToken: TokenInfo = {
      id: "Tk3",
      name: "Staging + Stale Token",
      project: {
        id: "Pj2",
        name: "Multi Project",
        environments: ["dev", "staging", "prod"],
      },
      permission: "read",
      environments: ["staging", "old-qa"],
      expiresAt: 0,
    };

    it("detects single-environment vs multi-environment projects", () => {
      expect(isMultiEnvironmentProject(singleEnvToken)).toBe(false);
      expect(isMultiEnvironmentProject(unrestrictedMultiEnvToken)).toBe(true);
      expect(isMultiEnvironmentProject(restrictedMultiEnvToken)).toBe(true);
    });

    it("computes allowed environments for single-env, unrestricted, and restricted tokens", () => {
      expect(getAllowedEnvironments(singleEnvToken)).toEqual([]);
      expect(getAllowedEnvironments(unrestrictedMultiEnvToken)).toEqual(["dev", "staging", "prod"]);
      expect(getAllowedEnvironments(restrictedMultiEnvToken)).toEqual(["staging"]);
    });

    it("computes stale token environments when project environment labels change", () => {
      expect(getStaleTokenEnvironments(singleEnvToken)).toEqual([]);
      expect(getStaleTokenEnvironments(unrestrictedMultiEnvToken)).toEqual([]);
      expect(getStaleTokenEnvironments(restrictedMultiEnvToken)).toEqual(["old-qa"]);
    });

    it("handles user session TokenInfo without project or environments", () => {
      const userSessionWithoutProject: TokenInfo = {
        kind: "user",
        id: "Cs1",
        name: "MacBook Pro",
        expiresAt: 1798675200000,
        user: {
          id: "U1",
          email: "jk@example.com",
          name: "JK",
        },
      };
      expect(isMultiEnvironmentProject(userSessionWithoutProject)).toBe(false);
      expect(getAllowedEnvironments(userSessionWithoutProject)).toEqual([]);
      expect(getStaleTokenEnvironments(userSessionWithoutProject)).toEqual([]);

      const userSessionWithProject: TokenInfo = {
        ...userSessionWithoutProject,
        project: {
          id: "Pj2",
          name: "Multi Project",
          environments: ["dev", "prod"],
        },
        permission: "write",
      };
      expect(isMultiEnvironmentProject(userSessionWithProject)).toBe(true);
      expect(getAllowedEnvironments(userSessionWithProject)).toEqual(["dev", "prod"]);
      expect(getStaleTokenEnvironments(userSessionWithProject)).toEqual([]);
    });
  });

  describe("getToken()", () => {
    it("fetches single-environment token metadata from GET /api/v1/token", async () => {
      const tokenPayload: TokenInfo = {
        id: "TkSingle123",
        name: "CI Token",
        project: {
          id: "PjSingle123",
          name: "Storefront",
          environments: [],
        },
        permission: "write",
        environments: [],
        expiresAt: null,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(tokenPayload));

      const client = createManagementClient({
        token: "rf_secret_123",
        fetch: fetchMock,
      });

      const result = await client.getToken();
      expect(result).toEqual(tokenPayload);
      expect(isMultiEnvironmentProject(result)).toBe(false);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/token");
      expect(init?.method).toBe("GET");
    });

    it("fetches multi-environment token metadata from GET /api/v1/token", async () => {
      const tokenPayload: TokenInfo = {
        id: "TkMulti456",
        name: "Deploy Token",
        project: {
          id: "PjMulti456",
          name: "Platform",
          environments: ["dev", "prod"],
        },
        permission: "read",
        environments: ["dev"],
        expiresAt: 1798675200000,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(tokenPayload));

      const client = new RocketFlagManagementClient({
        token: "rf_secret_456",
        apiUrl: "https://custom.rocketflag.test///",
        fetch: fetchMock,
      });

      const result = await client.getToken();
      expect(result).toEqual(tokenPayload);
      expect(isMultiEnvironmentProject(result)).toBe(true);
      expect(getAllowedEnvironments(result)).toEqual(["dev"]);

      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://custom.rocketflag.test/api/v1/token");
    });

    it("fetches user session metadata from GET /api/v1/token", async () => {
      const userInfo: CliSessionUser = {
        id: "Usr_123",
        email: "jk@rocketflag.app",
        name: "JK Gunnink",
      };
      const userPayload: TokenInfo = {
        kind: "user",
        id: "Cs_123",
        name: "jk-laptop",
        expiresAt: 1798675200000,
        user: userInfo,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(userPayload));

      const client = createManagementClient({
        token: "rfu_secret_123",
        fetch: fetchMock,
      });

      const result = await client.getToken();
      expect(result).toEqual(userPayload);
      expect(result.kind).toBe("user");
      expect(result.user).toEqual(userInfo);
    });
  });

  describe("listProjects() and revokeSession()", () => {
    it("fetches accessible projects from GET /api/v1/projects", async () => {
      const projects: PublicProject[] = [
        {
          id: "Pj_1",
          name: "Personal App",
          organisationId: "",
          organisationName: "",
          environments: [],
          permission: "write",
        },
        {
          id: "Pj_2",
          name: "Platform",
          organisationId: "Org_1",
          organisationName: "Acme Corp",
          environments: ["dev", "prod"],
          permission: "read",
        },
      ];
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ projects }));

      const client = createManagementClient({
        token: "rfu_user_token",
        fetch: fetchMock,
      });

      const result = await client.listProjects();
      expect(result).toEqual(projects);

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/projects");
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer rfu_user_token");
    });

    it("revokes session via POST /api/v1/session/revoke and handles 204 No Content", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      const client = createManagementClient({
        token: "rfu_user_token",
        fetch: fetchMock,
      });

      await expect(client.revokeSession()).resolves.toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/session/revoke");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer rfu_user_token");
    });
  });

  describe("headers and authentication", () => {
    it("sends X-RocketFlag-Project on authenticated requests when projectId is set, and omits it when empty or unauthenticated", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ flags: [] }))
        .mockResolvedValueOnce(jsonResponse({ id: "Fg1", name: "flag-1", enabled: true }))
        .mockResolvedValueOnce(jsonResponse({ flags: [] }));

      const clientWithProject = createManagementClient({
        token: "rfu_user_token",
        projectId: "  Pj_Selected_1  ",
        fetch: fetchMock,
      });

      await clientWithProject.listFlags();
      const [, authInit] = fetchMock.mock.calls[0]!;
      expect(new Headers(authInit?.headers).get("X-RocketFlag-Project")).toBe("Pj_Selected_1");

      await clientWithProject.evaluateFlag("Fg1");
      const [, evalInit] = fetchMock.mock.calls[1]!;
      expect(new Headers(evalInit?.headers).get("X-RocketFlag-Project")).toBeNull();

      const clientEmptyProject = createManagementClient({
        token: "rfu_user_token",
        projectId: "   ",
        fetch: fetchMock,
      });
      await clientEmptyProject.listFlags();
      const [, emptyInit] = fetchMock.mock.calls[2]!;
      expect(new Headers(emptyInit?.headers).get("X-RocketFlag-Project")).toBeNull();
    });
    it("sends Authorization, User-Agent, and X-RocketFlag-Client on /api/v1/* requests", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse({ flags: [] }));

      const client = createManagementClient({
        token: "rf_test_token",
        clientName: "cli",
        clientVersion: "1.2.3",
        fetch: fetchMock,
      });

      await client.listFlags();

      const [, init] = fetchMock.mock.calls[0]!;
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer rf_test_token");
      expect(headers.get("X-RocketFlag-Client")).toBe("cli/1.2.3");
      expect(headers.get("User-Agent")).toBe(
        `rocketflag-cli/1.2.3 node/${process.versions.node} ${process.platform}-${process.arch}`,
      );
    });

    it("sends User-Agent and X-RocketFlag-Client WITHOUT Authorization on /v1/flags/:id evaluation requests", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        jsonResponse({ id: "flag_1", name: "new-checkout", enabled: true }),
      );

      const client = createManagementClient({
        token: "rf_secret_never_leak",
        fetch: fetchMock,
      });

      await client.evaluateFlag("flag_1");

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/v1/flags/flag_1");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("X-RocketFlag-Client")).toBe("management/1.0.0");
      expect(headers.get("User-Agent")).toBe(
        `rocketflag-management/1.0.0 node/${process.versions.node} ${process.platform}-${process.arch}`,
      );
    });
  });

  describe("listFlags()", () => {
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

    it("lists all flags without a query parameter when name is omitted", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ flags: [sampleFlag] }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const flags = await client.listFlags();

      expect(flags).toEqual([sampleFlag]);
      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags");
    });

    it("appends ?name= filter when name is provided", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ flags: [sampleFlag] }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const flags = await client.listFlags({ name: "new-checkout" });

      expect(flags).toEqual([sampleFlag]);
      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags?name=new-checkout");
    });
  });

  describe("getFlag()", () => {
    it("fetches a flag without env parameter", async () => {
      const groupFlag: PublicFlag = {
        id: "Gp1",
        name: "search-v2",
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
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(groupFlag));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.getFlag("Gp1");

      expect(result).toEqual(groupFlag);
      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags/Gp1");
    });

    it("fetches a projected flag with ?env= and encodes special characters in id", async () => {
      const projectedFlag: PublicFlag = {
        id: "Gp1",
        name: "search-v2",
        kind: "groupflag",
        environment: "staging",
        enabled: true,
        trafficPercentage: 100,
        cohorts: ["qa"],
        audienceId: "aud_1",
        updatedAt: 1790730000000,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(projectedFlag));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.getFlag("Gp/1", { env: "staging" });

      expect(result).toEqual(projectedFlag);
      const [url] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags/Gp%2F1?env=staging");
    });
  });

  describe("createFlag()", () => {
    it("creates a single-environment flag and omits undefined fields from the JSON body", async () => {
      const createdFlag: PublicFlag = {
        id: "FgNew",
        name: "dark-mode",
        kind: "flag",
        enabled: true,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(createdFlag, 201));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.createFlag({
        name: "dark-mode",
        enabled: true,
        description: undefined,
        tags: undefined,
        trafficPercentage: undefined,
      });

      expect(result).toEqual(createdFlag);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags");
      expect(init?.method).toBe("POST");
      const sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(sentBody).toEqual({
        name: "dark-mode",
        enabled: true,
      });
      expect("description" in sentBody).toBe(false);
      expect("tags" in sentBody).toBe(false);
      expect("trafficPercentage" in sentBody).toBe(false);
    });

    it("creates a multi-environment flag with per-environment initial state and omits undefined nested keys", async () => {
      const createdGroupFlag: PublicFlag = {
        id: "GpNew",
        name: "ai-assistant",
        kind: "groupflag",
        environments: {
          dev: {
            enabled: true,
            trafficPercentage: 100,
            cohorts: ["internal"],
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
        .mockResolvedValueOnce(jsonResponse(createdGroupFlag, 201));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.createFlag({
        name: "ai-assistant",
        description: "Enable AI assistant",
        tags: ["ai", "beta"],
        environments: {
          dev: { enabled: true, cohorts: ["internal"], trafficPercentage: undefined },
          prod: { enabled: false },
        },
      });

      expect(result).toEqual(createdGroupFlag);
      const [, init] = fetchMock.mock.calls[0]!;
      const sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(sentBody).toEqual({
        name: "ai-assistant",
        description: "Enable AI assistant",
        tags: ["ai", "beta"],
        environments: {
          dev: { enabled: true, cohorts: ["internal"] },
          prod: { enabled: false },
        },
      });
    });
  });

  describe("patchFlag()", () => {
    it("patches flag state including audienceId: null to clear an audience and passes ?env=", async () => {
      const patchedFlag: PublicFlag = {
        id: "Gp1",
        name: "new-checkout",
        kind: "groupflag",
        environment: "staging",
        enabled: true,
        trafficPercentage: 75,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790735000000,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: patchedFlag }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.patchFlag(
        "Gp1",
        {
          enabled: true,
          trafficPercentage: 75,
          audienceId: null,
          cohorts: undefined,
        },
        { env: "staging" },
      );

      expect(result).toEqual({ changed: true, flag: patchedFlag });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe("https://api.rocketflag.app/api/v1/flags/Gp1?env=staging");
      expect(init?.method).toBe("PATCH");
      const sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(sentBody).toEqual({
        enabled: true,
        trafficPercentage: 75,
        audienceId: null,
      });
      expect("cohorts" in sentBody).toBe(false);
    });
  });

  describe("toggleFlag()", () => {
    it("flips false -> true on a single-environment flag via getFlag then patchFlag", async () => {
      const initialFlag: PublicFlag = {
        id: "Fg1",
        name: "new-checkout",
        kind: "flag",
        enabled: false,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const updatedFlag: PublicFlag = {
        ...initialFlag,
        enabled: true,
        updatedAt: 1790731000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(initialFlag))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: updatedFlag }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.toggleFlag("Fg1");

      expect(result).toEqual({
        previous: false,
        current: true,
        changed: true,
        flag: updatedFlag,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]![1]?.method).toBe("GET");
      expect(fetchMock.mock.calls[1]![1]?.method).toBe("PATCH");
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ enabled: true });
    });

    it("flips true -> false on a projected multi-environment flag when env is provided", async () => {
      const initialFlag: PublicFlag = {
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
      const updatedFlag: PublicFlag = {
        ...initialFlag,
        enabled: false,
        updatedAt: 1790731000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(initialFlag))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: updatedFlag }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.toggleFlag("Gp1", { env: "prod" });

      expect(result).toEqual({
        previous: true,
        current: false,
        changed: true,
        flag: updatedFlag,
      });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        "https://api.rocketflag.app/api/v1/flags/Gp1?env=prod",
      );
      expect(String(fetchMock.mock.calls[1]![0])).toBe(
        "https://api.rocketflag.app/api/v1/flags/Gp1?env=prod",
      );
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ enabled: false });
    });

    it("uses explicit enabled value when provided even if already in that state", async () => {
      const initialFlag: PublicFlag = {
        id: "Fg1",
        name: "new-checkout",
        kind: "flag",
        enabled: true,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(initialFlag))
        .mockResolvedValueOnce(jsonResponse({ changed: false, flag: initialFlag }));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.toggleFlag("Fg1", { enabled: true });

      expect(result).toEqual({
        previous: true,
        current: true,
        changed: false,
        flag: initialFlag,
      });
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ enabled: true });
    });

    it("rejects toggling an unprojected multi-environment groupflag without env before patching", async () => {
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
        .mockResolvedValueOnce(jsonResponse(unprojectedGroupFlag));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });

      await expect(client.toggleFlag("Gp1")).rejects.toThrow(
        "Cannot toggle a multi-environment flag without specifying an environment (env).",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("evaluateFlag()", () => {
    it("constructs query parameters for env, cohort, targetingKey, and attributes", async () => {
      const evalResult = { id: "Fg1", name: "new-checkout", enabled: true };
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(jsonResponse(evalResult));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });
      const result = await client.evaluateFlag("Fg1", {
        env: "prod_eu-1",
        cohort: "vip",
        targetingKey: "user_42",
        attributes: {
          plan: "enterprise",
          seats: 25,
          betaOptIn: true,
        },
      });

      expect(result).toEqual(evalResult);
      const [url] = fetchMock.mock.calls[0]!;
      const parsed = new URL(String(url));
      expect(parsed.origin + parsed.pathname).toBe("https://api.rocketflag.app/v1/flags/Fg1");
      expect(parsed.searchParams.get("env")).toBe("prod_eu-1");
      expect(parsed.searchParams.get("cohort")).toBe("vip");
      expect(parsed.searchParams.get("targetingKey")).toBe("user_42");
      expect(parsed.searchParams.get("plan")).toBe("enterprise");
      expect(parsed.searchParams.get("seats")).toBe("25");
      expect(parsed.searchParams.get("betaOptIn")).toBe("true");
    });

    it("rejects invalid env names locally before calling fetch", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>();
      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });

      await expect(client.evaluateFlag("Fg1", { env: "invalid env!" })).rejects.toThrow(
        /env/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("parses { error, detail, docs } into RocketFlagApiError and classifies 401, 402, 403, 404, 429", async () => {
      const client401 = createManagementClient({
        token: "rf_bad",
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
          jsonResponse(
            {
              error: "Invalid bearer token",
              detail: "The token was not recognised or has expired",
              docs: "https://docs.rocketflag.app/api/management#auth",
            },
            401,
          ),
        ),
      });

      await expect(client401.getToken()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(RocketFlagApiError);
        const apiErr = err as RocketFlagApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.errorTitle).toBe("Invalid bearer token");
        expect(apiErr.detail).toBe("The token was not recognised or has expired");
        expect(apiErr.docs).toBe("https://docs.rocketflag.app/api/management#auth");
        expect(apiErr.isUnauthorizedError()).toBe(true);
        expect(apiErr.isPaymentRequiredError()).toBe(false);
        expect(apiErr.isReadOnlyTokenError()).toBe(false);
        expect(apiErr.isEnvironmentForbiddenError()).toBe(false);
        expect(apiErr.isNotFoundError()).toBe(false);
        expect(apiErr.isRateLimitedError()).toBe(false);
        return true;
      });

      const readOnlyErr = new RocketFlagApiError(403, {
        error: "Insufficient permission",
        detail: "This endpoint requires a token with write permission",
        docs: "https://docs.rocketflag.app/api/management#auth",
      });
      expect(readOnlyErr.isReadOnlyTokenError()).toBe(true);
      expect(readOnlyErr.isEnvironmentForbiddenError()).toBe(false);

      const envForbiddenErr = new RocketFlagApiError(403, {
        error: "Environment not permitted",
        detail: 'This token is not allowed to access environment "production"',
        docs: "https://docs.rocketflag.app/api/management#auth",
      });
      expect(envForbiddenErr.isReadOnlyTokenError()).toBe(false);
      expect(envForbiddenErr.isEnvironmentForbiddenError()).toBe(true);

      const paymentErr = new RocketFlagApiError(402, {
        error: "Plan required",
        detail: "The Management API requires a Teams or Enterprise plan",
      });
      expect(paymentErr.isPaymentRequiredError()).toBe(true);

      const notFoundErr = new RocketFlagApiError(404, {
        error: "Flag not found",
        detail: "No flag with id FgMissing exists in this project",
      });
      expect(notFoundErr.isNotFoundError()).toBe(true);

      const rateLimitErr = new RocketFlagApiError(429, {
        error: "Rate limit exceeded",
        detail: "Too many requests",
      });
      expect(rateLimitErr.isRateLimitedError()).toBe(true);
    });

    it("falls back cleanly when an error response body is not valid JSON", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        new Response("Bad Gateway", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "Content-Type": "text/plain" },
        }),
      );

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });

      await expect(client.listFlags()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(RocketFlagApiError);
        const apiErr = err as RocketFlagApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.errorTitle).toContain("502");
        expect(apiErr.detail).toContain("Bad Gateway");
        return true;
      });
    });

    it("wraps fetch rejections in RocketFlagNetworkError", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));

      const client = createManagementClient({ token: "rf_tok", fetch: fetchMock });

      await expect(client.getToken()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(RocketFlagNetworkError);
        const netErr = err as RocketFlagNetworkError;
        expect(netErr.message).toContain("fetch failed: ECONNREFUSED");
        return true;
      });
    });
  });
});
