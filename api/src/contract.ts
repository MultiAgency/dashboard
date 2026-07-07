import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const applicationKind = z.enum(["founder", "contributor", "client"]);

const projectStatus = z.enum(["active", "paused", "archived"]);
const projectKind = z.enum(["project", "idea"]);
const visibility = z.enum(["public", "unlisted", "private"]);
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

// Matches nearcore's account-id grammar closely enough to reject emoji/whitespace foot-guns.
export const nearAccountId = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/,
    "must be a valid NEAR account id (lowercase letters, digits, dashes, underscores, dots)",
  );

// Zod 4's `.url()` accepts non-http schemes; the refine() is the XSS-scheme block.
export const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((s) => /^https?:\/\//i.test(s), "must start with http:// or https://");

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
  repository: z.string().nullable(),
  nearnListingId: z.string().nullable(),
  kind: projectKind,
  status: projectStatus,
  visibility,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const publicProject = project.omit({ description: true, nearnListingId: true });

const nearnListing = z.object({
  slug: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  token: z.string().nullable(),
  rewardAmount: z.number().nullable(),
  // Sponsorship-aware fields surfaced for UI fidelity (variable comp, ask ranges, recipient progress).
  compensationType: z.string().nullable(),
  minRewardAsk: z.number().nullable(),
  maxRewardAsk: z.number().nullable(),
  submissionLimit: z.string().nullable(),
  totalPaymentsMade: z.number().nullable(),
  totalWinnersSelected: z.number().nullable(),
  // Bounty position-tier prize distribution (JSON-as-text): `{"1": 500, "2": 100, ...}`. Caller parses.
  rewards: z.string().nullable(),
  maxBonusSpots: z.number().nullable(),
  // UX-rich payload fields. skills is JSON-as-text array (parse on display).
  usdValue: z.string().nullable(),
  skills: z.string().nullable(),
  region: z.string().nullable(),
  applicationType: z.string().nullable(),
  multipleSubmissionRule: z.string().nullable(),
  timeToComplete: z.string().nullable(),
  requirements: z.string().nullable(),
  sequentialId: z.number().nullable(),
  nearnPublishedAt: z.string().nullable(),
  isFeatured: z.boolean().nullable(),
  isPrivate: z.boolean().nullable(),
  // Hackathon nested data (sparse — null for non-hackathon listings).
  isHackathonPrize: z.boolean().nullable(),
  hackathonSlug: z.string().nullable(),
  hackathonName: z.string().nullable(),
  hackathonStartDate: z.string().nullable(),
  hackathonAnnounceDate: z.string().nullable(),
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
      entityName: z.string().nullable(),
      isCaution: z.boolean().nullable(),
    })
    .nullable(),
});

const projectWithNearn = publicProject.extend({ nearnListing: nearnListing.nullable() });

const internalListingType = z.enum(["Bounty", "Project", "Sponsorship"]);

export const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'decimal amount in display units (e.g. "100" or "100.5")')
  .max(80)
  .refine((s) => Number.parseFloat(s) > 0, "must be greater than 0");

const listing = z.object({
  id: z.string(),
  projectId: z.string(),
  source: z.enum(["nearn", "internal"]),
  title: z.string().nullable(),
  description: z.string().nullable(),
  type: z.string().nullable(),
  token: z.string().nullable(),
  rewardAmount: z.string().nullable(),
  deadline: z.date().nullable(),
  isPublished: z.boolean().nullable(),
  isArchived: z.boolean().nullable(),
  isWinnersAnnounced: z.boolean().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const internalListingCreate = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(200),
  type: internalListingType,
  token: tokenId,
  rewardAmount: decimalAmount,
  description: z.string().max(16000).optional(),
  deadline: z.date().nullable().optional(),
  isPublished: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isWinnersAnnounced: z.boolean().optional(),
});

const internalListingUpdate = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(200).optional(),
  type: internalListingType.optional(),
  token: tokenId.optional(),
  rewardAmount: decimalAmount.optional(),
  description: z.string().max(16000).nullable().optional(),
  deadline: z.date().nullable().optional(),
  isPublished: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isWinnersAnnounced: z.boolean().optional(),
});

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
  committed: z.string(),
  paid: z.string(),
  remaining: z.string(),
});

const budget = z.object({
  id: z.string(),
  projectId: z.string(),
  tokenId: z.string(),
  amount: z.string(),
  note: z.string().nullable(),
  actorAccountId: z.string(),
  relatedBudgetId: z.string().nullable(),
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
  // Empty {} when cache-served terminal proposals carry no per-voter record.
  votes: z.record(z.string(), z.enum(["Approve", "Reject", "Remove"])),
});

export const storageStatusOutput = z.object({
  tokenId: z.string(),
  status: z.object({ total: z.string(), available: z.string() }).nullable(),
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

    list: oc
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

    update: oc
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

      get: oc
        .route({ method: "GET", path: "/projects/{slug}" })
        .input(z.object({ slug }))
        .output(
          z.object({
            project,
            contributors: z
              .array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  nearAccountId: z.string().nullable(),
                  role: z.string().nullable(),
                }),
              )
              .nullable(),
          }),
        )
        .errors({ NOT_FOUND }),

      getBudget: oc
        .route({ method: "GET", path: "/admin/projects/{projectId}/budget" })
        .input(z.object({ projectId: z.string() }))
        .output(z.object({ budgets: z.array(tokenBudget) }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      create: oc
        .route({ method: "POST", path: "/admin/projects" })
        .input(
          z.object({
            slug,
            title: z.string().min(1).max(200),
            description: z.string().max(16000).optional(),
            repository: httpUrl.optional(),
            nearnListingId: z.string().max(200).optional(),
            kind: projectKind.default("project"),
            status: projectStatus.default("active"),
            visibility: visibility.default("private"),
          }),
        )
        .output(z.object({ project }))
        .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

      update: oc
        .route({ method: "PATCH", path: "/admin/projects/{id}" })
        .input(
          z.object({
            id: z.string(),
            title: z.string().min(1).max(200).optional(),
            description: z.string().max(16000).nullable().optional(),
            repository: httpUrl.optional(),
            nearnListingId: z.string().max(200).nullable().optional(),
            status: projectStatus.optional(),
            visibility: visibility.optional(),
          }),
        )
        .output(z.object({ project }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

      delete: oc
        .route({ method: "DELETE", path: "/admin/projects/{id}" })
        .input(z.object({ id: z.string() }))
        .output(z.object({ deleted: z.literal(true) }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },

    listings: {
      get: oc
        .route({ method: "GET", path: "/admin/projects/{projectId}/listings/internal" })
        .input(z.object({ projectId: z.string() }))
        .output(z.object({ listing: listing.nullable() }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      create: oc
        .route({ method: "POST", path: "/admin/projects/{projectId}/listings/internal" })
        .input(internalListingCreate)
        .output(z.object({ listing }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

      update: oc
        .route({ method: "PATCH", path: "/admin/projects/{projectId}/listings/internal" })
        .input(internalListingUpdate)
        .output(z.object({ listing }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

      delete: oc
        .route({ method: "DELETE", path: "/admin/projects/{projectId}/listings/internal" })
        .input(z.object({ projectId: z.string() }))
        .output(z.object({ deleted: z.literal(true) }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },
  },

  contributors: {
    list: oc
      .route({ method: "GET", path: "/admin/contributors" })
      .output(z.object({ data: z.array(contributor) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    create: oc
      .route({ method: "POST", path: "/admin/contributors" })
      .input(
        z.object({
          name: z.string().min(1).max(200),
          email: z.string().email().max(320).optional(),
          nearAccountId: nearAccountId.optional(),
          onboardingStatus: onboardingStatus.default("pending"),
        }),
      )
      .output(z.object({ contributor }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    update: oc
      .route({ method: "PATCH", path: "/admin/contributors/{id}" })
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
          email: z.string().email().max(320).nullable().optional(),
          nearAccountId: nearAccountId.nullable().optional(),
          onboardingStatus: onboardingStatus.optional(),
        }),
      )
      .output(z.object({ contributor }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  },

  assignments: {
    list: oc
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

    create: oc
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

    delete: oc
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

  budgets: {
    list: oc
      .route({ method: "GET", path: "/admin/budgets" })
      .input(
        paginationInput.extend({
          projectId: z.string().optional(),
          tokenId: z.string().optional(),
        }),
      )
      .output(
        z.object({
          data: z.array(budget),
          nextCursor: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    create: oc
      .route({ method: "POST", path: "/admin/projects/{projectId}/budgets" })
      .input(
        z.object({
          projectId: z.string(),
          tokenId,
          amount: baseAmount,
          note: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ budget }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    deallocate: oc
      .route({ method: "POST", path: "/admin/projects/{projectId}/budgets/deallocate" })
      .input(
        z.object({
          projectId: z.string(),
          tokenId,
          amount: baseAmount,
          note: z.string().max(2000).optional(),
        }),
      )
      .output(z.object({ budget }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    transfer: oc
      .route({ method: "POST", path: "/admin/budgets/transfer" })
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
      .output(z.object({ from: budget, to: budget }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  billings: {
    list: oc
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

    create: oc
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

    delete: oc
      .route({ method: "DELETE", path: "/admin/billings/{id}" })
      .input(z.object({ id: z.string() }))
      .output(z.object({ deleted: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
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
          data: z.array(proposalListItem),
          lastProposalId: z.number(),
          nextFromIndex: z.number().nullable(),
        }),
      ),

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

    getStorageStatus: oc
      .route({ method: "GET", path: "/tokens/storage-status" })
      .input(z.object({ tokenId: z.string().min(1).max(200) }))
      .output(storageStatusOutput),
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
              totalBudgeted: z.string(),
              available: z.string(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    getRollups: oc
      .route({ method: "GET", path: "/admin/treasury/rollups" })
      .output(
        z.object({
          rollups: z.array(
            z.object({
              tokenId: z.string(),
              balance: z.string(),
              budgeted: z.string(),
              allocated: z.string(),
              committed: z.string(),
              paid: z.string(),
              remaining: z.string(),
              available: z.string(),
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
              compensationType: z.string().nullable(),
              minRewardAsk: z.number().nullable(),
              maxRewardAsk: z.number().nullable(),
              totalPaymentsMade: z.number().nullable(),
              totalWinnersSelected: z.number().nullable(),
              sequentialId: z.number().nullable(),
              deadline: z.string().nullable(),
              isPublished: z.boolean().nullable(),
              isFeatured: z.boolean().nullable(),
              isPrivate: z.boolean().nullable(),
              isWinnersAnnounced: z.boolean().nullable(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    listSubmissions: oc
      .route({ method: "GET", path: "/admin/nearn/listings/{slug}/submissions" })
      .input(z.object({ slug: z.string().min(1).max(200) }))
      .output(
        z.object({
          submissions: z.array(
            z.object({
              id: z.string(),
              userId: z.string(),
              user: z.object({
                id: z.string(),
                name: z.string().nullable(),
                username: z.string().nullable(),
                publicKey: z.string().nullable(),
                photo: z.string().nullable(),
              }),
              isWinner: z.boolean().nullable(),
              winnerPosition: z.number().nullable(),
              status: z.string().nullable(),
              label: z.string().nullable(),
              ask: z.number().nullable(),
              token: z.string().nullable(),
              rewardInUSD: z.number().nullable(),
              link: z.string().nullable(),
              createdAt: z.string().nullable(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
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
          isContributor: z.boolean(),
          isClient: z.boolean(),
          isSuperAdmin: z.boolean(),
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

  agencyConfig: {
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
        orgAccountId: z.string(),
        network: z.enum(["mainnet", "testnet"]),
        networkPinned: z.boolean(),
      }),
    ),

    get: oc
      .route({ method: "GET", path: "/admin/settings" })
      .output(
        z.object({
          orgAccountId: z.string(),
          network: z.enum(["mainnet", "testnet"]),
          // Editable for admins of this deployment — resolved DB → env → hardcoded.
          editable: z.object({
            daoAccountId: z.string().nullable(),
            nearnAccountId: z.string().nullable(),
            websiteUrl: z.string().nullable(),
            docsUrl: z.string().nullable(),
            description: z.string().nullable(),
            contactEmail: z.string().nullable(),
          }),
          // Read-only — codebase-level brand identity and Sputnik role names.
          readOnly: z.object({
            name: z.string(),
            headline: z.string().nullable(),
            tagline: z.string().nullable(),
          }),
          audit: z
            .object({
              createdBy: z.string(),
              createdAt: z.string(),
              updatedBy: z.string(),
              updatedAt: z.string(),
            })
            .nullable(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    update: oc
      .route({ method: "PATCH", path: "/admin/settings" })
      .input(
        z.object({
          daoAccountId: z.string().trim().min(1).max(120).nullable().optional(),
          nearnAccountId: z.string().trim().min(1).max(120).nullable(),
          websiteUrl: httpUrl.nullable(),
          docsUrl: httpUrl.nullable(),
          description: z.string().trim().min(1).max(500).nullable(),
          contactEmail: z.string().trim().email().max(120).nullable(),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),
  },

  platform: {
    listOrgs: oc
      .route({ method: "GET", path: "/platform/orgs" })
      .output(
        z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            metadata: z.record(z.string(), z.unknown()).nullable(),
            createdAt: z.string(),
          }),
        ),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    createOrg: oc
      .route({ method: "POST", path: "/platform/orgs" })
      .input(
        z.object({
          name: z.string().trim().min(1).max(100),
          slug: z.string().trim().min(1).max(100),
          type: z.enum(["agency", "client"]).optional(),
          daoAccountId: z.string().trim().min(1).max(120),
          adminNearId: z.string().trim().max(120).optional(),
        }),
      )
      .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    updateOrg: oc
      .route({ method: "PATCH", path: "/platform/orgs/:orgId" })
      .input(
        z.object({
          orgId: z.string(),
          name: z.string().trim().min(1).max(100).optional(),
          type: z.enum(["agency", "client"]).optional(),
          daoAccountId: z.string().trim().min(1).max(120).optional(),
        }),
      )
      .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, NOT_FOUND }),

    listOrgMembers: oc
      .route({ method: "GET", path: "/platform/orgs/:orgId/members" })
      .input(z.object({ orgId: z.string() }))
      .output(
        z.array(
          z.object({
            id: z.string(),
            userId: z.string(),
            nearAccountId: z.string().nullable(),
            role: z.string(),
          }),
        ),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    addOrgMember: oc
      .route({ method: "POST", path: "/platform/orgs/:orgId/members" })
      .input(
        z.object({
          orgId: z.string(),
          nearAccountId: z.string().trim().min(1).max(120),
          role: z.enum(["admin", "contributor", "client"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    updateOrgMember: oc
      .route({ method: "PATCH", path: "/platform/orgs/:orgId/members/:memberId" })
      .input(
        z.object({
          orgId: z.string(),
          memberId: z.string(),
          role: z.enum(["admin", "contributor", "client"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    removeOrgMember: oc
      .route({ method: "DELETE", path: "/platform/orgs/:orgId/members/:memberId" })
      .input(z.object({ orgId: z.string(), memberId: z.string() }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    deleteOrg: oc
      .route({ method: "DELETE", path: "/platform/orgs/:orgId" })
      .input(z.object({ orgId: z.string() }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    listProjects: oc
      .route({ method: "GET", path: "/platform/projects" })
      .output(
        z.object({
          orgs: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              daoAccountId: z.string().nullable(),
              projects: z.array(publicProject),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },

  members: {
    list: oc
      .route({ method: "GET", path: "/members" })
      .output(
        z.array(
          z.object({
            id: z.string(),
            userId: z.string(),
            nearAccountId: z.string().nullable(),
            displayName: z.string().nullable(),
            role: z.string(),
          }),
        ),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    addByNearId: oc
      .route({ method: "POST", path: "/members" })
      .input(
        z.object({
          nearAccountId: z.string().trim().min(1).max(120),
          role: z.enum(["admin", "contributor", "client"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    updateRole: oc
      .route({ method: "PATCH", path: "/members/:memberId" })
      .input(
        z.object({
          memberId: z.string(),
          role: z.enum(["admin", "contributor", "client"]),
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    remove: oc
      .route({ method: "DELETE", path: "/members/:memberId" })
      .input(z.object({ memberId: z.string() }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),
  },
});

export type ContractType = typeof contract;
