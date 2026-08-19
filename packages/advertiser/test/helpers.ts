import type { SpecifyEvent } from "@specify-sh/core";

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

export interface EventBatch {
  property_id: string;
  events: SpecifyEvent[];
  sdk: { name: string; version: string };
}

/** Captured before any test installs a mock, so `restoreFetch` is truthful. */
const originalFetch = globalThis.fetch;

let recorded: RecordedRequest[] = [];

/** Record every ingest request and answer with the edge's 204. */
export const setupMockFetch = (status = 204): void => {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    recorded.push({ init, url: String(input) });
    return Promise.resolve(new Response(null, { status }));
  }) as typeof fetch;
};

/** Every request the mock has seen since the last {@link resetFetchCalls}. */
export const getFetchCalls = (): RecordedRequest[] => recorded;

export const getLastFetchCall = (): RecordedRequest | undefined => recorded[recorded.length - 1];

/** Parse the batch body of a recorded request. Defaults to the most recent. */
export const getBatch = (index = recorded.length - 1): EventBatch => {
  const call = recorded[index];
  if (!call?.init?.body) {
    throw new Error("No request has been recorded");
  }
  return JSON.parse(call.init.body as string) as EventBatch;
};

/** Every event across every recorded batch, in the order they were sent. */
export const getSentEvents = (): SpecifyEvent[] => recorded.flatMap((_, index) => getBatch(index).events);

/** Names of every event sent so far, in order. */
export const getSentEventNames = (): string[] => getSentEvents().map((event) => event.name);

export const resetFetchCalls = (): void => {
  recorded = [];
};

/** Put the real `fetch` back and clear the recording. */
export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
  resetFetchCalls();
};
