import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createGoogle,
  googleIdOf,
  parseServiceAccount,
  readServiceAccount,
} from "../../src/services/work-orders/google";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const json = JSON.stringify({
  type: "service_account",
  client_email: "multiagency@demo.iam.gserviceaccount.com",
  private_key: key,
  token_uri: "https://oauth2.example/token",
});

describe("Google service account", () => {
  test("the key is read from JSON or from a file path", () => {
    expect(readServiceAccount(json)).toBe(json);
    const dir = mkdtempSync(join(tmpdir(), "sa-"));
    const file = join(dir, "key.json");
    writeFileSync(file, json);
    expect(parseServiceAccount(readServiceAccount(file))?.clientEmail).toBe(
      "multiagency@demo.iam.gserviceaccount.com",
    );
    expect(readServiceAccount(join(dir, "missing.json"))).toBeNull();
    expect(parseServiceAccount("{}")).toBeNull();
  });

  test("ids come from Docs and Drive links", () => {
    expect(googleIdOf("https://docs.google.com/document/d/1AbCdEfGhIjKlMn/edit?tab=t.0")).toBe(
      "1AbCdEfGhIjKlMn",
    );
    expect(googleIdOf("https://drive.google.com/drive/folders/0AbCdEfGhIjKl?usp=sharing")).toBe(
      "0AbCdEfGhIjKl",
    );
    expect(googleIdOf("https://drive.google.com/open?id=1ZyXwVuTsRqPo")).toBe("1ZyXwVuTsRqPo");
    expect(googleIdOf("not a link")).toBeNull();
  });

  test("it signs in with a signed assertion and fills placeholders", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url === "https://oauth2.example/token") {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      return new Response(
        JSON.stringify({
          replies: [{ replaceAllText: { occurrencesChanged: 2 } }, { replaceAllText: {} }],
        }),
      );
    }) as typeof fetch;
    const google = createGoogle(parseServiceAccount(json)!, fetcher);
    const changed = await google.fill("doc1", { work_order_id: "SI-004", budget_usd: "1000" });
    expect(changed).toEqual({ work_order_id: 2, budget_usd: 0 });

    const assertion = new URLSearchParams(String(calls[0]?.init.body)).get("assertion") ?? "";
    const [header, claims, signature] = assertion.split(".");
    const decoded = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
    expect(decoded).toMatchObject({
      iss: "multiagency@demo.iam.gserviceaccount.com",
      aud: "https://oauth2.example/token",
      scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents",
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${claims}`)
        .verify(publicKey, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);

    const fill = JSON.parse(String(calls[1]?.init.body));
    expect(calls[1]?.url).toBe("https://docs.googleapis.com/v1/documents/doc1:batchUpdate");
    expect(fill.requests[0]).toEqual({
      replaceAllText: {
        containsText: { text: "{{work_order_id}}", matchCase: true },
        replaceText: "SI-004",
      },
    });
    expect((calls[1]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    await google.fill("doc1", { work_order_id: "SI-004" });
    expect(calls.filter((c) => c.url === "https://oauth2.example/token")).toHaveLength(1);
  });
});

describe("Google errors", () => {
  test("a My Drive folder explains the Shared Drive requirement instead of asking to share", async () => {
    const fetcher = (async (url: string) => {
      if (url.includes("oauth2")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      }
      return new Response(
        JSON.stringify({
          error: {
            message: "The user's Drive storage quota has been exceeded.",
            errors: [{ reason: "storageQuotaExceeded" }],
          },
        }),
        { status: 403 },
      );
    }) as typeof fetch;
    const google = createGoogle(parseServiceAccount(json)!, fetcher);
    await expect(google.copy("tpl", { name: "x", parentId: "folder" })).rejects.toThrow(
      /must be inside a Shared Drive/,
    );
  });
});
