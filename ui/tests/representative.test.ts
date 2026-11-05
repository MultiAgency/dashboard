import { describe, expect, it } from "vitest";
import { defaultRepresentative, isPlaceholderEmail } from "@/lib/representative";

describe("defaultRepresentative", () => {
  it("prefers the organization's default representative", () => {
    expect(
      defaultRepresentative(
        { name: "Rita Rep", email: "rita@studio.example" },
        { name: "Saad", email: "saad@example.com" },
      ),
    ).toEqual({ name: "Rita Rep", email: "rita@studio.example" });
  });

  it("falls back to the signed-in user with a real email", () => {
    expect(
      defaultRepresentative(
        { name: null, email: null },
        { name: "Saad", email: "saad@example.com" },
      ),
    ).toEqual({ name: "Saad", email: "saad@example.com" });
  });

  it("never uses a NEAR wallet placeholder email", () => {
    expect(defaultRepresentative(null, { name: "Saad", email: "sloppydev@near.email" })).toEqual({
      name: "Saad",
      email: "",
    });
    expect(isPlaceholderEmail("Someone@NEAR.email")).toBe(true);
    expect(isPlaceholderEmail("someone@near.org")).toBe(false);
  });
});
