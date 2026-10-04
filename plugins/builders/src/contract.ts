import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const BuilderOutput = z.object({
  id: z.string(),
  nearAccount: z.string(),
  userId: z.string().nullable(),
  name: z.string().nullable(),
  bio: z.string().nullable(),
  skills: z.array(z.string()),
  location: z.string().nullable(),
  links: z.record(z.string(), z.string()).nullable(),
  githubLogin: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const CONFLICT = { status: 409, message: "Conflict" } as const;

const Network = z.enum(["testnet", "mainnet"]);

const AdmissionStatus = z.enum(["admitted", "suspended", "removed"]);

const Kind = z.enum(["human", "agent"]);

const GithubLogin = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}(?:\[bot\])?$/);

const NearAccountId = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/,
    "must be a valid NEAR account id (lowercase letters, digits, dashes, underscores, dots)",
  );

const MemberOutput = z.object({
  githubLogin: z.string(),
  kind: Kind,
  operatorGithubLogin: z.string().nullable(),
  name: z.string().nullable(),
  skills: z.array(z.string()),
  nearAccount: z.string().nullable(),
  accounts: z.array(z.object({ network: Network, account: z.string() })),
  admissions: z.array(
    z.object({
      network: Network,
      status: AdmissionStatus,
      proofUrl: z.string().nullable(),
      admittedAt: z.iso.datetime().nullable(),
    }),
  ),
});

export const contract = oc.router({
  listBuilders: oc
    .route({ method: "GET", path: "/v1/builders" })
    .input(
      z.object({
        search: z.string().optional(),
        skill: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      }),
    )
    .output(
      z.object({
        data: z.array(BuilderOutput),
        meta: z.object({
          total: z.number().int().nonnegative(),
          hasMore: z.boolean(),
          nextCursor: z.string().nullable(),
        }),
      }),
    )
    .errors({ BAD_REQUEST }),

  getBuilder: oc
    .route({ method: "GET", path: "/v1/builders/{nearAccount}" })
    .input(z.object({ nearAccount: z.string() }))
    .output(z.object({ data: BuilderOutput }))
    .errors({ NOT_FOUND }),

  getMyBuilderProfile: oc
    .route({ method: "GET", path: "/v1/builders/me" })
    .input(z.object({}))
    .output(z.object({ data: BuilderOutput.nullable() }))
    .errors({ UNAUTHORIZED }),

  createBuilder: oc
    .route({ method: "POST", path: "/v1/builders" })
    .input(
      z.object({
        nearAccount: z.string(),
        userId: z.string().optional(),
        name: z.string().min(1).max(100).optional(),
        bio: z.string().max(1000).optional(),
        skills: z.array(z.string().max(50)).max(20).optional(),
        location: z.string().max(100).optional(),
        links: z.record(z.string(), z.string()).optional(),
      }),
    )
    .output(z.object({ data: BuilderOutput }))
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

  updateBuilderProfile: oc
    .route({ method: "PATCH", path: "/v1/builders/{nearAccount}" })
    .input(
      z.object({
        nearAccount: z.string(),
        name: z.string().min(1).max(100).optional(),
        bio: z.string().max(1000).optional(),
        skills: z.array(z.string().max(50)).max(20).optional(),
        location: z.string().max(100).optional(),
        links: z.record(z.string(), z.string()).optional(),
      }),
    )
    .output(z.object({ data: BuilderOutput }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  deleteBuilder: oc
    .route({ method: "DELETE", path: "/v1/builders/{nearAccount}" })
    .input(z.object({ nearAccount: z.string() }))
    .output(z.object({ deleted: z.boolean() }))
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

  listMembers: oc
    .route({ method: "GET", path: "/v1/members" })
    .input(z.object({ network: Network.optional(), status: AdmissionStatus.optional() }))
    .output(z.object({ data: z.array(MemberOutput) })),

  getMember: oc
    .route({ method: "GET", path: "/v1/members/{githubLogin}" })
    .input(z.object({ githubLogin: GithubLogin }))
    .output(z.object({ data: MemberOutput }))
    .errors({ NOT_FOUND }),

  putMember: oc
    .route({ method: "PUT", path: "/v1/members/{githubLogin}" })
    .input(
      z.object({
        githubLogin: GithubLogin,
        network: Network,
        kind: Kind,
        operatorGithubLogin: GithubLogin.optional(),
        name: z.string().trim().min(1).max(100).optional(),
        skills: z.array(z.string().max(50)).max(20).optional(),
        account: z.object({ account: NearAccountId, proof: z.string().min(1) }).optional(),
        admission: z
          .object({
            status: AdmissionStatus,
            proofUrl: z.url().optional(),
            admittedAt: z.iso.datetime().optional(),
          })
          .optional(),
      }),
    )
    .output(z.object({ data: MemberOutput, overwritten: z.array(z.string()) }))
    .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, CONFLICT }),

  recordAgreement: oc
    .route({ method: "PUT", path: "/v1/members/{githubLogin}/agreement" })
    .input(
      z.object({
        githubLogin: GithubLogin,
        version: z.string().trim().min(1).max(100),
        attestedAt: z.iso.datetime(),
        proof: z.string().min(1),
      }),
    )
    .output(
      z.object({
        data: z.object({
          githubLogin: z.string(),
          version: z.string(),
          attestedAt: z.iso.datetime(),
          recordedBy: z.string(),
          recordedAt: z.iso.datetime(),
        }),
      }),
    )
    .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
});

export type ContractType = typeof contract;
