import { describe, expect, test } from "vitest";
import { readableDescription } from "../src/lib/trezu";

describe("Trezu proposal descriptions", () => {
  test("shows Trezu-style fields as lines", () => {
    expect(
      readableDescription("* Title: WO-0001-R1: Importer <br>* Notes: Project: Atlas<br/>* Url: x"),
    ).toBe("Title: WO-0001-R1: Importer\nNotes: Project: Atlas\nUrl: x");
  });

  test("leaves plain descriptions as they are", () => {
    expect(readableDescription("Pay Carol\nfor September")).toBe("Pay Carol\nfor September");
  });
});
