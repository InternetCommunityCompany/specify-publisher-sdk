/**
 * GTM / CDN loader.
 *
 * Built to a single self-contained IIFE at `dist/loader/v1.js` and served from
 * `https://spfsrv.com/sdk/advertiser/v1.js`. It gives tag-manager users a
 * gtag-style command queue instead of an ES module import:
 *
 * ```html
 * <script>window.specifyAnalytics=window.specifyAnalytics||function(){(window.specifyAnalytics.q=window.specifyAnalytics.q||[]).push(arguments)};</script>
 * <script async src="https://spfsrv.com/sdk/advertiser/v1.js"></script>
 * ```
 *
 * The inline stub buffers calls into `window.specifyAnalytics.q` while the
 * async script is still in flight. On load this file swaps in a live dispatcher
 * and drains that buffer in order, so page code can call
 * `specifyAnalytics(...)` immediately and never has to check whether the SDK
 * has arrived yet.
 *
 * The global is deliberately distinct from the Publisher SDK's `window.specify`
 * so a site running both tags keeps two independent queues.
 */

import { SpecifyAnalytics } from "../index";
import type { Address, EventProps } from "../types";

/** Marks a live dispatcher so a second script tag is a no-op. */
const LOADED_FLAG = "__specifyAnalyticsLoaded";

type CommandArgs = unknown[];

interface SpecifyAnalyticsDispatcher {
  (...args: unknown[]): void;
  q?: ArrayLike<unknown>[];
  [LOADED_FLAG]?: boolean;
}

interface SpecifyAnalyticsWindow {
  specifyAnalytics?: SpecifyAnalyticsDispatcher;
  SpecifyAnalytics?: typeof SpecifyAnalytics;
}

function warn(message: string): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[specify-analytics] ${message}`);
  }
}

function reportError(message: string, error: unknown): void {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error(`[specify-analytics] ${message}`, error);
  }
}

/**
 * Swap the queue stub on `target` for a live dispatcher and drain the buffer.
 *
 * Exported so tests can drive it against a fake window; page code never calls
 * it — the module installs itself on `window` when loaded.
 *
 * @param target - The global object to install onto
 */
export function install(target: SpecifyAnalyticsWindow): void {
  const existing = target.specifyAnalytics;

  // Double-load guard: a second copy of this script must not reset the
  // singleton or re-drain a queue the first copy already consumed.
  if (existing?.[LOADED_FLAG]) {
    return;
  }

  let instance: SpecifyAnalytics | null = null;
  /** Commands received before `init`, replayed once the singleton exists. */
  const pending: CommandArgs[] = [];

  function runCommand(args: CommandArgs): void {
    const [command, ...rest] = args;

    if (command === "init") {
      if (instance) {
        warn("init called more than once; ignoring the repeat call");
        return;
      }
      try {
        instance = new SpecifyAnalytics(rest[0] as ConstructorParameters<typeof SpecifyAnalytics>[0]);
      } catch (error) {
        reportError("init failed", error);
        return;
      }
      const buffered = pending.splice(0, pending.length);
      for (const bufferedArgs of buffered) {
        runCommand(bufferedArgs);
      }
      return;
    }

    if (command !== "consent" && command !== "revokeConsent" && command !== "identify" && command !== "event") {
      warn(`unknown command "${String(command)}"`);
      return;
    }

    if (!instance) {
      // Buffer rather than drop: GTM tag ordering is not guaranteed, so an
      // event tag can genuinely fire before the init tag.
      pending.push(args);
      return;
    }

    if (command === "consent") {
      instance.consentForEnhancedTracking();
      return;
    }

    if (command === "revokeConsent") {
      instance.revokeEnhancedTrackingConsent();
      return;
    }

    if (command === "identify") {
      try {
        instance.identify(rest[0] as Address | Address[]);
      } catch (error) {
        reportError("identify failed", error);
      }
      return;
    }

    // `event` is fire-and-forget: there is no response to hand back, so a bad
    // event name is reported to the console rather than thrown at the tag.
    try {
      instance.logEvent(rest[0] as string, rest[1] as EventProps | undefined);
    } catch (error) {
      reportError("event failed", error);
    }
  }

  const dispatcher: SpecifyAnalyticsDispatcher = (...args: unknown[]) => {
    try {
      runCommand(args);
    } catch (error) {
      reportError("command failed", error);
    }
  };
  dispatcher[LOADED_FLAG] = true;
  dispatcher.q = [];

  // Capture the stub's buffer before replacing it, then drain in order.
  const queued = existing?.q ?? [];
  target.specifyAnalytics = dispatcher;
  target.SpecifyAnalytics = SpecifyAnalytics;

  for (const entry of queued) {
    dispatcher(...Array.prototype.slice.call(entry));
  }
}

if (typeof window !== "undefined") {
  install(window as unknown as SpecifyAnalyticsWindow);
}
