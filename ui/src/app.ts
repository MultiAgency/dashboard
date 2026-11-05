/**
 * Public UI surface — runtime helpers, client factories, and router types.
 *
 * Authored seam (ADR 0023): scaffolded once, app-owned forever after.
 * Imports within this file must be relative paths (./lib/api, ./lib/auth).
 * Never import from "@/app" here — that would create a circular self-reference.
 *
 * This file re-exports everything that UI route code needs and defines
 * thin runtime helpers (getAccount, getAppName, etc.) derived from
 * the injected runtime config.
 *
 * Boundary rule: The host loads UI remotely via Module Federation and
 * provides runtime config + auth/API routing. Work within the typed
 * surface exported here. Only investigate host internals if something
 * is genuinely broken and a parent PR is warranted
 * (https://github.com/nearbuilders/everything-dev).
 */

export { getBaseStyles } from "everything-dev/ui/head";

import {
  buildPublishedAccountHref,
  buildPublishedGatewayHref,
  buildRuntimeHref,
  getCspNonce,
  getRuntimeConfig,
} from "everything-dev/ui/runtime";

export {
  buildPublishedAccountHref,
  buildPublishedGatewayHref,
  buildRuntimeHref,
  getCspNonce,
  getRuntimeConfig,
};

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
export { createApiClient, useApiClient, useOrpc } from "./lib/api";
export type { AuthClient, Organization, Passkey, SessionData } from "./lib/auth";
export {
  createAuthClient,
  sessionQueryKey,
  sessionQueryOptions,
  useAuthClient,
  useRelayHistory,
} from "./lib/auth";

import type {
  CreateRouterOptions as BaseCreateRouterOptions,
  RenderOptions as BaseRenderOptions,
  RouterContextWithApi as BaseRouterContextWithApi,
} from "everything-dev/ui/types";
import { APP_LOCALE_COOKIE, APP_LOCALES, DEFAULT_APP_LOCALE } from "./i18n/catalogs";
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
  authClient?: AuthClientType;
}

export const appLocale = {
  locales: APP_LOCALES,
  defaultLocale: DEFAULT_APP_LOCALE,
  cookieName: APP_LOCALE_COOKIE,
};

export function apiConnectionError() {
  return {
    title: "Unable to connect to API",
    description: "The API is currently unavailable. Please try again later.",
  };
}
