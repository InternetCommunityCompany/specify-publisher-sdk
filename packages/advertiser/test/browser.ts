/**
 * Minimal browser globals for `bun test`. See the matching helpers in the core
 * and sdk packages — each package keeps its own so test fixtures never cross
 * the workspace boundary.
 *
 * This one adds a `history` stub that behaves like the real thing: pushing or
 * replacing state moves `location`, which is what the SDK's page-view capture
 * reads.
 */

export interface StubStorage extends Storage {
  __entries: Map<string, string>;
}

function createStorage(): StubStorage {
  const entries = new Map<string, string>();
  return {
    __entries: entries,
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? (entries.get(key) as string) : null;
    },
    key(index: number) {
      return [...entries.keys()][index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };
}

export const DEFAULT_URL = "https://advertiser.example/landing";

export interface BrowserStub {
  window: Window & typeof globalThis;
  document: Document;
  localStorage: StubStorage;
  sessionStorage: StubStorage;
  /** Flip visibility and fire the event the transport listens for. */
  setVisibility(state: "hidden" | "visible"): void;
  /** Move the URL and fire `popstate`, as a back/forward button does. */
  popTo(url: string): void;
}

/**
 * Install stub `window`/`document` globals. Returns handles for assertions.
 *
 * @param url - Initial page URL, including any query string
 */
export function installBrowser(url: string = DEFAULT_URL): BrowserStub {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const localStorage = createStorage();
  const sessionStorage = createStorage();

  const location = { href: url, search: new URL(url).search };

  function setUrl(next: string | URL | null | undefined): void {
    const resolved = new URL(String(next ?? location.href), location.href);
    location.href = resolved.href;
    location.search = resolved.search;
  }

  const history = {
    pushState(_state: unknown, _title: string, next?: string | URL | null) {
      setUrl(next);
    },
    replaceState(_state: unknown, _title: string, next?: string | URL | null) {
      setUrl(next);
    },
  } as unknown as History;

  const document = {
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
    referrer: "",
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    visibilityState: "visible",
  } as unknown as Document;

  const win = {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
    document,
    history,
    localStorage,
    location,
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    sessionStorage,
  } as unknown as Window & typeof globalThis;

  (globalThis as { window?: unknown }).window = win;
  (globalThis as { document?: unknown }).document = document;

  return {
    document,
    localStorage,
    popTo(next: string) {
      setUrl(next);
      win.dispatchEvent(new Event("popstate"));
    },
    sessionStorage,
    setVisibility(state) {
      (document as unknown as { visibilityState: string }).visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    window: win,
  };
}

/** Remove the stub globals so `isClient()` reports a non-browser environment. */
export function uninstallBrowser(): void {
  (globalThis as { window?: unknown }).window = undefined;
  (globalThis as { document?: unknown }).document = undefined;
}

export interface StubProviderOptions {
  /** Accounts returned by the silent `eth_accounts` read. */
  accounts: string[];
  /** Reject the `eth_accounts` request, as a locked wallet would. */
  reject?: boolean;
}

export interface StubProvider {
  request(args: { method: string }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  /** Fire `accountsChanged` as a wallet would mid-session. */
  emitAccountsChanged(accounts: string[]): void;
  /** Every method name the detector asked for, in order. */
  requestedMethods: string[];
}

/** A fake EIP-1193 provider that records which RPC methods were requested. */
export function createStubProvider(options: StubProviderOptions): StubProvider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const requestedMethods: string[] = [];

  return {
    emitAccountsChanged(accounts: string[]) {
      for (const listener of listeners.get("accountsChanged") ?? []) {
        listener(accounts);
      }
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
    request({ method }: { method: string }) {
      requestedMethods.push(method);
      if (options.reject) {
        return Promise.reject(new Error("wallet is locked"));
      }
      return Promise.resolve(options.accounts);
    },
    requestedMethods,
  };
}

/**
 * Announce a provider the way a real wallet does: answer the detector's
 * `eip6963:requestProvider` with an `eip6963:announceProvider` event.
 */
export function announceProviderOnRequest(stub: BrowserStub, uuid: string, provider: StubProvider): void {
  stub.window.addEventListener("eip6963:requestProvider", () => {
    stub.window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: { icon: "data:,", name: uuid, rdns: `com.example.${uuid}`, uuid },
          provider,
        },
      }),
    );
  });
}

/** Let queued microtasks and timers settle. */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
