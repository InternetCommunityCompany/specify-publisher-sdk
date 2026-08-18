import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventTransport, type SpecifyEvent } from "../lib/transport";
import { type BrowserStub, flush, installBrowser, uninstallBrowser } from "./browser";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;

let requests: RecordedRequest[] = [];

function mockFetch(): void {
  requests = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ init, url: String(input) });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
}

function bodyOf(index: number): { property_id: string; events: SpecifyEvent[]; sdk: { name: string } } {
  return JSON.parse(requests[index].init?.body as string);
}

function makeEvent(name: string): SpecifyEvent {
  return {
    name,
    page: { referrer: "", url: "https://publisher.example/article" },
    props: {},
    session_id: "session-1",
    spclid: null,
    ts: new Date().toISOString(),
    wallets: [],
  };
}

const ENDPOINT = "https://spfsrv.com/api/events";

function newTransport(overrides: Partial<ConstructorParameters<typeof EventTransport>[0]> = {}): EventTransport {
  return new EventTransport({
    endpoint: ENDPOINT,
    propertyId: "spk_test",
    sdk: { name: "publisher", version: "1.0.0" },
    ...overrides,
  });
}

describe("EventTransport", () => {
  let browser: BrowserStub;

  beforeEach(() => {
    browser = installBrowser();
    mockFetch();
  });

  afterEach(() => {
    uninstallBrowser();
    globalThis.fetch = originalFetch;
  });

  it("buffers without sending until the batch is full", () => {
    const transport = newTransport({ maxBatchSize: 3, maxBatchAgeMs: 60_000 });

    transport.enqueue(makeEvent("one"));
    transport.enqueue(makeEvent("two"));
    expect(requests).toHaveLength(0);

    transport.enqueue(makeEvent("three"));

    expect(requests).toHaveLength(1);
    expect(bodyOf(0).events.map((event) => event.name)).toEqual(["one", "two", "three"]);
    transport.destroy();
  });

  it("flushes on batch age when the batch never fills", async () => {
    const transport = newTransport({ maxBatchSize: 100, maxBatchAgeMs: 20 });

    transport.enqueue(makeEvent("slow"));
    expect(requests).toHaveLength(0);

    await flush(40);

    expect(requests).toHaveLength(1);
    expect(bodyOf(0).events).toHaveLength(1);
    transport.destroy();
  });

  it("sends credentialed, keepalive JSON with the property id and sdk tag", () => {
    const transport = newTransport({ maxBatchSize: 1 });

    transport.enqueue(makeEvent("one"));

    expect(requests[0].url).toBe(ENDPOINT);
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].init?.credentials).toBe("include");
    expect(requests[0].init?.keepalive).toBe(true);
    expect(bodyOf(0).property_id).toBe("spk_test");
    expect(bodyOf(0).sdk.name).toBe("publisher");
    transport.destroy();
  });

  it("starts a fresh batch after a flush", () => {
    const transport = newTransport({ maxBatchSize: 2, maxBatchAgeMs: 60_000 });

    transport.enqueue(makeEvent("one"));
    transport.enqueue(makeEvent("two"));
    transport.enqueue(makeEvent("three"));
    transport.flush();

    expect(requests).toHaveLength(2);
    expect(bodyOf(1).events.map((event) => event.name)).toEqual(["three"]);
    transport.destroy();
  });

  it("does nothing when flushing an empty queue", () => {
    const transport = newTransport();

    transport.flush();
    transport.flush();

    expect(requests).toHaveLength(0);
    transport.destroy();
  });

  it("flushes when the page is hidden", () => {
    const transport = newTransport({ maxBatchSize: 100, maxBatchAgeMs: 60_000 });
    transport.enqueue(makeEvent("one"));

    browser.setVisibility("hidden");

    expect(requests).toHaveLength(1);
    transport.destroy();
  });

  it("flushes on pagehide", () => {
    const transport = newTransport({ maxBatchSize: 100, maxBatchAgeMs: 60_000 });
    transport.enqueue(makeEvent("one"));

    browser.window.dispatchEvent(new Event("pagehide"));

    expect(requests).toHaveLength(1);
    transport.destroy();
  });

  it("flushes pending events and detaches listeners on destroy", () => {
    const transport = newTransport({ maxBatchSize: 100, maxBatchAgeMs: 60_000 });
    transport.enqueue(makeEvent("one"));

    transport.destroy();
    expect(requests).toHaveLength(1);

    browser.window.dispatchEvent(new Event("pagehide"));
    browser.setVisibility("hidden");
    expect(requests).toHaveLength(1);
  });

  it("cancels the age timer once a size-triggered flush has sent", async () => {
    const transport = newTransport({ maxBatchSize: 2, maxBatchAgeMs: 20 });

    transport.enqueue(makeEvent("one"));
    transport.enqueue(makeEvent("two"));
    expect(requests).toHaveLength(1);

    await flush(40);

    expect(requests).toHaveLength(1);
    transport.destroy();
  });
});
