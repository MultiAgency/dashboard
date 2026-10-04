import { createPluginRuntime } from "every-plugin";
import Plugin from "../src/index";

const PLUGIN_ID = "@everything-dev/builders-plugin";

export const TOKENS = { testnet: "testnet-secret", mainnet: "mainnet-secret" } as const;

export type Network = keyof typeof TOKENS;

export async function startRegistry({ withTokens = true } = {}) {
  const runtime = createPluginRuntime({ registry: { [PLUGIN_ID]: { module: Plugin } } } as any);
  const plugin = await (runtime as any).usePlugin(PLUGIN_ID, {
    variables: {},
    secrets: {
      BUILDERS_DATABASE_URL: ":memory:",
      ...(withTokens && {
        REGISTRY_TOKEN_TESTNET: TOKENS.testnet,
        REGISTRY_TOKEN_MAINNET: TOKENS.mainnet,
      }),
    },
  });

  return {
    shutdown: () => runtime.shutdown(),
    board: (token?: string): any =>
      plugin.createClient({
        reqHeaders: new Headers(token ? { "x-registry-token": token } : {}),
      }),
    signedIn: (
      userId: string,
      nearAccount: string | null,
      { platformAdmin = false, trusted = false } = {},
    ): any =>
      plugin.createClient({
        userId,
        user: { id: userId, role: platformAdmin ? "admin" : "user" },
        near: { primaryAccountId: nearAccount, linkedAccounts: [] },
        ...(trusted && { trusted: true }),
      }),
    anonymous: (): any => plugin.createClient({}),
  };
}
