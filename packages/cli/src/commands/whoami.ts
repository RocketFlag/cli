import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
} from "@rocketflag/management";
import { loadUserConfig, resolveApiUrl, resolveToken } from "../config.js";
import {
  EXIT_AUTH,
  EXIT_OK,
  EXIT_USAGE,
  formatStaleEnvWarning,
  handleCommandError,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "../output.js";
import { CLI_CLIENT_NAME, CLI_CLIENT_VERSION } from "./login.js";

export async function runWhoamiCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        token: { type: "string" },
        "api-url": { type: "string" },
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
    writeLine(
      io,
      "Usage: rocketflag whoami [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  const userConfig = await loadUserConfig({ env: io.env });
  const token = resolveToken({
    flagToken: parsed.values.token,
    env: io.env,
    userConfig,
  });

  if (!token) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  const apiUrl = resolveApiUrl({
    flagApiUrl: parsed.values["api-url"],
    env: io.env,
    userConfig,
  });

  const client = createManagementClient({
    token,
    apiUrl,
    clientName: CLI_CLIENT_NAME,
    clientVersion: CLI_CLIENT_VERSION,
    fetch: io.fetch,
  });

  try {
    const tokenInfo = await client.getToken();
    const multiEnvironment = isMultiEnvironmentProject(tokenInfo);
    const allowedEnvironments = getAllowedEnvironments(tokenInfo);
    const staleEnvironments = getStaleTokenEnvironments(tokenInfo);

    if (staleEnvironments.length > 0) {
      writeErrorLine(io, formatStaleEnvWarning(staleEnvironments));
    }

    if (parsed.values.json) {
      writeJson(io, {
        token: tokenInfo,
        multiEnvironment,
        allowedEnvironments,
        staleEnvironments,
      });
      return EXIT_OK;
    }

    const modeLabel = multiEnvironment
      ? "multi-environment"
      : "single-environment";
    const projectEnvsLabel = multiEnvironment
      ? tokenInfo.project.environments.join(", ")
      : "none (single-environment)";
    const allowedEnvsLabel = !multiEnvironment
      ? "n/a (single-environment)"
      : tokenInfo.environments.length === 0
        ? `all (${allowedEnvironments.join(", ")})`
        : allowedEnvironments.length > 0
          ? allowedEnvironments.join(", ")
          : "none";
    const expiryLabel =
      tokenInfo.expiresAt === null || tokenInfo.expiresAt === 0
        ? "never"
        : new Date(tokenInfo.expiresAt).toISOString();

    writeLine(io, `Token: ${tokenInfo.name} (${tokenInfo.id})`);
    writeLine(io, `Permission: ${tokenInfo.permission}`);
    writeLine(
      io,
      `Project: ${tokenInfo.project.name} (${tokenInfo.project.id}) [${modeLabel}]`,
    );
    writeLine(io, `Project environments: ${projectEnvsLabel}`);
    writeLine(io, `Token allowed environments: ${allowedEnvsLabel}`);
    writeLine(io, `Expiry: ${expiryLabel}`);

    if (staleEnvironments.length > 0) {
      writeLine(io, formatStaleEnvWarning(staleEnvironments));
    }

    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}
