import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  getUserConfigDir,
  normalizeOptionalEnv,
   type UserConfigOptions,
} from "../config.js";
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "../output.js";
import { CLI_CLIENT_VERSION } from "./login.js";

export const DEFAULT_NPM_LATEST_URL =
  "https://registry.npmjs.org/@rocketflag/cli/latest";
export const UPDATE_CHECK_FILENAME = "update-check.json";
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 1500;

export interface UpdateCheckCache {
  latestVersion: string;
  checkedAt: number;
}

function parseSemver(version: string): [number, number, number] | null {
  const cleaned = version.trim().replace(/^v/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(cleaned);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10),
  ];
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const cur = parseSemver(current);
  const cand = parseSemver(candidate);
  if (!cur || !cand) {
    return false;
  }
  if (cand[0] !== cur[0]) {
    return cand[0] > cur[0];
  }
  if (cand[1] !== cur[1]) {
    return cand[1] > cur[1];
  }
  return cand[2] > cur[2];
}

export function getUpdateCheckCachePath(options?: UserConfigOptions): string {
  return path.join(getUserConfigDir(options), UPDATE_CHECK_FILENAME);
}

export async function loadUpdateCheckCache(
  options?: UserConfigOptions,
): Promise<UpdateCheckCache | null> {
  const filePath = getUpdateCheckCachePath(options);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.latestVersion !== "string" ||
      typeof record.checkedAt !== "number" ||
      !Number.isFinite(record.checkedAt)
    ) {
      return null;
    }
    return {
      latestVersion: record.latestVersion.trim(),
      checkedAt: record.checkedAt,
    };
  } catch {
    return null;
  }
}

export async function saveUpdateCheckCache(
  cache: UpdateCheckCache,
  options?: UserConfigOptions,
): Promise<void> {
  try {
    const dir = getUserConfigDir(options);
    const filePath = path.join(dir, UPDATE_CHECK_FILENAME);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(filePath, 0o600);
  } catch {
    // Non-fatal: ignore cache write errors
  }
}

export async function fetchLatestCliVersion(options: {
  fetchImpl?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<string> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const registryUrl =
    normalizeOptionalEnv(options.env?.ROCKETFLAG_NPM_LATEST_URL) ??
    DEFAULT_NPM_LATEST_URL;
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;

  const response = await fetchFn(registryUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as unknown;
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).version !== "string"
  ) {
    throw new Error("Invalid version payload from npm registry");
  }

  return ((data as Record<string, unknown>).version as string).trim();
}

export function defaultInstallGlobalPackage(version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    execFile(
      npmCmd,
      ["install", "-g", `@rocketflag/cli@${version}`],
      (err, _stdout, stderr) => {
        if (err) {
          const detail = stderr?.trim() || err.message;
          reject(new Error(detail));
          return;
        }
        resolve();
      },
    );
  });
}

function shouldSkipUpdateNotice(argv: string[], io: CliIo): boolean {
  if (!io.isTTY) {
    return true;
  }
  const noCheck = normalizeOptionalEnv(io.env.ROCKETFLAG_NO_UPDATE_CHECK);
  if (noCheck === "1" || noCheck?.toLowerCase() === "true") {
    return true;
  }
  const ci = normalizeOptionalEnv(io.env.CI);
  if (ci !== undefined && ci !== "0" && ci.toLowerCase() !== "false") {
    return true;
  }
  if (argv.includes("--json") || argv.includes("-h") || argv.includes("--help")) {
    return true;
  }
  const cmd = argv[0];
  if (
    !cmd ||
    cmd === "update" ||
    cmd === "upgrade" ||
    cmd === "help" ||
    cmd === "version" ||
    cmd === "-v" ||
    cmd === "--version"
  ) {
    return true;
  }
  return false;
}

export async function maybePrintUpdateNotice(
  argv: string[],
  io: CliIo,
  currentVersion = CLI_CLIENT_VERSION,
): Promise<void> {
  if (shouldSkipUpdateNotice(argv, io)) {
    return;
  }

  try {
    const now = Date.now();
    const cached = await loadUpdateCheckCache({ env: io.env });
    let latestVersion: string | undefined;

    if (cached && now - cached.checkedAt < UPDATE_CHECK_TTL_MS) {
      latestVersion = cached.latestVersion;
    } else {
      latestVersion = await fetchLatestCliVersion({
        fetchImpl: io.fetch,
        env: io.env,
      });
      await saveUpdateCheckCache(
        { latestVersion, checkedAt: now },
        { env: io.env },
      );
    }

    if (latestVersion && isNewerVersion(currentVersion, latestVersion)) {
      writeErrorLine(
        io,
        `\nUpdate available: v${currentVersion} -> v${latestVersion}. Run 'rocketflag update' to update.`,
      );
    }
  } catch {
    // Never fail or noisy-warn when offline or registry times out
  }
}

export async function runUpdateCommand(
  args: string[],
  io: CliIo,
  currentVersion = CLI_CLIENT_VERSION,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        check: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(io, "Usage: rocketflag update [--check] [--json]");
    return EXIT_OK;
  }

  let latestVersion: string;
  try {
    latestVersion = await fetchLatestCliVersion({
      fetchImpl: io.fetch,
      env: io.env,
      timeoutMs: 10000,
    });
    await saveUpdateCheckCache(
      { latestVersion, checkedAt: Date.now() },
      { env: io.env },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Failed to check for updates: ${message}`);
    return EXIT_ERROR;
  }

  const updateAvailable = isNewerVersion(currentVersion, latestVersion);

  if (!updateAvailable) {
    if (parsed.values.json) {
      writeJson(io, {
        currentVersion,
        latestVersion,
        updateAvailable: false,
        updated: false,
      });
      return EXIT_OK;
    }
    writeLine(io, `rocketflag is already up to date (v${currentVersion}).`);
    return EXIT_OK;
  }

  if (parsed.values.check) {
    if (parsed.values.json) {
      writeJson(io, {
        currentVersion,
        latestVersion,
        updateAvailable: true,
        updated: false,
      });
      return EXIT_OK;
    }
    writeLine(
      io,
      `Update available: v${currentVersion} -> v${latestVersion}. Run 'rocketflag update' to install.`,
    );
    return EXIT_OK;
  }

  const installFn = io.installGlobalPackage ?? defaultInstallGlobalPackage;
  if (!parsed.values.json) {
    writeLine(
      io,
      `Updating @rocketflag/cli from v${currentVersion} to v${latestVersion}...`,
    );
  }

  try {
    await installFn(latestVersion);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(
      io,
      `Failed to install @rocketflag/cli@${latestVersion}: ${message}\nTry running: npm install -g @rocketflag/cli@latest`,
    );
    return EXIT_ERROR;
  }

  if (parsed.values.json) {
    writeJson(io, {
      currentVersion,
      latestVersion,
      updateAvailable: true,
      updated: true,
    });
    return EXIT_OK;
  }

  writeLine(
    io,
    `Updated @rocketflag/cli from v${currentVersion} to v${latestVersion}.`,
  );
  return EXIT_OK;
}
