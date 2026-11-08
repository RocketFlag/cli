import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const cliBinPath = path.join(repoRoot, "packages/cli/dist/index.js");

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

interface StoredEnvState {
  enabled: boolean;
  trafficPercentage: number;
  cohorts: string[];
  audienceId: string | null;
}

interface StoredFlag {
  id: string;
  name: string;
  environments: Record<string, StoredEnvState>;
}

interface CliExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCliSubprocess(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<CliExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliBinPath, ...args],
      {
        cwd: options.cwd,
        env: options.env,
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const execErr = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof execErr.code === "number" ? execErr.code : 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
    };
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("End-to-end subprocess suite (compiled CLI binary)", () => {
  let tempDir: string;
  let configDir: string;
  let workspaceDir: string;
  let server: http.Server;
  let apiUrl: string;
  let recordedRequests: RecordedRequest[];
  let flagsById: Map<string, StoredFlag>;
  let nextFlagSeq: number;

  const validWriteToken = "rf_live_e2e_write_token";
  const validUserToken = "rfu_live_e2e_user_session";

  function serializeFlag(flag: StoredFlag, env?: string) {
    if (env) {
      const state = flag.environments[env] ?? {
        enabled: false,
        trafficPercentage: 0,
        cohorts: [],
        audienceId: null,
      };
      return {
        kind: "environment_flag",
        id: flag.id,
        name: flag.name,
        environment: env,
        enabled: state.enabled,
        trafficPercentage: state.trafficPercentage,
        cohorts: state.cohorts,
        audienceId: state.audienceId,
      };
    }
    return {
      kind: "environment_flag",
      id: flag.id,
      name: flag.name,
      environments: flag.environments,
    };
  }

  beforeEach(async () => {
    tempDir = path.join(
      os.tmpdir(),
      `rocketflag-e2e-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    configDir = path.join(tempDir, "config");
    workspaceDir = path.join(tempDir, "workspace");
    await mkdir(configDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    recordedRequests = [];
    flagsById = new Map();
    nextFlagSeq = 1;

    server = http.createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const urlObj = new URL(req.url ?? "/", "http://127.0.0.1");
      const body = await readJsonBody(req);

      recordedRequests.push({
        method,
        url: `${urlObj.pathname}${urlObj.search}`,
        headers: req.headers,
        body,
      });

      // Public Evaluation API: GET /v1/flags/:id
      if (method === "GET" && urlObj.pathname.startsWith("/v1/flags/")) {
        const id = decodeURIComponent(
          urlObj.pathname.slice("/v1/flags/".length),
        );
        const flag = flagsById.get(id);
        if (!flag) {
          sendJson(res, 404, {
            error: "Not Found",
            detail: `Flag '${id}' was not found.`,
          });
          return;
        }
        const env = urlObj.searchParams.get("env") ?? "staging";
        const state = flag.environments[env];
        sendJson(res, 200, {
          id: flag.id,
          name: flag.name,
          enabled: state ? state.enabled : false,
        });
        return;
      }

      // Management API requires Bearer token
      const authHeader = req.headers.authorization;
      const isProjectToken = authHeader === `Bearer ${validWriteToken}`;
      const isUserToken = authHeader === `Bearer ${validUserToken}`;
      if (!isProjectToken && !isUserToken) {
        sendJson(res, 401, {
          error: "Unauthorized",
          detail: "Invalid or expired API token.",
        });
        return;
      }

      if (method === "GET" && urlObj.pathname === "/api/v1/token") {
        if (isUserToken) {
          const projectHeader = req.headers["x-rocketflag-project"];
          sendJson(res, 200, {
            kind: "user",
            id: "Cs_e2e_1",
            name: "E2E Workstation",
            expiresAt: 1798675200000,
            user: {
              id: "Usr_e2e_1",
              email: "jk@rocketflag.app",
              name: "JK Gunnink",
            },
            ...(projectHeader === "Pj_e2e_1"
              ? {
                  project: {
                    id: "Pj_e2e_1",
                    name: "RocketFlag E2E Project",
                    environments: ["staging", "production"],
                  },
                  permission: "write",
                }
              : {}),
          });
          return;
        }
        sendJson(res, 200, {
          kind: "token",
          id: "Tk_e2e_1",
          name: "E2E Write Token",
          permission: "write",
          environments: [],
          project: {
            id: "Pj_e2e_1",
            name: "RocketFlag E2E Project",
            environments: ["staging", "production"],
          },
          createdAt: 1700000000000,
          lastUsedAt: 1700000001000,
          expiresAt: null,
        });
        return;
      }

      if (method === "GET" && urlObj.pathname === "/api/v1/projects") {
        sendJson(res, 200, {
          projects: [
            {
              id: "Pj_e2e_1",
              name: "RocketFlag E2E Project",
              organisationId: "Org_e2e_1",
              organisationName: "RocketFlag Org",
              environments: ["staging", "production"],
              permission: "write",
            },
          ],
        });
        return;
      }

      if (method === "POST" && urlObj.pathname === "/api/v1/session/revoke") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (isUserToken && req.headers["x-rocketflag-project"] !== "Pj_e2e_1") {
        sendJson(res, 400, {
          error: "Invalid request",
          detail: "X-RocketFlag-Project header is required for user sessions.",
        });
        return;
      }

      if (method === "POST" && urlObj.pathname === "/api/v1/flags") {
        const payload = (body ?? {}) as {
          name?: string;
          environments?: Record<string, Partial<StoredEnvState>>;
        };
        const id = `flg_e2e_${nextFlagSeq++}`;
        const defaultState = (): StoredEnvState => ({
          enabled: false,
          trafficPercentage: 100,
          cohorts: [],
          audienceId: null,
        });
        const environments: Record<string, StoredEnvState> = {
          staging: defaultState(),
          production: defaultState(),
        };
        if (payload.environments) {
          for (const [envName, patch] of Object.entries(payload.environments)) {
            environments[envName] = {
              enabled: patch.enabled ?? false,
              trafficPercentage: patch.trafficPercentage ?? 100,
              cohorts: patch.cohorts ?? [],
              audienceId: patch.audienceId ?? null,
            };
          }
        }
        const stored: StoredFlag = {
          id,
          name: payload.name ?? "unnamed_flag",
          environments,
        };
        flagsById.set(id, stored);
        sendJson(res, 201, serializeFlag(stored));
        return;
      }

      if (method === "GET" && urlObj.pathname === "/api/v1/flags") {
        const nameFilter = urlObj.searchParams.get("name");
        const all = Array.from(flagsById.values()).filter((f) =>
          nameFilter ? f.name === nameFilter : true,
        );
        sendJson(res, 200, {
          flags: all.map((f) => serializeFlag(f)),
        });
        return;
      }

      if (urlObj.pathname.startsWith("/api/v1/flags/")) {
        const id = decodeURIComponent(
          urlObj.pathname.slice("/api/v1/flags/".length),
        );
        const flag = flagsById.get(id);
        if (!flag) {
          sendJson(res, 404, {
            error: "Not Found",
            detail: `Flag '${id}' was not found.`,
          });
          return;
        }
        const env = urlObj.searchParams.get("env") ?? undefined;

        if (method === "GET") {
          sendJson(res, 200, serializeFlag(flag, env));
          return;
        }

        if (method === "PATCH") {
          const patch = (body ?? {}) as Partial<StoredEnvState>;
          const targetEnv = env ?? "staging";
          const existing = flag.environments[targetEnv] ?? {
            enabled: false,
            trafficPercentage: 0,
            cohorts: [],
            audienceId: null,
          };
          const updated: StoredEnvState = {
            enabled: patch.enabled ?? existing.enabled,
            trafficPercentage:
              patch.trafficPercentage ?? existing.trafficPercentage,
            cohorts: patch.cohorts ?? existing.cohorts,
            audienceId:
              patch.audienceId !== undefined
                ? patch.audienceId
                : existing.audienceId,
          };
          const changed = existing.enabled !== updated.enabled;
          flag.environments[targetEnv] = updated;
          sendJson(res, 200, {
            changed,
            flag: serializeFlag(flag, targetEnv),
          });
          return;
        }
      }

      sendJson(res, 404, { error: "Not Found", detail: "Route not found" });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address() as AddressInfo;
    apiUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  it("executes full CLI workflow and error exit codes against a live HTTP server", async () => {
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ROCKETFLAG_CONFIG_DIR: configDir,
      ROCKETFLAG_TOKEN: undefined,
      ROCKETFLAG_ENV: undefined,
      ROCKETFLAG_API_URL: undefined,
    };

    // 1. login --token rf_... --api-url ...
    const loginRes = await runCliSubprocess(
      ["login", "--token", validWriteToken, "--api-url", apiUrl],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(loginRes.code).toBe(0);
    expect(loginRes.stdout).toContain("Authenticated with RocketFlag.");

    const configFile = path.join(configDir, "config.json");
    const configStat = await stat(configFile);
    expect(configStat.mode & 0o777).toBe(0o600);

    // 2. whoami --json
    const whoamiRes = await runCliSubprocess(["whoami", "--json"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(whoamiRes.code).toBe(0);
    const whoamiJson = JSON.parse(whoamiRes.stdout) as {
      token: { id: string; permission: string };
      multiEnvironment: boolean;
      allowedEnvironments: string[];
    };
    expect(whoamiJson.token.id).toBe("Tk_e2e_1");
    expect(whoamiJson.token.permission).toBe("write");
    expect(whoamiJson.multiEnvironment).toBe(true);
    expect(whoamiJson.allowedEnvironments).toEqual(["staging", "production"]);

    // 3. init --env staging
    const initRes = await runCliSubprocess(["init", "--env", "staging"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(initRes.code).toBe(0);
    const repoConfigRaw = await readFile(
      path.join(workspaceDir, ".rocketflag.json"),
      "utf8",
    );
    const repoConfig = JSON.parse(repoConfigRaw) as Record<string, unknown>;
    expect(repoConfig).toEqual({
      projectId: "Pj_e2e_1",
      defaultEnv: "staging",
    });
    expect(repoConfig).not.toHaveProperty("token");

    // 4. flags create checkout_v2 --enabled --percentage 50
    const createRes = await runCliSubprocess(
      [
        "flags",
        "create",
        "checkout_v2",
        "--enabled",
        "--percentage",
        "50",
        "--json",
      ],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(createRes.code).toBe(0);
    const createdFlag = JSON.parse(createRes.stdout) as {
      id: string;
      name: string;
      environments: Record<
        string,
        { enabled: boolean; trafficPercentage: number }
      >;
    };
    expect(createdFlag.id).toBe("flg_e2e_1");
    expect(createdFlag.name).toBe("checkout_v2");
    expect(createdFlag.environments.staging?.enabled).toBe(true);
    expect(createdFlag.environments.staging?.trafficPercentage).toBe(50);

    // 5. flags list
    const listRes = await runCliSubprocess(["flags", "list"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(listRes.code).toBe(0);
    expect(listRes.stdout).toContain("flg_e2e_1");
    expect(listRes.stdout).toContain("checkout_v2");

    // 6. flags get <id>
    const getRes = await runCliSubprocess(["flags", "get", createdFlag.id], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(getRes.code).toBe(0);
    expect(getRes.stdout).toContain(`ID: ${createdFlag.id}`);
    expect(getRes.stdout).toContain("Environment: staging");
    expect(getRes.stdout).toContain("Enabled: true");

    // 7. flags toggle <id> --json
    const toggleRes = await runCliSubprocess(
      ["flags", "toggle", createdFlag.id, "--json"],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(toggleRes.code).toBe(0);
    const toggleJson = JSON.parse(toggleRes.stdout) as {
      id: string;
      environment: string;
      previous: boolean;
      current: boolean;
      changed: boolean;
    };
    expect(toggleJson.id).toBe(createdFlag.id);
    expect(toggleJson.environment).toBe("staging");
    expect(toggleJson.previous).toBe(true);
    expect(toggleJson.current).toBe(false);
    expect(toggleJson.changed).toBe(true);

    // 8. flags eval <id> --cohort beta --key user_1 --attr plan=pro --json
    const evalRes = await runCliSubprocess(
      [
        "flags",
        "eval",
        createdFlag.id,
        "--cohort",
        "beta",
        "--key",
        "user_1",
        "--attr",
        "plan=pro",
        "--json",
      ],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(evalRes.code).toBe(0);
    const evalJson = JSON.parse(evalRes.stdout) as {
      id: string;
      name: string;
      enabled: boolean;
    };
    expect(evalJson).toEqual({
      id: createdFlag.id,
      name: "checkout_v2",
      enabled: false,
    });

    const evalReq = recordedRequests.find((r) =>
      r.url.startsWith(`/v1/flags/${createdFlag.id}`),
    );
    expect(evalReq).toBeDefined();
    expect(evalReq?.headers.authorization).toBeUndefined();
    expect(evalReq?.headers["x-rocketflag-client"]).toBe("cli/1.2.0");
    expect(evalReq?.url).toContain("env=staging");
    expect(evalReq?.url).toContain("cohort=beta");
    expect(evalReq?.url).toContain("targetingKey=user_1");
    expect(evalReq?.url).toContain("plan=pro");

    // 9. Error exit codes: EXIT_USAGE (2) and EXIT_AUTH (3)
    const usageRes = await runCliSubprocess(
      ["flags", "toggle", createdFlag.id, "--on", "--off"],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(usageRes.code).toBe(2);

    const authRes = await runCliSubprocess(
      ["whoami", "--token", "rf_invalid_token"],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(authRes.code).toBe(3);

    // 10. User session workflow: login --token rfu_... -> projects list -> whoami -> flags list -> logout
    const userLoginRes = await runCliSubprocess(
      ["login", "--token", validUserToken, "--api-url", apiUrl],
      { cwd: workspaceDir, env: baseEnv },
    );
    expect(userLoginRes.code).toBe(0);
    expect(userLoginRes.stdout).toContain("Authenticated as JK Gunnink (jk@rocketflag.app)");

    const projectsRes = await runCliSubprocess(["projects", "list", "--json"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(projectsRes.code).toBe(0);
    expect(JSON.parse(projectsRes.stdout)).toEqual({
      projects: [
        {
          id: "Pj_e2e_1",
          name: "RocketFlag E2E Project",
          organisationId: "Org_e2e_1",
          organisationName: "RocketFlag Org",
          environments: ["staging", "production"],
          permission: "write",
        },
      ],
    });

    const userFlagsListRes = await runCliSubprocess(["flags", "list", "--json"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(userFlagsListRes.code).toBe(0);

    const logoutRes = await runCliSubprocess(["logout", "--json"], {
      cwd: workspaceDir,
      env: baseEnv,
    });
    expect(logoutRes.code).toBe(0);
    expect(JSON.parse(logoutRes.stdout).loggedOut).toBe(true);
  });
});
