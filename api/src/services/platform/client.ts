import { type AppClient, appClient } from "@multiagency/sdk";

export {
  type AppConsentSubmission,
  type AppOwnerAction,
  type AppRouteResult,
  ASSETS,
  appConsentSubmission,
  consentMessage,
  type OwnerOutput,
  type OwnerResult,
  parseConsentMessage,
  parseSetupMessage,
  setupMessage,
} from "@multiagency/sdk";

export type PlatformApp = Pick<
  AppClient,
  "identity" | "reservations" | "setup" | "consents" | "agent"
>;

export type PlatformConsent = Extract<
  Awaited<ReturnType<PlatformApp["consents"]["list"]>>,
  { ok: true }
>["value"]["consents"][number];

export type PlatformSettings = {
  base: `https://${string}`;
  host: string;
  deployment: string;
  credential: string;
};

const DEPLOYMENT = /^[a-z0-9-]{1,32}$/;
const CREDENTIAL = /^tap_\S+$/;

export function platformSettings(secrets: {
  PLATFORM_URL?: string;
  PLATFORM_APP_CREDENTIAL?: string;
  PLATFORM_DEPLOYMENT?: string;
}): PlatformSettings | null {
  const url = secrets.PLATFORM_URL?.trim();
  const credential = secrets.PLATFORM_APP_CREDENTIAL?.trim();
  const deployment = secrets.PLATFORM_DEPLOYMENT?.trim();
  if (!url || !credential || !deployment) return null;
  if (!CREDENTIAL.test(credential) || !DEPLOYMENT.test(deployment)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return null;
  }
  return { base: `https://${parsed.host}`, host: parsed.host, deployment, credential };
}

const procedureOf = (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  return url.pathname.split("/rpc/")[1] ?? url.pathname;
};

export const loggedFetch =
  (fetcher: typeof fetch = fetch) =>
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const procedure = procedureOf(input);
    const response = await fetcher(input, init).catch((error: unknown) => {
      console.warn(`[API] MultiAgency platform ${procedure} didn't answer`, error);
      throw error;
    });
    if (!response.ok) {
      console.warn(`[API] MultiAgency platform ${procedure} answered HTTP ${response.status}`);
    }
    return response;
  };

export function createPlatformApp(settings: PlatformSettings): PlatformApp {
  return appClient({
    base: settings.base,
    credential: settings.credential,
    fetch: loggedFetch(),
  });
}
