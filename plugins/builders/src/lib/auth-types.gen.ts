export type {
  Auth,
  AuthOrganizationContext,
  AuthOrganization,
  AuthOrganizationSummary,
  AuthOrganizationMember,
  AuthApiKey,
  AuthInvitation,
  GetActiveMemberInput,
  GetOrganizationInput,
  ListMembersInput,
  ListInvitationsInput,
  ListApiKeysInput,
  AuthServices,
  createAuthInstance,
} from "../../../../.bos/generated/auth/auth-export.d.ts";
import type { InferOutput, ContractType as AuthContract } from "../../../../.bos/generated/auth/contract.d.ts";
import type { Auth as BaseAuth } from "../../../../.bos/generated/auth/auth-export.d.ts";

type RawAuthSession = InferOutput<"getSession">;
type RawAuthRequestContext = InferOutput<"getContext">;
type RawAuthActiveMember = InferOutput<"getActiveMember">;

export type AuthSessionUser = NonNullable<RawAuthSession["user"]>;
export type AuthSessionData = NonNullable<RawAuthSession["session"]>;
export type AuthSession = {
  user: AuthSessionUser | null;
  session: AuthSessionData | null;
};
export type AuthRequestContext = RawAuthRequestContext;
export type AuthPluginContext = Partial<AuthRequestContext> & {
  reqHeaders?: Headers;
  getRawBody?: () => Promise<string>;
};
export type AuthActiveMember = RawAuthActiveMember;
export type AuthBaseSession = BaseAuth["$Infer"]["Session"];
export type AuthContractType = AuthContract;
