import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getAllowedEnvironments,
  getStaleTokenEnvironments,
  isMultiEnvironmentProject,
  RocketFlagApiError,
  type TokenInfo,
} from "@rocketflag/management";

export interface WhoamiFormattedPayload extends TokenInfo {
  multiEnvironment: boolean;
  allowedEnvironments: string[];
  staleEnvironments: string[];
  warnings: string[];
  summary: string;
}

export function formatMcpError(err: unknown): string {
  if (err instanceof RocketFlagApiError) {
    if (err.isReadOnlyTokenError()) {
      return "Permission denied (403): This RocketFlag API token has read-only permission. Ask the user to create a Write token in the RocketFlag console under Project > Tokens and update ROCKETFLAG_TOKEN.";
    }
    if (err.isEnvironmentForbiddenError()) {
      return `Environment not allowed (403): ${err.detail}. Call the 'whoami' tool to see which environments this token is allowed to access.`;
    }
    if (err.isPaymentRequiredError()) {
      return `Plan or trial lock (402): ${err.detail}. Ask the user to check their organisation's billing or subscription status in the RocketFlag console.`;
    }
    if (err.isUnauthorizedError()) {
      return `Authentication failed (401): ${err.detail}. Check that ROCKETFLAG_TOKEN is a valid, unrevoked, non-expired 'rf_...' token.`;
    }
    if (err.isNotFoundError()) {
      return `Not found (404): ${err.detail}. Call 'list_flags' or 'whoami' to verify the flag ID and environment name.`;
    }
    if (err.isRateLimitedError()) {
      return `Rate limited (429): ${err.detail}. Wait briefly before retrying.`;
    }

    const base = `API error (${err.status}) ${err.errorTitle}: ${err.detail}`;
    return err.docs ? `${base} (Docs: ${err.docs})` : base;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}

export function formatWhoamiPayload(info: TokenInfo): WhoamiFormattedPayload {
  const multiEnvironment = isMultiEnvironmentProject(info);
  const allowedEnvironments = getAllowedEnvironments(info);
  const staleEnvironments = getStaleTokenEnvironments(info);

  const warnings: string[] = [];
  if (info.permission === "read") {
    warnings.push(
      "This token has read-only permission. Creating or toggling flags requires a write token.",
    );
  }
  if (staleEnvironments.length > 0) {
    warnings.push(
      `Stale environment restriction(s) not present on project: ${staleEnvironments.join(", ")}.`,
    );
  }

  const modeLabel = multiEnvironment
    ? `multi-environment (allowed: ${allowedEnvironments.join(", ") || "none"})`
    : "single-environment";

  const baseSummary = `Token "${info.name}" (${info.id}) has ${info.permission} permission for ${modeLabel} project "${info.project.name}" (${info.project.id}).`;
  const summary =
    warnings.length > 0
      ? `${baseSummary} Warnings: ${warnings.join(" ")}`
      : baseSummary;

  return {
    ...info,
    multiEnvironment,
    allowedEnvironments,
    staleEnvironments,
    warnings,
    summary,
  };
}

export function formatToolSuccess(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function formatToolError(err: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: formatMcpError(err),
      },
    ],
  };
}
