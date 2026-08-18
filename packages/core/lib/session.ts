import { isClient } from "./env";
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

/**
 * Read the current session id, creating one on first use.
 *
 * @returns A stable UUIDv7 for this browsing session
 */
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

/**
 * Drop the cached session id so the next {@link getSessionId} re-reads storage.
 * Exists for tests and for SPA teardown; publishers never need it.
 */
export function resetSessionId(): void {
  inMemorySessionId = null;
}
