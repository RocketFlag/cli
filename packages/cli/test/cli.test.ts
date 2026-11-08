import { mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PublicFlag, TokenInfo } from "@rocketflag/management";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { saveRepoConfig, saveUserConfig } from "../src/config.js";
import {
  EXIT_AUTH,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  type CliIo,
} from "../src/output.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const singleEnvWriteToken: TokenInfo = {
  id: "TkSingleWrite",
  name: "Single Env Write Token",
  project: {
    id: "PjSingle1",
    name: "Storefront",
    environments: [],
  },
  permission: "write",
  environments: [],
  expiresAt: null,
};

const singleEnvReadToken: TokenInfo = {
  id: "TkSingleRead",
  name: "Single Env Read Token",
  project: {
    id: "PjSingle1",
    name: "Storefront",
    environments: [],
  },
  permission: "read",
  environments: [],
  expiresAt: 0,
};

const multiEnvWriteToken: TokenInfo = {
  id: "TkMultiWrite",
  name: "Multi Env Write Token",
  project: {
    id: "PjMulti1",
    name: "Platform",
    environments: ["dev", "staging", "prod"],
  },
  permission: "write",
  environments: [],
  expiresAt: 1798675200000,
};

const multiEnvStaleReadToken: TokenInfo = {
  id: "TkMultiStale",
  name: "Staging + Stale QA Token",
  project: {
    id: "PjMulti1",
    name: "Platform",
    environments: ["dev", "staging", "prod"],
  },
  permission: "read",
  environments: ["staging", "old-qa"],
  expiresAt: null,
};

describe("rocketflag CLI commands", () => {
  let tempRoot: string;
  let configDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempRoot = path.join(
      os.tmpdir(),
      `rocketflag-cli-cmd-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    configDir = path.join(tempRoot, "config");
    repoDir = path.join(tempRoot, "repo");
    await mkdir(repoDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function createHarness(overrides?: Partial<CliIo>) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
      env: {
        ROCKETFLAG_CONFIG_DIR: configDir,
        ...overrides?.env,
      },
      cwd: overrides?.cwd ?? repoDir,
      promptToken: overrides?.promptToken,
      promptSelectEnv: overrides?.promptSelectEnv,
      fetch: overrides?.fetch,
    };
    return {
      io,
      getStdout: () => stdout,
      getStderr: () => stderr,
    };
  }

  describe("login", () => {
    it("validates token via GET /api/v1/token and saves config with 0600 permissions", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(multiEnvWriteToken));
      const { io, getStdout, getStderr } = createHarness({ fetch: fetchMock });

      const code = await runCli(["login", "--token", "rf_valid_write"], io);

      expect(code).toBe(EXIT_OK);
      expect(getStderr()).toBe("");
      expect(getStdout()).toContain("Platform");
      expect(getStdout()).toContain("Multi Env Write Token");
      expect(getStdout()).toContain("write");

      const configFile = path.join(configDir, "config.json");
      const fileStat = await stat(configFile);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const saved = JSON.parse(await readFile(configFile, "utf8")) as {
        token: string;
      };
      expect(saved.token).toBe("rf_valid_write");
    });

    it("prints a friendly read-only notice and stale environment warning on login", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(multiEnvStaleReadToken));
      const { io, getStdout, getStderr } = createHarness({
        fetch: fetchMock,
        promptToken: async () => "rf_prompted_read",
      });

      const code = await runCli(["login"], io);

      expect(code).toBe(EXIT_OK);
      expect(getStdout()).toMatch(/read-only/i);
      expect(getStderr()).toContain("old-qa");
    });

    it("returns EXIT_AUTH (3) when token validation fails with 401", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Invalid bearer token",
            detail: "The token was not recognised or has expired",
          },
          401,
        ),
      );
      const { io, getStderr } = createHarness({ fetch: fetchMock });

      const code = await runCli(["login", "--token", "rf_invalid"], io);

      expect(code).toBe(EXIT_AUTH);
      expect(getStderr()).toContain("Invalid bearer token");
    });

    it("returns EXIT_USAGE (2) when no token is provided and no interactive prompt is available", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>();
      const { io, getStderr } = createHarness({ fetch: fetchMock });

      const code = await runCli(["login"], io);

      expect(code).toBe(EXIT_USAGE);
      expect(getStderr()).toMatch(/--token|ROCKETFLAG_TOKEN/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("whoami", () => {
    it("displays single-environment token details in human mode", async () => {
      await saveUserConfig(
        { token: "rf_saved_token" },
        { env: { ROCKETFLAG_CONFIG_DIR: configDir } },
      );
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(singleEnvWriteToken));
      const { io, getStdout } = createHarness({ fetch: fetchMock });

      const code = await runCli(["whoami"], io);

      expect(code).toBe(EXIT_OK);
      const out = getStdout();
      expect(out).toContain("Single Env Write Token");
      expect(out).toContain("TkSingleWrite");
      expect(out).toContain("Storefront");
      expect(out).toContain("PjSingle1");
      expect(out).toMatch(/single-environment/i);
    });

    it("displays multi-environment token details and stale environment warnings in human and --json modes", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(multiEnvStaleReadToken))
        .mockResolvedValueOnce(jsonResponse(multiEnvStaleReadToken));

      const humanHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_env_tok" },
      });
      const humanCode = await runCli(["whoami"], humanHarness.io);
      expect(humanCode).toBe(EXIT_OK);
      expect(humanHarness.getStdout()).toMatch(/multi-environment/i);
      expect(humanHarness.getStdout()).toContain("staging");
      expect(humanHarness.getStdout() + humanHarness.getStderr()).toContain(
        "Warning: token restricts to environment(s) [old-qa] which no longer exist on this project.",
      );

      const jsonHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_env_tok" },
      });
      const jsonCode = await runCli(["whoami", "--json"], jsonHarness.io);
      expect(jsonCode).toBe(EXIT_OK);
      const parsed = JSON.parse(jsonHarness.getStdout()) as {
        token: TokenInfo;
        multiEnvironment: boolean;
        allowedEnvironments: string[];
        staleEnvironments: string[];
      };
      expect(parsed.token).toEqual(multiEnvStaleReadToken);
      expect(parsed.multiEnvironment).toBe(true);
      expect(parsed.allowedEnvironments).toEqual(["staging"]);
      expect(parsed.staleEnvironments).toEqual(["old-qa"]);
    });
  });

  describe("init", () => {
    it("writes projectId without defaultEnv on a single-environment project and rejects --env with EXIT_USAGE", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => jsonResponse(singleEnvWriteToken));

      const badHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const badCode = await runCli(["init", "--env", "prod"], badHarness.io);
      expect(badCode).toBe(EXIT_USAGE);
      expect(badHarness.getStderr()).toContain(
        "Project 'Storefront' is a single-environment project and does not use --env.",
      );

      const okHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const okCode = await runCli(["init"], okHarness.io);
      expect(okCode).toBe(EXIT_OK);

      const repoConfigRaw = JSON.parse(
        await readFile(path.join(repoDir, ".rocketflag.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(repoConfigRaw).toEqual({ projectId: "PjSingle1" });
      expect("defaultEnv" in repoConfigRaw).toBe(false);
    });

    it("writes projectId and defaultEnv on a multi-environment project and validates against project and token environments", async () => {
      const restrictedToken: TokenInfo = {
        ...multiEnvWriteToken,
        environments: ["dev", "staging"],
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => jsonResponse(restrictedToken));

      // Unknown project environment -> EXIT_USAGE (2)
      const unknownEnvHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const unknownCode = await runCli(
        ["init", "--env", "nonexistent"],
        unknownEnvHarness.io,
      );
      expect(unknownCode).toBe(EXIT_USAGE);
      expect(unknownEnvHarness.getStderr()).toContain("dev");

      // Project environment not allowed by token -> EXIT_AUTH (3)
      const unpermittedHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const unpermittedCode = await runCli(
        ["init", "--env", "prod"],
        unpermittedHarness.io,
      );
      expect(unpermittedCode).toBe(EXIT_AUTH);
      expect(unpermittedHarness.getStderr()).toContain("staging");

      // Valid environment -> EXIT_OK (0) and writes defaultEnv
      const validHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const validCode = await runCli(
        ["init", "--env", "staging"],
        validHarness.io,
      );
      expect(validCode).toBe(EXIT_OK);

      const repoConfigRaw = JSON.parse(
        await readFile(path.join(repoDir, ".rocketflag.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(repoConfigRaw).toEqual({
        projectId: "PjMulti1",
        defaultEnv: "staging",
      });
    });
  });

  describe("flags list & flags get", () => {
    const sampleFlags: PublicFlag[] = [
      {
        id: "Fg1",
        name: "checkout-v2",
        kind: "flag",
        enabled: true,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      },
      {
        id: "Gp1",
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
      },
    ];

    it("lists flags in human table and --json modes with optional --name filter", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ flags: sampleFlags }))
        .mockResolvedValueOnce(jsonResponse({ flags: [sampleFlags[0]] }));

      const humanHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const humanCode = await runCli(["flags", "list"], humanHarness.io);
      expect(humanCode).toBe(EXIT_OK);
      expect(humanHarness.getStdout()).toContain("Fg1");
      expect(humanHarness.getStdout()).toContain("checkout-v2");
      expect(humanHarness.getStdout()).toContain("Gp1");

      const jsonHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const jsonCode = await runCli(
        ["flags", "list", "--name", "checkout-v2", "--json"],
        jsonHarness.io,
      );
      expect(jsonCode).toBe(EXIT_OK);
      expect(String(fetchMock.mock.calls[1]![0])).toBe(
        "https://api.rocketflag.app/api/v1/flags?name=checkout-v2",
      );
      expect(JSON.parse(jsonHarness.getStdout())).toEqual({
        flags: [sampleFlags[0]],
      });
    });

    it("gets a flag using repo defaultEnv and normalizes empty env to undefined", async () => {
      await saveRepoConfig(repoDir, {
        projectId: "PjMulti1",
        defaultEnv: "staging",
      });

      const projectedFlag: PublicFlag = {
        id: "Gp1",
        name: "ai-search",
        kind: "groupflag",
        environment: "staging",
        enabled: true,
        trafficPercentage: 50,
        cohorts: ["beta"],
        audienceId: null,
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(projectedFlag))
        .mockResolvedValueOnce(jsonResponse(sampleFlags[0]));

      const harness1 = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok" },
      });
      const code1 = await runCli(["flags", "get", "Gp1", "--json"], harness1.io);
      expect(code1).toBe(EXIT_OK);
      expect(String(fetchMock.mock.calls[0]![0])).toBe(
        "https://api.rocketflag.app/api/v1/flags/Gp1?env=staging",
      );
      expect(JSON.parse(harness1.getStdout())).toEqual(projectedFlag);

      // Empty ROCKETFLAG_ENV with no repo config -> no ?env= parameter sent
      const singleDir = path.join(tempRoot, "single-repo");
      await mkdir(singleDir, { recursive: true });
      const harness2 = createHarness({
        cwd: singleDir,
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_tok", ROCKETFLAG_ENV: "   " },
      });
      const code2 = await runCli(["flags", "get", "Fg1", "--json"], harness2.io);
      expect(code2).toBe(EXIT_OK);
      expect(String(fetchMock.mock.calls[1]![0])).toBe(
        "https://api.rocketflag.app/api/v1/flags/Fg1",
      );
    });
  });

  describe("flags create", () => {
    it("rejects read-only tokens immediately with EXIT_AUTH (3)", async () => {
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(singleEnvReadToken));
      const { io, getStderr } = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_read" },
      });

      const code = await runCli(["flags", "create", "new-banner"], io);

      expect(code).toBe(EXIT_AUTH);
      expect(getStderr()).toContain(
        "Permission denied: token 'Single Env Read Token' has read-only permission. Create a Write token in the RocketFlag console under Project > Tokens to create or toggle flags.",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("creates a single-environment flag with flat state and rejects --env on single-env projects", async () => {
      const createdFlag: PublicFlag = {
        id: "FgCreated",
        name: "new-banner",
        kind: "flag",
        enabled: true,
        trafficPercentage: 50,
        cohorts: ["vip"],
        audienceId: "aud_1",
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(singleEnvWriteToken))
        .mockResolvedValueOnce(jsonResponse(singleEnvWriteToken))
        .mockResolvedValueOnce(jsonResponse(createdFlag, 201));

      // Single-env with --env -> EXIT_USAGE (2)
      const badEnvHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      const badCode = await runCli(
        ["flags", "create", "new-banner", "--env", "prod"],
        badEnvHarness.io,
      );
      expect(badCode).toBe(EXIT_USAGE);

      // Single-env create -> sends flat payload
      const okHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      const okCode = await runCli(
        [
          "flags",
          "create",
          "new-banner",
          "--description",
          "Promo banner",
          "--tag",
          "growth",
          "--enabled",
          "--percentage",
          "50",
          "--cohort",
          "vip",
          "--audience",
          "aud_1",
          "--json",
        ],
        okHarness.io,
      );
      expect(okCode).toBe(EXIT_OK);
      const sentBody = JSON.parse(String(fetchMock.mock.calls[2]![1]?.body));
      expect(sentBody).toEqual({
        name: "new-banner",
        description: "Promo banner",
        tags: ["growth"],
        enabled: true,
        trafficPercentage: 50,
        cohorts: ["vip"],
        audienceId: "aud_1",
      });
      expect(JSON.parse(okHarness.getStdout())).toEqual(createdFlag);
    });

    it("creates a multi-environment flag scoped to defaultEnv when initial state is passed", async () => {
      await saveRepoConfig(repoDir, {
        projectId: "PjMulti1",
        defaultEnv: "dev",
      });

      const createdGroupFlag: PublicFlag = {
        id: "GpCreated",
        name: "ai-flow",
        kind: "groupflag",
        environments: {
          dev: {
            enabled: true,
            trafficPercentage: 25,
            cohorts: ["alpha"],
            audienceId: null,
            updatedAt: 1790730000000,
          },
        },
        updatedAt: 1790730000000,
      };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(multiEnvWriteToken))
        .mockResolvedValueOnce(jsonResponse(createdGroupFlag, 201));

      const { io, getStdout } = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });

      const code = await runCli(
        [
          "flags",
          "create",
          "ai-flow",
          "--enabled",
          "--percentage",
          "25",
          "--cohort",
          "alpha",
          "--json",
        ],
        io,
      );

      expect(code).toBe(EXIT_OK);
      const sentBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
      expect(sentBody).toEqual({
        name: "ai-flow",
        environments: {
          dev: {
            enabled: true,
            trafficPercentage: 25,
            cohorts: ["alpha"],
          },
          staging: {
            trafficPercentage: 100,
          },
          prod: {
            trafficPercentage: 100,
          },
        },
      });
      expect(JSON.parse(getStdout())).toEqual(createdGroupFlag);
    });

    it("defaults trafficPercentage to 100 when --percentage is omitted on single-env and multi-env projects", async () => {
      const createdSingle: PublicFlag = {
        id: "FgDefault100",
        name: "single-default",
        kind: "flag",
        enabled: true,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const createdMulti: PublicFlag = {
        id: "GpDefault100",
        name: "multi-default",
        kind: "groupflag",
        environments: {
          dev: {
            enabled: false,
            trafficPercentage: 100,
            cohorts: [],
            audienceId: null,
            updatedAt: 1790730000000,
          },
          staging: {
            enabled: false,
            trafficPercentage: 100,
            cohorts: [],
            audienceId: null,
            updatedAt: 1790730000000,
          },
          prod: {
            enabled: false,
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
        .mockResolvedValueOnce(jsonResponse(singleEnvWriteToken))
        .mockResolvedValueOnce(jsonResponse(createdSingle, 201))
        .mockResolvedValueOnce(jsonResponse(multiEnvWriteToken))
        .mockResolvedValueOnce(jsonResponse(createdMulti, 201));

      const singleHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(
          ["flags", "create", "single-default", "--enabled", "--json"],
          singleHarness.io,
        ),
      ).toBe(EXIT_OK);
      expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
        name: "single-default",
        enabled: true,
        trafficPercentage: 100,
      });

      const multiHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(
          ["flags", "create", "multi-default", "--json"],
          multiHarness.io,
        ),
      ).toBe(EXIT_OK);
      expect(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body))).toEqual({
        name: "multi-default",
        environments: {
          dev: { trafficPercentage: 100 },
          staging: { trafficPercentage: 100 },
          prod: { trafficPercentage: 100 },
        },
      });
    });
  });

  describe("flags toggle", () => {
    it("supports --on, --off, and flip, and rejects both --on and --off with EXIT_USAGE", async () => {
      const initialFalse: PublicFlag = {
        id: "Fg1",
        name: "checkout-v2",
        kind: "flag",
        enabled: false,
        trafficPercentage: 100,
        cohorts: [],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const updatedTrue: PublicFlag = { ...initialFalse, enabled: true };
      const updatedFalse: PublicFlag = { ...initialFalse, enabled: false };

      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        // flip (false -> true)
        .mockResolvedValueOnce(jsonResponse(initialFalse))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: updatedTrue }))
        // --on (true -> true)
        .mockResolvedValueOnce(jsonResponse(updatedTrue))
        .mockResolvedValueOnce(jsonResponse({ changed: false, flag: updatedTrue }))
        // --off (true -> false)
        .mockResolvedValueOnce(jsonResponse(updatedTrue))
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: updatedFalse }));

      // Both --on and --off -> EXIT_USAGE
      const conflictHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(["flags", "toggle", "Fg1", "--on", "--off"], conflictHarness.io),
      ).toBe(EXIT_USAGE);

      // Flip
      const flipHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(["flags", "toggle", "Fg1", "--json"], flipHarness.io),
      ).toBe(EXIT_OK);
      expect(JSON.parse(flipHarness.getStdout())).toEqual({
        id: "Fg1",
        name: "checkout-v2",
        environment: null,
        previous: false,
        current: true,
        changed: true,
        flag: updatedTrue,
      });

      // --on
      const onHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(["flags", "toggle", "Fg1", "--on", "--json"], onHarness.io),
      ).toBe(EXIT_OK);
      expect(JSON.parse(onHarness.getStdout()).current).toBe(true);

      // --off
      const offHarness = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });
      expect(
        await runCli(["flags", "toggle", "Fg1", "--off", "--json"], offHarness.io),
      ).toBe(EXIT_OK);
      expect(JSON.parse(offHarness.getStdout()).current).toBe(false);
    });

    it("returns EXIT_USAGE (2) when toggling a multi-environment flag without an environment", async () => {
      const unprojectedGroupFlag: PublicFlag = {
        id: "Gp1",
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
        },
        updatedAt: 1790730000000,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(unprojectedGroupFlag));

      const { io, getStderr } = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });

      const code = await runCli(["flags", "toggle", "Gp1"], io);

      expect(code).toBe(EXIT_USAGE);
      expect(getStderr()).toMatch(/--env|rocketflag init/);
    });
  });

  describe("flags update", () => {
    it("patches cohorts, percentage, audience, and enabled state on a flag", async () => {
      const updatedFlag: PublicFlag = {
        id: "Fg1",
        name: "checkout-v2",
        kind: "flag",
        enabled: true,
        trafficPercentage: 50,
        cohorts: ["user@example.com"],
        audienceId: null,
        updatedAt: 1790730000000,
      };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse({ changed: true, flag: updatedFlag }));

      const { io, getStdout } = createHarness({
        fetch: fetchMock,
        env: { ROCKETFLAG_TOKEN: "rf_write" },
      });

      const code = await runCli(
        [
          "flags",
          "update",
          "Fg1",
          "--on",
          "--percentage",
          "50",
          "--cohort",
          "user@example.com",
          "--clear-audience",
          "--json",
        ],
        io,
      );

      expect(code).toBe(EXIT_OK);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(new URL(String(url)).pathname).toBe("/api/v1/flags/Fg1");
      expect(init?.method).toBe("PATCH");
      expect(JSON.parse(String(init?.body))).toEqual({
        enabled: true,
        trafficPercentage: 50,
        cohorts: ["user@example.com"],
        audienceId: null,
      });
      expect(JSON.parse(getStdout())).toEqual({
        changed: true,
        flag: updatedFlag,
      });
    });

    it("rejects conflicting flags or empty patch with EXIT_USAGE (2)", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>();

      for (const badArgs of [
        ["flags", "update", "Fg1"],
        ["flags", "update", "Fg1", "--on", "--off"],
        ["flags", "update", "Fg1", "--cohort", "a@b.com", "--clear-cohorts"],
        ["flags", "update", "Fg1", "--audience", "aud_1", "--clear-audience"],
        ["flags", "update", "Fg1", "--percentage", "150"],
      ]) {
        const { io } = createHarness({
          fetch: fetchMock,
          env: { ROCKETFLAG_TOKEN: "rf_write" },
        });
        expect(await runCli(badArgs, io)).toBe(EXIT_USAGE);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("flags eval", () => {
    it("evaluates a flag with --env, --cohort, --key, --attr, and --json even without a token", async () => {
      const evalPayload = { id: "Fg1", name: "checkout-v2", enabled: true };
      const fetchMock = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(jsonResponse(evalPayload));

      const { io, getStdout } = createHarness({ fetch: fetchMock });

      const code = await runCli(
        [
          "flags",
          "eval",
          "Fg1",
          "--env",
          "prod",
          "--cohort",
          "beta",
          "--key",
          "user_99",
          "--attr",
          "plan=pro",
          "--attr",
          "optIn=true",
          "--json",
        ],
        io,
      );

      expect(code).toBe(EXIT_OK);
      expect(JSON.parse(getStdout())).toEqual(evalPayload);

      const [url] = fetchMock.mock.calls[0]!;
      const parsedUrl = new URL(String(url));
      expect(parsedUrl.pathname).toBe("/v1/flags/Fg1");
      expect(parsedUrl.searchParams.get("env")).toBe("prod");
      expect(parsedUrl.searchParams.get("cohort")).toBe("beta");
      expect(parsedUrl.searchParams.get("targetingKey")).toBe("user_99");
      expect(parsedUrl.searchParams.get("plan")).toBe("pro");
      expect(parsedUrl.searchParams.get("optIn")).toBe("true");
    });

    it("rejects malformed --attr without '=' with EXIT_USAGE (2)", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>();
      const { io, getStderr } = createHarness({ fetch: fetchMock });

      const code = await runCli(
        ["flags", "eval", "Fg1", "--attr", "missingEquals"],
        io,
      );

      expect(code).toBe(EXIT_USAGE);
      expect(getStderr()).toContain("--attr");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns EXIT_ERROR (1) on 404 or network failure", async () => {
      const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        jsonResponse(
          {
            error: "Flag not found",
            detail: "No flag with id FgMissing exists",
          },
          404,
        ),
      );
      const { io, getStderr } = createHarness({ fetch: fetchMock });

      const code = await runCli(["flags", "eval", "FgMissing"], io);

      expect(code).toBe(EXIT_ERROR);
      expect(getStderr()).toContain("Flag not found");
    });
  });
});
