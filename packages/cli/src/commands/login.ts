import { execFile } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
} from "@rocketflag/management";
import {
  isUserSessionToken,
  loadUserConfig,
  normalizeOptionalEnv,
  resolveApiUrl,
  resolveConsoleUrl,
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
export const CLI_CLIENT_VERSION = "1.3.0";

const DEFAULT_LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;

export function defaultOpenBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    try {
      const child = execFile(cmd, args, (err) => {
        resolve(!err);
      });
      child.unref();
    } catch {
      resolve(false);
    }
  });
}

function renderHtmlPage(title: string, bodyText: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body {
      background: #0c0d10;
      color: #eceef2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #14161b;
      border: 1px solid #262932;
      padding: 2rem;
      max-width: 460px;
    }
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.75rem 0;
    }
    p {
      color: #a0a6b2;
      margin: 0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${bodyText}</p>
  </div>
</body>
</html>`;
}

export async function defaultStartLoopbackAuth(options: {
  consoleUrl: string;
  deviceName: string;
  openBrowser: (url: string) => Promise<boolean>;
  onAuthUrl?: (url: string) => void;
  timeoutMs?: number;
}): Promise<string> {
  const state = crypto.randomBytes(24).toString("base64url");
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      server.close();
    };

    const finishResolve = (token: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || urlObj.pathname !== "/callback") {
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
          Connection: "close",
        });
        res.end("Not found");
        return;
      }

      const returnedState = urlObj.searchParams.get("state") ?? "";
      if (returnedState !== state) {
        res.writeHead(400, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        res.end(
          renderHtmlPage(
            "Invalid authentication state",
            "The authentication state parameter did not match. Please return to your terminal and try again.",
          ),
        );
        finishReject(new Error("Invalid state parameter in browser callback."));
        return;
      }

      const errorParam = urlObj.searchParams.get("error");
      if (errorParam) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        res.end(
          renderHtmlPage(
            "Authentication cancelled",
            "RocketFlag CLI authentication was cancelled. You can close this tab and return to your terminal.",
          ),
        );
        finishReject(new Error("Authentication cancelled in browser."));
        return;
      }

      const token = (urlObj.searchParams.get("token") ?? "").trim();
      if (!isUserSessionToken(token)) {
        res.writeHead(400, {
          "Content-Type": "text/html; charset=utf-8",
          Connection: "close",
        });
        res.end(
          renderHtmlPage(
            "Invalid CLI token",
            "The callback did not include a valid RocketFlag CLI session token.",
          ),
        );
        finishReject(
          new Error("Browser callback did not provide a valid rfu_ token."),
        );
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        Connection: "close",
      });
      res.end(
        renderHtmlPage(
          "Authenticated with RocketFlag",
          "Authenticated with RocketFlag. You can close this tab and return to your terminal.",
        ),
      );
      finishResolve(token);
    });

    server.on("error", (err) => {
      finishReject(err instanceof Error ? err : new Error(String(err)));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        finishReject(new Error("Failed to bind local callback server."));
        return;
      }

      const authUrl = `${options.consoleUrl}/cli/auth?port=${address.port}&state=${encodeURIComponent(state)}&device=${encodeURIComponent(options.deviceName)}`;
      options.onAuthUrl?.(authUrl);

      timer = setTimeout(() => {
        finishReject(
          new Error(
            "Timed out waiting for browser authentication. Try again or run 'rocketflag login --no-browser'.",
          ),
        );
      }, timeoutMs);

      void options.openBrowser(authUrl);
    });
  });
}

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
        "no-browser": { type: "boolean", default: false },
        "device-name": { type: "string" },
        "api-url": { type: "string" },
        "console-url": { type: "string" },
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
      "Usage: rocketflag login [--token <rf_...|rfu_...>] [--no-browser] [--device-name <name>] [--api-url <url>] [--console-url <url>] [--json]",
    );
    return EXIT_OK;
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
  const consoleUrl = resolveConsoleUrl({
    flagConsoleUrl: parsed.values["console-url"],
    env: io.env,
    apiUrl,
  });
  const deviceName =
    normalizeOptionalEnv(parsed.values["device-name"]) ??
    normalizeOptionalEnv(os.hostname()) ??
    "RocketFlag CLI";

  let token =
    normalizeOptionalEnv(parsed.values.token) ??
    normalizeOptionalEnv(io.env.ROCKETFLAG_TOKEN);

  if (token === undefined) {
    if (parsed.values["no-browser"]) {
      const manualUrl = `${consoleUrl}/cli/auth?device=${encodeURIComponent(deviceName)}`;
      writeLine(io, `Open this URL in your browser to authorise the CLI:`);
      writeLine(io, `  ${manualUrl}`);
      if (!io.promptToken) {
        writeErrorLine(
          io,
          "Interactive token prompt is unavailable. Run 'rocketflag login --token <token>' with the token from the browser.",
        );
        return EXIT_USAGE;
      }
      token = normalizeOptionalEnv(await io.promptToken());
    } else if (io.startLoopbackAuth) {
      try {
        const openBrowser = io.openBrowser ?? defaultOpenBrowser;
        token = normalizeOptionalEnv(
          await io.startLoopbackAuth({
            consoleUrl,
            deviceName,
            openBrowser,
            onAuthUrl: (url) => {
              if (!parsed.values.json) {
                writeLine(io, "Opening browser to authenticate...");
                writeLine(io, `If your browser does not open, visit:\n  ${url}`);
              }
            },
          }),
        );
      } catch (err) {
        return handleCommandError(io, err);
      }
    } else if (io.openBrowser) {
      try {
        token = normalizeOptionalEnv(
          await defaultStartLoopbackAuth({
            consoleUrl,
            deviceName,
            openBrowser: io.openBrowser,
            onAuthUrl: (url) => {
              if (!parsed.values.json) {
                writeLine(io, "Opening browser to authenticate...");
                writeLine(io, `If your browser does not open, visit:\n  ${url}`);
              }
            },
          }),
        );
      } catch (err) {
        return handleCommandError(io, err);
      }
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      try {
        token = normalizeOptionalEnv(
          await defaultStartLoopbackAuth({
            consoleUrl,
            deviceName,
            openBrowser: defaultOpenBrowser,
            onAuthUrl: (url) => {
              if (!parsed.values.json) {
                writeLine(io, "Opening browser to authenticate...");
                writeLine(io, `If your browser does not open, visit:\n  ${url}`);
              }
            },
          }),
        );
      } catch (err) {
        return handleCommandError(io, err);
      }
    } else if (io.promptToken) {
      token = normalizeOptionalEnv(await io.promptToken());
    }
  }

  if (token === undefined) {
    writeErrorLine(
      io,
      "Missing API token. Run 'rocketflag login' in an interactive terminal, pass --token <token>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_USAGE;
  }

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

    if (tokenInfo.kind === "user" || tokenInfo.user || isUserSessionToken(token)) {
      const userLabel = tokenInfo.user
        ? `${tokenInfo.user.name} (${tokenInfo.user.email})`
        : tokenInfo.name;
      writeLine(io, `Authenticated as ${userLabel}.`);
      writeLine(io, `Session: ${tokenInfo.name} (${tokenInfo.id})`);
      if (tokenInfo.expiresAt) {
        writeLine(
          io,
          `Expires: ${new Date(tokenInfo.expiresAt).toISOString()}`,
        );
      }
      writeLine(io, `Saved credentials to ${configPath}`);
      writeLine(
        io,
        `Next: run 'rocketflag init' in a repository or 'rocketflag projects list' to view your projects.`,
      );
      return EXIT_OK;
    }

    writeLine(io, `Authenticated with RocketFlag.`);
    if (tokenInfo.project) {
      writeLine(
        io,
        `Project: ${tokenInfo.project.name} (${tokenInfo.project.id})`,
      );
    }
    writeLine(io, `Token: ${tokenInfo.name} (${tokenInfo.id})`);
    if (tokenInfo.permission) {
      writeLine(io, `Permission: ${tokenInfo.permission}`);
    }
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
