/**
 * Live check for a browser environment.
 *
 * Deliberately a function (not a module-load-time constant) so it reflects the
 * current global state at each call site rather than freezing whatever was true
 * when this module was first imported. That matters for SSR bundlers, which may
 * evaluate the module graph on the server and reuse it on the client, and for
 * tests that install and remove a stub `window`.
 */
export function isClient(): boolean {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}
