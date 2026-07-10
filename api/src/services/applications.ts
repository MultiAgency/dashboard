import { and, desc, eq } from "drizzle-orm";
import { Effect } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { cursorOf, cursorWhere } from "../db/cursor";
import { applications } from "../db/schema";
import { defaultContactEmail } from "./settings-admin";
import { notifyNewApplication, type NotifyConfig } from "./notify";

export function createApplicationsService(db: Database, notifyConfig: NotifyConfig) {
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
      status?: "new" | "reviewing" | "accepted" | "declined";
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
      input: { id: string; status: "new" | "reviewing" | "accepted" | "declined" },
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
          return yield* Effect.fail(new ORPCError("NOT_FOUND", { message: "Application not found" }));
        }
        return { application: row };
      }),
  };
}

export type ApplicationsService = ReturnType<typeof createApplicationsService>;
