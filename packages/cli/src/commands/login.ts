import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
} from "@rocketflag/management";
import {
  loadUserConfig,
  normalizeOptionalEnv,
  resolveApiUrl,
  saveUserConfig,
} from "../config.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  formatStaleEnvWarning,
  handleCommandError,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "../output.js";

export const CLI_CLIENT_NAME = "cli";
export const CLI_CLIENT_VERSION = "1.0.0";

export async function runLoginCommand(
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
      "Usage: rocketflag login [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  let token =
    normalizeOptionalEnv(parsed.values.token) ??
    normalizeOptionalEnv(io.env.ROCKETFLAG_TOKEN);

  if (token === undefined && io.promptToken) {
    token = normalizeOptionalEnv(await io.promptToken());
  }

  if (token === undefined) {
    writeErrorLine(
      io,
      "Missing API token. Pass --token <rf_...> or set ROCKETFLAG_TOKEN in your environment.",
    );
    return EXIT_USAGE;
  }

  const existingConfig = await loadUserConfig({ env: io.env });
  const apiUrlOverride =
    normalizeOptionalEnv(parsed.values["api-url"]) ??
    normalizeOptionalEnv(io.env.ROCKETFLAG_API_URL) ??
    normalizeOptionalEnv(existingConfig?.apiUrl);
  const apiUrl = resolveApiUrl({
    flagApiUrl: parsed.values["api-url"],
    env: io.env,
    userConfig: existingConfig,
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
    const configPath = await saveUserConfig(
      {
        token,
        ...(apiUrlOverride !== undefined ? { apiUrl: apiUrlOverride } : {}),
      },
      { env: io.env },
    );

    const multiEnvironment = isMultiEnvironmentProject(tokenInfo);
    const allowedEnvironments = getAllowedEnvironments(tokenInfo);
    const staleEnvironments = getStaleTokenEnvironments(tokenInfo);

    if (staleEnvironments.length > 0) {
      writeErrorLine(io, formatStaleEnvWarning(staleEnvironments));
    }

    if (parsed.values.json) {
      writeJson(io, {
        token: tokenInfo,
        configPath,
        multiEnvironment,
        allowedEnvironments,
        staleEnvironments,
      });
      return EXIT_OK;
    }

    writeLine(io, `Authenticated with RocketFlag.`);
    writeLine(
      io,
      `Project: ${tokenInfo.project.name} (${tokenInfo.project.id})`,
    );
    writeLine(io, `Token: ${tokenInfo.name} (${tokenInfo.id})`);
    writeLine(io, `Permission: ${tokenInfo.permission}`);
    if (multiEnvironment) {
      writeLine(
        io,
        `Allowed environments: ${allowedEnvironments.length > 0 ? allowedEnvironments.join(", ") : "none"}`,
      );
    } else {
      writeLine(io, `Environments: single-environment project`);
    }
    writeLine(io, `Saved credentials to ${configPath}`);

    if (tokenInfo.permission === "read") {
      writeLine(
        io,
        "Note: This token has read-only permission. 'flags create' and 'flags toggle' require a Write token.",
      );
    }

    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}
