import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_API_URL = "https://api.rocketflag.app";
export const DEFAULT_CONSOLE_URL = "https://console.rocketflag.app";
export const REPO_CONFIG_FILENAME = ".rocketflag.json";

export interface UserConfig {
  token: string;
  apiUrl?: string;
}

export interface RepoConfig {
  projectId: string;
  defaultEnv?: string;
}

export interface FoundRepoConfig {
  path: string;
  config: RepoConfig;
}

export interface UserConfigOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function normalizeOptionalEnv(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function getUserConfigDir(options?: UserConfigOptions): string {
  const env = options?.env ?? process.env;
  const customDir = normalizeOptionalEnv(env.ROCKETFLAG_CONFIG_DIR);
  if (customDir !== undefined) {
    return customDir;
  }
  const xdgConfigHome = normalizeOptionalEnv(env.XDG_CONFIG_HOME);
  if (xdgConfigHome !== undefined) {
    return path.join(xdgConfigHome, "rocketflag");
  }
  const home = options?.homeDir ?? os.homedir();
  return path.join(home, ".config", "rocketflag");
}

export function getUserConfigPath(options?: UserConfigOptions): string {
  return path.join(getUserConfigDir(options), "config.json");
}

export async function saveUserConfig(
  config: UserConfig,
  options?: UserConfigOptions,
): Promise<string> {
  const dir = getUserConfigDir(options);
  const filePath = path.join(dir, "config.json");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);

  const apiUrl = normalizeOptionalEnv(config.apiUrl);
  const sanitized: UserConfig = {
    token: config.token.trim(),
    ...(apiUrl !== undefined ? { apiUrl } : {}),
  };

  await writeFile(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
  return filePath;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function loadUserConfig(
  options?: UserConfigOptions,
): Promise<UserConfig | null> {
  const filePath = getUserConfigPath(options);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.token !== "string") {
    return null;
  }
  const apiUrl =
    typeof record.apiUrl === "string"
      ? normalizeOptionalEnv(record.apiUrl)
      : undefined;
  return {
    token: record.token,
    ...(apiUrl !== undefined ? { apiUrl } : {}),
  };
}

export async function deleteUserConfig(
  options?: UserConfigOptions,
): Promise<boolean> {
  const filePath = getUserConfigPath(options);
  try {
    await unlink(filePath);
    return true;
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function findRepoConfig(
  startDir: string,
): Promise<FoundRepoConfig | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, REPO_CONFIG_FILENAME);
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.projectId === "string") {
          const defaultEnv =
            typeof record.defaultEnv === "string"
              ? normalizeOptionalEnv(record.defaultEnv)
              : undefined;
          return {
            path: candidate,
            config: {
              projectId: record.projectId,
              ...(defaultEnv !== undefined ? { defaultEnv } : {}),
            },
          };
        }
      }
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "ENOENT") {
        throw err;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function saveRepoConfig(
  dir: string,
  config: RepoConfig,
): Promise<string> {
  const filePath = path.join(path.resolve(dir), REPO_CONFIG_FILENAME);
  const defaultEnv = normalizeOptionalEnv(config.defaultEnv);
  const sanitized: RepoConfig = {
    projectId: config.projectId,
    ...(defaultEnv !== undefined ? { defaultEnv } : {}),
  };
  await writeFile(filePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return filePath;
}

export function resolveToken(options: {
  flagToken?: string;
  env?: NodeJS.ProcessEnv;
  userConfig?: UserConfig | null;
}): string | undefined {
  const fromFlag = normalizeOptionalEnv(options.flagToken);
  if (fromFlag !== undefined) {
    return fromFlag;
  }
  const fromEnv = normalizeOptionalEnv(options.env?.ROCKETFLAG_TOKEN);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return normalizeOptionalEnv(options.userConfig?.token);
}

export function resolveApiUrl(options: {
  flagApiUrl?: string;
  env?: NodeJS.ProcessEnv;
  userConfig?: UserConfig | null;
}): string {
  const fromFlag = normalizeOptionalEnv(options.flagApiUrl);
  if (fromFlag !== undefined) {
    return fromFlag;
  }
  const fromEnv = normalizeOptionalEnv(options.env?.ROCKETFLAG_API_URL);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  const fromConfig = normalizeOptionalEnv(options.userConfig?.apiUrl);
  if (fromConfig !== undefined) {
    return fromConfig;
  }
  return DEFAULT_API_URL;
}

export function resolveEnvironment(options: {
  flagEnv?: string;
  env?: NodeJS.ProcessEnv;
  repoConfig?: RepoConfig | null;
}): string | undefined {
  const fromFlag = normalizeOptionalEnv(options.flagEnv);
  if (fromFlag !== undefined) {
    return fromFlag;
  }
  const fromEnv = normalizeOptionalEnv(options.env?.ROCKETFLAG_ENV);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return normalizeOptionalEnv(options.repoConfig?.defaultEnv);
}

export function resolveConsoleUrl(options: {
  flagConsoleUrl?: string;
  env?: NodeJS.ProcessEnv;
  apiUrl?: string;
}): string {
  const fromFlag = normalizeOptionalEnv(options.flagConsoleUrl);
  if (fromFlag !== undefined) {
    return fromFlag.replace(/\/+$/, "");
  }
  const fromEnv = normalizeOptionalEnv(options.env?.ROCKETFLAG_CONSOLE_URL);
  if (fromEnv !== undefined) {
    return fromEnv.replace(/\/+$/, "");
  }
  return DEFAULT_CONSOLE_URL.replace(/\/+$/, "");
}

export function resolveProjectId(options: {
  flagProject?: string;
  env?: NodeJS.ProcessEnv;
  repoConfig?: RepoConfig | null;
}): string | undefined {
  const fromFlag = normalizeOptionalEnv(options.flagProject);
  if (fromFlag !== undefined) {
    return fromFlag;
  }
  const fromEnv = normalizeOptionalEnv(options.env?.ROCKETFLAG_PROJECT);
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return normalizeOptionalEnv(options.repoConfig?.projectId);
}

export function isUserSessionToken(token: string): boolean {
  return token.trim().startsWith("rfu_");
}
