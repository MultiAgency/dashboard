import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import { siwnClient } from "better-near-auth/client";
import { getAccount, getHostUrl, getNetworkId } from "@/app";

function createAuthClient() {
  return createBetterAuthClient({
    baseURL: getHostUrl(),
    fetchOptions: { credentials: "include" },
    plugins: [
      siwnClient({
        recipient: getAccount(),
        networkId: getNetworkId(),
      }),
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

export type AuthClient = ReturnType<typeof createAuthClient>;
export type SessionData = AuthClient["$Infer"]["Session"];

// Agency stubs Organization/Passkey as `never`; siwnClient is the only plugin used.
export type Organization = never;
export type Passkey = never;

export function isAuthAvailable(): boolean {
  return true;
}
