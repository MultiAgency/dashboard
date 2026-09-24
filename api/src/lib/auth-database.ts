import { randomUUID } from "node:crypto";
import type { OrganizationMembersStore } from "../services/organization-recovery";
import { parseOrgMetadata } from "./organizations";

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
  };
}
