import { isClient } from "../utils";
import { uuidv7 } from "./uuid";

/**
 * Per-page-lifecycle session id.
 *
 * This is a first-party, client-visible identifier used to group events from a
 * single browsing session for funnel analytics. It is deliberately distinct
 * from the server-only `spid` cookie (which the SDK never sees) and carries no
 * cross-site meaning on its own.
 *
 * Persisted in `sessionStorage` so a session survives same-tab SPA navigations
 * and reloads but does not leak across tabs or persist indefinitely.
 */

const SESSION_KEY = "__specify_session_id";

let inMemorySessionId: string | null = null;

function getSessionStorage(): Storage | undefined {
  try {
    if (isClient() && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // sessionStorage can throw in sandboxed iframes / privacy modes.
  }
  return undefined;
}

export function getSessionId(): string {
  if (inMemorySessionId) {
    return inMemorySessionId;
  }

  const storage = getSessionStorage();
  const existing = storage?.getItem(SESSION_KEY);
  if (existing) {
    inMemorySessionId = existing;
    return existing;
  }

  const created = uuidv7();
  inMemorySessionId = created;
  try {
    storage?.setItem(SESSION_KEY, created);
  } catch {
    // Ignore write failures; the in-memory value keeps the session coherent
    // for the lifetime of the page.
  }
  return created;
}
