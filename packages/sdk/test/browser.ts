/**
 * Minimal browser globals for `bun test`.
 *
 * The SDK only touches `window.document`, `window.localStorage` and the
 * EIP-6963 event pair, so a hand-rolled stub is cheaper and more predictable
 * than pulling in jsdom.
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

export interface BrowserStub {
  window: Window & typeof globalThis;
  document: Document;
  localStorage: StubStorage;
  sessionStorage: StubStorage;
}

/**
 * Install stub `window`/`document` globals. Returns handles for assertions.
 */
export function installBrowser(): BrowserStub {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const localStorage = createStorage();
  const sessionStorage = createStorage();

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
    localStorage,
    location: { href: "https://publisher.example/article" },
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    sessionStorage,
  } as unknown as Window & typeof globalThis;

  (globalThis as { window?: unknown }).window = win;
  (globalThis as { document?: unknown }).document = document;

  return { document, localStorage, sessionStorage, window: win };
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
    const event = new CustomEvent("eip6963:announceProvider", {
      detail: {
        info: { icon: "data:,", name: uuid, rdns: `com.example.${uuid}`, uuid },
        provider,
      },
    });
    stub.window.dispatchEvent(event);
  });
}

/** Let queued microtasks and timers settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
