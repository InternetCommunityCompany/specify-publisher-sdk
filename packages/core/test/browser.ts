/**
 * Minimal browser globals for `bun test`. See the matching helper in the sdk
 * package — each package keeps its own so test fixtures never cross the
 * workspace boundary.
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
  sessionStorage: StubStorage;
  /** Flip visibility and fire the event the transport listens for. */
  setVisibility(state: "hidden" | "visible"): void;
}

export function installBrowser(): BrowserStub {
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
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
    localStorage: createStorage(),
    location: { href: "https://publisher.example/article" },
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    sessionStorage,
  } as unknown as Window & typeof globalThis;

  (globalThis as { window?: unknown }).window = win;
  (globalThis as { document?: unknown }).document = document;

  return {
    document,
    sessionStorage,
    setVisibility(state) {
      (document as unknown as { visibilityState: string }).visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    window: win,
  };
}

export function uninstallBrowser(): void {
  (globalThis as { window?: unknown }).window = undefined;
  (globalThis as { document?: unknown }).document = undefined;
}

export interface StubProvider {
  request(args: { method: string }): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  requestedMethods: string[];
  listenerCount(event: string): number;
}

export function createStubProvider(options: { accounts?: unknown; reject?: boolean } = {}): StubProvider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const requestedMethods: string[] = [];

  return {
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(...args);
      }
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
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
      return Promise.resolve(options.accounts ?? []);
    },
    requestedMethods,
  };
}

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

export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
