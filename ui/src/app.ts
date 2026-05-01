export { getBaseStyles } from "everything-dev/ui/head";

import {
  buildPublishedAccountHref,
  buildPublishedGatewayHref,
  buildRuntimeHref,
  getAccount,
  getActiveRuntime,
  getApiBaseUrl,
  getAssetsUrl,
  getHostUrl,
  getNetworkId,
  getRepository,
  getRuntimeBasePath,
  getRuntimeConfig,
} from "everything-dev/ui/runtime";

export {
  buildPublishedAccountHref,
  buildPublishedGatewayHref,
  buildRuntimeHref,
  getAccount,
  getActiveRuntime,
  getApiBaseUrl,
  getAssetsUrl,
  getHostUrl,
  getNetworkId,
  getRepository,
  getRuntimeBasePath,
  getRuntimeConfig,
};

import type { ApiClient, ApiContract } from "./lib/api-client";

export { createApiClient } from "./lib/api-client";
export { authClient } from "./lib/auth-client";
export type { ApiClient, ApiContract };

export function getAppName(config?: Parameters<typeof getAccount>[0]): string {
  return getActiveRuntime(config)?.title ?? getAccount(config);
}

import type {
  CreateRouterOptions as BaseCreateRouterOptions,
  RenderOptions as BaseRenderOptions,
  RouterContextWithApi as BaseRouterContextWithApi,
} from "everything-dev/ui/types";
import type { SessionData } from "@/lib/session";

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
}

export interface CreateRouterOptions
  extends Omit<BaseCreateRouterOptions<ApiClient, SessionData>, "context"> {
  context: RouterContext;
}

export interface RenderOptions extends Omit<BaseRenderOptions<SessionData>, "runtimeConfig"> {
  runtimeConfig: BaseRenderOptions<SessionData>["runtimeConfig"];
  apiClient: ApiClient;
}
