export { getBaseStyles } from "everything-dev/ui/head";

import {
  buildPublishedAccountHref,
  buildPublishedGatewayHref,
  buildRuntimeHref,
  getRuntimeConfig,
} from "everything-dev/ui/runtime";

export { buildPublishedAccountHref, buildPublishedGatewayHref, buildRuntimeHref, getRuntimeConfig };

type RuntimeConfigInput = Partial<import("everything-dev/types").ClientRuntimeConfig> | undefined;

function readRuntimeConfig(config?: RuntimeConfigInput) {
  if (config) return config;
  if (typeof window === "undefined") return undefined;
  try {
    return getRuntimeConfig();
  } catch {
    return undefined;
  }
}

export function getActiveRuntime(config?: RuntimeConfigInput) {
  return readRuntimeConfig(config)?.runtime;
}

export function getAccount(config?: RuntimeConfigInput): string {
  return readRuntimeConfig(config)?.account ?? "every.near";
}

export function getRepository(config?: RuntimeConfigInput): string | undefined {
  return readRuntimeConfig(config)?.repository;
}

export function getAppName(config?: RuntimeConfigInput): string {
  return getActiveRuntime(config)?.title ?? getAccount(config);
}

import type { ApiClient } from "./lib/api";
import type { AuthClient as AuthClientType } from "./lib/auth";

export type { ApiClient } from "./lib/api";
export { createApiClient, useApiClient } from "./lib/api";
export type { AuthClient, Organization, Passkey, SessionData } from "./lib/auth";
export { createAuthClient, sessionQueryOptions, useAuthClient, useRelayHistory } from "./lib/auth";

import type {
  CreateRouterOptions as BaseCreateRouterOptions,
  RenderOptions as BaseRenderOptions,
  RouterContextWithApi as BaseRouterContextWithApi,
} from "everything-dev/ui/types";
import type { SessionData } from "./lib/auth";

export type {
  ClientRuntimeConfig,
  ClientRuntimeInfo,
} from "everything-dev/types";
export type {
  HeadData,
  HeadLink,
  HeadMeta,
  HeadScript,
  RenderResult,
  RouterModule,
} from "everything-dev/ui/types";

export interface RouterContext extends BaseRouterContextWithApi<ApiClient, SessionData> {
  apiClient: ApiClient;
  authClient: AuthClientType;
}

export interface CreateRouterOptions
  extends Omit<BaseCreateRouterOptions<ApiClient, SessionData>, "context"> {
  context: RouterContext;
}

export interface RenderOptions extends Omit<BaseRenderOptions<SessionData>, "runtimeConfig"> {
  runtimeConfig: BaseRenderOptions<SessionData>["runtimeConfig"];
  apiClient: ApiClient;
}
