import { afterEach, describe, expect, it } from "vitest";
import {
  AGENCY_MANAGER_ROLES,
  AGENCY_MEMBER_ROLES,
  agencyScopeForClient,
  agencyScopeFromRequest,
} from "../../src/lib/agency-scope";
import { setDefaultDaoAccountId } from "../../src/lib/org";

const AGENCY = "alpha.sputnik-dao.near";

function memberContext(role: string, extra: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    organization: {
      organization: { metadata: { daoAccountId: AGENCY, type: "agency" } },
      member: { role },
    },
    ...extra,
  };
}

describe("agency scope", () => {
  afterEach(() => setDefaultDaoAccountId(undefined));

  it("takes the agency DAO and role from the active organization", () => {
    const scope = agencyScopeFromRequest(memberContext("admin"));

    expect(scope).toMatchObject({
      agencyDao: AGENCY,
      network: "mainnet",
      role: "admin",
      canSeePrivate: true,
    });
  });

  it("acts as the linked NEAR account, falling back to the user id", () => {
    expect(
      agencyScopeFromRequest(memberContext("owner", { near: { primaryAccountId: "boss.near" } }))
        .actorId,
    ).toBe("boss.near");
    expect(agencyScopeFromRequest(memberContext("owner")).actorId).toBe("user-1");
  });

  it("plain members and anonymous visitors cannot see private projects", () => {
    expect(agencyScopeFromRequest(memberContext("member")).canSeePrivate).toBe(false);

    setDefaultDaoAccountId(AGENCY);
    expect(agencyScopeFromRequest({})).toMatchObject({
      agencyDao: AGENCY,
      role: null,
      actorId: "unknown",
      canSeePrivate: false,
    });
  });

  it("rejects requests with no agency to act for", () => {
    expect(() => agencyScopeFromRequest({})).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("owning a workspace without a DAO grants no role in the default agency", () => {
    setDefaultDaoAccountId(AGENCY);
    const personalOwner = {
      userId: "user-2",
      organization: {
        organization: { metadata: { isPersonal: true } },
        member: { role: "owner" },
      },
    };

    expect(agencyScopeFromRequest(personalOwner)).toMatchObject({
      agencyDao: AGENCY,
      role: null,
      canSeePrivate: false,
    });
  });

  it("requiring agency roles rejects owners of other workspaces", () => {
    setDefaultDaoAccountId(AGENCY);
    const clientWorkspaceOwner = {
      userId: "user-3",
      organization: {
        organization: { metadata: { type: "client" } },
        member: { role: "owner" },
      },
    };

    expect(() => agencyScopeFromRequest(clientWorkspaceOwner, AGENCY_MANAGER_ROLES)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => agencyScopeFromRequest(memberContext("member"), AGENCY_MANAGER_ROLES)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(agencyScopeFromRequest(memberContext("owner"), AGENCY_MANAGER_ROLES).role).toBe("owner");
    expect(agencyScopeFromRequest(memberContext("member"), AGENCY_MEMBER_ROLES).role).toBe(
      "member",
    );
  });

  it("a client scope reads the agency's projects without manager rights", () => {
    const request = { near: { primaryAccountId: "client.near" } };
    const scope = agencyScopeForClient(request, AGENCY);

    expect(scope).toMatchObject({
      agencyDao: AGENCY,
      role: null,
      actorId: "client.near",
      canSeePrivate: true,
    });
    expect(scope.pluginContext.organization).toMatchObject({
      activeOrganizationId: AGENCY,
      organization: {
        id: AGENCY,
        metadata: { daoAccountId: AGENCY, type: "agency" },
      },
      member: { role: "member" },
    });
    expect(agencyScopeFromRequest(memberContext("admin")).pluginContext).toEqual(
      memberContext("admin"),
    );
  });
});
