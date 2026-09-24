import { BAD_REQUEST, FORBIDDEN, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

const tokenList = z.object({
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
});

const applicationKind = z.enum(["founder", "contributor", "client"]);

const projectStatus = z.enum(["active", "paused", "archived"]);
const projectKind = z.enum(["project", "idea", "scope", "result"]);
const visibility = z.enum(["public", "unlisted", "private"]);
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

const tokenAmount = z.object({
  tokenId: z.string(),
  amount: z.string(),
});

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
  status: z.enum(["new", "reviewing", "accepted", "declined", "converted"]),
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
  id: z.string().nullable(),
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
  lifecycle: z.enum(["draft", "published", "winners_announced", "archived"]),
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
  lifecycle: z.enum(["draft", "published", "winners_announced", "archived"]).optional(),
});

const internalListingUpdate = z.object({
  projectId: z.string(),
  title: z.string().min(1).max(200).optional(),
  type: internalListingType.optional(),
  token: tokenId.optional(),
  rewardAmount: decimalAmount.optional(),
  description: z.string().max(16000).nullable().optional(),
  deadline: z.date().nullable().optional(),
  lifecycle: z.enum(["draft", "published", "winners_announced", "archived"]).optional(),
});

const contributor = z.object({
  nearAccount: nearAccountId,
  name: z.string().nullable(),
  bio: z.string().nullable(),
  skills: z.array(z.string()),
  location: z.string().nullable(),
  links: z.record(z.string(), z.string()).nullable(),
  registered: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const engagementParty = z.object({ id: z.string(), name: z.string(), slug: z.string() });

const engagementStatus = z.enum(["proposed", "active", "declined", "ended"]);

const engagement = z.object({
  id: z.string(),
  kind: z.enum(["client", "subcontract"]),
  status: engagementStatus,
  side: z.enum(["agency", "client"]),
  agency: engagementParty,
  client: engagementParty,
  projectIds: z.array(z.string()),
  invitation: z
    .object({
      email: z.string(),
      status: z.enum(["pending", "expired", "accepted", "rejected", "canceled"]),
      expiresAt: z.date(),
      link: z.string(),
    })
    .nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  decidedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
});

const engagementIdInput = z.object({ id: z.string().min(1) });

const engagementProjectInput = z.object({
  engagementId: z.string().min(1),
  projectId: z.string().min(1),
});

const reportDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const reportOutput = z.object({
  overview: z.object({
    projectCount: z.number().int().nonnegative(),
    budgetByToken: z.array(tokenAmount),
    billedByToken: z.array(tokenAmount),
    period: z.string(),
  }),
  contributorStats: z.array(
    z.object({
      nearAccount: z.string(),
      name: z.string(),
      billedByToken: z.array(tokenAmount),
      billingCount: z.number().int().nonnegative(),
    }),
  ),
  clientBreakdown: z.array(
    z.object({
      clientName: z.string(),
      projectTitle: z.string(),
      projectSlug: z.string(),
      budgetByToken: z.array(tokenAmount),
      spentByToken: z.array(tokenAmount),
    }),
  ),
  notes: z.string(),
  generatedAt: z.string(),
});

const notification = z.object({
  id: z.string(),
  organizationId: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.date().nullable(),
  createdAt: z.date(),
});

const tokenBudget = z.object({
  tokenId: z.string(),
  budget: z.string(),
  allocated: z.string(),
  committed: z.string(),
  paid: z.string(),
  remaining: z.string(),
});

const projectBudget = z.object({
  budgets: z.array(tokenBudget),
  subcontractorSpend: z.array(
    z.object({
      daoAccountId: z.string(),
      tokenId: z.string(),
      committed: z.string(),
      paid: z.string(),
    }),
  ),
});

const budget = z.object({
  id: z.string(),
  projectId: z.string(),
  tokenId: z.string(),
  amount: z.string(),
  note: z.string().nullable(),
  actorAccountId: z.string(),
  relatedBudgetId: z.string().nullable(),
  engagementId: z.string().nullable(),
  fundingDaoAccountId: z.string().nullable(),
  createdAt: z.date(),
});

const prepaymentPeriod = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "a calendar month written as YYYY-MM");

const positiveBaseAmount = z
  .string()
  .regex(/^[1-9]\d*$/, "positive integer string in the token's smallest unit")
  .max(80);

const transferReference = z.string().trim().max(500);

const prepayment = z.object({
  id: z.string(),
  engagementId: z.string(),
  daoAccountId: z.string(),
  tokenId: z.string(),
  amount: z.string(),
  period: z.string(),
  transferReference: z.string().nullable(),
  actorAccountId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const prepaidBalance = z.object({
  tokenId: z.string(),
  prepaid: z.string(),
  budgeted: z.string(),
  balance: z.string(),
});

const changeOrderStatus = z.enum([
  "proposed",
  "approved",
  "applied",
  "rejected",
  "withdrawn",
  "failed",
]);

const changeOrderItem = z.object({
  projectId: z.string().min(1).nullable(),
  tokenId,
  kind: z.enum(["plan_change", "one_off_move"]),
  amount: z
    .string()
    .regex(/^-?[1-9]\d*$/, "non-zero integer string in the token's smallest unit")
    .max(81),
});

const changeOrder = z.object({
  id: z.string(),
  engagementId: z.string(),
  proposedBy: z.object({
    side: z.enum(["agency", "client"]),
    organizationId: z.string(),
    userId: z.string(),
  }),
  status: changeOrderStatus,
  effective: z.enum(["next_period", "now"]),
  effectivePeriod: z.string().nullable(),
  note: z.string().nullable(),
  items: z.array(changeOrderItem),
  decidedByUserId: z.string().nullable(),
  decidedAt: z.date().nullable(),
  appliedAt: z.date().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  canDecide: z.boolean(),
  canWithdraw: z.boolean(),
});

const allocationPlan = z.object({
  engagementId: z.string(),
  nextPeriod: z.string(),
  lines: z.array(
    z.object({
      projectId: z.string(),
      tokenId: z.string(),
      amount: z.string(),
      effectiveFrom: z.string(),
    }),
  ),
  applications: z.array(
    z.object({
      period: z.string(),
      appliedAt: z.date(),
      shortfall: z.array(
        z.object({
          projectId: z.string(),
          tokenId: z.string(),
          amount: z.string(),
          reason: z.string(),
        }),
      ),
    }),
  ),
});

const changeOrderIdInput = z.object({ id: z.string().min(1) });

const idea = z.object({
  id: z.string(),
  engagementId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(["new", "accepted", "declined"]),
  submittedByUserId: z.string(),
  result: z
    .object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      kind: projectKind,
      shared: z.boolean(),
    })
    .nullable(),
  createdAt: z.date(),
  decidedAt: z.date().nullable(),
});

const ideaIdInput = z.object({ id: z.string().min(1) });

const assignment = z.object({
  projectId: z.string(),
  nearAccount: z.string(),
  role: z.string().nullable(),
  onboardingStatus: z.string(),
  assignedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  canRemove: z.boolean(),
  createdAt: z.date(),
});

const billing = z.object({
  id: z.string(),
  projectId: z.string(),
  nearAccount: z.string().nullable(),
  tokenId: z.string(),
  amount: z.string(),
  proposalId: z.string(),
  payingDaoAccountId: z.string(),
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

  contact: {
    submit: oc
      .route({ method: "POST", path: "/contact" })
      .input(
        z.object({
          name: z.string().min(1).max(200),
          email: z.string().email().max(320),
          company: z.string().max(200).optional(),
          message: z.string().max(4000).optional(),
        }),
      )
      .output(
        z.object({
          status: z.literal("accepted"),
          deliveryId: z.string().optional(),
        }),
      ),
  },

  applications: {
    create: oc
      .route({ method: "POST", path: "/applications" })
      .input(
        z.object({
          kind: applicationKind,
          name: z.string().min(1).max(200),
          email: z.string().email().max(320),
          nearAccountId: nearAccountId.optional(),
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
          status: z.enum(["new", "reviewing", "accepted", "declined", "converted"]).optional(),
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
          status: z.enum(["new", "reviewing", "accepted", "declined", "converted"]),
        }),
      )
      .output(z.object({ application }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    convertToBuilder: oc
      .route({ method: "POST", path: "/admin/applications/{id}/convert" })
      .input(z.object({ id: z.string() }))
      .output(
        z.object({
          application,
          contributor: z.object({ nearAccount: z.string() }),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  agency: {
    projects: {
      list: oc
        .route({ method: "GET", path: "/projects" })
        .output(z.object({ data: z.array(projectWithNearn) })),

      listOwned: oc
        .route({ method: "GET", path: "/admin/projects" })
        .output(z.object({ data: z.array(projectWithNearn) }))
        .errors({ UNAUTHORIZED, FORBIDDEN }),

      get: oc
        .route({ method: "GET", path: "/projects/{slug}" })
        .input(z.object({ slug }))
        .output(
          z.object({
            project,
            contributors: z
              .array(
                z.object({
                  nearAccount: z.string(),
                  name: z.string(),
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
        .output(projectBudget)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      create: oc
        .route({ method: "POST", path: "/admin/projects" })
        .input(
          z
            .object({
              slug,
              title: z.string().min(1).max(200),
              description: z.string().max(16000).optional(),
              repository: httpUrl.optional(),
              nearnListingId: z.string().max(200).optional(),
              kind: projectKind.default("project"),
              parentSlug: z.string().max(100).optional(),
              status: projectStatus.default("active"),
              visibility: visibility.default("private"),
            })
            .superRefine((value, ctx) => {
              if (value.kind === "project" && !value.repository) {
                ctx.addIssue({
                  code: "custom",
                  message: "Projects require a repository URL",
                  path: ["repository"],
                });
              }
              if (
                (value.kind === "scope" || value.kind === "result") &&
                !value.parentSlug?.trim()
              ) {
                ctx.addIssue({
                  code: "custom",
                  message: `${value.kind} requires a parent project slug`,
                  path: ["parentSlug"],
                });
              }
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
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
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

    reports: {
      generate: oc
        .route({ method: "POST", path: "/admin/reports/generate" })
        .input(
          z.object({
            engagementId: z.string().optional(),
            projectId: z.string().optional(),
            note: z.string().max(4000).optional(),
            startDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            endDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
          }),
        )
        .output(
          z.object({
            overview: z.object({
              projectCount: z.number().int().nonnegative(),
              budgetByToken: z.array(tokenAmount),
              billedByToken: z.array(tokenAmount),
              period: z.string(),
            }),
            contributorStats: z.array(
              z.object({
                nearAccount: z.string(),
                name: z.string(),
                billedByToken: z.array(tokenAmount),
                billingCount: z.number().int().nonnegative(),
              }),
            ),
            clientBreakdown: z.array(
              z.object({
                clientName: z.string(),
                projectTitle: z.string(),
                projectSlug: z.string(),
                budgetByToken: z.array(tokenAmount),
                spentByToken: z.array(tokenAmount),
              }),
            ),
            notes: z.string(),
            generatedAt: z.string(),
          }),
        )
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },
  },

  engagements: {
    list: oc
      .route({ method: "GET", path: "/engagements" })
      .output(z.object({ data: z.array(engagement) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    get: oc
      .route({ method: "GET", path: "/engagements/{id}" })
      .input(engagementIdInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    createWithClient: oc
      .route({ method: "POST", path: "/engagements/new-client" })
      .input(
        z.object({
          name: z.string().trim().min(1).max(200),
          slug,
          adminEmail: z.string().trim().email().max(320),
          projectIds: z.array(z.string()).max(100).optional(),
          kind: z.enum(["client", "subcontract"]).default("client"),
        }),
      )
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    subcontract: oc
      .route({ method: "POST", path: "/engagements/subcontract" })
      .input(
        z.object({
          slug: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(200),
          projectIds: z.array(z.string()).max(100).optional(),
        }),
      )
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    sharedWithUs: oc
      .route({ method: "GET", path: "/engagements/shared-with-us" })
      .output(
        z.object({
          data: z.array(
            z.object({
              engagementId: z.string(),
              readOnly: z.boolean(),
              agency: engagementParty,
              project,
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    propose: oc
      .route({ method: "POST", path: "/engagements" })
      .input(
        z.object({
          slug: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(200),
        }),
      )
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    accept: oc
      .route({ method: "POST", path: "/engagements/{id}/accept" })
      .input(engagementIdInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    decline: oc
      .route({ method: "POST", path: "/engagements/{id}/decline" })
      .input(engagementIdInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    end: oc
      .route({ method: "POST", path: "/engagements/{id}/end" })
      .input(engagementIdInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    share: oc
      .route({ method: "POST", path: "/engagements/{engagementId}/projects" })
      .input(engagementProjectInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    unshare: oc
      .route({ method: "DELETE", path: "/engagements/{engagementId}/projects/{projectId}" })
      .input(engagementProjectInput)
      .output(engagement)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    invitation: {
      resend: oc
        .route({ method: "POST", path: "/engagements/{id}/invitation/resend" })
        .input(engagementIdInput)
        .output(engagement)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

      cancel: oc
        .route({ method: "POST", path: "/engagements/{id}/invitation/cancel" })
        .input(engagementIdInput)
        .output(engagement)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

      changeEmail: oc
        .route({ method: "POST", path: "/engagements/{id}/invitation/email" })
        .input(engagementIdInput.extend({ email: z.string().trim().email().max(320) }))
        .output(engagement)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
    },
  },

  prepayments: {
    list: oc
      .route({ method: "GET", path: "/engagements/{engagementId}/prepayments" })
      .input(z.object({ engagementId: z.string().min(1) }))
      .output(z.object({ data: z.array(prepayment) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    balance: oc
      .route({ method: "GET", path: "/engagements/{engagementId}/prepaid-balance" })
      .input(z.object({ engagementId: z.string().min(1) }))
      .output(z.object({ data: z.array(prepaidBalance) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    record: oc
      .route({ method: "POST", path: "/engagements/{engagementId}/prepayments" })
      .input(
        z.object({
          engagementId: z.string().min(1),
          tokenId,
          amount: positiveBaseAmount,
          period: prepaymentPeriod,
          transferReference: transferReference.optional(),
        }),
      )
      .output(prepayment)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    correct: oc
      .route({ method: "PATCH", path: "/prepayments/{id}" })
      .input(
        z.object({
          id: z.string().min(1),
          tokenId: tokenId.optional(),
          amount: positiveBaseAmount.optional(),
          period: prepaymentPeriod.optional(),
          transferReference: transferReference.nullable().optional(),
        }),
      )
      .output(prepayment)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    remove: oc
      .route({ method: "DELETE", path: "/prepayments/{id}" })
      .input(z.object({ id: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  changeOrders: {
    list: oc
      .route({ method: "GET", path: "/engagements/{engagementId}/change-orders" })
      .input(z.object({ engagementId: z.string().min(1) }))
      .output(z.object({ data: z.array(changeOrder) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    awaiting: oc
      .route({ method: "GET", path: "/change-orders/awaiting" })
      .output(z.object({ data: z.array(changeOrder) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    plan: oc
      .route({ method: "GET", path: "/engagements/{engagementId}/allocation-plan" })
      .input(z.object({ engagementId: z.string().min(1) }))
      .output(allocationPlan)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    propose: oc
      .route({ method: "POST", path: "/engagements/{engagementId}/change-orders" })
      .input(
        z.object({
          engagementId: z.string().min(1),
          effective: z.enum(["next_period", "now"]).default("next_period"),
          note: z.string().trim().max(500).optional(),
          items: z.array(changeOrderItem).min(1).max(100),
        }),
      )
      .output(changeOrder)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    withdraw: oc
      .route({ method: "POST", path: "/change-orders/{id}/withdraw" })
      .input(changeOrderIdInput)
      .output(changeOrder)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    approve: oc
      .route({ method: "POST", path: "/change-orders/{id}/approve" })
      .input(changeOrderIdInput)
      .output(changeOrder)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    reject: oc
      .route({ method: "POST", path: "/change-orders/{id}/reject" })
      .input(changeOrderIdInput)
      .output(changeOrder)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  ideas: {
    list: oc
      .route({ method: "GET", path: "/engagements/{engagementId}/ideas" })
      .input(z.object({ engagementId: z.string().min(1) }))
      .output(z.object({ data: z.array(idea) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    submit: oc
      .route({ method: "POST", path: "/engagements/{engagementId}/ideas" })
      .input(
        z.object({
          engagementId: z.string().min(1),
          title: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).optional(),
        }),
      )
      .output(idea)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    accept: oc
      .route({ method: "POST", path: "/ideas/{id}/accept" })
      .input(
        ideaIdInput.extend({
          kind: z.enum(["project", "scope"]),
          title: z.string().trim().min(1).max(200),
          slug,
          parentSlug: slug.optional(),
          share: z.boolean().default(true),
        }),
      )
      .output(idea)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    decline: oc
      .route({ method: "POST", path: "/ideas/{id}/decline" })
      .input(ideaIdInput)
      .output(idea)
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),
  },

  clientPortal: {
    dashboard: {
      summary: oc
        .route({ method: "GET", path: "/client/{engagementId}/summary" })
        .input(z.object({ engagementId: z.string().min(1) }))
        .output(
          z.object({
            status: engagementStatus,
            readOnly: z.boolean(),
            projectCount: z.number().int().nonnegative(),
            remainingByToken: z.array(tokenAmount),
          }),
        )
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },

    projects: {
      list: oc
        .route({ method: "GET", path: "/client/{engagementId}/projects" })
        .input(z.object({ engagementId: z.string().min(1) }))
        .output(z.object({ data: z.array(project) }))
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      get: oc
        .route({ method: "GET", path: "/client/{engagementId}/projects/{slug}" })
        .input(z.object({ slug, engagementId: z.string().min(1) }))
        .output(
          z.object({
            project,
            contributors: z
              .array(
                z.object({
                  nearAccount: z.string(),
                  name: z.string(),
                  role: z.string().nullable(),
                }),
              )
              .nullable(),
          }),
        )
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

      getBudget: oc
        .route({ method: "GET", path: "/client/{engagementId}/projects/{projectId}/budget" })
        .input(z.object({ projectId: z.string(), engagementId: z.string().min(1) }))
        .output(projectBudget)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },

    billings: {
      list: oc
        .route({ method: "GET", path: "/client/{engagementId}/billings" })
        .input(
          paginationInput.extend({
            projectId: z.string().optional(),
            engagementId: z.string().min(1),
          }),
        )
        .output(
          z.object({
            data: z.array(billing),
            nextCursor: z.string().nullable(),
          }),
        )
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },

    reports: {
      generate: oc
        .route({ method: "POST", path: "/client/{engagementId}/reports/generate" })
        .input(
          z.object({
            engagementId: z.string().min(1),
            note: z.string().max(4000).optional(),
            startDate: reportDate,
            endDate: reportDate,
          }),
        )
        .output(reportOutput)
        .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
    },
  },

  notifications: {
    list: oc
      .route({ method: "GET", path: "/notifications" })
      .input(paginationInput)
      .output(z.object({ data: z.array(notification), nextCursor: z.string().nullable() }))
      .errors({ UNAUTHORIZED }),

    unreadCount: oc
      .route({ method: "GET", path: "/notifications/unread-count" })
      .output(z.object({ count: z.number().int().nonnegative() }))
      .errors({ UNAUTHORIZED }),

    markRead: oc
      .route({ method: "POST", path: "/notifications/read" })
      .input(z.object({ ids: z.array(z.string()).max(200).optional() }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED }),
  },

  contributors: {
    list: oc
      .route({ method: "GET", path: "/admin/contributors" })
      .output(z.object({ data: z.array(contributor) }))
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    get: oc
      .route({ method: "GET", path: "/admin/contributors/{nearAccount}" })
      .input(z.object({ nearAccount: nearAccountId }))
      .output(z.object({ contributor, canEdit: z.boolean() }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),

    create: oc
      .route({ method: "POST", path: "/admin/contributors" })
      .input(
        z.object({
          nearAccount: nearAccountId,
          name: z.string().min(1).max(200).optional(),
          bio: z.string().max(1000).optional(),
          skills: z.array(z.string().max(50)).max(20).optional(),
          location: z.string().max(100).optional(),
          links: z.record(z.string(), z.string()).optional(),
        }),
      )
      .output(z.object({ contributor }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    update: oc
      .route({ method: "PATCH", path: "/admin/contributors/{nearAccount}" })
      .input(
        z.object({
          nearAccount: nearAccountId,
          name: z.string().min(1).max(100).optional(),
          bio: z.string().max(1000).optional(),
          skills: z.array(z.string().max(50)).max(20).optional(),
          location: z.string().max(100).optional(),
          links: z.record(z.string(), z.string()).optional(),
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
          data: z.array(assignment),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    listAll: oc
      .route({ method: "GET", path: "/admin/assignments" })
      .output(
        z.object({
          data: z.array(
            assignment.extend({
              projectSlug: z.string(),
              projectTitle: z.string(),
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
          nearAccount: nearAccountId,
          role: z.string().max(80).optional(),
          onboardingStatus: z.string().max(40).optional(),
        }),
      )
      .output(
        z.object({
          projectId: z.string(),
          nearAccount: z.string(),
          role: z.string().nullable(),
          onboardingStatus: z.string(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

    delete: oc
      .route({
        method: "DELETE",
        path: "/admin/projects/{projectId}/contributors/{nearAccount}",
      })
      .input(
        z.object({
          projectId: z.string(),
          nearAccount: nearAccountId,
        }),
      )
      .output(z.object({ ok: z.literal(true) }))
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND }),
  },

  budgets: {
    list: oc
      .route({ method: "GET", path: "/admin/budgets" })
      .input(
        paginationInput.extend({
          projectId: z.string().optional(),
          tokenId: z.string().optional(),
          engagementId: z.string().optional(),
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
      .errors({ UNAUTHORIZED, FORBIDDEN, NOT_FOUND, BAD_REQUEST }),

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
          nearAccount: nearAccountId.optional(),
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
          nearAccount: nearAccountId.optional(),
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
    list: oc.route({ method: "GET", path: "/tokens" }).output(tokenList),

    listOwned: oc
      .route({ method: "GET", path: "/admin/tokens" })
      .output(tokenList)
      .errors({ UNAUTHORIZED, FORBIDDEN }),

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
              id: z.string().nullable(),
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
    roles: oc
      .route({ method: "GET", path: "/me/roles" })
      .output(
        z.object({
          orgRole: z.enum(["admin", "member", "owner"]).nullable(),
          agencyDao: z.string().nullable(),
          capabilities: z.object({
            canManageMembers: z.boolean(),
            canUseMoney: z.boolean(),
            hasAgencySections: z.boolean(),
            hasClientSections: z.boolean(),
          }),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    assignedProjects: oc
      .route({ method: "GET", path: "/me/assigned-projects" })
      .output(
        z.object({
          data: z.array(
            z.object({
              projectId: z.string(),
              projectSlug: z.string(),
              projectTitle: z.string(),
              organizationId: z.string(),
              agencyName: z.string(),
              role: z.string().nullable(),
              onboardingStatus: z.string(),
              createdAt: z.date(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    billings: oc
      .route({ method: "GET", path: "/me/billings" })
      .input(paginationInput)
      .output(
        z.object({
          data: z.array(
            billing.extend({
              projectTitle: z.string().nullable(),
              agencyName: z.string().nullable(),
            }),
          ),
          nextCursor: z.string().nullable(),
        }),
      )
      .errors({ UNAUTHORIZED }),

    organizations: oc
      .route({ method: "GET", path: "/me/organizations" })
      .output(
        z.object({
          data: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              slug: z.string(),
              role: z.enum(["owner", "admin", "member"]).nullable(),
            }),
          ),
        }),
      )
      .errors({ UNAUTHORIZED }),
  },

  agencyDao: {
    get: oc
      .route({ method: "GET", path: "/admin/agency-dao" })
      .output(
        z.object({
          daoAccountId: z.string().nullable(),
          network: z.enum(["mainnet", "testnet"]),
          inUse: z.boolean(),
        }),
      )
      .errors({ UNAUTHORIZED, FORBIDDEN }),

    connect: oc
      .route({ method: "POST", path: "/admin/agency-dao" })
      .input(
        z.object({
          daoAccountId: z.string().trim().min(1).max(64),
          organizationId: z.string().min(1).optional(),
        }),
      )
      .output(z.object({ daoAccountId: z.string() }))
      .errors({ UNAUTHORIZED, FORBIDDEN, BAD_REQUEST }),

    disconnect: oc
      .route({ method: "DELETE", path: "/admin/agency-dao" })
      .output(z.object({ daoAccountId: z.null() }))
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
        orgAccountId: z.string().nullable(),
        network: z.enum(["mainnet", "testnet"]),
        networkPinned: z.boolean(),
      }),
    ),

    get: oc
      .route({ method: "GET", path: "/admin/settings" })
      .output(
        z.object({
          orgAccountId: z.string().nullable(),
          network: z.enum(["mainnet", "testnet"]),
          // Editable for admins of this deployment — resolved DB → env → hardcoded.
          editable: z.object({
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
});

export type ContractType = typeof contract;
