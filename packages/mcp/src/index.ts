#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startRocketFlagMcpServer } from "./server.js";

export {
  formatMcpError,
  formatToolError,
  formatToolSuccess,
  formatWhoamiPayload,
  type WhoamiFormattedPayload,
} from "./format.js";
export {
  createRocketFlagMcpServer,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MISSING_TOKEN_MESSAGE,
  startRocketFlagMcpServer,
  validateRocketFlagToken,
  type StartRocketFlagMcpServerOptions,
} from "./server.js";
export { normalizeOptionalEnv, registerRocketFlagTools } from "./tools.js";

function isExecutedDirectly(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) {
    return false;
  }
  try {
    const currentFile = realpathSync(fileURLToPath(import.meta.url));
    const entryFile = realpathSync(resolve(entryArg));
    return currentFile === entryFile;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  startRocketFlagMcpServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
