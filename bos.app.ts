import { App } from "everything-dev/descriptor";

// Authored app descriptor. The published config is canonicalized to JSON
// from this file; dev-only overrides live in bos.dev.ts (never published).
export default App({
  name: "multiagency.ai",
  extends: "bos://dev.everything.near/everything.dev",
  platform: "2.0.0-rc.27",
  account: "multiagentic.near",
  domain: "multiagency.ai",
  title: "MultiAgency",
  description: "Human-led, AI-native agencies for hire.",
  testnet: "agency.testnet",
  staging: {
    domain: "dev.multiagency.ai",
  },
  repository: "https://github.com/MultiAgency/dashboard",
  ci: {
    railway: {
      service: "dashboard",
    },
  },
  ui: {
    path: "ui",
  },
  api: {
    path: "api",
    variables: {
      agencyDaoAccount: "multiagency.sputnik-dao.near",
      appOrigin: "https://dev.multiagency.ai",
      communityApiUrl: "https://nearbuilders.org/api",
    },
    secrets: [
      "API_DATABASE_URL",
      "AUTH_DATABASE_URL",
      "APPLICATIONS_WEBHOOK_URL",
      "CONTACT_FORM_WEBHOOK_URL",
      "CONTACT_FORM_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "NOTIFY_FROM_EMAIL",
      "APP_ORIGIN",
      "FASTNEAR_API_KEY",
      "GITHUB_TOKEN",
      "WORK_ORDERS_RUN_SECRET",
      "ANTHROPIC_API_KEY",
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_PICKER_API_KEY",
      "GOOGLE_CLOUD_PROJECT_NUMBER",
      "GOOGLE_STARTER_TEMPLATE_ID",
      "GOOGLE_TOKENS_SECRET_KEY",
      "NEAR_INTENTS_AGENT_API_KEY",
      "NEAR_INTENTS_AGENT_API_URL",
      "DOCUMENSO_API_KEY",
      "DOCUMENSO_API_URL",
      "PAYOUTS_SECRET_KEY",
    ],
  },
  auth: {
    variables: {
      trustedOrigins: ["http://localhost:3000"],
      email: {
        from: "noreply@multiagency.ai",
      },
      siwn: {
        recipients: {
          mainnet: "multiagency.sputnik-dao.near",
          testnet: "multiagency.sputnikv2.testnet",
        },
      },
    },
    secrets: [
      "AUTH_DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "FASTNEAR_API_KEY",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
      "RESEND_API_KEY",
    ],
  },
  plugins: {
    projects: {
      path: "plugins/projects",
      secrets: ["PROJECTS_DATABASE_URL"],
    },
    builders: {
      path: "plugins/builders",
      secrets: ["BUILDERS_DATABASE_URL", "REGISTRY_TOKEN_TESTNET", "REGISTRY_TOKEN_MAINNET"],
    },
  },
});
