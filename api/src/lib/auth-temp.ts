// Temporary direct-DB bridge — replaces the auth plugin's missing
// programmatic org/member management API (list all orgs, add member
// by ID with custom roles, find user by NEAR account).
// Replace with auth plugin API when available.
import pg from "pg";

export interface AuthOrg {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface AuthMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
  nearAccountId: string | null;
  email: string | null;
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function generateId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export class AuthDbClient {
  private pool: pg.Pool;

  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      ssl:
        url.includes("localhost") || url.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: false },
    });
  }

  async listOrgs(): Promise<AuthOrg[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, slug, logo, created_at, metadata FROM organization
       WHERE metadata IS NOT NULL
         AND metadata::jsonb ? 'daoAccountId'
         AND (metadata::jsonb ->> 'isPersonal') IS DISTINCT FROM 'true'
       ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo ?? null,
      createdAt: r.created_at,
      metadata: parseMetadata(r.metadata),
    }));
  }

  async createOrg(data: {
    name: string;
    slug: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuthOrg> {
    const id = generateId();
    const now = new Date();
    const metaJson = data.metadata ? JSON.stringify(data.metadata) : null;
    await this.pool.query(
      `INSERT INTO organization (id, name, slug, logo, created_at, metadata) VALUES ($1, $2, $3, NULL, $4, $5)`,
      [id, data.name, data.slug, now, metaJson],
    );
    return {
      id,
      name: data.name,
      slug: data.slug,
      logo: null,
      createdAt: now,
      metadata: data.metadata ?? null,
    };
  }

  async listMembers(orgId: string): Promise<AuthMember[]> {
    const { rows } = await this.pool.query(
      `SELECT m.id, m.organization_id, m.user_id, m.role, m.created_at,
              u.name as near_account_id, u.email
       FROM member m
       JOIN "user" u ON m.user_id = u.id
       WHERE m.organization_id = $1
       ORDER BY m.created_at ASC`,
      [orgId],
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
      nearAccountId: r.near_account_id ?? null,
      email: r.email ?? null,
    }));
  }

  async findUserByNearId(nearAccountId: string): Promise<{ id: string; email: string | null } | null> {
    const input = nearAccountId.trim();
    if (input.includes("@")) {
      const { rows } = await this.pool.query(
        `SELECT id, email FROM "user" WHERE email = $1 LIMIT 1`,
        [input],
      );
      return rows[0] ?? null;
    }
    const withoutSuffix = input.replace(/\.near$/, "");
    const derivedEmail = `${withoutSuffix}@near.email`;
    const { rows } = await this.pool.query(
      `SELECT id, email FROM "user" WHERE name = $1 OR name = $2 OR email = $3 LIMIT 1`,
      [input, withoutSuffix, derivedEmail],
    );
    return rows[0] ?? null;
  }

  async addMember(orgId: string, userId: string, role: string): Promise<void> {
    const id = generateId();
    await this.pool.query(
      `INSERT INTO member (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [id, orgId, userId, role, new Date()],
    );
  }

  async updateMemberRole(memberId: string, orgId: string, role: string): Promise<void> {
    await this.pool.query(`UPDATE member SET role = $1 WHERE id = $2 AND organization_id = $3`, [
      role,
      memberId,
      orgId,
    ]);
  }

  async removeMember(memberId: string, orgId: string): Promise<void> {
    await this.pool.query(`DELETE FROM member WHERE id = $1 AND organization_id = $2`, [
      memberId,
      orgId,
    ]);
  }

  async deleteOrg(orgId: string): Promise<void> {
    await this.pool.query(`DELETE FROM member WHERE organization_id = $1`, [orgId]);
    await this.pool.query(`DELETE FROM organization WHERE id = $1`, [orgId]);
  }

  async updateOrg(
    orgId: string,
    data: { name?: string; metadata?: Record<string, unknown> },
  ): Promise<AuthOrg | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(data.name);
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${i++}`);
      values.push(JSON.stringify(data.metadata));
    }
    if (updates.length === 0) return null;
    values.push(orgId);
    const { rows } = await this.pool.query(
      `UPDATE organization SET ${updates.join(", ")} WHERE id = $${i} RETURNING id, name, slug, logo, created_at, metadata`,
      values,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo ?? null,
      createdAt: r.created_at,
      metadata: parseMetadata(r.metadata),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
