import { isClient } from "../utils";

/**
 * Passive, read-only wallet detection shared by the Publisher and Advertiser
 * SDKs (spec §3.3).
 *
 * Guarantees:
 * - Never prompts the user and never requests permissions. Only ever calls the
 *   silent `eth_accounts` (returns already-connected accounts), never
 *   `eth_requestAccounts`.
 * - Uses EIP-6963 provider discovery (correct for multi-wallet browsers) with a
 *   legacy `window.ethereum` fallback.
 * - Normalises addresses to lowercase hex before exposing them.
 *
 * Known gap: WalletConnect v2 sessions do not inject a provider, so remote
 * wallets are invisible here — integrators pass those via `setWalletAddresses`.
 */

type Address = string;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Eip6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

interface Eip6963AnnounceEvent extends Event {
  detail: Eip6963ProviderDetail;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function normalize(address: unknown): Address | null {
  if (typeof address !== "string") {
    return null;
  }
  const trimmed = address.trim();
  return ADDRESS_REGEX.test(trimmed) ? trimmed.toLowerCase() : null;
}

export type WalletChangeListener = (addresses: Address[]) => void;

export class WalletDetector {
  private readonly providers = new Map<string, Eip1193Provider>();
  private readonly detected = new Set<Address>();
  private readonly listeners = new Set<WalletChangeListener>();
  private started = false;
  private readonly boundAnnounce = (event: Event) => this.onAnnounce(event as Eip6963AnnounceEvent);

  /** Begin passive discovery. Idempotent and a no-op outside the browser. */
  public start(): void {
    if (this.started || !isClient()) {
      return;
    }
    this.started = true;

    // EIP-6963: listen for provider announcements, then request them. Wallets
    // that were already loaded respond synchronously to the request event.
    window.addEventListener("eip6963:announceProvider", this.boundAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Legacy fallback for wallets that only expose window.ethereum.
    const legacy = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
    if (legacy) {
      this.registerProvider("legacy:window.ethereum", legacy);
    }
  }

  /** Stop discovery and detach all provider listeners. */
  public stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (isClient()) {
      window.removeEventListener("eip6963:announceProvider", this.boundAnnounce);
    }
    this.providers.clear();
    this.listeners.clear();
  }

  /** Current set of detected, connected addresses (lowercase hex). */
  public getAddresses(): Address[] {
    return [...this.detected];
  }

  /** Subscribe to mid-session wallet changes. Returns an unsubscribe fn. */
  public onChange(listener: WalletChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onAnnounce(event: Eip6963AnnounceEvent): void {
    const detail = event.detail;
    if (!detail?.provider || !detail.info?.uuid) {
      return;
    }
    this.registerProvider(detail.info.uuid, detail.provider);
  }

  private registerProvider(key: string, provider: Eip1193Provider): void {
    if (this.providers.has(key)) {
      return;
    }
    this.providers.set(key, provider);

    // Silent read of already-connected accounts. Never triggers a prompt.
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => this.ingest(accounts))
      .catch(() => {
        // Provider may reject if locked; that's expected and non-fatal.
      });

    // Subscribe to mid-session changes.
    provider.on?.("accountsChanged", (accounts) => this.ingest(accounts));
    provider.on?.("connect", () => {
      provider
        .request({ method: "eth_accounts" })
        .then((accounts) => this.ingest(accounts))
        .catch(() => {});
    });
  }

  private ingest(accounts: unknown): void {
    if (!Array.isArray(accounts)) {
      return;
    }
    let changed = false;
    for (const account of accounts) {
      const normalized = normalize(account);
      if (normalized && !this.detected.has(normalized)) {
        this.detected.add(normalized);
        changed = true;
      }
    }
    if (changed) {
      this.emit();
    }
  }

  private emit(): void {
    const snapshot = this.getAddresses();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A throwing consumer must not break detection for the others.
      }
    }
  }
}

/** Validate and normalise externally-supplied addresses (setWalletAddresses). */
export function normalizeAddresses(addresses: readonly string[]): Address[] {
  const out = new Set<Address>();
  for (const address of addresses) {
    const normalized = normalize(address);
    if (normalized) {
      out.add(normalized);
    }
  }
  return [...out];
}
