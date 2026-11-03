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
  resolveToken,
  saveRepoConfig,
} from "../config.js";
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

export async function runInitCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
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
      "Usage: rocketflag init [--env <env>] [--token <rf_...>] [--api-url <url>] [--json]",
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
    const staleEnvironments = getStaleTokenEnvironments(tokenInfo);

    if (staleEnvironments.length > 0) {
      writeErrorLine(io, formatStaleEnvWarning(staleEnvironments));
    }

    const explicitFlagEnv = normalizeOptionalEnv(parsed.values.env);

    if (!multiEnvironment) {
      if (parsed.values.env !== undefined) {
        writeErrorLine(
          io,
          `Project '${tokenInfo.project.name}' is a single-environment project and does not use --env.`,
        );
        return EXIT_USAGE;
      }

      const configPath = await saveRepoConfig(io.cwd, {
        projectId: tokenInfo.project.id,
      });

      if (parsed.values.json) {
        writeJson(io, {
          path: configPath,
          config: { projectId: tokenInfo.project.id },
          project: tokenInfo.project,
        });
        return EXIT_OK;
      }

      writeLine(
        io,
        `Initialised RocketFlag project '${tokenInfo.project.name}' (${tokenInfo.project.id}) in ${configPath}`,
      );
      return EXIT_OK;
    }

    const allowed = getAllowedEnvironments(tokenInfo);
    if (allowed.length === 0) {
      writeErrorLine(
        io,
        `Token '${tokenInfo.name}' is restricted to environment(s) [${tokenInfo.environments.join(", ")}] which no longer exist on project '${tokenInfo.project.name}'.`,
      );
      return EXIT_AUTH;
    }

    const requestedEnv =
      explicitFlagEnv ?? normalizeOptionalEnv(io.env.ROCKETFLAG_ENV);
    let defaultEnv: string;

    if (requestedEnv !== undefined) {
      if (!tokenInfo.project.environments.includes(requestedEnv)) {
        writeErrorLine(
          io,
          `Unknown environment '${requestedEnv}' for project '${tokenInfo.project.name}'. Valid project environments: ${tokenInfo.project.environments.join(", ")}.`,
        );
        return EXIT_USAGE;
      }
      if (!allowed.includes(requestedEnv)) {
        writeErrorLine(
          io,
          `Token '${tokenInfo.name}' is not permitted to access environment '${requestedEnv}'. Allowed environments for this token: ${allowed.join(", ")}.`,
        );
        return EXIT_AUTH;
      }
      defaultEnv = requestedEnv;
    } else if (allowed.length === 1) {
      defaultEnv = allowed[0]!;
    } else if (io.promptSelectEnv) {
      const selected = normalizeOptionalEnv(await io.promptSelectEnv(allowed));
      if (!selected || !allowed.includes(selected)) {
        writeErrorLine(
          io,
          `Invalid environment selection. Choose one of: ${allowed.join(", ")}.`,
        );
        return EXIT_USAGE;
      }
      defaultEnv = selected;
    } else {
      writeErrorLine(
        io,
        `Project '${tokenInfo.project.name}' has multiple environments. Pass --env <name> (${allowed.join(", ")}).`,
      );
      return EXIT_USAGE;
    }

    const configPath = await saveRepoConfig(io.cwd, {
      projectId: tokenInfo.project.id,
      defaultEnv,
    });

    if (parsed.values.json) {
      writeJson(io, {
        path: configPath,
        config: { projectId: tokenInfo.project.id, defaultEnv },
        project: tokenInfo.project,
      });
      return EXIT_OK;
    }

    writeLine(
      io,
      `Initialised RocketFlag project '${tokenInfo.project.name}' (${tokenInfo.project.id}) with defaultEnv '${defaultEnv}' in ${configPath}`,
    );
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}
