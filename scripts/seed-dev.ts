import { execFileSync } from "node:child_process";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const PG_CONTAINER = process.env.SEED_PG_CONTAINER ?? "multiagency-dev-db";
const PG_USER = process.env.SEED_PG_USER ?? "everythingdev";
const PASSWORD = "multiagency-dev-password";
const AGENCY_DAO = "multiagency.sputnik-dao.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

const USERS = {
  agency: { email: "agency@multiagency.test", name: "Agency Owner" },
  client: { email: "client@nearbuilders.test", name: "Client Owner" },
  partner: { email: "partner@pixelpartners.test", name: "Partner Owner" },
} as const;

type Session = { cookie: string };

function sql(db: string, statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", db, "-v", "ON_ERROR_STOP=1", "-At"],
    { input: statement, encoding: "utf8" },
  ).trim();
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function request<T>(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; setCookie: string[] }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(session ? { cookie: session.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return { data: (text ? JSON.parse(text) : null) as T, setCookie: res.headers.getSetCookie() };
}

function mergeCookies(session: Session, setCookie: string[]): void {
  const jar = new Map(
    session.cookie
      .split("; ")
      .filter(Boolean)
      .map((c) => [c.split("=")[0]!, c] as const),
  );
  for (const raw of setCookie) {
    const pair = raw.split(";")[0]!;
    jar.set(pair.split("=")[0]!, pair);
  }
  session.cookie = [...jar.values()].join("; ");
}

async function signIn(user: { email: string; name: string }): Promise<Session> {
  const exists = sql("auth_db", `select count(*) from "user" where email = ${quote(user.email)}`);
  if (exists === "0") {
    await request(null, "POST", "/api/auth/sign-up/email", { ...user, password: PASSWORD });
  }
  sql("auth_db", `update "user" set email_verified = true where email = ${quote(user.email)}`);
  const session: Session = { cookie: "" };
  const { setCookie } = await request(null, "POST", "/api/auth/sign-in/email", {
    email: user.email,
    password: PASSWORD,
  });
  mergeCookies(session, setCookie);
  return session;
}

async function ensureOrganization(session: Session, name: string, slug: string): Promise<string> {
  let id = sql("auth_db", `select id from organization where slug = ${quote(slug)}`);
  if (!id) {
    const { data } = await request<{ id: string }>(
      session,
      "POST",
      "/api/auth/organization/create",
      { name, slug },
    );
    id = data.id;
  }
  const { setCookie } = await request(session, "POST", "/api/auth/organization/set-active", {
    organizationId: id,
  });
  mergeCookies(session, setCookie);
  return id;
}

type Project = { id: string; slug: string };

async function ensureProject(
  session: Session,
  input: { slug: string; title: string; description: string; repository: string },
): Promise<Project> {
  const existing = await request<{ data: Project[] }>(session, "GET", "/api/admin/projects");
  const found = existing.data.data.find((p) => p.slug === input.slug);
  if (found) return found;
  const { data } = await request<{ project: Project }>(session, "POST", "/api/admin/projects", {
    ...input,
    kind: "project",
    status: "active",
    visibility: "public",
  });
  return data.project;
}

async function ensureBuilder(
  session: Session,
  builder: { nearAccount: string; name: string; skills: string[] },
): Promise<void> {
  await request(session, "POST", "/api/admin/contributors", builder).catch((err: Error) => {
    if (!/409|exists|CONFLICT/i.test(err.message)) throw err;
  });
}

async function assign(session: Session, projectId: string, nearAccount: string, role: string) {
  await request(session, "POST", `/api/admin/projects/${projectId}/contributors`, {
    projectId,
    nearAccount,
    role,
  }).catch((err: Error) => {
    if (!/409|exists|CONFLICT/i.test(err.message)) throw err;
  });
}

async function engage(
  agency: Session,
  client: Session,
  clientSlug: string,
  clientName: string,
  projects: Project[],
): Promise<string> {
  type Engagement = { id: string; status: string; side: string; client: { id: string } };
  const list = await request<{ data: Engagement[] }>(agency, "GET", "/api/engagements");
  const clientId = sql("auth_db", `select id from organization where slug = ${quote(clientSlug)}`);
  let engagement = list.data.data.find(
    (e) =>
      e.side === "agency" &&
      e.client.id === clientId &&
      e.status !== "declined" &&
      e.status !== "ended",
  );
  if (!engagement) {
    const { data } = await request<Engagement>(agency, "POST", "/api/engagements", {
      slug: clientSlug,
      name: clientName,
    });
    engagement = data;
  }
  if (engagement.status === "proposed") {
    await request(client, "POST", `/api/engagements/${engagement.id}/accept`, {
      id: engagement.id,
    });
  }
  for (const project of projects) {
    await request(agency, "POST", `/api/engagements/${engagement.id}/projects`, {
      engagementId: engagement.id,
      projectId: project.id,
    }).catch((err: Error) => {
      if (!/409|already|CONFLICT/i.test(err.message)) throw err;
    });
  }
  return engagement.id;
}

function usdc(amount: number): string {
  return String(Math.round(amount * 1_000_000));
}

function seedMoney(
  engagementId: string,
  rows: Array<{ project: Project; budget: number; bills: Array<[string, number]> }>,
) {
  const statements: string[] = [];
  let proposalId = 990001;
  for (const { project, budget, bills } of rows) {
    statements.push(
      `insert into budgets (id, project_id, token_id, amount, note, actor_account_id, engagement_id, funding_dao_account_id)
       values (${quote(`seed-budget-${project.slug}`)}, ${quote(project.id)}, ${quote(USDC)}, ${quote(usdc(budget))},
               'Seeded budget', 'seed.near', ${quote(engagementId)}, ${quote(AGENCY_DAO)})
       on conflict (id) do nothing;`,
    );
    for (const [nearAccount, amount] of bills) {
      const id = proposalId++;
      statements.push(
        `insert into proposals (dao_account_id, proposal_id, proposer, description, status, kind_type,
                                transfer_token_id, transfer_receiver_id, transfer_amount, submission_time, indexed_at)
         values (${quote(AGENCY_DAO)}, ${id}, 'seed.near', ${quote(`Seeded payout to ${nearAccount}`)}, 'Approved',
                 'Transfer', ${quote(USDC)}, ${quote(nearAccount)}, ${quote(usdc(amount))}, now(), now())
         on conflict do nothing;`,
        `insert into billings (id, project_id, token_id, amount, proposal_id, note, near_account, paying_dao_account_id)
         values (${quote(`seed-billing-${id}`)}, ${quote(project.id)}, ${quote(USDC)}, ${quote(usdc(amount))},
                 ${quote(String(id))}, 'Seeded billing', ${quote(nearAccount)}, ${quote(AGENCY_DAO)})
         on conflict (id) do nothing;`,
      );
    }
  }
  sql("api_db", statements.join("\n"));
}

async function main() {
  const agency = await signIn(USERS.agency);
  const client = await signIn(USERS.client);
  const partner = await signIn(USERS.partner);

  const agencyOrg = await ensureOrganization(agency, "MultiAgency", "multiagency");
  await ensureOrganization(client, "NEAR Builders", "nearbuilders");
  await ensureOrganization(partner, "Pixel Partners", "pixelpartners");

  sql(
    "api_db",
    `insert into organization_daos (organization_id, dao_account_id)
     values (${quote(agencyOrg)}, ${quote(AGENCY_DAO)}) on conflict do nothing;`,
  );

  const projects = await Promise.all(
    [
      {
        slug: "nearbuildersorg",
        title: "nearbuilders.org",
        description: "Community site for NEAR builders: projects, events and profiles.",
        repository: "https://github.com/nearbuilders/nearbuilders.org",
      },
      {
        slug: "pingonramp",
        title: "onramp.pingpay.io",
        description: "Fiat on-ramp for the Ping payments app.",
        repository: "https://github.com/nearbuilders/pingpay-onramp",
      },
      {
        slug: "nbsmm",
        title: "NEAR Builders Social Media Management",
        description: "Content project: weekly posts, threads and community highlights.",
        repository: "https://github.com/nearbuilders/social-content",
      },
      {
        slug: "nearbuildersbot",
        title: "NEAR Builders Bot",
        description: "Telegram bot that nominates and tracks builders.",
        repository: "https://github.com/nearbuilders/bot",
      },
      {
        slug: "city-nodes",
        title: "citynode.app",
        description: "Agency-only project, not shared with the client.",
        repository: "https://github.com/nearbuilders/citynode",
      },
    ].map((p) => ensureProject(agency, p)),
  );
  const [site, onramp, social, bot] = projects as [Project, Project, Project, Project, Project];

  const builders = [
    { nearAccount: "alice-dev.near", name: "Alice", skills: ["React", "TypeScript"] },
    { nearAccount: "bob-dev.near", name: "Bob", skills: ["Rust", "Smart contracts"] },
    { nearAccount: "carol-dev.near", name: "Carol", skills: ["Content", "Design"] },
    { nearAccount: "dave-dev.near", name: "Dave", skills: ["Node", "Bots"] },
  ];
  for (const builder of builders) await ensureBuilder(agency, builder);
  await assign(agency, site.id, "alice-dev.near", "Frontend");
  await assign(agency, site.id, "bob-dev.near", "Contracts");
  await assign(agency, onramp.id, "bob-dev.near", "Lead");
  await assign(agency, social.id, "carol-dev.near", "Writer");
  await assign(agency, bot.id, "dave-dev.near", "Lead");

  const clientEngagement = await engage(agency, client, "nearbuilders", "NEAR Builders", [
    site,
    onramp,
    social,
    bot,
  ]);

  await ensureOrganization(partner, "Pixel Partners", "pixelpartners");
  const partnerProject = await ensureProject(partner, {
    slug: "pixel-brand-refresh",
    title: "Pixel brand refresh",
    description: "Partner project shared with MultiAgency as a client.",
    repository: "https://github.com/pixelpartners/brand",
  });
  await ensureOrganization(agency, "MultiAgency", "multiagency");
  await engage(partner, agency, "multiagency", "MultiAgency", [partnerProject]);

  seedMoney(clientEngagement, [
    {
      project: site,
      budget: 12000,
      bills: [
        ["alice-dev.near", 2500],
        ["bob-dev.near", 1800],
      ],
    },
    { project: onramp, budget: 8000, bills: [["bob-dev.near", 3200]] },
    { project: social, budget: 3000, bills: [["carol-dev.near", 900]] },
    { project: bot, budget: 4000, bills: [] },
  ]);

  console.log("Seeded. Sign in at", `${BASE}/sign-in`, "with any of:");
  for (const user of Object.values(USERS)) console.log(`  ${user.email}`);
  console.log("Password: see PASSWORD in scripts/seed-dev.ts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
