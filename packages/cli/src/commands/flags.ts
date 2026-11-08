import { parseArgs } from "node:util";
import {
  createManagementClient,
  getAllowedEnvironments,
  isMultiEnvironmentProject,
  RocketFlagApiError,
  type ContextValue,
  type CreateFlagInput,
  type FlagStatePatch,
  type PublicFlag,
} from "@rocketflag/management";
import {
  findRepoConfig,
  loadUserConfig,
  normalizeOptionalEnv,
  resolveApiUrl,
  resolveEnvironment,
  resolveToken,
} from "../config.js";
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

function summarizeFlagState(flag: PublicFlag): string {
  if (typeof flag.enabled === "boolean") {
    const pct =
      typeof flag.trafficPercentage === "number"
        ? ` (${flag.trafficPercentage}%)`
        : "";
    const envPrefix = flag.environment ? `[${flag.environment}] ` : "";
    return `${envPrefix}${flag.enabled ? "on" : "off"}${pct}`;
  }
  if (flag.environments) {
    const entries = Object.entries(flag.environments);
    if (entries.length === 0) {
      return "no environments";
    }
    return entries
      .map(
        ([envName, state]) =>
          `${envName}:${state.enabled ? "on" : "off"}(${state.trafficPercentage}%)`,
      )
      .join(", ");
  }
  return "unknown";
}

function printHumanFlagDetail(io: CliIo, flag: PublicFlag): void {
  writeLine(io, `ID: ${flag.id}`);
  writeLine(io, `Name: ${flag.name}`);
  writeLine(io, `Kind: ${flag.kind}`);
  if (flag.environment) {
    writeLine(io, `Environment: ${flag.environment}`);
  }
  if (typeof flag.enabled === "boolean") {
    writeLine(io, `Enabled: ${flag.enabled}`);
    if (typeof flag.trafficPercentage === "number") {
      writeLine(io, `Traffic percentage: ${flag.trafficPercentage}%`);
    }
    if (flag.cohorts) {
      writeLine(
        io,
        `Cohorts: ${flag.cohorts.length > 0 ? flag.cohorts.join(", ") : "none"}`,
      );
    }
    if (flag.audienceId !== undefined) {
      writeLine(io, `Audience ID: ${flag.audienceId ?? "none"}`);
    }
  } else if (flag.environments) {
    writeLine(io, "Environments:");
    for (const [envName, state] of Object.entries(flag.environments)) {
      writeLine(
        io,
        `  ${envName}: enabled=${state.enabled}, traffic=${state.trafficPercentage}%, cohorts=${state.cohorts.join(",") || "none"}, audience=${state.audienceId ?? "none"}`,
      );
    }
  }
}

async function createAuthenticatedClient(
  io: CliIo,
  options: { flagToken?: string; flagApiUrl?: string },
) {
  const userConfig = await loadUserConfig({ env: io.env });
  const token = resolveToken({
    flagToken: options.flagToken,
    env: io.env,
    userConfig,
  });
  if (!token) {
    return null;
  }
  const apiUrl = resolveApiUrl({
    flagApiUrl: options.flagApiUrl,
    env: io.env,
    userConfig,
  });
  return createManagementClient({
    token,
    apiUrl,
    clientName: CLI_CLIENT_NAME,
    clientVersion: CLI_CLIENT_VERSION,
    fetch: io.fetch,
  });
}

async function runFlagsList(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        name: { type: "string" },
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
      "Usage: rocketflag flags list [--name <exact>] [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  const client = await createAuthenticatedClient(io, {
    flagToken: parsed.values.token,
    flagApiUrl: parsed.values["api-url"],
  });
  if (!client) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  try {
    const nameFilter = normalizeOptionalEnv(parsed.values.name);
    const flags = await client.listFlags({ name: nameFilter });

    if (parsed.values.json) {
      writeJson(io, { flags });
      return EXIT_OK;
    }

    if (flags.length === 0) {
      writeLine(io, "No flags found.");
      return EXIT_OK;
    }

    const rows = flags.map((flag) => [
      flag.id,
      flag.name,
      flag.kind,
      summarizeFlagState(flag),
    ]);
    writeLine(
      io,
      formatTable(["ID", "NAME", "KIND", "STATE / ENVIRONMENTS"], rows),
    );
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}

async function runFlagsGet(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
        token: { type: "string" },
        "api-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(
      io,
      "Usage: rocketflag flags get <id> [--env <env>] [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  const id = normalizeOptionalEnv(parsed.positionals[0]);
  if (!id || parsed.positionals.length > 1) {
    writeErrorLine(io, "Usage: rocketflag flags get <id> [--env <env>] [--json]");
    return EXIT_USAGE;
  }

  const client = await createAuthenticatedClient(io, {
    flagToken: parsed.values.token,
    flagApiUrl: parsed.values["api-url"],
  });
  if (!client) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  const foundRepo = await findRepoConfig(io.cwd);
  const env = normalizeOptionalEnv(
    resolveEnvironment({
      flagEnv: parsed.values.env,
      env: io.env,
      repoConfig: foundRepo?.config,
    }),
  );

  try {
    const flag = await client.getFlag(id, { env });
    if (parsed.values.env !== undefined && flag.kind === "flag") {
      writeErrorLine(
        io,
        `Flag '${flag.name}' (${flag.id}) belongs to a single-environment project and does not use --env.`,
      );
      return EXIT_USAGE;
    }

    if (parsed.values.json) {
      writeJson(io, flag);
      return EXIT_OK;
    }

    printHumanFlagDetail(io, flag);
    return EXIT_OK;
  } catch (err) {
    if (
      err instanceof RocketFlagApiError &&
      (err.status === 400 || err.status === 422) &&
      parsed.values.env !== undefined &&
      /single|environment|env/i.test(err.message)
    ) {
      writeErrorLine(io, err.message);
      return EXIT_USAGE;
    }
    return handleCommandError(io, err);
  }
}

async function runFlagsCreate(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        description: { type: "string" },
        tag: { type: "string", multiple: true },
        enabled: { type: "boolean" },
        percentage: { type: "string" },
        cohort: { type: "string", multiple: true },
        audience: { type: "string" },
        env: { type: "string" },
        token: { type: "string" },
        "api-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(
      io,
      "Usage: rocketflag flags create <name> [--description <text>] [--tag <tag>...] [--enabled] [--percentage <0-100>] [--cohort <c>...] [--audience <id>] [--env <env>] [--json]",
    );
    return EXIT_OK;
  }

  const name = normalizeOptionalEnv(parsed.positionals[0]);
  if (!name || parsed.positionals.length > 1) {
    writeErrorLine(
      io,
      "Usage: rocketflag flags create <name> [--description <text>] [--tag <tag>...] [--enabled] [--percentage <0-100>] [--cohort <c>...] [--audience <id>] [--env <env>] [--json]",
    );
    return EXIT_USAGE;
  }

  let trafficPercentage: number | undefined;
  if (parsed.values.percentage !== undefined) {
    const rawPct = parsed.values.percentage.trim();
    if (!/^\d+$/.test(rawPct)) {
      writeErrorLine(
        io,
        `Invalid --percentage '${parsed.values.percentage}'. Must be an integer between 0 and 100.`,
      );
      return EXIT_USAGE;
    }
    const num = Number(rawPct);
    if (!Number.isInteger(num) || num < 0 || num > 100) {
      writeErrorLine(
        io,
        `Invalid --percentage '${parsed.values.percentage}'. Must be an integer between 0 and 100.`,
      );
      return EXIT_USAGE;
    }
    trafficPercentage = num;
  }

  const client = await createAuthenticatedClient(io, {
    flagToken: parsed.values.token,
    flagApiUrl: parsed.values["api-url"],
  });
  if (!client) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  try {
    const tokenInfo = await client.getToken();
    if (tokenInfo.permission === "read") {
      writeErrorLine(
        io,
        `Permission denied: token '${tokenInfo.name}' has read-only permission. Create a Write token in the RocketFlag console under Project > Tokens to create or toggle flags.`,
      );
      return EXIT_AUTH;
    }

    const description = normalizeOptionalEnv(parsed.values.description);
    const tags = parsed.values.tag
      ?.map((t) => t.trim())
      .filter((t) => t.length > 0);
    const enabled = parsed.values.enabled;
    const cohorts = parsed.values.cohort
      ?.map((c) => c.trim())
      .filter((c) => c.length > 0);
    const audienceId = normalizeOptionalEnv(parsed.values.audience);

    const multiEnvironment = isMultiEnvironmentProject(tokenInfo);

    if (!multiEnvironment) {
      if (parsed.values.env !== undefined) {
        writeErrorLine(
          io,
          `Project '${tokenInfo.project.name}' is a single-environment project and does not use --env.`,
        );
        return EXIT_USAGE;
      }

      const input: CreateFlagInput = {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(tags && tags.length > 0 ? { tags } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        trafficPercentage: trafficPercentage ?? 100,
        ...(cohorts && cohorts.length > 0 ? { cohorts } : {}),
        ...(audienceId !== undefined ? { audienceId } : {}),
      };

      const created = await client.createFlag(input);
      if (parsed.values.json) {
        writeJson(io, created);
        return EXIT_OK;
      }
      writeLine(io, `Created flag '${created.name}' (${created.id}).`);
      printHumanFlagDetail(io, created);
      return EXIT_OK;
    }

    // Multi-environment project
    const hasInitialState =
      enabled !== undefined ||
      trafficPercentage !== undefined ||
      (cohorts !== undefined && cohorts.length > 0) ||
      audienceId !== undefined;
    const explicitEnv = normalizeOptionalEnv(parsed.values.env);
    const allowed = getAllowedEnvironments(tokenInfo);

    const environments: Record<string, FlagStatePatch> = {};
    for (const envName of allowed) {
      environments[envName] = { trafficPercentage: 100 };
    }

    const input: CreateFlagInput = {
      name,
      ...(description !== undefined ? { description } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(allowed.length > 0 ? { environments } : {}),
    };

    if (hasInitialState || explicitEnv !== undefined) {
      const foundRepo = await findRepoConfig(io.cwd);
      const targetEnv = normalizeOptionalEnv(
        resolveEnvironment({
          flagEnv: parsed.values.env,
          env: io.env,
          repoConfig: foundRepo?.config,
        }),
      );

      if (!targetEnv) {
        writeErrorLine(
          io,
          `Project '${tokenInfo.project.name}' is a multi-environment project. Pass --env <env> or run 'rocketflag init' before setting initial flag state.`,
        );
        return EXIT_USAGE;
      }

      if (!tokenInfo.project.environments.includes(targetEnv)) {
        writeErrorLine(
          io,
          `Unknown environment '${targetEnv}' for project '${tokenInfo.project.name}'. Valid project environments: ${tokenInfo.project.environments.join(", ")}.`,
        );
        return EXIT_USAGE;
      }

      if (!allowed.includes(targetEnv)) {
        writeErrorLine(
          io,
          `Token '${tokenInfo.name}' is not permitted to access environment '${targetEnv}'. Allowed environments: ${allowed.join(", ") || "none"}.`,
        );
        return EXIT_AUTH;
      }

      const envPatch: FlagStatePatch = {
        ...(enabled !== undefined ? { enabled } : {}),
        trafficPercentage: trafficPercentage ?? 100,
        ...(cohorts && cohorts.length > 0 ? { cohorts } : {}),
        ...(audienceId !== undefined ? { audienceId } : {}),
      };

      environments[targetEnv] = envPatch;
      input.environments = environments;
    }

    const created = await client.createFlag(input);
    if (parsed.values.json) {
      writeJson(io, created);
      return EXIT_OK;
    }
    writeLine(io, `Created flag '${created.name}' (${created.id}).`);
    printHumanFlagDetail(io, created);
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}

async function runFlagsUpdate(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
        on: { type: "boolean", default: false },
        off: { type: "boolean", default: false },
        percentage: { type: "string" },
        cohort: { type: "string", multiple: true },
        "clear-cohorts": { type: "boolean", default: false },
        audience: { type: "string" },
        "clear-audience": { type: "boolean", default: false },
        token: { type: "string" },
        "api-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(
      io,
      "Usage: rocketflag flags update <id> [--env <env>] [--on | --off] [--percentage <0-100>] [--cohort <c>... | --clear-cohorts] [--audience <id> | --clear-audience] [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  const id = normalizeOptionalEnv(parsed.positionals[0]);
  if (!id || parsed.positionals.length > 1) {
    writeErrorLine(
      io,
      "Usage: rocketflag flags update <id> [--env <env>] [--on | --off] [--percentage <0-100>] [--cohort <c>... | --clear-cohorts] [--audience <id> | --clear-audience] [--json]",
    );
    return EXIT_USAGE;
  }

  if (parsed.values.on && parsed.values.off) {
    writeErrorLine(io, "Cannot pass both --on and --off to 'flags update'.");
    return EXIT_USAGE;
  }
  if (parsed.values.cohort !== undefined && parsed.values["clear-cohorts"]) {
    writeErrorLine(
      io,
      "Cannot pass both --cohort and --clear-cohorts to 'flags update'.",
    );
    return EXIT_USAGE;
  }
  if (parsed.values.audience !== undefined && parsed.values["clear-audience"]) {
    writeErrorLine(
      io,
      "Cannot pass both --audience and --clear-audience to 'flags update'.",
    );
    return EXIT_USAGE;
  }

  let trafficPercentage: number | undefined;
  if (parsed.values.percentage !== undefined) {
    const rawPct = parsed.values.percentage.trim();
    if (!/^\d+$/.test(rawPct)) {
      writeErrorLine(
        io,
        `Invalid --percentage '${parsed.values.percentage}'. Must be an integer between 0 and 100.`,
      );
      return EXIT_USAGE;
    }
    const num = Number(rawPct);
    if (!Number.isInteger(num) || num < 0 || num > 100) {
      writeErrorLine(
        io,
        `Invalid --percentage '${parsed.values.percentage}'. Must be an integer between 0 and 100.`,
      );
      return EXIT_USAGE;
    }
    trafficPercentage = num;
  }

  const enabled = parsed.values.on
    ? true
    : parsed.values.off
      ? false
      : undefined;

  let cohorts: string[] | undefined;
  if (parsed.values["clear-cohorts"]) {
    cohorts = [];
  } else if (parsed.values.cohort !== undefined) {
    cohorts = parsed.values.cohort
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  let audienceId: string | null | undefined;
  if (parsed.values["clear-audience"]) {
    audienceId = null;
  } else if (parsed.values.audience !== undefined) {
    const trimmed = normalizeOptionalEnv(parsed.values.audience);
    if (!trimmed) {
      writeErrorLine(
        io,
        "Invalid --audience. Provide an audience ID or use --clear-audience to remove it.",
      );
      return EXIT_USAGE;
    }
    audienceId = trimmed;
  }

  const patch: FlagStatePatch = {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(trafficPercentage !== undefined ? { trafficPercentage } : {}),
    ...(cohorts !== undefined ? { cohorts } : {}),
    ...(audienceId !== undefined ? { audienceId } : {}),
  };

  if (Object.keys(patch).length === 0) {
    writeErrorLine(
      io,
      "No fields to update. Pass at least one of --on, --off, --percentage, --cohort, --clear-cohorts, --audience, or --clear-audience.",
    );
    return EXIT_USAGE;
  }

  const client = await createAuthenticatedClient(io, {
    flagToken: parsed.values.token,
    flagApiUrl: parsed.values["api-url"],
  });
  if (!client) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  const foundRepo = await findRepoConfig(io.cwd);
  const env = normalizeOptionalEnv(
    resolveEnvironment({
      flagEnv: parsed.values.env,
      env: io.env,
      repoConfig: foundRepo?.config,
    }),
  );

  try {
    const result = await client.patchFlag(id, patch, { env });
    if (parsed.values.json) {
      writeJson(io, result);
      return EXIT_OK;
    }

    const environment = result.flag.environment ?? env ?? null;
    const envLabel = environment ? ` [${environment}]` : "";
    writeLine(
      io,
      `Updated flag '${result.flag.name}' (${result.flag.id})${envLabel}${result.changed ? "." : " (unchanged)."}`,
    );
    printHumanFlagDetail(io, result.flag);
    return EXIT_OK;
  } catch (err) {
    return handleCommandError(io, err);
  }
}

async function runFlagsToggle(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
        on: { type: "boolean", default: false },
        off: { type: "boolean", default: false },
        token: { type: "string" },
        "api-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(
      io,
      "Usage: rocketflag flags toggle <id> [--env <env>] [--on | --off] [--token <rf_...>] [--api-url <url>] [--json]",
    );
    return EXIT_OK;
  }

  const id = normalizeOptionalEnv(parsed.positionals[0]);
  if (!id || parsed.positionals.length > 1) {
    writeErrorLine(
      io,
      "Usage: rocketflag flags toggle <id> [--env <env>] [--on | --off] [--json]",
    );
    return EXIT_USAGE;
  }

  if (parsed.values.on && parsed.values.off) {
    writeErrorLine(io, "Cannot pass both --on and --off to 'flags toggle'.");
    return EXIT_USAGE;
  }

  const client = await createAuthenticatedClient(io, {
    flagToken: parsed.values.token,
    flagApiUrl: parsed.values["api-url"],
  });
  if (!client) {
    writeErrorLine(
      io,
      "Not authenticated. Run 'rocketflag login', pass --token <rf_...>, or set ROCKETFLAG_TOKEN.",
    );
    return EXIT_AUTH;
  }

  const foundRepo = await findRepoConfig(io.cwd);
  const env = normalizeOptionalEnv(
    resolveEnvironment({
      flagEnv: parsed.values.env,
      env: io.env,
      repoConfig: foundRepo?.config,
    }),
  );

  const desiredEnabled = parsed.values.on
    ? true
    : parsed.values.off
      ? false
      : undefined;

  try {
    const result = await client.toggleFlag(id, {
      env,
      enabled: desiredEnabled,
    });

    const environment = result.flag.environment ?? env ?? null;
    const payload = {
      id: result.flag.id,
      name: result.flag.name,
      environment,
      previous: result.previous,
      current: result.current,
      changed: result.changed,
      flag: result.flag,
    };

    if (parsed.values.json) {
      writeJson(io, payload);
      return EXIT_OK;
    }

    const envLabel = environment ? ` [${environment}]` : "";
    writeLine(
      io,
      `Flag '${result.flag.name}' (${result.flag.id})${envLabel}: ${result.previous ? "on" : "off"} -> ${result.current ? "on" : "off"}${result.changed ? "" : " (unchanged)"}`,
    );
    return EXIT_OK;
  } catch (err) {
    if (
      err instanceof Error &&
      !(err instanceof RocketFlagApiError) &&
      /multi-environment flag without specifying an environment/i.test(
        err.message,
      )
    ) {
      writeErrorLine(
        io,
        `Cannot toggle multi-environment flag '${id}' without an environment. Pass --env <env> or run 'rocketflag init' to configure a defaultEnv.`,
      );
      return EXIT_USAGE;
    }
    return handleCommandError(io, err);
  }
}

function parseAttributes(
  rawAttrs: string[] | undefined,
): { ok: true; attributes?: Record<string, ContextValue> } | { ok: false; error: string } {
  if (!rawAttrs || rawAttrs.length === 0) {
    return { ok: true, attributes: undefined };
  }

  const attributes: Record<string, ContextValue> = {};
  for (const entry of rawAttrs) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex <= 0) {
      return {
        ok: false,
        error: `Invalid --attr '${entry}'. Expected format: --attr key=value.`,
      };
    }
    const key = entry.slice(0, eqIndex).trim();
    const rawValue = entry.slice(eqIndex + 1);
    if (!key) {
      return {
        ok: false,
        error: `Invalid --attr '${entry}'. Attribute key must not be empty.`,
      };
    }
    if (rawValue === "true") {
      attributes[key] = true;
    } else if (rawValue === "false") {
      attributes[key] = false;
    } else {
      attributes[key] = rawValue;
    }
  }
  return { ok: true, attributes };
}

async function runFlagsEval(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        env: { type: "string" },
        cohort: { type: "string" },
        key: { type: "string" },
        attr: { type: "string", multiple: true },
        token: { type: "string" },
        "api-url": { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeErrorLine(io, `Invalid arguments: ${message}`);
    return EXIT_USAGE;
  }

  if (parsed.values.help) {
    writeLine(
      io,
      "Usage: rocketflag flags eval <id> [--env <env>] [--cohort <c>] [--key <targetingKey>] [--attr <k=v>...] [--json]",
    );
    return EXIT_OK;
  }

  const id = normalizeOptionalEnv(parsed.positionals[0]);
  if (!id || parsed.positionals.length > 1) {
    writeErrorLine(
      io,
      "Usage: rocketflag flags eval <id> [--env <env>] [--cohort <c>] [--key <targetingKey>] [--attr <k=v>...] [--json]",
    );
    return EXIT_USAGE;
  }

  const parsedAttrs = parseAttributes(parsed.values.attr);
  if (!parsedAttrs.ok) {
    writeErrorLine(io, parsedAttrs.error);
    return EXIT_USAGE;
  }

  const userConfig = await loadUserConfig({ env: io.env });
  const token =
    resolveToken({
      flagToken: parsed.values.token,
      env: io.env,
      userConfig,
    }) ?? "";
  const apiUrl = resolveApiUrl({
    flagApiUrl: parsed.values["api-url"],
    env: io.env,
    userConfig,
  });

  const foundRepo = await findRepoConfig(io.cwd);
  const env = normalizeOptionalEnv(
    resolveEnvironment({
      flagEnv: parsed.values.env,
      env: io.env,
      repoConfig: foundRepo?.config,
    }),
  );

  const client = createManagementClient({
    token,
    apiUrl,
    clientName: CLI_CLIENT_NAME,
    clientVersion: CLI_CLIENT_VERSION,
    fetch: io.fetch,
  });

  try {
    const result = await client.evaluateFlag(id, {
      env,
      cohort: normalizeOptionalEnv(parsed.values.cohort),
      targetingKey: normalizeOptionalEnv(parsed.values.key),
      attributes: parsedAttrs.attributes,
    });

    if (parsed.values.json) {
      writeJson(io, result);
      return EXIT_OK;
    }

    writeLine(
      io,
      `Flag '${result.name}' (${result.id}): ${result.enabled ? "true (enabled)" : "false (disabled)"}`,
    );
    return EXIT_OK;
  } catch (err) {
    if (
      err instanceof Error &&
      !(err instanceof RocketFlagApiError) &&
      /env values may only contain/i.test(err.message)
    ) {
      writeErrorLine(io, err.message);
      return EXIT_USAGE;
    }
    return handleCommandError(io, err);
  }
}

export async function runFlagsCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "list":
      return runFlagsList(rest, io);
    case "get":
      return runFlagsGet(rest, io);
    case "create":
      return runFlagsCreate(rest, io);
    case "update":
      return runFlagsUpdate(rest, io);
    case "toggle":
      return runFlagsToggle(rest, io);
    case "eval":
      return runFlagsEval(rest, io);
    case "--help":
    case "-h":
    case "help":
      writeLine(
        io,
        "Usage: rocketflag flags <list|get|create|update|toggle|eval> [options]",
      );
      return EXIT_OK;
    default:
      writeErrorLine(
        io,
        `Unknown or missing flags subcommand${subcommand ? ` '${subcommand}'` : ""}. Expected one of: list, get, create, update, toggle, eval.`,
      );
      return EXIT_USAGE;
  }
}
