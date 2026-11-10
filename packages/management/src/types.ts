export type TokenPermission = "read" | "write";

export interface TokenProject {
  id: string;
  name: string;
  /** Empty array `[]` on single-environment projects; environment labels on multi-environment projects. */
  environments: string[];
}

export interface CliSessionUser {
  id: string;
  email: string;
  name: string;
}

export interface PublicProject {
  id: string;
  name: string;
  organisationId: string;
  organisationName: string;
  environments: string[];
  permission: TokenPermission;
}

export interface TokenInfo {
  kind?: "token" | "user";
  id: string;
  name: string;
  project?: TokenProject;
  permission?: TokenPermission;
  /** Empty array `[]` means unrestricted (all project environments). Present on project tokens. */
  environments?: string[];
  /** Unix milliseconds, or `null` / `0` when the token does not expire. */
  expiresAt: number | null;
  /** Present when `kind === "user"` (`rfu_...` CLI session). */
  user?: CliSessionUser;
}

export interface EnvironmentState {
  enabled: boolean;
  trafficPercentage: number;
  cohorts: string[];
  audienceId: string | null;
  updatedAt: number;
}

export type FlagKind = "flag" | "groupflag";

export interface PublicFlag {
  id: string;
  name: string;
  kind: FlagKind;
  /** Present when a groupflag is projected to a single environment via `?env=`. */
  environment?: string;
  /** Present on flat shapes (`kind === "flag"` or projected `groupflag`). */
  enabled?: boolean;
  /** Present on flat shapes (`kind === "flag"` or projected `groupflag`). */
  trafficPercentage?: number;
  /** Present on flat shapes (`kind === "flag"` or projected `groupflag`). */
  cohorts?: string[];
  /** Present on flat shapes (`kind === "flag"` or projected `groupflag`). */
  audienceId?: string | null;
  /** Present on unprojected `groupflag` shapes (`kind === "groupflag"` without `?env=`). */
  environments?: Record<string, EnvironmentState>;
  updatedAt: number;
}

export interface FlagStatePatch {
  enabled?: boolean;
  trafficPercentage?: number;
  cohorts?: string[];
  /** String sets the audience; `null` clears it; `undefined` leaves it unchanged. */
  audienceId?: string | null;
}

export interface CreateFlagInput {
  name: string;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  trafficPercentage?: number;
  cohorts?: string[];
  audienceId?: string | null;
  environments?: Record<string, FlagStatePatch>;
}

export interface PatchFlagResult {
  changed: boolean;
  flag: PublicFlag;
}

export interface ToggleFlagResult {
  previous: boolean;
  current: boolean;
  changed: boolean;
  flag: PublicFlag;
}

export type ContextValue = string | number | boolean;

export interface EvaluateFlagOptions {
  env?: string;
  cohort?: ContextValue;
  targetingKey?: string | number;
  attributes?: Record<string, ContextValue>;
}

export interface EvaluateFlagResult {
  id: string;
  name: string;
  enabled: boolean;
}

export function isMultiEnvironmentProject(tokenInfo: TokenInfo): boolean {
  return (tokenInfo.project?.environments.length ?? 0) > 0;
}

export function getAllowedEnvironments(tokenInfo: TokenInfo): string[] {
  const projectEnvs = tokenInfo.project?.environments ?? [];
  if (projectEnvs.length === 0) {
    return [];
  }
  const tokenEnvs = tokenInfo.environments ?? [];
  if (tokenEnvs.length === 0) {
    return [...projectEnvs];
  }
  return tokenEnvs.filter((env) => projectEnvs.includes(env));
}

export function getStaleTokenEnvironments(tokenInfo: TokenInfo): string[] {
  const projectEnvs = tokenInfo.project?.environments ?? [];
  const tokenEnvs = tokenInfo.environments ?? [];
  if (projectEnvs.length === 0 || tokenEnvs.length === 0) {
    return [];
  }
  return tokenEnvs.filter((env) => !projectEnvs.includes(env));
}
