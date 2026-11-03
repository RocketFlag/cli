import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  createManagementClient,
  type RocketFlagManagementClient,
} from "@rocketflag/management";
import { registerRocketFlagTools } from "./tools.js";

export const MCP_SERVER_NAME = "@rocketflag/mcp";
export const MCP_SERVER_VERSION = "0.1.0";

export const MISSING_TOKEN_MESSAGE =
  "Missing ROCKETFLAG_TOKEN environment variable. Create an API token in the RocketFlag console under Project > Tokens and set ROCKETFLAG_TOKEN=rf_...";

export function validateRocketFlagToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.ROCKETFLAG_TOKEN?.trim();
  if (!token) {
    throw new Error(MISSING_TOKEN_MESSAGE);
  }
  return token;
}

export function createRocketFlagMcpServer(
  client: RocketFlagManagementClient,
): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerRocketFlagTools(server, client);
  return server;
}

export interface StartRocketFlagMcpServerOptions {
  env?: NodeJS.ProcessEnv;
  stderr?: { write(msg: string): unknown };
  exit?: (code: number) => void;
  transport?: Transport;
}

export async function startRocketFlagMcpServer(
  options?: StartRocketFlagMcpServerOptions,
): Promise<McpServer | null> {
  const env = options?.env ?? process.env;
  const stderr = options?.stderr ?? process.stderr;
  const exit = options?.exit ?? ((code: number) => process.exit(code));

  let token: string;
  try {
    token = validateRocketFlagToken(env);
  } catch (err) {
    const message = err instanceof Error ? err.message : MISSING_TOKEN_MESSAGE;
    stderr.write(`${message}\n`);
    exit(1);
    return null;
  }

  const rawApiUrl = env.ROCKETFLAG_API_URL?.trim();
  const apiUrl = rawApiUrl === "" ? undefined : rawApiUrl;

  const client = createManagementClient({
    token,
    apiUrl,
    clientName: "mcp",
    clientVersion: MCP_SERVER_VERSION,
  });

  const server = createRocketFlagMcpServer(client);
  const transport = options?.transport ?? new StdioServerTransport();
  await server.connect(transport);
  return server;
}
