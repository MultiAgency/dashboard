import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import { ORPCError } from "every-plugin/orpc";
import type { Database } from "../db";
import { DatabaseTag } from "../db/layer";
import { builderAccounts, builderAdmissions, builderAgreements, builders } from "../db/schema";
import {
  type BuilderCaller,
  generateId,
  isPlatformAdmin,
  parseSkills,
  serializeSkills,
} from "./builders";

export type Network = "testnet" | "mainnet";
type Kind = "human" | "agent";
type AdmissionStatus = "admitted" | "suspended" | "removed";

export interface Member {
  githubLogin: string;
  kind: Kind;
  operatorGithubLogin: string | null;
  name: string | null;
  skills: string[];
  nearAccount: string | null;
  accounts: Array<{ network: Network; account: string }>;
  admissions: Array<{
    network: Network;
    status: AdmissionStatus;
    proofUrl: string | null;
    admittedAt: string | null;
  }>;
}

export interface MemberWrite {
  githubLogin: string;
  network: Network;
  kind: Kind;
  operatorGithubLogin?: string;
  name?: string;
  skills?: string[];
  account?: { account: string; proof: string };
  admission?: {
    status: AdmissionStatus;
    proofUrl?: string;
    admittedAt?: string;
  };
}

export interface Agreement {
  version: string;
  attestedAt: string;
  proof: string;
}

export interface RecordedAgreement {
  githubLogin: string;
  version: string;
  attestedAt: string;
  recordedBy: string;
  recordedAt: string;
}

export interface MemberFilter {
  network?: Network;
  status?: AdmissionStatus;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | Transaction;

const badRequest = (message: string) => new ORPCError("BAD_REQUEST", { message });
const conflict = (message: string) => new ORPCError("CONFLICT", { message });

function checkWrite(input: MemberWrite) {
  if (input.kind === "agent" && !input.operatorGithubLogin) {
    throw badRequest("An agent needs an operator");
  }
  if (input.kind === "human" && input.operatorGithubLogin) {
    throw badRequest("Only an agent has an operator");
  }
  if (input.operatorGithubLogin === input.githubLogin) {
    throw badRequest("A member cannot be its own operator");
  }
  const admission = input.admission;
  if (admission?.status === "admitted" && (!admission.proofUrl || !admission.admittedAt)) {
    throw badRequest("Admitting a member needs its proof and date");
  }
}

async function findBy(db: Queryable, where: ReturnType<typeof eq>) {
  const [row] = await db.select().from(builders).where(where).limit(1);
  return row;
}

async function admissionOf(db: Queryable, builderId: string, network: Network) {
  const [row] = await db
    .select()
    .from(builderAdmissions)
    .where(and(eq(builderAdmissions.builderId, builderId), eq(builderAdmissions.network, network)))
    .limit(1);
  return row;
}

async function accountOf(db: Queryable, builderId: string, network: Network) {
  const [row] = await db
    .select()
    .from(builderAccounts)
    .where(and(eq(builderAccounts.builderId, builderId), eq(builderAccounts.network, network)))
    .limit(1);
  return row;
}

async function operatorIdFor(
  db: Queryable,
  input: MemberWrite,
  currentOperatorId: string | null,
): Promise<string | null> {
  if (!input.operatorGithubLogin) return null;
  const operator = await findBy(db, eq(builders.githubLogin, input.operatorGithubLogin));
  if (!operator || operator.kind !== "human") {
    throw badRequest(`Operator ${input.operatorGithubLogin} is not a human member`);
  }
  if (operator.id === currentOperatorId && input.network === "testnet") return operator.id;
  const admission = await admissionOf(db, operator.id, input.network);
  if (admission?.status !== "admitted") {
    throw badRequest(`Operator ${input.operatorGithubLogin} is not admitted on ${input.network}`);
  }
  return operator.id;
}

type BuilderRow = typeof builders.$inferSelect;
type MemberRow = BuilderRow & { githubLogin: string };

const isMember = (row: BuilderRow | undefined): row is MemberRow => Boolean(row?.githubLogin);

async function assemble(db: Queryable, rows: MemberRow[]): Promise<Member[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const operatorIds = rows.flatMap((row) => (row.operatorId ? [row.operatorId] : []));
  const [accounts, admissions, operators] = await Promise.all([
    db
      .select()
      .from(builderAccounts)
      .where(inArray(builderAccounts.builderId, ids))
      .orderBy(builderAccounts.network),
    db
      .select()
      .from(builderAdmissions)
      .where(inArray(builderAdmissions.builderId, ids))
      .orderBy(builderAdmissions.network),
    operatorIds.length
      ? db
          .select({ id: builders.id, githubLogin: builders.githubLogin })
          .from(builders)
          .where(inArray(builders.id, operatorIds))
      : [],
  ]);
  const operatorLogin = new Map(operators.map((o) => [o.id, o.githubLogin]));
  const accountsOf = Map.groupBy(accounts, (a) => a.builderId);
  const admissionsOf = Map.groupBy(admissions, (a) => a.builderId);

  return rows.map((row) => ({
    githubLogin: row.githubLogin,
    kind: row.kind as Kind,
    operatorGithubLogin: row.operatorId ? (operatorLogin.get(row.operatorId) ?? null) : null,
    name: row.name ?? null,
    skills: parseSkills(row.skills),
    nearAccount: row.nearAccount ?? null,
    accounts: (accountsOf.get(row.id) ?? []).map((a) => ({
      network: a.network as Network,
      account: a.account,
    })),
    admissions: (admissionsOf.get(row.id) ?? []).map((a) => ({
      network: a.network as Network,
      status: a.status as AdmissionStatus,
      proofUrl: a.proofUrl ?? null,
      admittedAt: a.admittedAt?.toISOString() ?? null,
    })),
  }));
}

async function readMember(db: Queryable, githubLogin: string): Promise<Member | null> {
  const row = await findBy(db, eq(builders.githubLogin, githubLogin));
  if (!isMember(row)) return null;
  const [member] = await assemble(db, [row]);
  return member ?? null;
}

async function listMembers(db: Database, filter: MemberFilter): Promise<Member[]> {
  const admitted =
    filter.network || filter.status
      ? inArray(
          builders.id,
          db
            .select({ builderId: builderAdmissions.builderId })
            .from(builderAdmissions)
            .where(
              and(
                filter.network ? eq(builderAdmissions.network, filter.network) : undefined,
                filter.status ? eq(builderAdmissions.status, filter.status) : undefined,
              ),
            ),
        )
      : undefined;
  const rows = await db
    .select()
    .from(builders)
    .where(and(isNotNull(builders.githubLogin), admitted))
    .orderBy(asc(builders.githubLogin));
  return assemble(db, rows.filter(isMember));
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toOrpcError(error: unknown) {
  if (error instanceof ORPCError) return error;
  if (isUniqueViolation(error)) return conflict("Another write for this member or account won");
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: error instanceof Error ? error.message : String(error),
  });
}

async function lockKeys(tx: Transaction, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`builders-registry:${key}`}))`);
  }
}

async function absorbProfile(tx: Transaction, member: BuilderRow, profile: BuilderRow) {
  await tx.delete(builders).where(eq(builders.id, profile.id));
  const merged = {
    userId: member.userId ?? profile.userId,
    name: member.name ?? profile.name,
    bio: member.bio ?? profile.bio,
    location: member.location ?? profile.location,
    links: member.links ?? profile.links,
    skills: parseSkills(member.skills).length > 0 ? member.skills : profile.skills,
  };
  await tx.update(builders).set(merged).where(eq(builders.id, member.id));
  return { ...member, ...merged };
}

async function writeMember(tx: Transaction, input: MemberWrite) {
  const mainnetAccount = input.network === "mainnet" ? input.account?.account : undefined;
  await lockKeys(tx, [
    `member:${input.githubLogin}`,
    ...(input.operatorGithubLogin ? [`member:${input.operatorGithubLogin}`] : []),
    ...(mainnetAccount ? [`account:${mainnetAccount}`] : []),
  ]);

  let member = await findBy(tx, eq(builders.githubLogin, input.githubLogin));
  const profile = mainnetAccount
    ? await findBy(tx, eq(builders.nearAccount, mainnetAccount))
    : undefined;
  if (profile && profile.id !== member?.id) {
    if (profile.githubLogin) {
      throw conflict(`${mainnetAccount} belongs to member ${profile.githubLogin}`);
    }
    if (member?.nearAccount) {
      throw conflict(`${mainnetAccount} already has a builder profile`);
    }
    member = member ? await absorbProfile(tx, member, profile) : profile;
  }

  const operatorId = await operatorIdFor(tx, input, member?.operatorId ?? null);

  const previousAccount = member && (await accountOf(tx, member.id, input.network));

  const overwritten: string[] = [];
  if (member) {
    const identityChanged = member.kind !== input.kind || member.operatorId !== operatorId;
    if (
      identityChanged &&
      input.network === "testnet" &&
      (await admissionOf(tx, member.id, "mainnet"))
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "Kind and operator of a member admitted on mainnet change only through mainnet",
      });
    }
    if (input.kind === "agent" && member.kind !== "agent") {
      const operated = await findBy(tx, eq(builders.operatorId, member.id));
      if (operated) throw badRequest("A member who operates agents cannot become an agent");
    }
    if (member.kind !== input.kind) overwritten.push("kind");
    if (member.operatorId !== operatorId) overwritten.push("operatorGithubLogin");
    if (input.name !== undefined && member.name !== null && member.name !== input.name) {
      overwritten.push("name");
    }
    if (
      input.skills !== undefined &&
      parseSkills(member.skills).length > 0 &&
      member.skills !== serializeSkills(input.skills)
    ) {
      overwritten.push("skills");
    }
    if (input.account && previousAccount && previousAccount.account !== input.account.account) {
      overwritten.push("account");
    }
  }

  const now = new Date();
  const identity = {
    githubLogin: input.githubLogin,
    kind: input.kind,
    operatorId,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.skills !== undefined && { skills: serializeSkills(input.skills) }),
    ...(mainnetAccount && !member?.nearAccount && { nearAccount: mainnetAccount }),
    updatedAt: now,
  };

  const builderId = member?.id ?? generateId();
  if (member) {
    await tx.update(builders).set(identity).where(eq(builders.id, builderId));
  } else {
    await tx.insert(builders).values({
      id: builderId,
      ...identity,
      skills: serializeSkills(input.skills),
      createdAt: now,
    });
  }

  if (input.account) {
    const [holder] = await tx
      .select()
      .from(builderAccounts)
      .where(
        and(
          eq(builderAccounts.network, input.network),
          eq(builderAccounts.account, input.account.account),
        ),
      )
      .limit(1);
    if (holder && holder.builderId !== builderId) {
      throw conflict(`${input.account.account} is another member's ${input.network} account`);
    }
    const account = {
      account: input.account.account,
      proof: input.account.proof,
      verifiedAt: now,
    };
    await tx
      .insert(builderAccounts)
      .values({ builderId, network: input.network, ...account })
      .onConflictDoUpdate({
        target: [builderAccounts.builderId, builderAccounts.network],
        set: account,
      });
  }

  if (input.admission) {
    const admission = input.admission;
    const fields = {
      status: admission.status,
      ...(admission.proofUrl !== undefined && { proofUrl: admission.proofUrl }),
      ...(admission.admittedAt !== undefined && { admittedAt: new Date(admission.admittedAt) }),
      updatedAt: now,
    };
    await tx
      .insert(builderAdmissions)
      .values({ builderId, network: input.network, ...fields })
      .onConflictDoUpdate({
        target: [builderAdmissions.builderId, builderAdmissions.network],
        set: fields,
      });
  }

  const data = await readMember(tx, input.githubLogin);
  if (!data) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Member was not saved" });
  return { data, overwritten };
}

async function recordAgreement(
  db: Database,
  githubLogin: string,
  agreement: Agreement,
  caller: BuilderCaller,
): Promise<RecordedAgreement> {
  if (!isPlatformAdmin(caller)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only a platform admin records a services agreement",
    });
  }
  const member = await findBy(db, eq(builders.githubLogin, githubLogin));
  if (!isMember(member)) throw new ORPCError("NOT_FOUND", { message: "Member not found" });
  const fields = {
    version: agreement.version,
    attestedAt: new Date(agreement.attestedAt),
    proof: agreement.proof,
    recordedBy: caller.userId,
    recordedAt: new Date(),
  };
  await db
    .insert(builderAgreements)
    .values({ builderId: member.id, ...fields })
    .onConflictDoUpdate({ target: builderAgreements.builderId, set: fields });
  return {
    githubLogin: member.githubLogin,
    version: fields.version,
    attestedAt: fields.attestedAt.toISOString(),
    recordedBy: fields.recordedBy,
    recordedAt: fields.recordedAt.toISOString(),
  };
}

export class MemberService extends Context.Tag("builders/MemberService")<
  MemberService,
  {
    putMember: (
      input: MemberWrite,
    ) => Effect.Effect<{ data: Member; overwritten: string[] }, ORPCError<string, unknown>>;
    listMembers: (filter: MemberFilter) => Effect.Effect<Member[], ORPCError<string, unknown>>;
    getMember: (githubLogin: string) => Effect.Effect<Member | null, ORPCError<string, unknown>>;
    recordAgreement: (
      githubLogin: string,
      agreement: Agreement,
      caller: BuilderCaller,
    ) => Effect.Effect<RecordedAgreement, ORPCError<string, unknown>>;
  }
>() {}

export const MemberServiceLive = Layer.effect(
  MemberService,
  Effect.gen(function* () {
    const db = yield* DatabaseTag;

    return {
      putMember: (input) =>
        Effect.tryPromise({
          try: async () => {
            checkWrite(input);
            return db.transaction((tx) => writeMember(tx, input));
          },
          catch: toOrpcError,
        }),
      listMembers: (filter) =>
        Effect.tryPromise({ try: () => listMembers(db, filter), catch: toOrpcError }),
      getMember: (githubLogin) =>
        Effect.tryPromise({ try: () => readMember(db, githubLogin), catch: toOrpcError }),
      recordAgreement: (githubLogin, agreement, caller) =>
        Effect.tryPromise({
          try: () => recordAgreement(db, githubLogin, agreement, caller),
          catch: toOrpcError,
        }),
    };
  }),
);
