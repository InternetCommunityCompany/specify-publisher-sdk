import { describe, expect, it } from "bun:test";
import { DEFAULT_EDGE_BASE_URL, resolveEndpoints } from "../lib/config";

describe("resolveEndpoints", () => {
  it("defaults to the neutral edge domain", () => {
    expect(DEFAULT_EDGE_BASE_URL).toBe("https://spfsrv.com");
    expect(resolveEndpoints()).toEqual({
      ads: "https://spfsrv.com/api/ads",
      events: "https://spfsrv.com/v1/events",
    });
  });

  it("honours a baseUrl override", () => {
    expect(resolveEndpoints({ baseUrl: "http://localhost:3000" })).toEqual({
      ads: "http://localhost:3000/api/ads",
      events: "http://localhost:3000/v1/events",
    });
  });

  it("trims trailing slashes from the override", () => {
    expect(resolveEndpoints({ baseUrl: "https://edge.example.com///" })).toEqual({
      ads: "https://edge.example.com/api/ads",
      events: "https://edge.example.com/v1/events",
    });
  });

  it("falls back to the default for a blank override", () => {
    expect(resolveEndpoints({ baseUrl: "   " }).ads).toBe("https://spfsrv.com/api/ads");
    expect(resolveEndpoints({ baseUrl: undefined }).events).toBe("https://spfsrv.com/v1/events");
  });
});
