import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getSessionId, resetSessionId } from "../lib/session";
import { type BrowserStub, installBrowser, uninstallBrowser } from "./browser";

describe("getSessionId", () => {
  let browser: BrowserStub;

  beforeEach(() => {
    browser = installBrowser();
    resetSessionId();
  });

  afterEach(() => {
    uninstallBrowser();
    resetSessionId();
  });

  it("creates a session id and persists it to sessionStorage", () => {
    const id = getSessionId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(browser.sessionStorage.getItem("__specify_session_id")).toBe(id);
  });

  it("returns the same id on repeat calls", () => {
    expect(getSessionId()).toBe(getSessionId());
  });

  it("reuses an id already in sessionStorage across page loads", () => {
    browser.sessionStorage.setItem("__specify_session_id", "existing-session-id");

    expect(getSessionId()).toBe("existing-session-id");
  });

  it("still returns a stable id when storage is unavailable", () => {
    uninstallBrowser();
    resetSessionId();

    const id = getSessionId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getSessionId()).toBe(id);
  });
});
