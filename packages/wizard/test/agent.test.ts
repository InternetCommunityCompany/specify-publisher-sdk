/**
 * These exercise the real AnyAgent code path — `detect()`, `create()` and a
 * real `run()` with the real turn machinery — using AnyAgent's own test seams:
 * a fake `VersionProbe` for detection and a custom `Adapter` whose invocation
 * is `/bin/echo`. No coding agent is installed, no model is called, and the
 * wizard's `createAnyAgentGateway` is the code under test rather than a mock of
 * it.
 */

import { describe, expect, it } from "bun:test";
import { asSchemaFailure, createAnyAgentGateway, describeEvent, toWizardEvent } from "../lib/agent";
import { fakeAdapter, fakeProbe } from "./fixtures";

/** Drain a run's events and resolve with its result. */
async function drain(run: { done: Promise<{ json?: unknown; text: string }>; events: AsyncIterable<unknown> }) {
  for await (const _event of run.events) {
    // the spinner's job in production; nothing to assert here
  }
  return await run.done;
}

describe("createAnyAgentGateway — detection", () => {
  it("returns nothing when no agent is on PATH, which is the fallback trigger", async () => {
    const gateway = createAnyAgentGateway({ adapters: [fakeAdapter({})], probe: fakeProbe([]) });
    expect(await gateway.list()).toEqual([]);
  });

  it("reports id, name, version and capabilities for an installed agent", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ id: "fake-agent", name: "Fake Agent" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const agents = await gateway.list();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual({
      canReadOnly: true,
      canSchema: true,
      id: "fake-agent",
      name: "Fake Agent",
      version: "1.2.3",
    });
  });

  it("reports an agent that cannot run read-only or return structured output", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ readOnly: false, structuredOutput: false })],
      probe: fakeProbe(["fake-agent"]),
    });

    const [agent] = await gateway.list();
    expect(agent.canReadOnly).toBe(false);
    expect(agent.canSchema).toBe(false);
  });

  it("lists every installed agent and opens the one asked for", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ id: "agent-one", name: "One" }), fakeAdapter({ id: "agent-two", name: "Two" })],
      probe: fakeProbe(["agent-one", "agent-two"]),
    });

    expect((await gateway.list()).map((agent) => agent.id)).toEqual(["agent-one", "agent-two"]);
    expect((await gateway.open("agent-two")).name).toBe("Two");
  });

  it("refuses to open an agent that is not installed", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ id: "agent-one" })],
      probe: fakeProbe(["agent-one"]),
    });
    expect(gateway.open("agent-nine")).rejects.toThrow('No installed coding agent with id "agent-nine"');
  });
});

describe("createAnyAgentGateway — running", () => {
  it("streams events and resolves with the run's text", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [
        fakeAdapter({
          emit: [
            { input: {}, name: "read", nativeName: "Read", type: "tool-call" },
            { kind: "modify", path: "app/layout.tsx", type: "file-change" },
          ],
          reply: "wired it up",
        }),
      ],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const run = runner.run("do the thing", { cwd: process.cwd() });

    const seen: string[] = [];
    for await (const event of run.events) {
      seen.push(event.type);
    }

    expect(seen).toContain("tool-call");
    expect(seen).toContain("file-change");
    expect((await run.done).text).toBe("wired it up");
  });

  it("returns a schema-validated payload on json when a schema is given", async () => {
    const reply = JSON.stringify({ framework: { name: "next" }, packageManager: "pnpm", typescript: true });
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ reply })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const result = await drain(
      runner.run("investigate", {
        cwd: process.cwd(),
        readOnly: true,
        schema: { properties: { typescript: { type: "boolean" } }, required: ["typescript"], type: "object" },
      }),
    );

    expect(result.json).toEqual({ framework: { name: "next" }, packageManager: "pnpm", typescript: true });
  });

  it("does not ask for read-only on an agent that cannot guarantee it", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ readOnly: false, reply: "ok" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    // AnyAgent throws UnsupportedCapability before spawning if `readOnly` is
    // passed to an agent without it; the gateway must drop it instead.
    const run = runner.run("investigate", { cwd: process.cwd(), readOnly: true });
    expect((await run.done).text).toBe("ok");
  });
});

describe("createAnyAgentGateway — sessions", () => {
  const schema = { properties: { summary: { type: "string" } }, required: ["summary"], type: "object" };

  it("runs several turns in one conversation", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ replies: ["read the code", "wired it up", "moved it"], resume: "native" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });

    expect((await drain(session.run("investigate", { readOnly: true }))).text).toBe("read the code");
    expect((await drain(session.run("implement"))).text).toBe("wired it up");
    expect((await drain(session.run("now move it"))).text).toBe("moved it");

    await session.close();
  });

  it("refuses new turns once the conversation is closed", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ resume: "native" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });
    await drain(session.run("do it"));
    await session.close();

    expect(() => session.run("and again")).toThrow();
  });

  it("throws for an agent that cannot continue a conversation, which is the fallback trigger", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ resume: false })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    expect(() => runner.session({ cwd: process.cwd() })).toThrow("cannot continue a conversation");
  });

  it("does not ask for read-only on a session turn the agent cannot guarantee", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ readOnly: false, reply: "ok", resume: "native" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });
    // AnyAgent throws UnsupportedCapability before spawning if `readOnly` is
    // passed to an agent without it; the gateway must drop it instead.
    expect((await drain(session.run("investigate", { readOnly: true }))).text).toBe("ok");
  });

  it("validates a turn against a schema", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ reply: JSON.stringify({ summary: "did the thing" }), resume: "native" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });

    expect((await drain(session.run("implement", { schema, schemaRetries: 0 }))).json).toEqual({
      summary: "did the thing",
    });
  });

  it("fails a bad reply once, without re-running an editing turn, and keeps the reply", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [
        fakeAdapter({
          replies: ["I changed four files.", JSON.stringify({ summary: "second turn" })],
          resume: "native",
        }),
      ],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });

    const failure = await session
      .run("implement", { schema, schemaRetries: 0 })
      .done.then(() => null)
      .catch((error: unknown) => asSchemaFailure(error));

    expect(failure).not.toBeNull();
    expect(failure?.raw).toBe("I changed four files.");
    expect(failure?.issues.length).toBeGreaterThan(0);

    // The second reply was never consumed, so the turn ran exactly once: the
    // conversation picks it up on the next turn instead.
    expect((await drain(session.run("try again", { schema }))).json).toEqual({ summary: "second turn" });
  });

  it("re-asks a read-only turn, where a second run costs nothing but time", async () => {
    const gateway = createAnyAgentGateway({
      adapters: [fakeAdapter({ replies: ["not json", JSON.stringify({ summary: "second try" })], resume: "native" })],
      probe: fakeProbe(["fake-agent"]),
    });

    const runner = await gateway.open("fake-agent");
    const session = runner.session({ cwd: process.cwd() });
    const run = session.run("investigate", { readOnly: true, schema });

    const seen: string[] = [];
    for await (const event of run.events) {
      seen.push(event.type);
    }

    expect(seen).toContain("schema-retry");
    expect((await run.done).json).toEqual({ summary: "second try" });
  });
});

describe("asSchemaFailure", () => {
  it("recognises a schema failure and keeps the reply that caused it", () => {
    expect(asSchemaFailure({ code: "Parse", issues: ["$.summary: required"], raw: "prose" })).toEqual({
      issues: ["$.summary: required"],
      raw: "prose",
    });
  });

  it("tolerates a failure that carries nothing useful", () => {
    expect(asSchemaFailure({ code: "Parse" })).toEqual({ issues: [], raw: "" });
  });

  it("passes every other failure through as not-a-schema-failure", () => {
    expect(asSchemaFailure({ code: "Invocation" })).toBeNull();
    expect(asSchemaFailure(new Error("the CLI exited 1"))).toBeNull();
    expect(asSchemaFailure("nope")).toBeNull();
    expect(asSchemaFailure(null)).toBeNull();
  });
});

describe("toWizardEvent", () => {
  it("keeps the fields the wizard renders and drops the rest", () => {
    expect(toWizardEvent({ text: "hello", type: "text-delta" })).toEqual({ text: "hello", type: "text-delta" });
    expect(toWizardEvent({ input: {}, name: "bash", nativeName: "Bash", type: "tool-call" })).toEqual({
      toolName: "bash",
      type: "tool-call",
    });
    expect(toWizardEvent({ kind: "create", path: "a.ts", type: "file-change" })).toEqual({
      kind: "create",
      path: "a.ts",
      type: "file-change",
    });
    expect(toWizardEvent({ sessionId: "abc", type: "session" })).toEqual({ type: "session" });
  });
});

describe("describeEvent", () => {
  it("describes the events worth showing", () => {
    expect(describeEvent({ kind: "modify", path: "app/page.tsx", type: "file-change" })).toBe("modify app/page.tsx");
    expect(describeEvent({ toolName: "grep", type: "tool-call" })).toBe("running grep");
    expect(describeEvent({ type: "schema-retry" })).toContain("asking again");
  });

  it("stays silent for token-level noise", () => {
    expect(describeEvent({ text: "a", type: "text-delta" })).toBeNull();
    expect(describeEvent({ text: "b", type: "reasoning-delta" })).toBeNull();
    expect(describeEvent({ type: "done" })).toBeNull();
  });
});
