/**
 * Auth context types and Better-Auth plugin client factory for the API.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { ORPCError } from "every-plugin/orpc";
import type { AuthPluginContext } from "./auth-types.gen";

export type AuthContext = AuthPluginContext;
export type RequestAuthUser = NonNullable<AuthContext["user"]>;
export type ApiKeyContext = NonNullable<AuthContext["apiKey"]>;

export interface AuthenticatedContext extends AuthContext {
  userId: string;
  user: RequestAuthUser;
}

export function createAuthMiddleware(builder: any) {
  const requireAuth = builder.middleware(
    async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in to continue" },
        });
      }
      return next({ context });
    },
  );

  const requireAuthOrApiKey = builder.middleware(
    async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user && !context.userId && !context.apiKey) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { hint: "Sign in or provide an API key" },
        });
      }
      return next({ context });
    },
  );

  const requireUser = builder.middleware(
    async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "User authentication required",
          data: { hint: "Sign in or provide a user-scoped API key" },
        });
      }
      return next({ context });
    },
  );

  const requireRole = <TRoles extends readonly string[]>(...roles: TRoles) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
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
      return next({ context });
    });

  const requireAdmin = requireRole("admin");

  const requireOrganization = builder.middleware(
    async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      if (!context.organization?.activeOrganizationId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Active organization required",
          data: { hint: "Select or create an organization" },
        });
      }
      return next({ context });
    },
  );

  const requireOrgRole = <TRoles extends readonly string[]>(...roles: TRoles) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
      if (!context.user || !context.userId) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Authentication required",
          data: { authType: "session", hint: "Sign in to continue" },
        });
      }
      if (!context.organization?.activeOrganizationId) {
        throw new ORPCError("FORBIDDEN", {
          message: "Active organization required",
          data: { hint: "Select or create an organization" },
        });
      }
      const member = context.organization?.member;
      if (!member?.id || !member?.role || !roles.includes(member.role)) {
        throw new ORPCError("FORBIDDEN", {
          message: `Requires organization role: ${roles.join(" or ")}`,
          data: { requiredRoles: roles, currentRole: member?.role ?? null },
        });
      }
      return next({ context });
    });

  const requireApiKey = (requiredPermissions?: Record<string, string[]>) =>
    builder.middleware(async ({ context, next }: { context: AuthContext; next: any }) => {
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
      return next({ context });
    });

  return {
    requireAuth,
    requireAuthOrApiKey,
    requireUser,
    requireRole,
    requireAdmin,
    requireOrganization,
    requireOrgRole,
    requireApiKey,
  };
}
