import {
  RocketFlagApiError,
  RocketFlagNetworkError,
  type RocketFlagErrorEnvelope,
} from "./errors.js";
import type {
  CreateFlagInput,
  EvaluateFlagOptions,
  EvaluateFlagResult,
  FlagStatePatch,
  PatchFlagResult,
  PublicFlag,
  PublicProject,
  ToggleFlagResult,
  TokenInfo,
} from "./types.js";

const DEFAULT_API_URL = "https://api.rocketflag.app";
const DEFAULT_CLIENT_NAME = "management";
const DEFAULT_CLIENT_VERSION = "1.0.0";
const ENV_REGEX = /^[A-Za-z0-9_-]+$/;
const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]+$/;

function validateFlagId(id: string): void {
  if (!id || id === "." || id === "..") {
    throw new Error(`Invalid flag id: '${id}'`);
  }
}

function validateEnvName(env?: string): void {
  if (env !== undefined && env !== "" && !ENV_REGEX.test(env)) {
    throw new Error(
      `env values may only contain letters, numbers, hyphens and underscores. Invalid value for env: ${env}`,
    );
  }
}

export interface RocketFlagManagementClientOptions {
  token: string;
  apiUrl?: string;
  projectId?: string;
  clientName?: string;
  clientVersion?: string;
  fetch?: typeof globalThis.fetch;
}

function stripUndefinedFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function serializeFlagStatePatch(patch: FlagStatePatch): Record<string, unknown> {
  return stripUndefinedFields({
    enabled: patch.enabled,
    trafficPercentage: patch.trafficPercentage,
    cohorts: patch.cohorts,
    audienceId: patch.audienceId,
  });
}

function serializeCreateFlagInput(input: CreateFlagInput): Record<string, unknown> {
  let environments: Record<string, Record<string, unknown>> | undefined;
  if (input.environments !== undefined) {
    environments = {};
    for (const [envName, envPatch] of Object.entries(input.environments)) {
      environments[envName] = serializeFlagStatePatch(envPatch);
    }
  }

  return stripUndefinedFields({
    name: input.name,
    description: input.description,
    tags: input.tags,
    enabled: input.enabled,
    trafficPercentage: input.trafficPercentage,
    cohorts: input.cohorts,
    audienceId: input.audienceId,
    environments,
  });
}

function isErrorEnvelope(value: unknown): value is RocketFlagErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.error === "string" &&
    typeof record.detail === "string" &&
    (record.docs === undefined || typeof record.docs === "string")
  );
}

export class RocketFlagManagementClient {
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly projectId?: string;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: RocketFlagManagementClientOptions) {
    this.token = options.token;
    const rawUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid apiUrl: '${rawUrl}'`);
    }
    const isLoopback =
      parsedUrl.hostname === "127.0.0.1" ||
      parsedUrl.hostname === "localhost" ||
      parsedUrl.hostname === "[::1]";
    if (
      parsedUrl.protocol !== "https:" &&
      !(parsedUrl.protocol === "http:" && isLoopback)
    ) {
      throw new Error(
        `Insecure apiUrl '${rawUrl}': must use https:// (http:// is only permitted for localhost).`,
      );
    }
    this.apiUrl = rawUrl;
    const trimmedProjectId = options.projectId?.trim();
    if (trimmedProjectId && trimmedProjectId.length > 0) {
      if (!PROJECT_ID_REGEX.test(trimmedProjectId)) {
        throw new Error(`Invalid projectId: '${trimmedProjectId}'`);
      }
      this.projectId = trimmedProjectId;
    } else {
      this.projectId = undefined;
    }
    this.clientName = options.clientName ?? DEFAULT_CLIENT_NAME;
    this.clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  public async getToken(): Promise<TokenInfo> {
    return this.request<TokenInfo>("/api/v1/token", {
      method: "GET",
      authenticated: true,
    });
  }

  public async listProjects(): Promise<PublicProject[]> {
    const response = await this.request<{ projects: PublicProject[] }>(
      "/api/v1/projects",
      {
        method: "GET",
        authenticated: true,
      },
    );
    return response.projects;
  }

  public async revokeSession(): Promise<void> {
    await this.request<void>("/api/v1/session/revoke", {
      method: "POST",
      authenticated: true,
    });
  }

  public async listFlags(options?: { name?: string }): Promise<PublicFlag[]> {
    const query = new URLSearchParams();
    if (options?.name !== undefined && options.name !== "") {
      query.set("name", options.name);
    }
    const response = await this.request<{ flags: PublicFlag[] }>("/api/v1/flags", {
      method: "GET",
      query,
      authenticated: true,
    });
    return response.flags;
  }

  public async getFlag(
    id: string,
    options?: { env?: string },
  ): Promise<PublicFlag> {
    validateFlagId(id);
    validateEnvName(options?.env);
    const query = new URLSearchParams();
    if (options?.env !== undefined && options.env !== "") {
      query.set("env", options.env);
    }
    return this.request<PublicFlag>(
      `/api/v1/flags/${encodeURIComponent(id)}`,
      {
        method: "GET",
        query,
        authenticated: true,
      },
    );
  }

  public async createFlag(input: CreateFlagInput): Promise<PublicFlag> {
    return this.request<PublicFlag>("/api/v1/flags", {
      method: "POST",
      body: serializeCreateFlagInput(input),
      authenticated: true,
    });
  }

  public async patchFlag(
    id: string,
    patch: FlagStatePatch,
    options?: { env?: string },
  ): Promise<PatchFlagResult> {
    validateFlagId(id);
    validateEnvName(options?.env);
    const query = new URLSearchParams();
    if (options?.env !== undefined && options.env !== "") {
      query.set("env", options.env);
    }
    return this.request<PatchFlagResult>(
      `/api/v1/flags/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        query,
        body: serializeFlagStatePatch(patch),
        authenticated: true,
      },
    );
  }

  public async toggleFlag(
    id: string,
    options?: { env?: string; enabled?: boolean },
  ): Promise<ToggleFlagResult> {
    validateFlagId(id);
    validateEnvName(options?.env);
    const currentFlag = await this.getFlag(id, { env: options?.env });
    const previous = currentFlag.enabled;
    if (typeof previous !== "boolean") {
      throw new Error(
        "Cannot toggle a multi-environment flag without specifying an environment (env).",
      );
    }

    const target =
      options?.enabled !== undefined ? options.enabled : !previous;
    const result = await this.patchFlag(
      id,
      { enabled: target },
      { env: options?.env },
    );

    return {
      previous,
      current: result.flag.enabled ?? target,
      changed: result.changed,
      flag: result.flag,
    };
  }

  public async evaluateFlag(
    id: string,
    options?: EvaluateFlagOptions,
  ): Promise<EvaluateFlagResult> {
    validateFlagId(id);
    if (options?.env !== undefined) {
      if (!ENV_REGEX.test(options.env)) {
        throw new Error(
          `env values may only contain letters, numbers, hyphens and underscores. Invalid value for env: ${options.env}`,
        );
      }
    }

    const query = new URLSearchParams();
    if (options?.env !== undefined) {
      query.append("env", options.env);
    }
    if (options?.cohort !== undefined) {
      query.append("cohort", String(options.cohort));
    }
    if (options?.targetingKey !== undefined) {
      query.append("targetingKey", String(options.targetingKey));
    }
    if (options?.attributes !== undefined) {
      for (const [key, value] of Object.entries(options.attributes)) {
        query.append(key, String(value));
      }
    }

    return this.request<EvaluateFlagResult>(
      `/v1/flags/${encodeURIComponent(id)}`,
      {
        method: "GET",
        query,
        authenticated: false,
      },
    );
  }

  private buildHeaders(authenticated: boolean, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RocketFlag-Client": `${this.clientName}/${this.clientVersion}`,
      "User-Agent": `rocketflag-${this.clientName}/${this.clientVersion} node/${process.versions.node} ${process.platform}-${process.arch}`,
      Accept: "application/json",
    };

    if (authenticated) {
      headers.Authorization = `Bearer ${this.token}`;
      if (this.projectId) {
        headers["X-RocketFlag-Project"] = this.projectId;
      }
    }

    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST" | "PATCH";
      query?: URLSearchParams;
      body?: Record<string, unknown>;
      authenticated: boolean;
    },
  ): Promise<T> {
    const queryStr = options.query?.toString() ?? "";
    const url = queryStr
      ? `${this.apiUrl}${path}?${queryStr}`
      : `${this.apiUrl}${path}`;

    const hasBody = options.body !== undefined;
    const init: RequestInit = {
      method: options.method,
      headers: this.buildHeaders(options.authenticated, hasBody),
    };

    if (hasBody) {
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown network error";
      throw new RocketFlagNetworkError(`Network error: ${message}`, {
        cause: err,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed: unknown;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      if (isErrorEnvelope(parsed)) {
        throw new RocketFlagApiError(response.status, parsed);
      }

      const fallbackDetail =
        text.trim() || response.statusText || "Request failed";
      throw new RocketFlagApiError(response.status, {
        error: `HTTP ${response.status}`,
        detail: fallbackDetail,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

export function createManagementClient(
  options: RocketFlagManagementClientOptions,
): RocketFlagManagementClient {
  return new RocketFlagManagementClient(options);
}
