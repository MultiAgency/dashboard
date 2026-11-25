import { type AppClient, appClient } from "@multiagency/sdk";

export {
  type AppConsentSubmission,
  type AppRouteResult,
  appConsentSubmission,
  consentMessage,
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

export function createPlatformApp(settings: PlatformSettings): PlatformApp {
  return appClient({ base: settings.base, credential: settings.credential });
}
