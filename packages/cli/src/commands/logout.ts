import { parseArgs } from "node:util";
import { createManagementClient } from "@rocketflag/management";
import {
  deleteUserConfig,
  getUserConfigPath,
  isUserSessionToken,
  loadUserConfig,
  resolveApiUrl,
} from "../config.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "../output.js";
import { CLI_CLIENT_NAME, CLI_CLIENT_VERSION } from "./login.js";

export async function runLogoutCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
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
    writeLine(io, "Usage: rocketflag logout [--api-url <url>] [--json]");
    return EXIT_OK;
  }

  const userConfig = await loadUserConfig({ env: io.env });
  if (!userConfig) {
    if (parsed.values.json) {
      writeJson(io, { loggedOut: false });
      return EXIT_OK;
    }
    writeLine(io, "Not logged in.");
    return EXIT_OK;
  }

  if (isUserSessionToken(userConfig.token)) {
    const apiUrl = resolveApiUrl({
      flagApiUrl: parsed.values["api-url"],
      env: io.env,
      userConfig,
    });
    const client = createManagementClient({
      token: userConfig.token,
      apiUrl,
      clientName: CLI_CLIENT_NAME,
      clientVersion: CLI_CLIENT_VERSION,
      fetch: io.fetch,
    });
    try {
      await client.revokeSession();
    } catch {
      // Best-effort revocation; always remove local credentials.
    }
  }

  const configPath = getUserConfigPath({ env: io.env });
  await deleteUserConfig({ env: io.env });

  if (parsed.values.json) {
    writeJson(io, { loggedOut: true, configPath });
    return EXIT_OK;
  }

  writeLine(io, "Logged out and removed saved credentials.");
  return EXIT_OK;
}
