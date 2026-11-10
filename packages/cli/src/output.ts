import readline from "node:readline/promises";
import { RocketFlagApiError, type PublicProject } from "@rocketflag/management";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_AUTH = 3;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  promptToken?: () => Promise<string>;
  promptSelectEnv?: (envs: string[]) => Promise<string>;
  promptSelectProject?: (projects: PublicProject[]) => Promise<string>;
  openBrowser?: (url: string) => Promise<boolean>;
  startLoopbackAuth?: (options: {
    consoleUrl: string;
    deviceName: string;
    openBrowser: (url: string) => Promise<boolean>;
    onAuthUrl?: (url: string) => void;
  }) => Promise<string>;
  fetch?: typeof globalThis.fetch;
}

export function createDefaultIo(overrides?: Partial<CliIo>): CliIo {
  const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const defaultPromptToken = isInteractive
    ? async (): Promise<string> => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        try {
          const answer = await rl.question("Enter RocketFlag token (rfu_... or rf_...): ");
          return answer.trim();
        } finally {
          rl.close();
        }
      }
    : undefined;

  const defaultPromptSelectEnv = isInteractive
    ? async (envs: string[]): Promise<string> => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        try {
          const answer = await rl.question(
            `Select default environment (${envs.join(", ")}): `,
          );
          return answer.trim();
        } finally {
          rl.close();
        }
      }
    : undefined;

  const defaultPromptSelectProject = isInteractive
    ? async (projects: PublicProject[]): Promise<string> => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        try {
          process.stderr.write("Available projects:\n");
          for (const [idx, project] of projects.entries()) {
            const orgLabel = project.organisationName || "Personal";
            process.stderr.write(
              `  ${idx + 1}. ${project.id}  ${project.name} (${orgLabel})\n`,
            );
          }
          const answer = await rl.question(
            `Select project (1-${projects.length} or project ID): `,
          );
          return answer.trim();
        } finally {
          rl.close();
        }
      }
    : undefined;

  return {
    stdout: overrides?.stdout ?? ((text: string) => process.stdout.write(text)),
    stderr: overrides?.stderr ?? ((text: string) => process.stderr.write(text)),
    env: overrides?.env ?? process.env,
    cwd: overrides?.cwd ?? process.cwd(),
    promptToken: overrides?.promptToken ?? defaultPromptToken,
    promptSelectEnv: overrides?.promptSelectEnv ?? defaultPromptSelectEnv,
    promptSelectProject:
      overrides?.promptSelectProject ?? defaultPromptSelectProject,
    openBrowser: overrides?.openBrowser,
    startLoopbackAuth: overrides?.startLoopbackAuth,
    fetch: overrides?.fetch,
  };
}

export function writeLine(io: CliIo, line = ""): void {
  io.stdout(line.endsWith("\n") ? line : `${line}\n`);
}

export function writeErrorLine(io: CliIo, line: string): void {
  io.stderr(line.endsWith("\n") ? line : `${line}\n`);
}

export function writeJson(io: CliIo, payload: unknown): void {
  writeLine(io, JSON.stringify(payload, null, 2));
}

export function formatStaleEnvWarning(staleEnvironments: string[]): string {
  return `Warning: token restricts to environment(s) [${staleEnvironments.join(", ")}] which no longer exist on this project.`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, colIndex) => {
    let max = header.length;
    for (const row of rows) {
      const cell = row[colIndex] ?? "";
      if (cell.length > max) {
        max = cell.length;
      }
    }
    return max;
  });

  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, idx) =>
        idx === cells.length - 1 ? cell : cell.padEnd(widths[idx] ?? 0, " "),
      )
      .join("  ");

  const lines = [formatRow(headers), ...rows.map(formatRow)];
  return lines.join("\n");
}

export function handleCommandError(io: CliIo, err: unknown): number {
  if (err instanceof RocketFlagApiError) {
    if (err.isUnauthorizedError()) {
      writeErrorLine(io, `Authentication failed (401): ${err.message}`);
      return EXIT_AUTH;
    }
    if (err.isReadOnlyTokenError()) {
      writeErrorLine(
        io,
        `Permission denied (403): ${err.message}. Create a Write token in the RocketFlag console under Project > Tokens to create or toggle flags.`,
      );
      return EXIT_AUTH;
    }
    if (err.isEnvironmentForbiddenError()) {
      writeErrorLine(io, `Environment not allowed (403): ${err.message}`);
      return EXIT_AUTH;
    }
    writeErrorLine(io, `Error (${err.status}): ${err.message}`);
    return EXIT_ERROR;
  }

  const message = err instanceof Error ? err.message : String(err);
  writeErrorLine(io, `Error: ${message}`);
  return EXIT_ERROR;
}
