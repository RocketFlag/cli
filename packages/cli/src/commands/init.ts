import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
  type TokenProject,
} from "@rocketflag/management";
import {
  isUserSessionToken,
  loadUserConfig,
  normalizeOptionalEnv,
  resolveApiUrl,
  resolveToken,
  saveRepoConfig,
} from "../config.js";
import {
  EXIT_AUTH,
  EXIT_ERROR,
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
        project: { type: "string" },
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
      "Usage: rocketflag init [--project <id>] [--env <env>] [--token <token>] [--api-url <url>] [--json]",
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

  const client = createManagementClient({
    token,
    apiUrl,
    clientName: CLI_CLIENT_NAME,
    clientVersion: CLI_CLIENT_VERSION,
    fetch: io.fetch,
  });

  const explicitFlagEnv = normalizeOptionalEnv(parsed.values.env);
  const requestedProjectId =
    normalizeOptionalEnv(parsed.values.project) ??
    normalizeOptionalEnv(io.env.ROCKETFLAG_PROJECT);

  try {
    if (isUserSessionToken(token)) {
      const projects = await client.listProjects();
      if (projects.length === 0) {
        writeErrorLine(
          io,
          "No projects found for this account. Create a project at https://console.rocketflag.app first.",
        );
        return EXIT_ERROR;
      }

      let chosenProject: TokenProject;
      if (requestedProjectId !== undefined) {
        const match = projects.find((p) => p.id === requestedProjectId);
        if (!match) {
          writeErrorLine(
            io,
            `Project '${requestedProjectId}' was not found or is not accessible. Available projects: ${projects.map((p) => `${p.name} (${p.id})`).join(", ")}.`,
          );
          return EXIT_USAGE;
        }
        chosenProject = {
          id: match.id,
          name: match.name,
          environments: match.environments,
        };
      } else if (projects.length === 1) {
        const only = projects[0]!;
        chosenProject = {
          id: only.id,
          name: only.name,
          environments: only.environments,
        };
      } else if (io.promptSelectProject) {
        const selectedId = normalizeOptionalEnv(
          await io.promptSelectProject(projects),
        );
        let match = selectedId
          ? projects.find((p) => p.id === selectedId || p.name === selectedId)
          : undefined;
        if (!match && selectedId && /^\d+$/.test(selectedId)) {
          const index = Number.parseInt(selectedId, 10);
          if (index >= 1 && index <= projects.length) {
            match = projects[index - 1];
          }
        }
        if (!match) {
          writeErrorLine(
            io,
            `Invalid project selection. Choose 1-${projects.length} or one of: ${projects.map((p) => p.id).join(", ")}.`,
          );
          return EXIT_USAGE;
        }
        chosenProject = {
          id: match.id,
          name: match.name,
          environments: match.environments,
        };
      } else {
        writeErrorLine(
          io,
          `Multiple projects available. Pass --project <id> (${projects.map((p) => `${p.id} [${p.name}]`).join(", ")}).`,
        );
        return EXIT_USAGE;
      }

      if (chosenProject.environments.length === 0) {
        if (parsed.values.env !== undefined) {
          writeErrorLine(
            io,
            `Project '${chosenProject.name}' is a single-environment project and does not use --env.`,
          );
          return EXIT_USAGE;
        }

        const configPath = await saveRepoConfig(io.cwd, {
          projectId: chosenProject.id,
        });

        if (parsed.values.json) {
          writeJson(io, {
            path: configPath,
            config: { projectId: chosenProject.id },
            project: chosenProject,
          });
          return EXIT_OK;
        }

        writeLine(
          io,
          `Initialised RocketFlag project '${chosenProject.name}' (${chosenProject.id}) in ${configPath}`,
        );
        return EXIT_OK;
      }

      const allowed = chosenProject.environments;
      const requestedEnv =
        explicitFlagEnv ?? normalizeOptionalEnv(io.env.ROCKETFLAG_ENV);
      let defaultEnv: string;

      if (requestedEnv !== undefined) {
        if (!allowed.includes(requestedEnv)) {
          writeErrorLine(
            io,
            `Unknown environment '${requestedEnv}' for project '${chosenProject.name}'. Valid project environments: ${allowed.join(", ")}.`,
          );
          return EXIT_USAGE;
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
          `Project '${chosenProject.name}' has multiple environments. Pass --env <name> (${allowed.join(", ")}).`,
        );
        return EXIT_USAGE;
      }

      const configPath = await saveRepoConfig(io.cwd, {
        projectId: chosenProject.id,
        defaultEnv,
      });

      if (parsed.values.json) {
        writeJson(io, {
          path: configPath,
          config: { projectId: chosenProject.id, defaultEnv },
          project: chosenProject,
        });
        return EXIT_OK;
      }

      writeLine(
        io,
        `Initialised RocketFlag project '${chosenProject.name}' (${chosenProject.id}) with defaultEnv '${defaultEnv}' in ${configPath}`,
      );
      return EXIT_OK;
    }

    const tokenInfo = await client.getToken();
    const project = tokenInfo.project;
    if (!project) {
      writeErrorLine(
        io,
        "No project associated with this credential. Pass --project <id>.",
      );
      return EXIT_USAGE;
    }

    if (
      requestedProjectId !== undefined &&
      requestedProjectId !== project.id
    ) {
      writeErrorLine(
        io,
        `Token '${tokenInfo.name}' is scoped to project '${project.name}' (${project.id}), not '${requestedProjectId}'.`,
      );
      return EXIT_USAGE;
    }

    const multiEnvironment = isMultiEnvironmentProject(tokenInfo);
    const staleEnvironments = getStaleTokenEnvironments(tokenInfo);

    if (staleEnvironments.length > 0) {
      writeErrorLine(io, formatStaleEnvWarning(staleEnvironments));
    }

    if (!multiEnvironment) {
      if (parsed.values.env !== undefined) {
        writeErrorLine(
          io,
          `Project '${project.name}' is a single-environment project and does not use --env.`,
        );
        return EXIT_USAGE;
      }

      const configPath = await saveRepoConfig(io.cwd, {
        projectId: project.id,
      });

      if (parsed.values.json) {
        writeJson(io, {
          path: configPath,
          config: { projectId: project.id },
          project,
        });
        return EXIT_OK;
      }

      writeLine(
        io,
        `Initialised RocketFlag project '${project.name}' (${project.id}) in ${configPath}`,
      );
      return EXIT_OK;
    }

    const allowed = getAllowedEnvironments(tokenInfo);
    const tokenEnvs = tokenInfo.environments ?? [];
    if (allowed.length === 0) {
      writeErrorLine(
        io,
        `Token '${tokenInfo.name}' is restricted to environment(s) [${tokenEnvs.join(", ")}] which no longer exist on project '${project.name}'.`,
      );
      return EXIT_AUTH;
    }

    const requestedEnv =
      explicitFlagEnv ?? normalizeOptionalEnv(io.env.ROCKETFLAG_ENV);
    let defaultEnv: string;

    if (requestedEnv !== undefined) {
      if (!project.environments.includes(requestedEnv)) {
        writeErrorLine(
          io,
          `Unknown environment '${requestedEnv}' for project '${project.name}'. Valid project environments: ${project.environments.join(", ")}.`,
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
        `Project '${project.name}' has multiple environments. Pass --env <name> (${allowed.join(", ")}).`,
      );
      return EXIT_USAGE;
    }

    const configPath = await saveRepoConfig(io.cwd, {
      projectId: project.id,
      defaultEnv,
    });

    if (parsed.values.json) {
      writeJson(io, {
        path: configPath,
        config: { projectId: project.id, defaultEnv },
        project,
      });
      return EXIT_OK;
    }

    writeLine(
      io,
      `Initialised RocketFlag project '${project.name}' (${project.id}) with defaultEnv '${defaultEnv}' in ${configPath}`,
    );
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}
