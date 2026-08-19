import { and, desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { applications } from "../db/schema";
import type { ContributorsService } from "./contributors";
import { type NotifyConfig, notifyNewApplication } from "./notify";
import { defaultContactEmail } from "./settings-admin";

export function createApplicationsService(
  db: Database,
  notifyConfig: NotifyConfig,
  contributors?: ContributorsService,
) {
  return {
    create: (input: {
      kind: "founder" | "contributor" | "client";
      name: string;
      email: string;
      nearAccountId?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    }) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID();
        yield* Effect.promise(() =>
          db.insert(applications).values({
            id,
            kind: input.kind,
            name: input.name,
            email: input.email,
            nearAccountId: input.nearAccountId ?? null,
            message: input.message ?? null,
            metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          }),
        );
        yield* Effect.promise(() =>
          notifyNewApplication(
            {
              id,
              kind: input.kind,
              name: input.name,
              email: input.email,
              nearAccountId: input.nearAccountId ?? null,
              message: input.message ?? null,
            },
            { ...notifyConfig, contactEmail: defaultContactEmail() },
          ),
        );
        return { id, status: "new" as const };
      }),

    list: (input: {
      kind?: "founder" | "contributor" | "client";
      status?: "new" | "reviewing" | "accepted" | "declined" | "converted";
      cursor?: string;
      limit: number;
    }) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          db
            .select()
            .from(applications)
            .where(
              and(
                input.kind ? eq(applications.kind, input.kind) : undefined,
                input.status ? eq(applications.status, input.status) : undefined,
                cursorWhere(applications.createdAt, applications.id, input.cursor),
              ),
            )
            .orderBy(desc(applications.createdAt), desc(applications.id))
            .limit(input.limit),
        );
        const last = rows[rows.length - 1];
        return {
          data: rows,
          nextCursor:
            rows.length === input.limit && last ? cursorOf(last.createdAt, last.id) : null,
        };
      }),

    update: (
      context: { near?: { primaryAccountId?: string }; userId?: string },
      input: {
        id: string;
        status: "new" | "reviewing" | "accepted" | "declined" | "converted";
      },
    ) =>
      Effect.gen(function* () {
        const reviewed = input.status !== "new";
        const result = yield* Effect.promise(() =>
          db
            .update(applications)
            .set({
              status: input.status,
              reviewedBy: reviewed
                ? (context.near?.primaryAccountId ?? context.userId ?? null)
                : null,
              reviewedAt: reviewed ? new Date() : null,
            })
            .where(eq(applications.id, input.id))
            .returning(),
        );
        const row = result[0];
        if (!row) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Application not found" }),
          );
        }
        return { application: row };
      }),

    convertToBuilder: (context: Record<string, unknown>, input: { id: string }) =>
      Effect.gen(function* () {
        if (!contributors) {
          return yield* Effect.fail(
            new ORPCError("INTERNAL_SERVER_ERROR", { message: "Contributors service unavailable" }),
          );
        }

        const rows = yield* Effect.promise(() =>
          db.select().from(applications).where(eq(applications.id, input.id)).limit(1),
        );
        const app = rows[0];
        if (!app) {
          return yield* Effect.fail(
            new ORPCError("NOT_FOUND", { message: "Application not found" }),
          );
        }
        if (app.status === "converted") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", { message: "Application already converted" }),
          );
        }
        if (app.status !== "accepted") {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Only accepted applications can be converted to builders",
            }),
          );
        }
        if (!app.nearAccountId) {
          return yield* Effect.fail(
            new ORPCError("BAD_REQUEST", {
              message: "Application must have a NEAR account to convert",
            }),
          );
        }

        yield* contributors.create(context, {
          nearAccount: app.nearAccountId,
          name: app.name,
          bio: app.message ?? undefined,
        });

        const result = yield* Effect.promise(() =>
          db
            .update(applications)
            .set({
              status: "converted",
              reviewedBy:
                (context as any).near?.primaryAccountId ?? (context as any).userId ?? null,
              reviewedAt: new Date(),
            })
            .where(eq(applications.id, input.id))
            .returning(),
        );

        return { application: result[0]!, contributor: { nearAccount: app.nearAccountId } };
      }),
  };
}

export type ApplicationsService = ReturnType<typeof createApplicationsService>;
