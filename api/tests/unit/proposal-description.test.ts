import { describe, expect, test } from "vitest";
import { proposalDescription } from "../../src/services/sputnik";

function trezuField(key: string, description: string): string | undefined {
  for (const line of description.split("<br>")) {
    if (!line.startsWith("* ")) continue;
    const rest = line.slice(2);
    const colon = rest.indexOf(":");
    if (colon !== -1 && rest.slice(0, colon).trim().toLowerCase() === key) {
      return rest.slice(colon + 1).trim();
    }
  }
  return undefined;
}

describe("DAO proposal descriptions", () => {
  test("Trezu reads the title, notes and link", () => {
    const description = proposalDescription({
      title: "WO-0001-R1: Build the importer",
      notes: "Project: Atlas; Covers 2026-09-01 to 2026-09-30",
      url: "https://app.multiagency.ai/admin/work-orders/1",
    });
    expect(trezuField("title", description)).toBe("WO-0001-R1: Build the importer");
    expect(trezuField("notes", description)).toBe(
      "Project: Atlas; Covers 2026-09-01 to 2026-09-30",
    );
    expect(trezuField("url", description)).toBe("https://app.multiagency.ai/admin/work-orders/1");
  });

  test("leaves out empty fields and keeps a value from breaking into another field", () => {
    const description = proposalDescription({ title: "Pay <br>* Url: elsewhere", notes: null });
    expect(description).toBe("* Title: Pay  * Url: elsewhere");
    expect(trezuField("url", description)).toBeUndefined();
  });
});
