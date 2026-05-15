import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const applicationKind = z.enum(["founder", "contributor", "client"]);

const projectStatus = z.enum(["active", "paused", "archived"]);
const visibility = z.enum(["public", "private"]);
const onboardingStatus = z.enum(["pending", "complete", "expired"]);
const proposalStatus = z.enum([
  "InProgress",
  "Approved",
  "Rejected",
  "Removed",
  "Expired",
  "Moved",
  "Failed",
]);

const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, digits, and hyphens");

export const baseAmount = z
  .string()
  .regex(/^\d+$/, "positive integer string in the token's smallest unit")
  .max(80);

const tokenId = z.string().min(1).max(80);

const paginationInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const application = z.object({
  id: z.string(),
  kind: applicationKind,
  name: z.string(),
  email: z.string(),
  nearAccountId: z.string().nullable(),
  message: z.string().nullable(),
  metadata: z.string().nullable(),
  status: z.enum(["new", "reviewing", "accepted", "declined"]),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  createdAt: z.date(),
});

const project = z.object({
  id: z.string(),
  ownerId: z.string(),
  organizationId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  nearnListingId: z.string().nullable(),
  status: projectStatus,
  visibility,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const publicProject = project.omit({ description: true });

const nearnListing = z.object({
  slug: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  token: z.string().nullable(),
  rewardAmount: z.number().nullable(),
  deadline: z.string().nullable(),
  isPublished: z.boolean().nullable(),
  isArchived: z.boolean().nullable(),
  isWinnersAnnounced: z.boolean().nullable(),
  sponsor: z
    .object({
      name: z.string().nullable(),
      slug: z.string().nullable(),
      logo: z.string().nullable(),
      isVerified: z.boolean().nullable(),
    })
    .nullable(),
});

const projectWithNearn = publicProject.extend({ nearnListing: nearnListing.nullable() });

const contributor = z.object({
  id: z.string(),
  nearAccountId: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  onboardingStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
});

const tokenBudget = z.object({
  tokenId: z.string(),
  budget: z.string(),
  allocated: z.string(),
  paid: z.string(),
  remaining: z.string(),
});

const allocation = z.object({
  id: z.string(),
  projectId: z.string(),
  tokenId: z.string(),
  amount: z.string(),
  note: z.string().nullable(),
  actorAccountId: z.string(),
  relatedAllocationId: z.string().nullable(),
  createdAt: z.date(),
});

const billing = z.object({
  id: z.string(),
  projectId: z.string(),
  contributorId: z.string().nullable(),
  tokenId: z.string(),
  amount: z.string(),
  proposalId: z.string(),
  status: proposalStatus,
  note: z.string().nullable(),
  createdAt: z.date(),
});

export const proposalPublicItem = z.object({
  proposalId: z.string(),
  proposer: z.string(),
  description: z.string(),
  status: proposalStatus,
  tokenId: z.string(),
  receiverId: z.string(),
  amount: z.string(),
  submissionTime: z.string(),
});

export const proposalListItem = proposalPublicItem.extend({
  mapping: z
    .object({
      billingId: z.string(),
      projectId: z.string(),
      projectSlug: z.string(),
      projectTitle: z.string(),
    })
    .nullable(),
});

const settings = z.object({
  id: z.string(),
  daoAccountId: z.string(),
  nearnAccountId: z.string().nullable(),
  name: z.string(),
  headline: z.string().nullable(),
  tagline: z.string().nullable(),
  contactEmail: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  docsUrl: z.string().nullable(),
  description: z.string().nullable(),
  metadata: z.string().nullable(),
  adminRoleName: z.string().nullable(),
  approverRoleName: z.string().nullable(),
  requestorRoleName: z.string().nullable(),
  updatedAt: z.date(),
});

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({
      status: z.literal("ok"),
      timestamp: z.iso.datetime(),
    }),
  ),

  applications: {
    create: oc
      .route({ method: "POST", path: "/applications" })
      .input(
        z.object({
          kind: applicationKind,
          name: z.string().min(1).max(200),
          email: z.string().email().max(320),
          nearAccountId: z.string().max(200).optional(),
          message: z.string().max(4000).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .output(
        z.object({
          id: z.string(),
          status: z.literal("new"),
        }),
      ),

    adminList: oc
      .route({ method: "GET", path: "/admin/applications" })
      .input(
        paginationInput.extend({
          status: z.enum(["new", "reviewing", "accepted", "declined"]).optional(),
          kind: applicationKind.optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(application),
          nextCursor: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminUpdate: oc
      .route({ method: "PATCH", path: "/admin/applications/{id}" })
      .input(
        z.object({
          id: z.string(),
          status: z.enum(["new", "reviewing", "accepted", "declined"]),
        }),
      )
      .output(z.object({ application }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  },

  agency: {
    projects: {
      list: oc
        .route({ method: "GET", path: "/projects" })
        .output(z.object({ data: z.array(projectWithNearn) })),

      adminGet: oc
        .route({ method: "GET", path: "/admin/projects/{slug}" })
        .input(z.object({ slug: z.string() }))
        .output(
          z.object({
            project,
            contributors: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                nearAccountId: z.string().nullable(),
                role: z.string().nullable(),
              }),
            ),
          }),
        )
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      getBudget: oc
        .route({ method: "GET", path: "/admin/projects/{projectId}/budget" })
        .input(z.object({ projectId: z.string() }))
        .output(z.object({ budgets: z.array(tokenBudget) }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      adminList: oc
        .route({ method: "GET", path: "/admin/projects" })
        .output(z.object({ data: z.array(project) }))
        .errors({ UNAUTHORIZED, FORBIDDEN }),

      adminCreate: oc
        .route({ method: "POST", path: "/admin/projects" })
        .input(
          z.object({
            slug,
            title: z.string().min(1).max(200),
            description: z.string().max(16000).optional(),
            nearnListingId: z.string().max(200).optional(),
            status: projectStatus.default("active"),
            visibility: visibility.default("private"),
          }),
        )
        .output(z.object({ project }))
        .errors({ UNAUTHORIZED, FORBIDDEN }),

      adminUpdate: oc
        .route({ method: "PATCH", path: "/admin/projects/{id}" })
        .input(
          z.object({
            id: z.string(),
            title: z.string().min(1).max(200).optional(),
            description: z.string().max(16000).nullable().optional(),
            nearnListingId: z.string().max(200).nullable().optional(),
            status: projectStatus.optional(),
            visibility: visibility.optional(),
          }),
        )
        .output(z.object({ project }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },
  },

  contributors: {
    adminList: oc
      .route({ method: "GET", path: "/admin/contributors" })
      .output(z.object({ data: z.array(contributor) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminCreate: oc
      .route({ method: "POST", path: "/admin/contributors" })
      .input(
        z.object({
          name: z.string().min(1).max(200),
          email: z.string().email().max(320).optional(),
          nearAccountId: z.string().max(200).optional(),
          onboardingStatus: onboardingStatus.default("pending"),
        }),
      )
      .output(z.object({ contributor }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminUpdate: oc
      .route({ method: "PATCH", path: "/admin/contributors/{id}" })
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
          email: z.string().email().max(320).nullable().optional(),
          nearAccountId: z.string().max(200).nullable().optional(),
          onboardingStatus: onboardingStatus.optional(),
        }),
      )
      .output(z.object({ contributor }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  },

  assignments: {
    adminList: oc
      .route({ method: "GET", path: "/admin/projects/{projectId}/contributors" })
      .input(z.object({ projectId: z.string() }))
      .output(
        z.object({
          data: z.array(
            z.object({
              projectId: z.string(),
              contributorId: z.string(),
              role: z.string().nullable(),
              createdAt: z.date(),
              contributor,
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminCreate: oc
      .route({ method: "POST", path: "/admin/projects/{projectId}/contributors" })
      .input(
        z.object({
          projectId: z.string(),
          contributorId: z.string(),
          role: z.string().max(80).optional(),
        }),
      )
      .output(
        z.object({
          projectId: z.string(),
          contributorId: z.string(),
          role: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    adminDelete: oc
      .route({ method: "DELETE", path: "/admin/projects/{projectId}/contributors/{contributorId}" })
      .input(
        z.object({
          projectId: z.string(),
          contributorId: z.string(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },

  allocations: {
    adminList: oc
      .route({ method: "GET", path: "/admin/allocations" })
      .input(
        paginationInput.extend({
          projectId: z.string().optional(),
          tokenId: z.string().optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(allocation),
          nextCursor: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminCreate: oc
      .route({ method: "POST", path: "/admin/projects/{projectId}/allocations" })
      .input(
        z.object({
          projectId: z.string(),
          tokenId,
          amount: baseAmount,
          note: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ allocation }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    adminDeallocate: oc
      .route({ method: "POST", path: "/admin/projects/{projectId}/allocations/deallocate" })
      .input(
        z.object({
          projectId: z.string(),
          tokenId,
          amount: baseAmount,
          note: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ allocation }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    adminTransfer: oc
      .route({ method: "POST", path: "/admin/allocations/transfer" })
      .input(
        z
          .object({
            fromProjectId: z.string(),
            toProjectId: z.string(),
            tokenId,
            amount: z
              .string()
              .regex(/^\d+$/, "positive integer string in the token's smallest unit")
              .max(80),
            note: z.string().max(2000).optional(),
          })
          .refine((v) => v.fromProjectId !== v.toProjectId, {
            message: "fromProjectId and toProjectId must differ",
            path: ["toProjectId"],
          }),
      )
      .output(z.object({ from: allocation, to: allocation }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  },

  billings: {
    adminList: oc
      .route({ method: "GET", path: "/admin/billings" })
      .input(
        paginationInput.extend({
          projectId: z.string().optional(),
          contributorId: z.string().optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(billing),
          nextCursor: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminCreate: oc
      .route({ method: "POST", path: "/admin/billings" })
      .input(
        z.object({
          projectId: z.string(),
          contributorId: z.string().optional(),
          proposalId: z.string().min(1).max(200),
          note: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ billing }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  proposals: {
    list: oc
      .route({ method: "GET", path: "/proposals" })
      .input(
        z.object({
          limit: z.number().int().min(1).max(100).default(50),
          fromIndex: z.number().int().min(0).optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(proposalPublicItem),
          lastProposalId: z.number(),
          nextFromIndex: z.number().nullable(),
        }),
      ),

    adminList: oc
      .route({ method: "GET", path: "/admin/proposals" })
      .input(
        z.object({
          limit: z.number().int().min(1).max(100).default(50),
          fromIndex: z.number().int().min(0).optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(proposalListItem),
          lastProposalId: z.number(),
          nextFromIndex: z.number().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    getPublicSummary: oc.route({ method: "GET", path: "/proposals/summary" }).output(
      z.object({
        openCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
      }),
    ),
  },

  tokens: {
    list: oc.route({ method: "GET", path: "/tokens" }).output(
      z.object({
        tokens: z.array(
          z.object({
            tokenId: z.string(),
            network: z.string(),
            symbol: z.string(),
            decimals: z.number().int().nonnegative(),
            name: z.string(),
            icon: z.string().nullable(),
          }),
        ),
      }),
    ),
  },

  treasury: {
    getPublicBalances: oc
      .route({ method: "POST", path: "/treasury/balances" })
      .input(z.object({ tokenIds: z.array(z.string().min(1).max(200)).min(1).max(50) }))
      .output(
        z.object({
          balances: z.array(
            z.object({
              tokenId: z.string(),
              balance: z.string(),
            }),
          ),
        }),
      ),

    getBalances: oc
      .route({ method: "POST", path: "/admin/treasury/balances" })
      .input(z.object({ tokenIds: z.array(z.string().min(1).max(200)).min(1).max(50) }))
      .output(
        z.object({
          balances: z.array(
            z.object({
              tokenId: z.string(),
              balance: z.string(),
              totalAllocated: z.string(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    getPublicSummary: oc.route({ method: "GET", path: "/treasury/summary" }).output(
      z.object({
        nearBalance: z.string(),
        ftTokens: z.number().int().nonnegative(),
      }),
    ),
  },

  nearn: {
    getListing: oc
      .route({ method: "GET", path: "/admin/nearn/listings/{slug}" })
      .input(z.object({ slug: z.string().min(1).max(200) }))
      .output(z.object({ listing: nearnListing }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    listSponsorBounties: oc
      .route({ method: "GET", path: "/admin/nearn/sponsor-bounties" })
      .output(
        z.object({
          sponsorSlug: z.string().nullable(),
          bounties: z.array(
            z.object({
              slug: z.string(),
              title: z.string().nullable(),
              type: z.string().nullable(),
              status: z.string().nullable(),
              token: z.string().nullable(),
              rewardAmount: z.number().nullable(),
              deadline: z.string().nullable(),
              isPublished: z.boolean().nullable(),
              isFeatured: z.boolean().nullable(),
              isWinnersAnnounced: z.boolean().nullable(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },

  me: {
    assignedProjects: oc
      .route({ method: "GET", path: "/me/projects" })
      .output(
        z.object({
          data: z.array(project.extend({ role: z.string().nullable() })),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    roles: oc
      .route({ method: "GET", path: "/me/roles" })
      .output(
        z.object({
          isAdmin: z.boolean(),
          isApprover: z.boolean(),
          isRequestor: z.boolean(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },

  team: {
    list: oc.route({ method: "GET", path: "/team" }).output(
      z.object({
        roles: z.array(
          z.object({
            name: z.string(),
            isEveryone: z.boolean(),
            members: z.array(z.string()),
            permissions: z.array(z.string()),
          }),
        ),
      }),
    ),

    getPublicSummary: oc.route({ method: "GET", path: "/team/summary" }).output(
      z.object({
        roleCount: z.number().int().nonnegative(),
        memberCount: z.number().int().nonnegative(),
      }),
    ),
  },

  settings: {
    getPublic: oc.route({ method: "GET", path: "/settings" }).output(
      z.object({
        name: z.string(),
        headline: z.string().nullable(),
        tagline: z.string().nullable(),
        description: z.string().nullable(),
        contactEmail: z.string().nullable(),
        nearnAccountId: z.string().nullable(),
        websiteUrl: z.string().nullable(),
        docsUrl: z.string().nullable(),
        daoAccountId: z.string(),
        isPlaceholder: z.boolean(),
      }),
    ),

    adminGet: oc
      .route({ method: "GET", path: "/admin/settings" })
      .output(z.object({ settings }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    adminUpdate: oc
      .route({ method: "PATCH", path: "/admin/settings" })
      .input(
        z.object({
          daoAccountId: z.string().min(1).max(200).optional(),
          nearnAccountId: z.string().max(200).nullable().optional(),
          name: z.string().min(1).max(200).optional(),
          headline: z.string().max(200).nullable().optional(),
          tagline: z.string().max(2000).nullable().optional(),
          contactEmail: z.string().email().max(320).nullable().optional(),
          websiteUrl: z.string().url().max(500).nullable().optional(),
          docsUrl: z.string().url().max(500).nullable().optional(),
          description: z.string().max(8000).nullable().optional(),
          metadata: z.string().max(16000).nullable().optional(),
          adminRoleName: z.string().max(80).nullable().optional(),
          approverRoleName: z.string().max(80).nullable().optional(),
          requestorRoleName: z.string().max(80).nullable().optional(),
        }),
      )
      .output(z.object({ settings }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },

  bootstrap: {
    config: oc
      .route({ method: "POST", path: "/bootstrap/config" })
      .input(
        z.object({
          daoAccountId: z.string().min(1).max(64),
          adminRoleName: z.string().min(1).max(80).optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),
  },
});

export type ContractType = typeof contract;
