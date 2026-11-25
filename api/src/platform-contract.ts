import { oc } from "@orpc/contract";
import { BAD_REQUEST, FORBIDDEN, UNAUTHORIZED } from "every-plugin/errors";
import { z } from "zod";
import {
  CONSENT_DAYS,
  nep413Intent,
  PLATFORM_AGENT_STATES,
  PLATFORM_SIGNING_KINDS,
} from "./services/platform/terms";

const errors = { UNAUTHORIZED, FORBIDDEN, BAD_REQUEST };

const nearAccount = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const platformAgentView = z.object({
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  state: z.enum(PLATFORM_AGENT_STATES),
  host: z.string().nullable(),
  ownerAccountId: z.string().nullable(),
  agent: z.string().nullable(),
  agentId: z.string().nullable(),
  setupPublicKey: z.string().nullable(),
  signing: z
    .object({
      kind: z.enum(PLATFORM_SIGNING_KINDS),
      message: z.string(),
      recipient: z.string(),
      nonce: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  retryable: z.boolean(),
  create: z
    .object({
      correlationId: z.string(),
      confirmUrl: z.string().nullable(),
      expiresAt: z.string().nullable(),
      status: z.string().nullable(),
    })
    .nullable(),
  consent: z
    .object({
      id: z.string(),
      scopes: z.array(z.string()),
      expiresAt: z.string(),
      expiringSoon: z.boolean(),
    })
    .nullable(),
  consents: z.array(
    z.object({
      id: z.string(),
      scopes: z.array(z.string()),
      expiresAt: z.string(),
      revokedAt: z.string().nullable(),
      revokedReason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  consentDays: z.array(z.literal(CONSENT_DAYS)),
  error: z.string().nullable(),
});

const usd = z.string().nullable();

export const platformAgentContract = {
  view: oc
    .route({ method: "GET", path: "/admin/platform-agent" })
    .input(z.object({}))
    .output(platformAgentView)
    .errors({ UNAUTHORIZED, FORBIDDEN }),

  startSetup: oc
    .route({ method: "POST", path: "/admin/platform-agent/setup" })
    .input(z.object({ ownerAccountId: nearAccount }))
    .output(platformAgentView)
    .errors(errors),

  startConsent: oc
    .route({ method: "POST", path: "/admin/platform-agent/consent" })
    .input(z.object({ days: z.literal(CONSENT_DAYS) }))
    .output(platformAgentView)
    .errors(errors),

  submitSigned: oc
    .route({ method: "POST", path: "/admin/platform-agent/signed" })
    .input(
      z.object({
        message: z.string().min(1).max(2048),
        nonce: z.string().min(1).max(64),
        publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/),
        signature: z.string().min(1).max(200),
      }),
    )
    .output(platformAgentView)
    .errors(errors),

  retry: oc
    .route({ method: "POST", path: "/admin/platform-agent/retry" })
    .input(z.object({}))
    .output(platformAgentView)
    .errors(errors),

  prepareCreate: oc
    .route({ method: "POST", path: "/admin/platform-agent/create" })
    .input(z.object({}))
    .output(z.object({ view: platformAgentView, intent: nep413Intent.nullable() }))
    .errors(errors),

  submitCreate: oc
    .route({ method: "POST", path: "/admin/platform-agent/create/submit" })
    .input(
      z.object({
        correlationId: z.string().min(1).max(200),
        signedData: z.record(z.string(), z.unknown()),
      }),
    )
    .output(platformAgentView)
    .errors(errors),

  followCreate: oc
    .route({ method: "POST", path: "/admin/platform-agent/create/status" })
    .input(z.object({}))
    .output(platformAgentView)
    .errors(errors),

  disconnect: oc
    .route({ method: "POST", path: "/admin/platform-agent/disconnect" })
    .input(z.object({}))
    .output(platformAgentView)
    .errors(errors),

  overview: oc
    .route({ method: "GET", path: "/admin/platform-agent/overview" })
    .input(z.object({}))
    .output(
      z.object({
        agentId: z.string(),
        revision: z.number().nullable(),
        status: z.string(),
        synced: z.boolean(),
        notInForce: z.string().nullable(),
        frozen: z.boolean().nullable(),
        ownerApproval: z.boolean().nullable(),
        assets: z.array(z.string()),
        perTransaction: z.record(z.string(), z.string()),
        budget: z.object({ dailyUsd: usd, weeklyUsd: usd, monthlyUsd: usd }),
        monthly: z
          .object({
            limitUsd: usd,
            spentUsd: z.string(),
            remainingUsd: usd,
            resetsAt: z.string().nullable(),
          })
          .nullable(),
        destinationsMode: z.string().nullable(),
        destinations: z.array(
          z.object({ action: z.string(), address: z.string(), chain: z.string().nullable() }),
        ),
        agreed: z.array(z.string()),
        policyChangeAvailableAt: z.string().nullable(),
        book: z.array(
          z.object({
            asset: z.string(),
            symbol: z.string(),
            decimals: z.number(),
            public: z.string(),
            confidential: z.string(),
            usd: z.number().nullable(),
          }),
        ),
        grants: z.array(
          z.object({
            grantId: z.string(),
            label: z.string(),
            issuedAt: z.string(),
            expiresAt: z.string(),
            revokedAt: z.string().nullable(),
          }),
        ),
      }),
    )
    .errors(errors),

  unresolved: oc
    .route({ method: "GET", path: "/admin/platform-agent/unresolved" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          key: z.string(),
          at: z.string(),
          kind: z.string(),
          status: z.string().nullable(),
          sent: z.boolean(),
        }),
      ),
    )
    .errors(errors),

  held: oc
    .route({ method: "GET", path: "/admin/platform-agent/held" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          at: z.string(),
          kind: z.string(),
          correlationId: z.string(),
          approvalId: z.string(),
          recipient: z.string().nullable(),
          amount: z.string().nullable(),
          asset: z.string().nullable(),
          chain: z.string().nullable(),
        }),
      ),
    )
    .errors(errors),

  activity: oc
    .route({ method: "GET", path: "/admin/platform-agent/activity" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          at: z.string(),
          kind: z.string(),
          correlationId: z.string().nullable(),
          status: z.string().nullable(),
          refused: z.string().nullable(),
        }),
      ),
    )
    .errors(errors),

  ledger: oc
    .route({ method: "GET", path: "/admin/platform-agent/ledger" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          at: z.string(),
          settledAt: z.string(),
          type: z.string(),
          status: z.string(),
          failureCode: z.string().nullable(),
          asset: z.string().nullable(),
          amount: z.string().nullable(),
          recipient: z.string().nullable(),
          correlationId: z.string(),
        }),
      ),
    )
    .errors(errors),

  policyHistory: oc
    .route({ method: "GET", path: "/admin/platform-agent/policy-history" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          revision: z.number().nullable(),
          status: z.string(),
          appliedAt: z.string().nullable(),
          transactionHash: z.string().nullable(),
        }),
      ),
    )
    .errors(errors),

  ownerActions: oc
    .route({ method: "GET", path: "/admin/platform-agent/owner-actions" })
    .input(z.object({}))
    .output(
      z.array(
        z.object({
          correlationId: z.string(),
          type: z.string(),
          expiresAt: z.string(),
          stage: z.string(),
          status: z.string().nullable(),
          failureCode: z.string().nullable(),
        }),
      ),
    )
    .errors(errors),
};
