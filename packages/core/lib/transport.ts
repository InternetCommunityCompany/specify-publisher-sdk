import { isClient } from "./env";

/**
 * Batched, credentialed event transport.
 *
 * Events are queued and flushed when any of these occur:
 * - the buffer reaches `maxBatchSize` (default 10),
 * - `maxBatchAgeMs` elapses since the first buffered event (default 5s),
 * - the page is hidden/unloaded (flushed via `fetch` with `keepalive`, the
 *   modern `sendBeacon` equivalent that still lets us send credentials + JSON).
 *
 * The `spid` cookie rides along on every request via `credentials: 'include'`;
 * it never appears in the payload.
 *
 * Not used by the Publisher SDK — event ingest belongs to the Advertiser SDK,
 * which moves into this monorepo next. It lives here so both packages share one
 * implementation.
 */

export interface SpecifyEvent {
  name: string;
  ts: string;
  session_id: string;
  spclid: string | null;
  wallets: string[];
  page: { url: string; referrer: string };
  props: Record<string, unknown>;
}

export interface TransportOptions {
  endpoint: string;
  propertyId: string;
  sdk: { name: string; version: string };
  maxBatchSize?: number;
  maxBatchAgeMs?: number;
}

export class EventTransport {
  private readonly endpoint: string;
  private readonly propertyId: string;
  private readonly sdk: { name: string; version: string };
  private readonly maxBatchSize: number;
  private readonly maxBatchAgeMs: number;

  private queue: SpecifyEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleBound = false;
  private readonly boundLifecycleFlush = () => this.flush();

  constructor(options: TransportOptions) {
    this.endpoint = options.endpoint;
    this.propertyId = options.propertyId;
    this.sdk = options.sdk;
    this.maxBatchSize = options.maxBatchSize ?? 10;
    this.maxBatchAgeMs = options.maxBatchAgeMs ?? 5000;
    this.bindLifecycle();
  }

  /**
   * Buffer an event, flushing immediately if the batch is now full.
   *
   * @param event - The event to send
   */
  public enqueue(event: SpecifyEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.maxBatchAgeMs);
    }
  }

  /** Send everything currently buffered. Safe to call repeatedly. */
  public flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) {
      return;
    }

    const events = this.queue;
    this.queue = [];

    const body = JSON.stringify({
      property_id: this.propertyId,
      events,
      sdk: this.sdk,
    });

    try {
      void fetch(this.endpoint, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(() => {
        // Ingest failures are non-fatal; events are best-effort analytics.
      });
    } catch {
      // fetch can throw synchronously if the payload exceeds keepalive limits.
    }
  }

  /** Detach lifecycle listeners; flushes any remaining events first. */
  public destroy(): void {
    this.flush();
    if (this.lifecycleBound && isClient()) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      window.removeEventListener("pagehide", this.boundLifecycleFlush);
    }
    this.lifecycleBound = false;
  }

  private readonly onVisibilityChange = () => {
    if (isClient() && document.visibilityState === "hidden") {
      this.flush();
    }
  };

  private bindLifecycle(): void {
    if (this.lifecycleBound || !isClient()) {
      return;
    }
    this.lifecycleBound = true;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.boundLifecycleFlush);
  }
}
