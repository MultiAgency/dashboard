import { randomUUID } from "node:crypto";
import type { OrganizationMembersStore } from "../services/organization-recovery";
import {
  deliverableEmail,
  type Invitation,
  MANAGER_ROLES,
  type OrganizationDirectory,
  type OrganizationRole,
  parseOrgMetadata,
  SlugTakenError,
  toInvitationStatus,
  toOrganization,
  toOrganizationRole,
} from "./organizations";

export type SqlClient = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type AuthTableNames = { user: string; organization: string; member: string };

const DEFAULT_TABLES: AuthTableNames = {
  user: "user",
  organization: "organization",
  member: "member",
};

type MemberColumns = { organizationId: string; userId: string; createdAt: string };

const CAMEL_CASE: MemberColumns = {
  organizationId: "organizationId",
  userId: "userId",
  createdAt: "createdAt",
};

const SNAKE_CASE: MemberColumns = {
  organizationId: "organization_id",
  userId: "user_id",
  createdAt: "created_at",
};

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function authDatabaseMembers(
  sql: SqlClient,
  tables: AuthTableNames = DEFAULT_TABLES,
): OrganizationMembersStore {
  let columns: Promise<MemberColumns> | null = null;

  async function detectColumns(): Promise<MemberColumns> {
    const { rows } = await sql.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
      [tables.member],
    );
    const names = new Set(rows.map((r) => r.column_name));
    if (names.has(CAMEL_CASE.organizationId)) return CAMEL_CASE;
    if (names.has(SNAKE_CASE.organizationId)) return SNAKE_CASE;
    throw new Error(
      `Table ${tables.member} has neither organizationId nor organization_id; is this the auth database?`,
    );
  }

  const memberColumns = () => {
    columns ??= detectColumns();
    return columns;
  };

  const user = quote(tables.user);
  const organization = quote(tables.organization);
  const member = quote(tables.member);

  return {
    findUserId: async (emailOrId) => {
      const { rows } = await sql.query<{ id: string }>(
        `SELECT id FROM ${user} WHERE id = $1 OR lower(email) = lower($1) LIMIT 1`,
        [emailOrId.trim()],
      );
      return rows[0]?.id ?? null;
    },

    roster: async (organizationId) => {
      const c = await memberColumns();
      const { rows: organizations } = await sql.query<{
        id: string;
        name: string;
        metadata: unknown;
      }>(`SELECT id, name, metadata FROM ${organization} WHERE id = $1`, [organizationId]);
      const found = organizations[0];
      if (!found) return null;
      const { rows: members } = await sql.query<{ id: string; userId: string; role: string }>(
        `SELECT id, ${quote(c.userId)} AS "userId", role FROM ${member} WHERE ${quote(c.organizationId)} = $1`,
        [organizationId],
      );
      return {
        organization: {
          id: found.id,
          name: found.name,
          isPersonal: parseOrgMetadata(found.metadata).isPersonal === true,
        },
        members: members.map((m) => ({ memberId: m.id, userId: m.userId, role: m.role })),
      };
    },

    addOwner: async ({ organizationId, userId }) => {
      const c = await memberColumns();
      await sql.query(
        `INSERT INTO ${member} (id, ${quote(c.organizationId)}, ${quote(c.userId)}, role, ${quote(c.createdAt)}) VALUES ($1, $2, $3, 'owner', now())`,
        [randomUUID(), organizationId, userId],
      );
    },

    promoteToOwner: async ({ memberId }) => {
      await sql.query(`UPDATE ${member} SET role = 'owner' WHERE id = $1`, [memberId]);
    },

    findUserIdByNearAccount: async (accountId) => {
      const { rows: found } = await sql.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_name IN ('nearAccount', 'near_account')",
      );
      const table = found[0]?.table_name;
      if (!table) return null;
      const snake = table === "near_account";
      const { rows } = await sql.query<{ userId: string }>(
        `SELECT ${quote(snake ? "user_id" : "userId")} AS "userId" FROM ${quote(table)} WHERE ${quote(snake ? "account_id" : "accountId")} = $1 LIMIT 1`,
        [accountId],
      );
      return rows[0]?.userId ?? null;
    },

    removeMember: async ({ memberId }) => {
      await sql.query(`DELETE FROM ${member} WHERE id = $1`, [memberId]);
    },
  };
}

type TableColumns = (camel: string) => string;

function snakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function columnResolver(sql: SqlClient) {
  const cache = new Map<string, Promise<Set<string>>>();
  const columnsOf = (table: string) => {
    let found = cache.get(table);
    if (!found) {
      found = sql
        .query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
          [table],
        )
        .then(({ rows }) => new Set(rows.map((r) => r.column_name)));
      cache.set(table, found);
    }
    return found;
  };
  return async (table: string): Promise<TableColumns & { has(camel: string): boolean }> => {
    const columns = await columnsOf(table);
    const name = (camel: string) =>
      quote(columns.has(camel) || !columns.has(snakeCase(camel)) ? camel : snakeCase(camel));
    return Object.assign(name, {
      has: (camel: string) => columns.has(camel) || columns.has(snakeCase(camel)),
    });
  };
}

export type AuthDirectoryTables = AuthTableNames & { invitation: string };

type OrganizationRowShape = {
  id: string;
  name: string;
  slug: string;
  metadata: unknown;
  createdAt: Date | string | null;
};

type InvitationRowShape = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date | string;
};

function toInvitation(row: InvitationRowShape): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: toOrganizationRole(row.role),
    status: toInvitationStatus(row.status),
    expiresAt: new Date(row.expiresAt),
  };
}

function managerRole(raw: string): OrganizationRole | null {
  const roles = raw.split(",").map((r) => r.trim());
  return MANAGER_ROLES.find((role) => roles.includes(role)) ?? null;
}

export function authDatabaseDirectory(
  sql: SqlClient,
  tables: AuthDirectoryTables = { ...DEFAULT_TABLES, invitation: "invitation" },
): OrganizationDirectory {
  const columns = columnResolver(sql);
  const user = quote(tables.user);
  const organization = quote(tables.organization);
  const member = quote(tables.member);
  const invitation = quote(tables.invitation);

  async function organizationSelect(alias: string) {
    const o = await columns(tables.organization);
    return `${alias}.id, ${alias}.name, ${alias}.slug, ${alias}.metadata, ${alias}.${o("createdAt")} AS "createdAt"`;
  }

  async function findOrganization(where: string, param: string) {
    const { rows } = await sql.query<OrganizationRowShape>(
      `SELECT ${await organizationSelect("o")} FROM ${organization} o WHERE ${where} LIMIT 1`,
      [param],
    );
    return rows[0] ? toOrganization(rows[0]) : null;
  }

  async function invitationSelect() {
    const i = await columns(tables.invitation);
    return `id, ${i("organizationId")} AS "organizationId", email, role, status, ${i("expiresAt")} AS "expiresAt"`;
  }

  return {
    get: (organizationId) => findOrganization("o.id = $1", organizationId),

    findBySlug: (slug) => findOrganization("lower(o.slug) = lower($1)", slug.trim()),

    managers: async (organizationId) => {
      const m = await columns(tables.member);
      const { rows } = await sql.query<{ userId: string; role: string; email: string | null }>(
        `SELECT m.${m("userId")} AS "userId", m.role, u.email FROM ${member} m JOIN ${user} u ON u.id = m.${m("userId")} WHERE m.${m("organizationId")} = $1`,
        [organizationId],
      );
      return rows.flatMap((row) => {
        const role = managerRole(row.role);
        return role ? [{ userId: row.userId, role, email: deliverableEmail(row.email) }] : [];
      });
    },

    memberships: async (userId) => {
      const m = await columns(tables.member);
      const { rows } = await sql.query<OrganizationRowShape & { role: string }>(
        `SELECT ${await organizationSelect("o")}, m.role FROM ${member} m JOIN ${organization} o ON o.id = m.${m("organizationId")} WHERE m.${m("userId")} = $1`,
        [userId],
      );
      return rows.map((row) => ({
        organization: toOrganization(row),
        role: managerRole(row.role) ?? toOrganizationRole(row.role.split(",")[0]?.trim()),
      }));
    },

    create: async ({ name, slug }) => {
      if (await findOrganization("lower(o.slug) = lower($1)", slug)) throw new SlugTakenError(slug);
      const o = await columns(tables.organization);
      const id = randomUUID();
      await sql.query(
        `INSERT INTO ${organization} (id, name, slug, ${o("createdAt")}) VALUES ($1, $2, $3, now())`,
        [id, name, slug],
      );
      const created = await findOrganization("o.id = $1", id);
      if (!created) throw new Error("Organization insert returned no row");
      return created;
    },

    invite: async (input) => {
      const i = await columns(tables.invitation);
      const id = randomUUID();
      const extra = i.has("createdAt") ? `, ${i("createdAt")}` : "";
      await sql.query(
        `INSERT INTO ${invitation} (id, ${i("organizationId")}, email, role, status, ${i("expiresAt")}, ${i("inviterId")}${extra}) VALUES ($1, $2, $3, $4, 'pending', $5, $6${extra ? ", now()" : ""})`,
        [
          id,
          input.organizationId,
          input.email.trim().toLowerCase(),
          input.role,
          input.expiresAt,
          input.inviterId,
        ],
      );
      return {
        id,
        organizationId: input.organizationId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        status: "pending",
        expiresAt: input.expiresAt,
      };
    },

    invitation: async (invitationId) => {
      const { rows } = await sql.query<InvitationRowShape>(
        `SELECT ${await invitationSelect()} FROM ${invitation} WHERE id = $1`,
        [invitationId],
      );
      return rows[0] ? toInvitation(rows[0]) : null;
    },

    updateInvitation: async (invitationId, patch) => {
      const i = await columns(tables.invitation);
      const sets: string[] = [];
      const params: unknown[] = [invitationId];
      if (patch.status) {
        params.push(patch.status);
        sets.push(`status = $${params.length}`);
      }
      if (patch.expiresAt) {
        params.push(patch.expiresAt);
        sets.push(`${i("expiresAt")} = $${params.length}`);
      }
      if (sets.length === 0) return;
      await sql.query(`UPDATE ${invitation} SET ${sets.join(", ")} WHERE id = $1`, params);
    },
  };
}
