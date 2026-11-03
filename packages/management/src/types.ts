export type TokenPermission = "read" | "write";

export interface TokenProject {
  id: string;
  name: string;
  /** Empty array `[]` on single-environment projects; environment labels on multi-environment projects. */
  environments: string[];
}

export interface TokenInfo {
  id: string;
  name: string;
  project: TokenProject;
  permission: TokenPermission;
  /** Empty array `[]` means unrestricted (all project environments). */
  environments: string[];
  /** Unix milliseconds, or `null` / `0` when the token does not expire. */
  expiresAt: number | null;
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
  return tokenInfo.project.environments.length > 0;
}

export function getAllowedEnvironments(tokenInfo: TokenInfo): string[] {
  if (tokenInfo.project.environments.length === 0) {
    return [];
  }
  if (tokenInfo.environments.length === 0) {
    return [...tokenInfo.project.environments];
  }
  return tokenInfo.environments.filter((env) =>
    tokenInfo.project.environments.includes(env),
  );
}

export function getStaleTokenEnvironments(tokenInfo: TokenInfo): string[] {
  if (
    tokenInfo.project.environments.length === 0 ||
    tokenInfo.environments.length === 0
  ) {
    return [];
  }
  return tokenInfo.environments.filter(
    (env) => !tokenInfo.project.environments.includes(env),
  );
}
