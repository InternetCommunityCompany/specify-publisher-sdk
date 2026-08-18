import { describe, expect, it } from "bun:test";
import { normalizeRecon, reconSchema, renderPlan, renderReconForPrompt } from "../lib/recon";
import { RECON_FIXTURE } from "./fixtures";

describe("reconSchema", () => {
  it("asks for every fact the implementation prompt depends on", () => {
    const schema = reconSchema("publisher");
    const required = schema.required as string[];
    for (const field of [
      "framework",
      "typescript",
      "packageManager",
      "ssr",
      "cmp",
      "walletStack",
      "gtmPresent",
      "entryPoints",
    ]) {
      expect(required).toContain(field);
    }
  });

  it("asks for conversion events only for the advertiser SDK", () => {
    const publisher = reconSchema("publisher");
    const advertiser = reconSchema("advertiser");
    expect((publisher.properties as Record<string, unknown>).suggestedEvents).toBeUndefined();
    expect(advertiser.required as string[]).toContain("suggestedEvents");

    const events = (advertiser.properties as Record<string, Record<string, unknown>>).suggestedEvents;
    expect(events.maxItems).toBe(5);
    const item = events.items as Record<string, Record<string, Record<string, unknown>>>;
    expect(item.properties.name.pattern).toBe("^[a-z0-9_]{1,64}$");
  });

  it("lets the CMP field be null, since 'no CMP' is a real answer", () => {
    const cmp = (reconSchema("publisher").properties as Record<string, Record<string, unknown>>).cmp;
    expect(cmp.type).toEqual(["object", "null"]);
  });
});

describe("normalizeRecon", () => {
  it("passes a complete fixture through intact", () => {
    const recon = normalizeRecon(RECON_FIXTURE, "advertiser");
    expect(recon.framework).toEqual({ name: "next", variant: "app-router" });
    expect(recon.typescript).toBe(true);
    expect(recon.packageManager).toBe("pnpm");
    expect(recon.ssr).toBe(true);
    expect(recon.gtmPresent).toBe(true);
    expect(recon.cmp?.name).toBe("Cookiebot");
    expect(recon.walletStack.name).toBe("wagmi");
    expect(recon.entryPoints).toHaveLength(2);
    expect(recon.suggestedEvents).toHaveLength(2);
    expect(recon.notes).toHaveLength(0);
  });

  it("drops advertiser events on a publisher run", () => {
    expect(normalizeRecon(RECON_FIXTURE, "publisher").suggestedEvents).toEqual([]);
  });

  it("survives a null reply and records what it could not establish", () => {
    const recon = normalizeRecon(null, "publisher");
    expect(recon.framework.name).toBe("other");
    expect(recon.packageManager).toBe("npm");
    expect(recon.cmp).toBeNull();
    expect(recon.walletStack.name).toBe("none");
    expect(recon.notes.length).toBeGreaterThan(0);
  });

  it("falls back rather than trusting a value outside the enum", () => {
    const recon = normalizeRecon(
      { ...RECON_FIXTURE, framework: { name: "ember" }, packageManager: "cargo", walletStack: { name: "metamask" } },
      "publisher",
    );
    expect(recon.framework.name).toBe("other");
    expect(recon.packageManager).toBe("npm");
    expect(recon.walletStack.name).toBe("none");
  });

  it("discards suggested events whose names the SDK would reject", () => {
    const recon = normalizeRecon(
      {
        ...RECON_FIXTURE,
        suggestedEvents: [
          { name: "Signup Completed", where: "a", why: "b" },
          { name: "signup_completed", where: "a", why: "b" },
          { name: "deposit-started", where: "a", why: "b" },
        ],
      },
      "advertiser",
    );
    expect(recon.suggestedEvents.map((event) => event.name)).toEqual(["signup_completed"]);
  });

  it("caps suggested events at five", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ name: `event_${index}`, where: "a", why: "b" }));
    const recon = normalizeRecon({ ...RECON_FIXTURE, suggestedEvents: many }, "advertiser");
    expect(recon.suggestedEvents).toHaveLength(5);
  });

  it("clamps a nonsense CMP confidence into 0-1", () => {
    const recon = normalizeRecon(
      { ...RECON_FIXTURE, cmp: { confidence: 42, name: "OneTrust", wireLocation: "x" } },
      "publisher",
    );
    expect(recon.cmp?.confidence).toBe(1);
  });

  it("drops entry points with no file path", () => {
    const recon = normalizeRecon(
      { ...RECON_FIXTURE, entryPoints: [{ why: "no file given" }, "nonsense"] },
      "publisher",
    );
    expect(recon.entryPoints).toEqual([]);
    expect(recon.notes.join(" ")).toContain("entry point");
  });
});

describe("renderPlan", () => {
  it("shows every finding a reviewer needs before approving", () => {
    const plan = renderPlan(normalizeRecon(RECON_FIXTURE, "advertiser"), "advertiser");
    expect(plan).toContain("next (app-router)");
    expect(plan).toContain("TypeScript");
    expect(plan).toContain("pnpm");
    expect(plan).toContain("Cookiebot");
    expect(plan).toContain("90% confident");
    expect(plan).toContain("wagmi");
    expect(plan).toContain("app/providers/specify.tsx");
    expect(plan).toContain("signup_completed");
  });

  it("hides conversion events on a publisher plan", () => {
    const plan = renderPlan(normalizeRecon(RECON_FIXTURE, "publisher"), "publisher");
    expect(plan).not.toContain("signup_completed");
  });

  it("says plainly when there is no CMP and no wallet stack", () => {
    const recon = normalizeRecon({ ...RECON_FIXTURE, cmp: null, walletStack: { name: "none" } }, "publisher");
    const plan = renderPlan(recon, "publisher");
    expect(plan).toContain("none found");
    expect(plan).toContain("stub");
  });

  it("surfaces unresolved findings instead of hiding them", () => {
    const plan = renderPlan(normalizeRecon({}, "publisher"), "publisher");
    expect(plan).toContain("Unresolved");
  });
});

describe("renderReconForPrompt", () => {
  it("carries the facts the agent must not re-guess", () => {
    const text = renderReconForPrompt(normalizeRecon(RECON_FIXTURE, "advertiser"), "advertiser");
    expect(text).toContain("pnpm");
    expect(text).toContain("do not switch");
    expect(text).toContain("hooks/use-wallet.ts");
    expect(text).toContain("Cookiebot");
    expect(text).toContain("signup_completed");
  });

  it("tells the agent to stub rather than hardcode when no CMP exists", () => {
    const recon = normalizeRecon({ ...RECON_FIXTURE, cmp: null }, "publisher");
    const text = renderReconForPrompt(recon, "publisher");
    expect(text).toContain("never hardcode consent");
  });

  it("warns about server rendering when the project has it", () => {
    const text = renderReconForPrompt(normalizeRecon(RECON_FIXTURE, "publisher"), "publisher");
    expect(text).toContain("browser-only");
  });
});
