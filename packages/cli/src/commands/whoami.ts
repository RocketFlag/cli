import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
} from "@rocketflag/management";
import {
  findRepoConfig,
  loadUserConfig,
  resolveApiUrl,
  resolveProjectId,
  resolveToken,
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

export async function runWhoamiCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        project: { type: "string" },
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
      "Usage: rocketflag whoami [--project <id>] [--token <token>] [--api-url <url>] [--json]",
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
      "Not authenticated. Run 'rocketflag login', pass --token <token>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  const apiUrl = resolveApiUrl({
    flagApiUrl: parsed.values["api-url"],
    env: io.env,
    userConfig,
  });

  const foundRepo = await findRepoConfig(io.cwd);
  const projectId = resolveProjectId({
    flagProject: parsed.values.project,
    env: io.env,
    repoConfig: foundRepo?.config,
  });

  const client = createManagementClient({
    token,
    apiUrl,
    projectId,
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
      ? (tokenInfo.project?.environments ?? []).join(", ")
      : "none (single-environment)";
    const expiryLabel =
      tokenInfo.expiresAt === null || tokenInfo.expiresAt === 0
        ? "never"
        : new Date(tokenInfo.expiresAt).toISOString();

    if (tokenInfo.kind === "user" || tokenInfo.user) {
      const userName = tokenInfo.user?.name ?? "";
      const userEmail = tokenInfo.user?.email ?? "";
      writeLine(
        io,
        `Account: ${userName ? `${userName} (${userEmail})` : userEmail}`,
      );
      writeLine(io, `Session: ${tokenInfo.name} (${tokenInfo.id})`);
      writeLine(io, `Expiry: ${expiryLabel}`);
      if (tokenInfo.project) {
        writeLine(
          io,
          `Project: ${tokenInfo.project.name} (${tokenInfo.project.id}) [${modeLabel}]`,
        );
        if (tokenInfo.permission) {
          writeLine(io, `Permission: ${tokenInfo.permission}`);
        }
        writeLine(io, `Project environments: ${projectEnvsLabel}`);
      } else {
        writeLine(
          io,
          "Project: none selected (run 'rocketflag init' or pass --project <id>)",
        );
      }
      return EXIT_OK;
    }

    const tokenEnvs = tokenInfo.environments ?? [];
    const allowedEnvsLabel = !multiEnvironment
      ? "n/a (single-environment)"
      : tokenEnvs.length === 0
        ? `all (${allowedEnvironments.join(", ")})`
        : allowedEnvironments.length > 0
          ? allowedEnvironments.join(", ")
          : "none";

    writeLine(io, `Token: ${tokenInfo.name} (${tokenInfo.id})`);
    if (tokenInfo.permission) {
      writeLine(io, `Permission: ${tokenInfo.permission}`);
    }
    if (tokenInfo.project) {
      writeLine(
        io,
        `Project: ${tokenInfo.project.name} (${tokenInfo.project.id}) [${modeLabel}]`,
      );
    }
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
