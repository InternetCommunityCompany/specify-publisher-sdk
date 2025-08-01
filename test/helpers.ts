export interface MockResponse<T> extends Response {
  status: number;
  ok: boolean;
  json: () => Promise<T>;
  text: () => Promise<string>;
  headers: Headers;
}

export interface ErrorResponse {
  error: string;
}

export const setupMockFetch = <T>(response: T, status = 200, contentType = "application/json") => {
  // Mock the global fetch function
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
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
