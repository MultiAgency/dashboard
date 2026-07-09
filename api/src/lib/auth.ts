import { ORPCError } from "every-plugin/orpc";
import type { AuthRequestContext as GeneratedAuthRequestContext } from "./auth-types.gen";
import type { PluginsClient } from "./plugins-types.gen";

export type RequestAuthUser = NonNullable<GeneratedAuthRequestContext["user"]>;
export type ApiKeyContext = NonNullable<GeneratedAuthRequestContext["apiKey"]>;

export interface RequestAuthContext {
  userId?: GeneratedAuthRequestContext["userId"];
  user?: GeneratedAuthRequestContext["user"];
  organizationId?: GeneratedAuthRequestContext["organization"]["activeOrganizationId"];
  organization?: {
    activeOrganizationId?: string | null;
    organization?: {
      id?: string;
      name?: string;
      slug?: string;
      logo?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
    member?: { id: string; role: string } | null;
    isPersonal?: boolean;
    hasOrganization?: boolean;
  };
  near?: {
    primaryAccountId: string | null;
    linkedAccounts: Array<{
      accountId: string;
      network: string;
      publicKey: string;
      isPrimary: boolean;
    }>;
    hasNearAccount: boolean;
  };
  apiKey?: GeneratedAuthRequestContext["apiKey"];
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
}

export interface AuthContext extends RequestAuthContext {
  userId: NonNullable<GeneratedAuthRequestContext["userId"]>;
  user: RequestAuthUser;
}

export type AuthPluginClientFactory = PluginsClient["auth"];
export type AuthPluginClient = ReturnType<AuthPluginClientFactory>;

export interface AuthCapableServices {
  auth?: AuthPluginClientFactory | null;
}

export function parseOrgMetadata(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === "string") {
    try {
      return JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof meta === "object") return meta as Record<string, unknown>;
  return {};
}

export function getAuthClient(
  services: AuthCapableServices,
  context?: Record<string, unknown>,
): AuthPluginClient {
  if (!services.auth) {
    throw new Error("Auth plugin client unavailable");
  }
  return services.auth(context);
}

function toRequestAuthContext(context: RequestAuthContext): RequestAuthContext {
  return {
    userId: context.userId,
    user: context.user,
    organizationId: context.organizationId,
    organization: context.organization,
    near: context.near,
    apiKey: context.apiKey,
    reqHeaders: context.reqHeaders,
    getRawBody: context.getRawBody,
  };
}

export function createAuthMiddleware(builder: any) {
  const requireAuth = builder.middleware(
    async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in or provide an API key" },
        });
      }
      return next({ context: toRequestAuthContext(context) });
    },
  );

  const requireAuthOrApiKey = builder.middleware(
    async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in or provide an API key" },
        });
      }
      return next({ context: toRequestAuthContext(context) });
    },
  );

  const requireUser = builder.middleware(
    async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User authentication required",
          data: { hint: "Sign in or provide a user-scoped API key" },
        });
      }
      return next({ context: toRequestAuthContext(context) });
    },
  );

  const requireRole = <TRoles extends readonly string[]>(...roles: TRoles) =>
    builder.middleware(async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      const currentRole = context.user.role;
      if (!currentRole || !roles.includes(currentRole)) {
        throw new ORPCError("FORBIDDEN", {
          message: `Requires role: ${roles.join(" or ")}`,
          data: { requiredRoles: roles, currentRole },
        });
      }
      return next({ context: toRequestAuthContext(context) });
    });

  const requireAdmin = requireRole("admin");

  const requireOrganization = builder.middleware(
    async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      if (!context.organizationId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Active organization required",
          data: { hint: "Select or create an organization" },
        });
      }
      return next({ context: toRequestAuthContext(context) });
    },
  );

  const requireApiKey = (requiredPermissions?: Record<string, string[]>) =>
    builder.middleware(async ({ context, next }: { context: RequestAuthContext; next: any }) => {
      if (!context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "API key required",
          data: { authType: "apiKey", hint: "Provide a valid API key via x-api-key header" },
        });
      }
      if (requiredPermissions) {
        const keyPerms = context.apiKey.permissions ?? {};
        for (const [resource, actions] of Object.entries(requiredPermissions)) {
          const allowed = keyPerms[resource] ?? [];
          const missing = actions.filter((a: string) => !allowed.includes(a));
          if (missing.length > 0) {
            throw new ORPCError("FORBIDDEN", {
              message: `API key lacks permission: ${resource}:${missing.join(",")}`,
              data: { requiredPermissions, keyPermissions: keyPerms },
            });
          }
        }
      }
      return next({ context: toRequestAuthContext(context) });
    });

  return {
    requireAuth,
    requireAuthOrApiKey,
    requireUser,
    requireRole,
    requireAdmin,
    requireOrganization,
    requireApiKey,
  };
}
