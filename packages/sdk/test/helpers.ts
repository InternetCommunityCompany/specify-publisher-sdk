export interface MockResponse<T> extends Response {
  status: number;
  ok: boolean;
  json: () => Promise<T>;
  text: () => Promise<string>;
  headers: Headers;
}

export interface ErrorResponse {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** Captured before any test installs a mock, so `restoreFetch` is truthful. */
const originalFetch = globalThis.fetch;

let recorded: RecordedRequest[] = [];

export const setupMockFetch = <T>(response: T, status = 200, contentType = "application/json") => {
  // Mock the global fetch function
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Verify the request is going to the correct endpoint
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/api/ads")) {
      throw new Error(`Unexpected API endpoint: ${url}`);
    }

    // Verify the request method and headers
    if (init?.method !== "POST") {
      throw new Error(`Expected POST request, got ${init?.method}`);
    }

    if (init?.headers && !(init.headers as Record<string, string>)["x-api-key"]) {
      throw new Error("Missing x-api-key header");
    }

    recorded.push({ init, url });

    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers({
        "Content-Type": contentType,
      }),
      // Add required Response properties
      redirected: false,
      statusText: "",
      type: "default" as ResponseType,
      url: typeof input === "string" ? input : input.toString(),
      body: null,
      bodyUsed: false,
      clone: () => new Response(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      blob: () => Promise.resolve(new Blob()),
      formData: () => Promise.resolve(new FormData()),
      json: () => Promise.resolve(response),
      text: () => {
        if (contentType === "text/plain") {
          return Promise.resolve((response as ErrorResponse).error || "");
        }
        return Promise.resolve(JSON.stringify(response));
      },
    } as MockResponse<T>);
  };
};

/** Every request the mock has seen since the last {@link resetFetchCalls}. */
export const getFetchCalls = (): RecordedRequest[] => recorded;

export const getLastFetchCall = (): RecordedRequest | undefined => recorded[recorded.length - 1];

/** Parse the JSON body of the most recent request. */
export const getLastRequestBody = <T = Record<string, unknown>>(): T => {
  const call = getLastFetchCall();
  if (!call?.init?.body) {
    throw new Error("No request has been recorded");
  }
  return JSON.parse(call.init.body as string) as T;
};

export const resetFetchCalls = (): void => {
  recorded = [];
};

/** Put the real `fetch` back and clear the recording. */
export const restoreFetch = (): void => {
  globalThis.fetch = originalFetch;
  resetFetchCalls();
};
