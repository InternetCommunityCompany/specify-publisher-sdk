/**
 * GTM / CDN loader.
 *
 * Built to a single self-contained IIFE at `dist/loader/v1.js` and served from
 * `https://spfsrv.com/sdk/v1.js`. It gives tag-manager users a gtag-style
 * command queue instead of an ES module import:
 *
 * ```html
 * <script>window.specify=window.specify||function(){(window.specify.q=window.specify.q||[]).push(arguments)};</script>
 * <script async src="https://spfsrv.com/sdk/v1.js"></script>
 * ```
 *
 * The inline stub buffers calls into `window.specify.q` while the async script
 * is still in flight. On load this file swaps in a live dispatcher and drains
 * that buffer in order, so page code can call `specify(...)` immediately and
 * never has to check whether the SDK has arrived yet.
 */

import Specify from "../index";
import type { Address, ServeOptions, SpecifyAd } from "../types";

/** Marks a live dispatcher so a second script tag is a no-op. */
const LOADED_FLAG = "__specifyLoaded";

type CommandArgs = unknown[];

interface SpecifyDispatcher {
  (...args: unknown[]): void;
  q?: ArrayLike<unknown>[];
  [LOADED_FLAG]?: boolean;
}

interface SpecifyWindow {
  specify?: SpecifyDispatcher;
  Specify?: typeof Specify;
}

type ServeCallback = (ad: SpecifyAd | null, error?: Error) => void;

function warn(message: string): void {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[specify] ${message}`);
  }
}

function reportError(message: string, error: unknown): void {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error(`[specify] ${message}`, error);
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Invoke a publisher-supplied callback without letting it break the queue. */
function invokeCallback(callback: unknown, ad: SpecifyAd | null, error?: Error): void {
  if (typeof callback !== "function") {
    return;
  }
  try {
    (callback as ServeCallback)(ad, error);
  } catch (callbackError) {
    reportError("serve callback threw", callbackError);
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
export function install(target: SpecifyWindow): void {
  const existing = target.specify;

  // Double-load guard: a second copy of this script must not reset the
  // singleton or re-drain a queue the first copy already consumed.
  if (existing?.[LOADED_FLAG]) {
    return;
  }

  let instance: Specify | null = null;
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
        instance = new Specify(rest[0] as ConstructorParameters<typeof Specify>[0]);
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

    if (command !== "consent" && command !== "revokeConsent" && command !== "identify" && command !== "serve") {
      warn(`unknown command "${String(command)}"`);
      return;
    }

    if (!instance) {
      // Buffer rather than drop: GTM tag ordering is not guaranteed, so a
      // serve tag can genuinely fire before the init tag.
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

    const options = rest[0] as ServeOptions;
    const callback = rest[1];
    try {
      instance
        .serve(options)
        .then((ad) => invokeCallback(callback, ad))
        .catch((error: unknown) => invokeCallback(callback, null, toError(error)));
    } catch (error) {
      invokeCallback(callback, null, toError(error));
    }
  }

  const dispatcher: SpecifyDispatcher = (...args: unknown[]) => {
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
  target.specify = dispatcher;
  target.Specify = Specify;

  for (const entry of queued) {
    dispatcher(...Array.prototype.slice.call(entry));
  }
}

if (typeof window !== "undefined") {
  install(window as unknown as SpecifyWindow);
}
