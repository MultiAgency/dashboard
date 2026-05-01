import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  adminClient,
  anonymousClient,
  inferAdditionalFields,
  organizationClient,
  phoneNumberClient,
} from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import type { createAuthInstance } from "host/src/services/auth";
import { getAccount, getHostUrl, getNetworkId } from "@/app";

function createAuthClient() {
  return createBetterAuthClient({
    baseURL: getHostUrl(),
    fetchOptions: { credentials: "include" },
    plugins: [
      inferAdditionalFields<typeof createAuthInstance>(),
      siwnClient({
        recipient: getAccount(),
        networkId: getNetworkId(),
      }),
      adminClient(),
      anonymousClient(),
      phoneNumberClient(),
      passkeyClient(),
      organizationClient(),
      apiKeyClient(),
    ],
  });
}

let _authClient: ReturnType<typeof createAuthClient> | undefined;

export function getAuthClient() {
  if (_authClient === undefined) {
    _authClient = createAuthClient();
  }
  return _authClient;
}

export const authClient: ReturnType<typeof createAuthClient> = new Proxy(
  {} as ReturnType<typeof createAuthClient>,
  {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return Reflect.get(getAuthClient() as object, prop);
    },
  },
);
