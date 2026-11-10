import { runFlagsCommand } from "./commands/flags.js";
import { runInitCommand } from "./commands/init.js";
import { CLI_CLIENT_VERSION, runLoginCommand } from "./commands/login.js";
import { runLogoutCommand } from "./commands/logout.js";
import { runProjectsCommand } from "./commands/projects.js";
import {
  maybePrintUpdateNotice,
  runUpdateCommand,
} from "./commands/update.js";
import { runWhoamiCommand } from "./commands/whoami.js";
import {
  createDefaultIo,
  EXIT_OK,
  EXIT_USAGE,
  writeErrorLine,
  writeLine,
  type CliIo,
} from "./output.js";

const HELP_TEXT = `rocketflag v${CLI_CLIENT_VERSION} - RocketFlag command-line interface

Usage:
  rocketflag <command> [options]

Commands:
  login                         Authenticate in your browser (or via --token) and save credentials
  logout                        Revoke active CLI session and remove saved credentials
  whoami                        Inspect active session or API token, permissions, and project environments
  projects list                 List projects accessible to your account or API token
  init                          Initialise .rocketflag.json in the current repository
  flags list [--name <exact>]   List feature flags in the project
  flags get <id> [--env <env>]  Fetch details for a feature flag
  flags create <name> [options] Create a new feature flag
  flags update <id> [options]   Update a feature flag's state, percentage, cohorts, or audience
  flags toggle <id> [options]   Toggle a feature flag on or off
  flags eval <id> [options]     Evaluate a feature flag via the public Evaluation API
  update [--check]              Check for a newer CLI version and update @rocketflag/cli

Global options:
  --project <id>                Override target project ID (or set ROCKETFLAG_PROJECT)
  --token <rf_...|rfu_...>      Override API token or user session token (or set ROCKETFLAG_TOKEN)
  --env <name>                  Override target environment (or set ROCKETFLAG_ENV)
  --api-url <url>               Override API base URL (or set ROCKETFLAG_API_URL)
  --json                        Output machine-readable JSON
  -h, --help                    Show help
  -v, --version                 Show version`;

export async function runCli(
  argv: string[],
  ioOverrides?: Partial<CliIo>,
): Promise<number> {
  const io = createDefaultIo(ioOverrides);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    writeLine(io, HELP_TEXT);
    return EXIT_OK;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    writeLine(io, CLI_CLIENT_VERSION);
    return EXIT_OK;
  }

  let exitCode: number;
  switch (command) {
    case "login":
      exitCode = await runLoginCommand(rest, io);
      break;
    case "logout":
      exitCode = await runLogoutCommand(rest, io);
      break;
    case "whoami":
      exitCode = await runWhoamiCommand(rest, io);
      break;
    case "projects":
      exitCode = await runProjectsCommand(rest, io);
      break;
    case "init":
      exitCode = await runInitCommand(rest, io);
      break;
    case "flags":
      exitCode = await runFlagsCommand(rest, io);
      break;
    case "update":
    case "upgrade":
      return runUpdateCommand(rest, io);
    default:
      writeErrorLine(
        io,
        `Unknown command '${command}'. Run 'rocketflag --help' for usage.`,
      );
      return EXIT_USAGE;
  }

  await maybePrintUpdateNotice(argv, io);
  return exitCode;
}
