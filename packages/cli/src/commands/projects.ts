import { parseArgs } from "node:util";
import { createManagementClient } from "@rocketflag/management";
import { loadUserConfig, resolveApiUrl, resolveToken } from "../config.js";
import {
  EXIT_AUTH,
  EXIT_OK,
  EXIT_USAGE,
  formatTable,
  handleCommandError,
  writeErrorLine,
  writeJson,
  writeLine,
  type CliIo,
} from "../output.js";
import { CLI_CLIENT_NAME, CLI_CLIENT_VERSION } from "./login.js";

async function runProjectsList(args: string[], io: CliIo): Promise<number> {
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
      "Usage: rocketflag projects list [--token <token>] [--api-url <url>] [--json]",
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

  try {
    const projects = await client.listProjects();

    if (parsed.values.json) {
      writeJson(io, { projects });
      return EXIT_OK;
    }

    if (projects.length === 0) {
      writeLine(io, "No projects found.");
      return EXIT_OK;
    }

    const rows = projects.map((project) => [
      project.id,
      project.name,
      project.organisationName || "Personal",
      project.environments.length > 0
        ? project.environments.join(", ")
        : "single-env",
      project.permission,
    ]);

    writeLine(
      io,
      formatTable(
        ["ID", "NAME", "ORGANISATION", "ENVIRONMENTS", "PERMISSION"],
        rows,
      ),
    );
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}

export async function runProjectsCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case undefined:
    case "list":
      return runProjectsList(subcommand ? rest : [], io);
    case "--help":
    case "-h":
    case "help":
      writeLine(
        io,
        "Usage: rocketflag projects list [--token <token>] [--api-url <url>] [--json]",
      );
      return EXIT_OK;
    default:
      if (subcommand.startsWith("-")) {
        return runProjectsList(args, io);
      }
      writeErrorLine(
        io,
        `Unknown projects subcommand '${subcommand}'. Expected: list.`,
      );
      return EXIT_USAGE;
  }
}
