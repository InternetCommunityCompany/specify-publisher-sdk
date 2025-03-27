import { mock } from "bun:test";

export interface MockResponse<T> {
  status?: number;
  ok?: boolean;
  json?: () => Promise<T>;
  text?: () => Promise<string>;
  headers?: Headers;
}

export interface ErrorResponse {
  error: string;
}

export const setupMockFetch = <T>(response: T, status = 200, contentType = "application/json") => {
  mock.module("cross-fetch", () => ({
    default: (_url: string, _options: RequestInit) => {
      return Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(response),
        text: () => {
          if (contentType === "text/plain") {
            return Promise.resolve((response as ErrorResponse).error || "");
          }
          return Promise.resolve(JSON.stringify(response));
        },
        headers: new Headers({
          "Content-Type": contentType,
        }),
      } as MockResponse<T>);
    },
  }));
};
