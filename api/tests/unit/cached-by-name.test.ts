import { describe, expect, it } from "vitest";
import { cachedByName } from "../../src/services/work-orders/github";

function counted(fail = new Set<string>()) {
  const calls: string[] = [];
  const load = async (name: string) => {
    calls.push(name);
    if (fail.has(name)) throw new Error(`${name} failed`);
    return `${name}:${calls.length}`;
  };
  return { calls, load };
}

describe("cachedByName", () => {
  it("serves a name from the cache regardless of case until it expires", async () => {
    let clock = 0;
    const { calls, load } = counted();
    const cached = cachedByName(load, 1000, () => clock);
    expect(await cached("NEARBuilders")).toBe("NEARBuilders:1");
    expect(await cached("nearbuilders")).toBe("NEARBuilders:1");
    clock = 1000;
    expect(await cached("nearbuilders")).toBe("nearbuilders:2");
    expect(calls).toEqual(["NEARBuilders", "nearbuilders"]);
  });

  it("doesn't keep a failure", async () => {
    const fail = new Set(["down"]);
    const { calls, load } = counted(fail);
    const cached = cachedByName(load, 1000, () => 0);
    await expect(cached("down")).rejects.toThrow("down failed");
    fail.clear();
    expect(await cached("down")).toBe("down:2");
    expect(calls).toEqual(["down", "down"]);
  });

  it("drops expired names when it loads a new one", async () => {
    let clock = 0;
    const { calls, load } = counted();
    const cached = cachedByName(load, 1000, () => clock);
    await cached("a");
    clock = 2000;
    await cached("b");
    clock = 0;
    await cached("a");
    expect(calls).toEqual(["a", "b", "a"]);
  });
});
