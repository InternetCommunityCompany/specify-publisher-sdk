import { describe, expect, it } from "bun:test";
import { uuidv7 } from "../lib/uuid";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("produces a well-formed version 7 uuid", () => {
    expect(uuidv7()).toMatch(UUID_REGEX);
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("encodes the current time in the leading 48 bits", () => {
    const before = Date.now();
    const timestamp = Number.parseInt(uuidv7().replace(/-/g, "").slice(0, 12), 16);
    const after = Date.now();

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("sorts lexicographically in creation order", async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();

    expect(first < second).toBe(true);
  });
});
