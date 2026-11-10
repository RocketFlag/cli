#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./cli.js";

export { runCli } from "./cli.js";
export { runFlagsCommand } from "./commands/flags.js";
export { runInitCommand } from "./commands/init.js";
export {
  CLI_CLIENT_NAME,
  CLI_CLIENT_VERSION,
  defaultOpenBrowser,
  defaultStartLoopbackAuth,
  runLoginCommand,
} from "./commands/login.js";
export { runLogoutCommand } from "./commands/logout.js";
export { runProjectsCommand } from "./commands/projects.js";
export {
  DEFAULT_NPM_LATEST_URL,
  defaultInstallGlobalPackage,
  fetchLatestCliVersion,
  getUpdateCheckCachePath,
  isNewerVersion,
  loadUpdateCheckCache,
  maybePrintUpdateNotice,
  runUpdateCommand,
  saveUpdateCheckCache,
  UPDATE_CHECK_FILENAME,
  UPDATE_CHECK_TTL_MS,
  type UpdateCheckCache,
} from "./commands/update.js";
export { runWhoamiCommand } from "./commands/whoami.js";
export {
  DEFAULT_API_URL,
  DEFAULT_CONSOLE_URL,
  deleteUserConfig,
  findRepoConfig,
  getUserConfigDir,
  getUserConfigPath,
  isUserSessionToken,
  loadUserConfig,
  normalizeOptionalEnv,
  REPO_CONFIG_FILENAME,
  resolveApiUrl,
  resolveConsoleUrl,
  resolveEnvironment,
  resolveProjectId,
  resolveToken,
  saveRepoConfig,
  saveUserConfig,
  type FoundRepoConfig,
  type RepoConfig,
  type UserConfig,
  type UserConfigOptions,
} from "./config.js";
export {
  createDefaultIo,
  EXIT_AUTH,
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  formatStaleEnvWarning,
  formatTable,
  handleCommandError,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "./output.js";

function isExecutedDirectly(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  try {
    const currentFile = realpathSync(fileURLToPath(import.meta.url));
    const entryFile = realpathSync(resolve(entryArg));
    return currentFile === entryFile;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    },
  );
}
