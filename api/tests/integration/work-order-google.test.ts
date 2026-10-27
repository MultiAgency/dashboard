import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Database } from "../../src/db";
import { googleOauthStates, workOrderIntegrations } from "../../src/db/schema";
import { open } from "../../src/services/payouts/crypto";
import { docOf } from "../../src/services/work-orders/google";
import {
  createGoogleConnections,
  DRIVE_FILE_SCOPE,
  type GoogleOAuthConfig,
} from "../../src/services/work-orders/google-oauth";
import { createGoogleSetup } from "../../src/services/work-orders/google-setup";
import { createWorkOrderIntegrations } from "../../src/services/work-orders/outbox";
import {
  parseAiSpots,
  patternSpots,
  templateTags,
} from "../../src/services/work-orders/template-fields";
import { FakeGoogle } from "../fakes/google";
import { migratedDatabase } from "./_pg";

const KEY = "test-secret-key";
const config = {
  clientId: "client-1",
  clientSecret: "shh",
  redirectUri: "https://app.example/api/work-orders/google/callback",
  secretKey: KEY,
  pickerApiKey: "picker-key",
  projectNumber: "123",
};

const idToken = (email: string) =>
  `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

type TokenCall = Record<string, string>;

function tokenEndpoint(answer: (params: TokenCall) => { status?: number; body: unknown }) {
  const calls: TokenCall[] = [];
  const revoked: string[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
      revoked.push(new URL(url).searchParams.get("token") ?? "");
      return new Response("{}");
    }
    if (url === "https://oauth2.googleapis.com/token") {
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      calls.push(params);
      const { status, body } = answer(params);
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { fetcher, calls, revoked };
}

const granted = {
  body: {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    scope: `openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`,
    id_token: idToken("ops@studio.example"),
  },
};

describe("Google Drive connection per organization", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let clock: Date;

  beforeEach(() => {
    db = database.db;
    clock = new Date("2026-10-01T10:00:00.000Z");
  });

  const connections = (fetcher: typeof fetch, over: Partial<GoogleOAuthConfig> = {}) =>
    createGoogleConnections({ db, config: { ...config, ...over }, fetcher, now: () => clock });

  const stateOf = (url: string) => new URL(url).searchParams.get("state") ?? "";

  test("the sign-in link asks only for drive.file, offline, with a single-use state", async () => {
    const google = connections(tokenEndpoint(() => granted).fetcher);
    const url = new URL(await google.start("studio", "admin-1"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "client-1",
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: `openid email ${DRIVE_FILE_SCOPE}`,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    const rows = await db.select().from(googleOauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stateHash).not.toBe(url.searchParams.get("state"));
  });

  test("the callback refuses unknown and expired states", async () => {
    const google = connections(tokenEndpoint(() => granted).fetcher);
    await expect(google.finish({ code: "c", state: "forged" }, "admin-1")).rejects.toThrow(
      /expired/,
    );
    const state = stateOf(await google.start("studio", "admin-1"));
    clock = new Date(clock.getTime() + 11 * 60_000);
    await expect(google.finish({ code: "c", state }, "admin-1")).rejects.toThrow(/expired/);
  });

  test("the callback refuses a browser signed in as someone else, or signed out", async () => {
    const endpoint = tokenEndpoint(() => granted);
    const google = connections(endpoint.fetcher);
    const state = stateOf(await google.start("studio", "admin-1"));
    await expect(google.finish({ code: "c", state }, "someone-else")).rejects.toThrow(
      /signed in to MultiAgency as the person who started it/,
    );
    await expect(google.finish({ code: "c", state }, "admin-1")).rejects.toThrow(/expired/);
    const again = stateOf(await google.start("studio", "admin-1"));
    await expect(google.finish({ code: "c", state: again }, null)).rejects.toThrow(
      /signed in to MultiAgency/,
    );
    expect(endpoint.calls).toHaveLength(0);
    expect((await google.status("studio")).connected).toBe(false);
  });

  test("the callback stores the refresh token encrypted with the account email, once", async () => {
    const endpoint = tokenEndpoint(() => granted);
    const google = connections(endpoint.fetcher);
    const state = stateOf(await google.start("studio", "admin-1"));
    expect(await google.finish({ code: "code-1", state }, "admin-1")).toEqual({
      organizationId: "studio",
      email: "ops@studio.example",
    });
    expect(endpoint.calls[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: config.redirectUri,
      client_id: "client-1",
      client_secret: "shh",
    });
    const [row] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, "studio"));
    expect(row?.googleOauthToken).not.toContain("refresh-1");
    expect(open(row?.googleOauthToken ?? "", KEY)).toBe("refresh-1");
    expect(row?.googleOauthEmail).toBe("ops@studio.example");
    expect(row?.googleOauthConnectedBy).toBe("admin-1");
    expect(await google.status("studio")).toMatchObject({
      connected: true,
      email: "ops@studio.example",
      error: null,
    });
    await expect(google.finish({ code: "code-1", state }, "admin-1")).rejects.toThrow(/expired/);
  });

  test("it refuses to connect without Drive access or without an encryption key", async () => {
    const narrow = connections(
      tokenEndpoint(() => ({ body: { ...granted.body, scope: "openid email" } })).fetcher,
    );
    const state = stateOf(await narrow.start("studio", "admin-1"));
    await expect(narrow.finish({ code: "c", state }, "admin-1")).rejects.toThrow(
      /see and edit the Drive/,
    );
    const keyless = connections(tokenEndpoint(() => granted).fetcher, { secretKey: null });
    await expect(keyless.start("studio", "admin-1")).rejects.toThrow(/PAYOUTS_SECRET_KEY/);
  });

  test("access tokens refresh when expired, and invalid_grant marks the connection broken", async () => {
    let refreshes = 0;
    let revoked = false;
    const endpoint = tokenEndpoint((params) => {
      if (params.grant_type === "authorization_code") return granted;
      refreshes += 1;
      return revoked
        ? { status: 400, body: { error: "invalid_grant" } }
        : { body: { access_token: `access-r${refreshes}`, expires_in: 3600 } };
    });
    const google = connections(endpoint.fetcher);
    await google.finish(
      { code: "c", state: stateOf(await google.start("studio", "admin-1")) },
      "admin-1",
    );
    expect((await google.accessToken("studio")).token).toBe("access-1");
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    expect((await google.accessToken("studio")).token).toBe("access-r1");
    expect(endpoint.calls.at(-1)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    expect((await google.accessToken("studio")).token).toBe("access-r1");
    expect(refreshes).toBe(1);

    revoked = true;
    clock = new Date(clock.getTime() + 2 * 3_600_000);
    await expect(google.accessToken("studio")).rejects.toThrow(/Reconnect/);
    expect((await google.status("studio")).error).toMatch(/Reconnect/);
    expect(await google.port("studio")).toBeNull();
  });

  test("disconnecting revokes the token at Google and forgets it", async () => {
    const endpoint = tokenEndpoint(() => granted);
    const google = connections(endpoint.fetcher);
    await google.finish(
      { code: "c", state: stateOf(await google.start("studio", "admin-1")) },
      "admin-1",
    );
    await google.disconnect("studio");
    expect(endpoint.revoked).toEqual(["refresh-1"]);
    expect(await google.status("studio")).toMatchObject({ connected: false, email: null });
  });
});

describe("template fields", () => {
  const database = migratedDatabase({ perTest: true });
  let db: Database;
  let google: FakeGoogle;

  beforeEach(async () => {
    db = database.db;
    google = new FakeGoogle([]);
    google.kind = "oauth";
    await createWorkOrderIntegrations({ db }).saveGoogle("studio", "admin-1", {
      templateId: "tpl",
      documentsFolderId: "docs",
      signedFolderId: null,
    });
  });

  const setup = (finder?: Parameters<typeof createGoogleSetup>[0]["finder"]) =>
    createGoogleSetup({ db, googleFor: async () => google, finder });

  test("tags are found in the body, tables, headers and footers", () => {
    const paragraph = (startIndex: number, content: string) => ({
      startIndex,
      paragraph: { elements: [{ startIndex, textRun: { content } }] },
    });
    const doc = docOf("d1", {
      title: "Contract",
      body: {
        content: [
          paragraph(1, "Work order {{ work_order_id }} for {{contractor_name}}\n"),
          {
            startIndex: 50,
            table: {
              tableRows: [
                {
                  tableCells: [
                    { content: [paragraph(52, "Budget {{budget}}\n")] },
                    { content: [paragraph(70, "Again {{contractor_name}}\n")] },
                  ],
                },
              ],
            },
          },
        ],
      },
      headers: { h1: { content: [paragraph(0, "Header {{client_code}}\n")] } },
      footers: { f1: { content: [paragraph(0, "Page {{work_order_id}}\n")] } },
    });
    expect(templateTags(doc)).toEqual([
      { tag: "work_order_id", count: 2 },
      { tag: "contractor_name", count: 2 },
      { tag: "budget", count: 1 },
      { tag: "client_code", count: 1 },
    ]);
  });

  test("blanks with labels and bracketed placeholders are detected", async () => {
    google.setDoc(
      "tpl",
      "Contractor: __________\nStart date: ________\n[Builder address] and <Effective Date> {Budget}\n",
    );
    const doc = await google.read("tpl");
    const spots = patternSpots(doc);
    expect(spots.map((s) => [s.text, s.target, s.label, s.suggestion])).toEqual([
      [
        "Contractor: __________",
        "__________",
        "Contractor",
        { kind: "field", field: "contractor_name" },
      ],
      ["Start date: ________", "________", "Start date", { kind: "field", field: "period_start" }],
      ["[Builder address]", "[Builder address]", "Builder address", { kind: "ask" }],
      [
        "<Effective Date>",
        "<Effective Date>",
        "Effective Date",
        { kind: "field", field: "effective_date" },
      ],
      ["{Budget}", "{Budget}", "Budget", { kind: "field", field: "budget" }],
    ]);
  });

  test("AI suggestions keep only verbatim snippets and known field keys", async () => {
    google.setDoc("tpl", "This agreement with John Doe starts January 1, 2026 for $5,000.");
    const doc = await google.read("tpl");
    const spots = parseAiSpots(
      JSON.stringify({
        spots: [
          {
            text: "with John Doe starts",
            target: "John Doe",
            label: "Contractor",
            field: "contractor_name",
          },
          { text: "Jane Roe", label: "Invented", field: "contractor_name" },
          { text: "for $5,000", target: "$5,000", label: "Fee", field: "total_fee" },
          { text: "January 1, 2026", target: "March", field: "period_start" },
        ],
      }),
      doc,
    );
    expect(spots.map((s) => [s.text, s.target, s.suggestion, s.source])).toEqual([
      ["with John Doe starts", "John Doe", { kind: "field", field: "contractor_name" }, "ai"],
      ["for $5,000", "$5,000", { kind: "ask" }, "ai"],
    ]);
    expect(parseAiSpots("not json", doc)).toEqual([]);
  });

  test("scanning merges patterns and AI and reports missing important tags", async () => {
    google.setDoc("tpl", "WO {{work_order_id}} Contractor: _____ paid $5,000");
    const scan = await setup(async (doc) =>
      parseAiSpots(
        JSON.stringify({ spots: [{ text: "paid $5,000", target: "$5,000", field: "budget" }] }),
        doc,
      ),
    ).scan("studio", { detect: true });
    expect(scan.tags).toEqual([{ tag: "work_order_id", count: 1, known: true, mapping: null }]);
    expect(scan.missing).toContain("contractor_name");
    expect(scan.missing).not.toContain("work_order_id");
    expect(scan.spots.map((s) => [s.target, s.source])).toEqual([
      ["_____", "pattern"],
      ["$5,000", "ai"],
    ]);
    expect(scan.aiUsed).toBe(true);
  });

  test("applying fields tags a copy of the template, selects it and saves the mapping", async () => {
    google.setDoc(
      "tpl",
      "Contractor: __________\nBuilder John Doe, signed by John Doe\n[Builder address]\n",
      [{ segmentId: "h1", text: "Governed by [State]\n" }],
    );
    const applied = await setup().applyFields("studio", "admin-1", [
      {
        text: "Contractor: __________",
        target: "__________",
        occurrence: null,
        mapping: { kind: "field", field: "contractor_name" },
      },
      {
        text: "John Doe",
        target: "John Doe",
        occurrence: 0,
        mapping: { kind: "field", field: "contractor_name" },
      },
      {
        text: "John Doe",
        target: "John Doe",
        occurrence: 1,
        mapping: { kind: "field", field: "representative_name" },
      },
      {
        text: "[Builder address]",
        target: "[Builder address]",
        occurrence: null,
        mapping: { kind: "ask", label: "Builder address" },
      },
      {
        text: "[State]",
        target: "[State]",
        occurrence: null,
        mapping: { kind: "text", value: "Delaware" },
      },
    ]);
    expect(applied.templateId).toBe("doc-1");
    expect(google.copies[0]).toMatchObject({
      templateId: "tpl",
      parentId: "docs",
      name: "tpl (MultiAgency fields)",
    });
    expect(google.textOf("doc-1")).toBe(
      "Contractor: {{contractor_name}}\nBuilder {{contractor_name}}, signed by {{representative_name}}\n{{builder_address}}\n\nGoverned by {{fixed_delaware}}\n",
    );
    expect(google.textOf("tpl")).toContain("Contractor: __________");
    const [row] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, "studio"));
    expect(row?.googleTemplateId).toBe("doc-1");
    expect(JSON.parse(row?.googleFieldMap ?? "{}")).toEqual({
      builder_address: { kind: "ask", label: "Builder address" },
      fixed_delaware: { kind: "text", value: "Delaware" },
    });
  });

  test("a snippet set up twice must name its occurrences, and nothing is copied", async () => {
    google.setDoc("tpl", "John Doe and John Doe");
    await expect(
      setup().applyFields("studio", "admin-1", [
        {
          text: "John Doe",
          target: "John Doe",
          occurrence: null,
          mapping: { kind: "field", field: "contractor_name" },
        },
        {
          text: "John Doe",
          target: "John Doe",
          occurrence: 1,
          mapping: { kind: "field", field: "representative_name" },
        },
      ]),
    ).rejects.toThrow(/set up twice/);
    expect(google.copies).toEqual([]);
  });

  test("preview fills a copy with sample data and the mapping", async () => {
    google.setDoc("tpl", "{{contractor_name}} / {{addr}} / {{law}}");
    await setup().saveFieldMap("studio", "admin-1", {
      addr: { kind: "ask", label: "Address" },
      law: { kind: "text", value: "Delaware" },
      contractor_name: { kind: "field", field: "contractor_name" },
    });
    const { url } = await setup().preview("studio");
    expect(url).toBe("https://docs.google.com/document/d/doc-1/edit");
    expect(google.textOf("doc-1")).toBe("Ada Builder / [Address] / Delaware");
  });
});
