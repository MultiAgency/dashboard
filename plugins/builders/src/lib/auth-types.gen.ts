export type * from "../../../../.bos/generated/auth/auth-export.d.ts";
import type { InferOutput } from "../../../../.bos/generated/auth/contract.d.ts";

export type AuthSessionUser = NonNullable<InferOutput<"getSession">["user"]>;
export type AuthSessionData = NonNullable<InferOutput<"getSession">["session"]>;
export type AuthSession = {
  user: AuthSessionUser | null;
  session: AuthSessionData | null;
};
export type AuthRequestContext = InferOutput<"getContext">;
export type AuthPluginContext = Partial<AuthRequestContext> & {
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
};

