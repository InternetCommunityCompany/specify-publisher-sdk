import { isClient } from "../utils";

/**
 * Identity sync (spec §3.2).
 *
 * `GET /v1/sync` with `credentials: 'include'`. The edge reads or mints the
 * server-only `spid` cookie and replies `204 No Content` + `Set-Cookie`.
 * Because `spid` is `HttpOnly`, the SDK never sees the value — it only makes
 * the credentialed request and lets the cookie ride along.
 *
 * Browsers that block third-party cookies (Safari ITP, Firefox ETP, Brave)
 * simply never persist the cookie. The call is idempotent and cheap, and every
 * downstream consumer tolerates `spid = null`, so failures here are swallowed.
 */
export async function syncIdentity(syncUrl: string): Promise<void> {
  if (!isClient()) {
    return;
  }
  try {
    await fetch(syncUrl, {
      method: "GET",
      credentials: "include",
      keepalive: true,
      // Response is 204; we never read a body.
      cache: "no-store",
    });
  } catch {
    // Network/blocked-cookie failures are expected and non-fatal.
  }
}
