import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_API_URL,
  DEFAULT_CONSOLE_URL,
  deleteUserConfig,
  findRepoConfig,
  getUserConfigDir,
  getUserConfigPath,
  isUserSessionToken,
  loadUserConfig,
  normalizeOptionalEnv,
  resolveApiUrl,
  resolveConsoleUrl,
  resolveEnvironment,
  resolveProjectId,
  resolveToken,
  saveRepoConfig,
  saveUserConfig,
} from "../src/config.js";

describe("CLI config and credential helpers", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = path.join(
      os.tmpdir(),
      `rocketflag-cli-config-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  describe("user config (~/.config/rocketflag/config.json)", () => {
    it("resolves config path from ROCKETFLAG_CONFIG_DIR, XDG_CONFIG_HOME, or homeDir", () => {
      const explicitDir = path.join(tempRoot, "custom-rf");
      expect(
        getUserConfigDir({
          env: { ROCKETFLAG_CONFIG_DIR: explicitDir, XDG_CONFIG_HOME: "/ignored" },
          homeDir: "/ignored-home",
        }),
      ).toBe(explicitDir);

      const xdgDir = path.join(tempRoot, "xdg");
      expect(
        getUserConfigDir({
          env: { XDG_CONFIG_HOME: xdgDir },
          homeDir: "/ignored-home",
        }),
      ).toBe(path.join(xdgDir, "rocketflag"));

      const fakeHome = path.join(tempRoot, "home");
      expect(
        getUserConfigPath({
          env: {},
          homeDir: fakeHome,
        }),
      ).toBe(path.join(fakeHome, ".config", "rocketflag", "config.json"));
    });

    it("saves and loads user config with 0700 directory mode and 0600 file mode", async () => {
      const configDir = path.join(tempRoot, "user-config");
      const env = { ROCKETFLAG_CONFIG_DIR: configDir };

      expect(await loadUserConfig({ env })).toBeNull();

      const filePath = await saveUserConfig(
        {
          token: "rf_live_secret_123",
          apiUrl: "https://api.staging.rocketflag.app",
        },
        { env },
      );

      expect(filePath).toBe(path.join(configDir, "config.json"));

      const dirStat = await stat(configDir);
      const fileStat = await stat(filePath);
      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);

      const loaded = await loadUserConfig({ env });
      expect(loaded).toEqual({
        token: "rf_live_secret_123",
        apiUrl: "https://api.staging.rocketflag.app",
      });
    });

    it("tightens existing permissive config file permissions to 0600 on save", async () => {
      const configDir = path.join(tempRoot, "permissive-config");
      await mkdir(configDir, { recursive: true, mode: 0o755 });
      const filePath = path.join(configDir, "config.json");
      await writeFile(filePath, JSON.stringify({ token: "rf_old" }), { mode: 0o644 });

      await saveUserConfig(
        { token: "rf_new" },
        { env: { ROCKETFLAG_CONFIG_DIR: configDir } },
      );

      const fileStat = await stat(filePath);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const loaded = await loadUserConfig({
        env: { ROCKETFLAG_CONFIG_DIR: configDir },
      });
      expect(loaded).toEqual({ token: "rf_new" });
    });

    it("deletes user config file and returns true when present or false when missing", async () => {
      const configDir = path.join(tempRoot, "delete-config");
      const env = { ROCKETFLAG_CONFIG_DIR: configDir };

      expect(await deleteUserConfig({ env })).toBe(false);

      await saveUserConfig({ token: "rfu_session_123" }, { env });
      expect(await loadUserConfig({ env })).toEqual({ token: "rfu_session_123" });

      expect(await deleteUserConfig({ env })).toBe(true);
      expect(await loadUserConfig({ env })).toBeNull();
      expect(await deleteUserConfig({ env })).toBe(false);
    });
  });

  describe("repo config (.rocketflag.json)", () => {
    it("discovers .rocketflag.json in current and parent directories", async () => {
      const repoRoot = path.join(tempRoot, "workspace", "my-app");
      const nestedDir = path.join(repoRoot, "packages", "web", "src");
      await mkdir(nestedDir, { recursive: true });

      expect(await findRepoConfig(nestedDir)).toBeNull();

      const savedPath = await saveRepoConfig(repoRoot, {
        projectId: "Pj_123",
        defaultEnv: "staging",
      });

      expect(savedPath).toBe(path.join(repoRoot, ".rocketflag.json"));

      const fromRoot = await findRepoConfig(repoRoot);
      expect(fromRoot).toEqual({
        path: savedPath,
        config: {
          projectId: "Pj_123",
          defaultEnv: "staging",
        },
      });

      const fromNested = await findRepoConfig(nestedDir);
      expect(fromNested).toEqual({
        path: savedPath,
        config: {
          projectId: "Pj_123",
          defaultEnv: "staging",
        },
      });
    });

    it("never stores secrets or tokens in .rocketflag.json", async () => {
      const repoRoot = path.join(tempRoot, "repo-no-secrets");
      await mkdir(repoRoot, { recursive: true });

      const configWithSecret = {
        projectId: "Pj_Safe",
        defaultEnv: "prod",
        token: "rf_secret_must_never_be_written",
      } as unknown as { projectId: string; defaultEnv?: string };

      const savedPath = await saveRepoConfig(repoRoot, configWithSecret);
      const raw = await readFile(savedPath, "utf8");

      expect(raw.endsWith("\n")).toBe(true);
      expect(raw).not.toContain("rf_secret_must_never_be_written");
      expect(raw).not.toContain("token");
      expect(JSON.parse(raw)).toEqual({
        projectId: "Pj_Safe",
        defaultEnv: "prod",
      });
    });
  });

  describe("precedence rules", () => {
    it("resolves token in order: --token > ROCKETFLAG_TOKEN > userConfig.token", () => {
      expect(
        resolveToken({
          flagToken: "rf_from_flag",
          env: { ROCKETFLAG_TOKEN: "rf_from_env" },
          userConfig: { token: "rf_from_file" },
        }),
      ).toBe("rf_from_flag");

      expect(
        resolveToken({
          flagToken: "   ",
          env: { ROCKETFLAG_TOKEN: "rf_from_env" },
          userConfig: { token: "rf_from_file" },
        }),
      ).toBe("rf_from_env");

      expect(
        resolveToken({
          flagToken: undefined,
          env: { ROCKETFLAG_TOKEN: "" },
          userConfig: { token: "rf_from_file" },
        }),
      ).toBe("rf_from_file");

      expect(
        resolveToken({
          flagToken: undefined,
          env: {},
          userConfig: null,
        }),
      ).toBeUndefined();
    });

    it("resolves API URL in order: --api-url > ROCKETFLAG_API_URL > userConfig.apiUrl > default", () => {
      expect(
        resolveApiUrl({
          flagApiUrl: "https://flag.rocketflag.test",
          env: { ROCKETFLAG_API_URL: "https://env.rocketflag.test" },
          userConfig: { token: "rf_1", apiUrl: "https://file.rocketflag.test" },
        }),
      ).toBe("https://flag.rocketflag.test");

      expect(
        resolveApiUrl({
          flagApiUrl: "",
          env: { ROCKETFLAG_API_URL: "https://env.rocketflag.test" },
          userConfig: { token: "rf_1", apiUrl: "https://file.rocketflag.test" },
        }),
      ).toBe("https://env.rocketflag.test");

      expect(
        resolveApiUrl({
          env: {},
          userConfig: { token: "rf_1", apiUrl: "https://file.rocketflag.test" },
        }),
      ).toBe("https://file.rocketflag.test");

      expect(resolveApiUrl({ env: {}, userConfig: null })).toBe(DEFAULT_API_URL);
    });

    it("resolves environment in order: --env > ROCKETFLAG_ENV > .rocketflag.json defaultEnv and normalizes empty strings to undefined", () => {
      expect(
        resolveEnvironment({
          flagEnv: "prod",
          env: { ROCKETFLAG_ENV: "staging" },
          repoConfig: { projectId: "Pj1", defaultEnv: "dev" },
        }),
      ).toBe("prod");

      expect(
        resolveEnvironment({
          flagEnv: "   ",
          env: { ROCKETFLAG_ENV: "staging" },
          repoConfig: { projectId: "Pj1", defaultEnv: "dev" },
        }),
      ).toBe("staging");

      expect(
        resolveEnvironment({
          flagEnv: "",
          env: { ROCKETFLAG_ENV: "  " },
          repoConfig: { projectId: "Pj1", defaultEnv: "dev" },
        }),
      ).toBe("dev");

      expect(
        resolveEnvironment({
          flagEnv: "",
          env: { ROCKETFLAG_ENV: "" },
          repoConfig: { projectId: "Pj1", defaultEnv: "   " },
        }),
      ).toBeUndefined();

      expect(normalizeOptionalEnv("")).toBeUndefined();
      expect(normalizeOptionalEnv("   ")).toBeUndefined();
      expect(normalizeOptionalEnv(" prod ")).toBe("prod");
    });

    it("resolves console URL in order: --console-url > ROCKETFLAG_CONSOLE_URL > default and strips trailing slashes", () => {
      expect(
        resolveConsoleUrl({
          flagConsoleUrl: "https://console.custom.test///",
          env: { ROCKETFLAG_CONSOLE_URL: "https://console.env.test" },
        }),
      ).toBe("https://console.custom.test");

      expect(
        resolveConsoleUrl({
          flagConsoleUrl: "  ",
          env: { ROCKETFLAG_CONSOLE_URL: "https://console.env.test/" },
        }),
      ).toBe("https://console.env.test");

      expect(
        resolveConsoleUrl({
          env: {},
          apiUrl: "http://127.0.0.1:8080",
        }),
      ).toBe(DEFAULT_CONSOLE_URL);
    });

    it("resolves projectId in order: --project > ROCKETFLAG_PROJECT > .rocketflag.json projectId", () => {
      expect(
        resolveProjectId({
          flagProject: "Pj_Flag",
          env: { ROCKETFLAG_PROJECT: "Pj_Env" },
          repoConfig: { projectId: "Pj_Repo" },
        }),
      ).toBe("Pj_Flag");

      expect(
        resolveProjectId({
          flagProject: "  ",
          env: { ROCKETFLAG_PROJECT: "Pj_Env" },
          repoConfig: { projectId: "Pj_Repo" },
        }),
      ).toBe("Pj_Env");

      expect(
        resolveProjectId({
          flagProject: undefined,
          env: { ROCKETFLAG_PROJECT: "" },
          repoConfig: { projectId: "Pj_Repo" },
        }),
      ).toBe("Pj_Repo");

      expect(
        resolveProjectId({
          flagProject: undefined,
          env: {},
          repoConfig: null,
        }),
      ).toBeUndefined();
    });

    it("detects rfu_ user session tokens vs rf_ project tokens", () => {
      expect(isUserSessionToken("rfu_abc123")).toBe(true);
      expect(isUserSessionToken("  rfu_abc123  ")).toBe(true);
      expect(isUserSessionToken("rf_abc123")).toBe(false);
      expect(isUserSessionToken("")).toBe(false);
    });
  });
});
