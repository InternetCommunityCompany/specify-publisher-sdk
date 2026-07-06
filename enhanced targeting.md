# Specify SDK — Enhanced Targeting

**Publisher SDK (existing) & Advertiser SDK (new)**
Draft v0.1 — July 2026 · Author: Ross / TICC OÜ · Status: for internal review

---

## 1. Overview

Specify operates a two-sided web3 performance advertising network. Attribution today is deterministic and onchain-first: conversions are observed directly from chain data and joined to ad interactions, which is why an advertiser can run on Specify with **zero client-side integration**. This document specifies the two client SDKs and the identity infrastructure that connects them:

- The **Publisher SDK** (existing, TypeScript) renders ads, captures wallet and session context on publisher properties, and generates click IDs.
- The **Advertiser SDK** (new, TypeScript + CDN loader) is an *optional, advanced* integration for advertisers who want off-chain funnel analytics, richer wallet identification, and participation in network-wide retargeting.
- The **Specify Identity Service** issues a cross-site identifier (`spid`) via a third-party cookie and maintains the server-side identity graph that links `spid ↔ wallet ↔ click`.

The strategic goal of this architecture is network expansion: by building a durable map between browsers and wallets, Specify can serve wallet-targeted inventory on publishers where **no wallet is connected**, turning general-audience sites into sellable crypto inventory and enabling cross-site retargeting of known wallets.

### 1.1 Design principles

1. **Deterministic first.** Billing (CPA / tiered volume) is computed exclusively from deterministic joins: onchain conversion events, observed wallet connections, and click IDs. The identity graph informs *targeting and reach*, never invoicing. Probabilistic signals are out of scope for v1 and, if added later, will carry confidence scores and remain targeting-only.
2. **Zero-integration baseline.** Advertisers get conversion measurement without installing anything. The Advertiser SDK adds capability; it is never a prerequisite. There is consequently no `trackAllSessions`-style gate — installing the SDK *is* the advanced opt-in, and it tracks the sessions it sees.
3. **Shared identity core.** Both SDKs consume one internal package (`@specify/core`) for identity sync, wallet detection, and event transport, so behaviour is identical on both sides of the network.
4. **Consent is the integrator's responsibility.** Mirroring prevailing web3 adtech practice, the SDKs ship with sensible privacy flags and clear documentation, and integrators are contractually required to obtain any consents needed in their jurisdictions before loading the SDK (see §9).
5. **Chrome-first realism.** The `spid` third-party cookie works in Chromium browsers with default settings (~65% of desktop). Safari and Firefox block third-party cookies entirely; on those browsers the network degrades gracefully to click-ID and wallet-anchored attribution. No fingerprinting workarounds in v1.

### 1.2 Explicit non-goals (v1)

Probabilistic device matching; CNAME cloaking or bounce-tracking ID passing; CHIPS/partitioned cookies (partitioning defeats the purpose); mobile in-app SDKs; Solana wallet detection (v1 is EVM-only — see §11 for the Solana plan).

---

## 2. System architecture

```
┌────────────────────────┐                ┌────────────────────────┐
│  Publisher property     │                │  Advertiser property   │
│  @specify/publisher     │                │  @specify/advertiser   │
│  ─ ad units             │                │  ─ funnel events       │
│  ─ wallet detection     │                │  ─ wallet detection    │
│  ─ click ID minting     │                │  ─ spclid capture      │
└───────┬────────────────┘                └───────────┬────────────┘
        │  credentialed HTTPS (spid cookie rides along)│
        ▼                                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Specify Edge (id.spfy-net.com)                 │
│   /v1/ads (ad server)   /v1/sync (identity)   /v1/events (ingest)│
└───────┬──────────────────────┬──────────────────────┬────────────┘
        ▼                      ▼                      ▼
   Ad decisioning        Identity graph          Event pipeline
   (targeting via        (spid ↔ wallet ↔        (funnel analytics,
    graph lookups)        click_id edges)         audience builder)
                               ▲
                               │
                  Onchain attribution pipeline
                  (chain indexers, conversion
                   scoping rules per advertiser)
```

**Domain strategy.** All edge endpoints live on a single dedicated registrable domain (working name `spfy-net.com`; final choice TBD) that is *not* the marketing site. The `spid` cookie is scoped to this eTLD+1 so the ad server, sync, and ingest subdomains all send/receive it. A dedicated domain limits blast radius when (not if) ad-block filter lists add it, and keeps the corporate site's cookie posture clean.

Cross-site flow in one paragraph: a user on Publisher A connects their wallet; the Publisher SDK's ad request carries the `spid` cookie and the observed wallet, and the graph records `spid ↔ 0xabc…`. Days later the same browser visits Publisher B — a general-audience site with no wallet UX. The ad request from B carries the same `spid`; the ad server resolves it to `0xabc…`, applies the advertiser's onchain behavioural targeting, and serves a wallet-targeted ad on a page that knows nothing about wallets. If the user clicks and later converts onchain, the click ID and wallet close the attribution loop deterministically.

---

## 3. Identity layer

### 3.1 The `spid` cookie

| Attribute | Value | Rationale |
|---|---|---|
| Name | `spid` | Opaque; no wallet or PII ever encoded in the value |
| Value | UUIDv7 | Time-ordered, safe to index |
| Domain | `.spfy-net.com` | Shared across ad/sync/ingest subdomains |
| Flags | `Secure; HttpOnly; SameSite=None` | Required for cross-site sending; JS never reads it |
| Max-Age | 390 days, rolling | Refreshed on every credentialed request |
| Partitioned | **No** | CHIPS would silo per top-level site |

The cookie is **server-set only**. Every credentialed response from the edge refreshes it. Because it is `HttpOnly`, the SDKs never see the value; they simply make credentialed requests and the cookie rides along. This means no `spid` ever appears in client-side code, logs, or DOM — the graph exists only server-side.

### 3.2 `/v1/sync`

`GET https://id.spfy-net.com/v1/sync` — called once per page lifecycle by both SDKs at init, with `credentials: 'include'`. Reads or mints `spid`, returns `204 No Content` plus `Set-Cookie`. The publisher ad request also refreshes the cookie, so on publisher pages the explicit sync is skipped when an ad request will fire anyway (the SDK handles this).

Browsers without third-party cookie support simply never persist the cookie; the endpoint is idempotent and cheap, and everything downstream tolerates `spid = null`.

### 3.3 Wallet detection (`@specify/core/wallet`)

Passive, read-only detection shared by both SDKs. The module never prompts the user and never requests permissions:

- **EIP-6963** provider discovery (handles multi-wallet browsers correctly) with legacy `window.ethereum` fallback.
- On each discovered provider: a silent `eth_accounts` call (returns connected accounts only; never `eth_requestAccounts`).
- Subscribes to `accountsChanged` and `connect` events for mid-session changes.
- Addresses are normalised to lowercase hex before transmission.

**Known gap:** WalletConnect v2 sessions don't inject a provider, so remote-wallet users are invisible to automatic detection. This is the primary reason the explicit `setWalletAddresses()` API exists (§5.3) — dApps already hold the connected address in their own state (wagmi/viem/web3modal) and can pass it in one line.

Config flag `privacy.disableWalletDetection: true` turns the automatic layer off entirely; explicit `setWalletAddresses()` still works.

### 3.4 Click IDs (`spclid`)

The Publisher SDK mints a `spclid` (UUIDv7, signed with an HMAC suffix to make forgery detectable server-side) at click time and appends it to the click-through URL. The Advertiser SDK, when present, captures `spclid` from the landing URL and persists it in **first-party** storage on the advertiser's domain (localStorage, mirrored to a first-party cookie, 90-day TTL, last-click-wins). Every subsequent event from that browser carries the stored `spclid`. This path works in all browsers, including Safari/Firefox, and requires no third-party cookies.

### 3.5 Identity graph (server-side)

Nodes: `wallet`, `spid`, `spclid`, `advertiser_user` (per-property session scope). Edges carry `{source, first_seen, last_seen, observation_count, confidence}` where v1 sources are all deterministic: `wallet_connect_publisher`, `wallet_connect_advertiser`, `click_landing`, `explicit_set`. A wallet observed under a new `spid` (new browser/device) simply gains an additional edge — wallets are the durable anchor that heals the graph as cookies churn. Edges decay: an edge unrefreshed for 180 days is excluded from targeting resolution (configurable per use).

Resolution rule for targeting: `spid → wallet` requires at least one deterministic edge within the decay window; where multiple wallets map to one `spid`, all are returned and the ad server targets on the union.

---

## 4. Publisher SDK (`@specify/publisher`, existing — v2 additions)

The existing TypeScript SDK's core responsibilities (init with property slug, ad unit rendering, impression/click reporting) are retained. This section specifies the deltas required by the identity architecture.

### 4.1 Integration surface

```ts
import { Specify } from '@specify/publisher';

const specify = Specify.init({
  propertyId: 'pub_xxxxxxxx',
  environment: 'production',
  privacy: {
    disableWalletDetection: false,   // default
  },
});

// Framework-agnostic placement
specify.render('#sidebar-slot', { placement: 'sidebar_300x250' });

// Optional: pass the connected wallet explicitly (WalletConnect etc.)
specify.setWalletAddresses(['0xabc…']);
```

### 4.2 Ad request flow

1. On `render()`, the SDK issues `POST https://ads.spfy-net.com/v1/ads` with `credentials: 'include'`.
2. Request body: `{ property_id, placement, page: { url, referrer }, wallets: [...detected], sdk: { name, version } }`. The `spid` cookie travels in headers; the response refreshes it.
3. The ad server resolves targeting in order: (a) wallets observed in-request, (b) graph lookup `spid → wallet(s)`, (c) contextual fallback. The response indicates which tier served, for internal analytics only — never exposed to the page.
4. Creative markup is returned and rendered inside a sandboxed iframe served from the edge domain (this iframe request is itself a credentialed request, guaranteeing cookie set/refresh even if `fetch` metadata is stripped by an extension).
5. Click-through URLs are minted server-side with `spclid` embedded, pointing at the redirect endpoint `https://ads.spfy-net.com/c/{spclid}` → 302 to the advertiser landing URL with `?spclid=` appended. Server-side redirect guarantees click logging even without the Advertiser SDK on the other end.

### 4.3 Wallet capture on publishers

Wallet observations ride on ad requests and on a lightweight `POST /v1/events` beacon fired when `accountsChanged` occurs after the ad request. Publishers with wallet UX are the highest-value graph seeders; the integration docs should encourage (not require) `setWalletAddresses()` for publishers using WalletConnect-style flows.

---

## 5. Advertiser SDK (`@specify/advertiser`, new)

### 5.1 Positioning

Optional and additive. Default conversion tracking (onchain observation, scoped per the advertiser's agreed methodology) works with zero integration. The Advertiser SDK exists for advertisers who want: off-chain funnel events (page views, signups, quest completions, Discord clicks); wallet identification on their own property (feeding both their funnel analytics and the network graph); and stronger retargeting of their users across Specify's network.

Because installation is itself the opt-in to advanced tracking, the SDK tracks all sessions on the pages where it is loaded. There is no click-gating flag; advertisers who want to restrict tracking to consented users do so by conditioning the SDK load on their CMP (§9).

### 5.2 Distribution

Two equivalent routes:

- **npm**: `@specify/advertiser` for SPAs and modern stacks (typed, tree-shakeable).
- **CDN loader snippet** for CMS/GTM installs — gtag-style stub that queues calls made before the async script loads:

```html
<script>
  (function (w, d, src) {
    w.SpecifyAnalytics = w.SpecifyAnalytics || {
      _q: [],
      logEvent: function () { w.SpecifyAnalytics._q.push(['logEvent', arguments]); },
      setWalletAddresses: function () { w.SpecifyAnalytics._q.push(['setWalletAddresses', arguments]); },
    };
    var s = d.createElement('script'); s.async = true; s.src = src;
    d.head.appendChild(s);
  })(window, document, 'https://cdn.spfy-net.com/advertiser/v1.js?pid=adv_xxxxxxxx');
</script>
```

The loaded script drains `_q`, runs `/v1/sync`, captures `spclid` from the URL, and starts automatic events. A GTM community template wrapping this snippet ships at launch (Addressable demonstrated this materially lowers integration friction).

### 5.3 API surface

```ts
import { SpecifyAnalytics } from '@specify/advertiser';

const analytics = SpecifyAnalytics.init({
  propertyId: 'adv_xxxxxxxx',
  environment: 'production',
  privacy: {
    disableWalletDetection: false,  // default: automatic EIP-6963/1193 detection on
  },
});

analytics.logEvent('signup_completed');                       // custom funnel event
analytics.logEvent('quest_completed', { quest: 'genesis' });  // with properties (flat JSON, ≤2KB)
analytics.setWalletAddresses(['0xabc…']);                     // explicit, for WalletConnect flows
```

**Network participation.** There is deliberately no per-client "keep my data out of the network" flag in v1. The reason is structural, not commercial: the SDK's headline features — impression-to-visit matching for anonymous visitors, view-through funnel reporting, cross-network retargeting of lapsed users — all *consist of* the cross-site join between publisher-side exposure and advertiser-side sessions. A mode that severed the `spid` linkage (e.g. uncredentialed transport) would silently disable those same features for the advertiser's own analytics; the privacy trade and the product are the same data. Installing the Advertiser SDK therefore constitutes participation in the identity layer, and the documentation states this in plain language. Two safeguards preserve future flexibility: every graph edge records its originating `property_id` (§3.5), so per-account scoping of targeting resolution can be introduced later as a query-time filter without a schema migration; and participation terms for strategic accounts are handled explicitly in the insertion order rather than implied by a default.

### 5.4 Automatic events

`page_view` (initial load + SPA route changes via History API hooks), `wallet_detected`, `wallet_changed`. Everything else is explicit via `logEvent`. Event names for conversions the advertiser wants billed against must be pre-registered in the dashboard so the billing pipeline only ever consumes a declared allowlist — arbitrary `logEvent` strings can never create billable events.

### 5.5 Event transport

`POST https://in.spfy-net.com/v1/events`, `credentials: 'include'`, batched (flush at 10 events / 5s / page-hide via `sendBeacon`-style `fetch keepalive`). Payload:

```json
{
  "property_id": "adv_xxxxxxxx",
  "events": [{
    "name": "signup_completed",
    "ts": "2026-07-06T14:03:22.011Z",
    "session_id": "uuid-v7",
    "spclid": "…or null",
    "wallets": ["0xabc…"],
    "page": { "url": "https://…", "referrer": "https://…" },
    "props": { }
  }],
  "sdk": { "name": "advertiser", "version": "1.0.0" }
}
```

Server enriches with IP and user agent for fraud/spam filtering (retained per §9.3). The `spid` never appears in payloads — it is only ever the cookie.

---

## 6. Attribution & billing

The billing pipeline is unchanged in principle: **only deterministic joins produce invoices.**

1. **Onchain conversions (default, zero-integration).** Chain indexers watch the advertiser's scoped contracts/methods (per agreed methodology — e.g. UI-originated only). A conversion attributes when the acting wallet has a deterministic edge to a `spclid` (click) within the attribution window, or was directly observed at click time on the publisher.
2. **Off-chain conversions (requires Advertiser SDK).** Pre-registered events carrying a valid `spclid` attribute last-click. Events without `spclid` are analytics-only.
3. **View-through** is reported separately, wallet-anchored only (wallet saw impression on publisher; same wallet converted onchain), clearly labelled, and excluded from CPA invoices unless the insertion order explicitly includes it.

The identity graph is deliberately absent from this list: `spid`-inferred matches inform *targeting* and *audience reach reporting*, never billing. This split is the firewall that protects measurement credibility.

**Retargeting audiences.** The audience builder composes segments from an advertiser's own data (site visitors, wallet-connected-no-convert, event sequences) and, where the campaign buys it, network signals (onchain behaviour of matched wallets). Serving resolves at ad-request time via `spid → wallet → audience` or direct wallet observation. Audience membership counts shown in the dashboard are labelled as reachable-browser estimates, not unique humans.

---

## 7. Browser & environment matrix

| Capability | Chrome/Edge (default) | Safari | Firefox | Brave |
|---|---|---|---|---|
| `spid` third-party cookie | ✅ | ❌ (ITP) | ❌ (ETP) | ❌ |
| `spclid` first-party persistence | ✅ | ⚠️ 7-day script-writable cookie cap; server-assisted cookie recommended | ✅ | ✅ |
| Wallet detection (EIP-6963) | ✅ | ✅ | ✅ | ✅ |
| Onchain attribution | ✅ | ✅ | ✅ | ✅ |
| Net effect | Full graph | Click + wallet only | Click + wallet only | Click + wallet only |

Ad blockers will eventually list the edge domain; the sandboxed-iframe ad path degrades to no-fill, and analytics silently no-op. Do not implement blocker circumvention — it burns publisher trust and violates several jurisdictions' expectations.

---

## 8. Security

`spclid` values are HMAC-signed; forged or replayed click IDs are rejected at ingest and flagged to fraud review (protects CPA billing from conversion injection). Event ingest rate-limits per property and per IP. The graph datastore is access-controlled and edges are append-only with audit logging — this dataset (wallet ↔ browsing context) is the most sensitive asset the company holds and should be treated with production-secrets-level access discipline. Wallet addresses are stored as-is (they are pseudonymous public data, but personal data under GDPR — see §9); IP addresses are never stored joined to wallet edges, only in the short-retention fraud store.

---

## 9. Privacy & consent

### 9.1 Model

Consent collection is the **integrator's responsibility** (publisher or advertiser), matching prevailing practice in web3 adtech. Contracts (publisher terms, insertion orders) and the SDK docs require integrators to obtain any consents needed under applicable law (GDPR/ePrivacy, CCPA, etc.) before loading the SDK, and to condition SDK load on consent where required. The documented pattern:

```js
cmp.onConsent(['analytics', 'advertising'], () => loadSpecifySdk());
```

### 9.2 What Specify's own docs must disclose

Plain-language documentation of: what is collected (events, page URL/referrer, user agent, IP for fraud, detected wallet addresses); the existence and purpose of the cross-site identifier; the fact that installing the Advertiser SDK entails participation in the cross-site identity layer (and why this is inseparable from view-through/funnel features); the `disableWalletDetection` flag; retention periods; and a contact for data requests. Wallet addresses are treated as personal data for GDPR purposes (this is the conservative and correct reading for an EU-established controller). A DPIA covering the identity graph should be completed before GA — as an Estonian OÜ, TICC is squarely in scope, and this dataset is exactly the kind a DPA would examine.

### 9.3 Retention defaults

Graph edges: 180-day activity decay, hard delete at 13 months unrefreshed. Raw events: 25 months. Fraud store (IP/UA joined to requests): 30 days. Wallet deletion requests: edge removal within 30 days, propagated to audiences at next rebuild.

### 9.4 TCF

No IAB TCF vendor registration in v1 (cost/effort disproportionate at current scale), revisit if publishers running mainstream CMPs join the network — their CMPs will want Specify in the vendor list.

---

## 10. Rollout plan

**Phase 1 — Identity foundation.** Stand up the edge domain, `/v1/sync`, cookie issuance, and graph store. Publisher SDK v2 ships credentialed ad requests + wallet capture. No behaviour change visible to publishers beyond a version bump.

**Phase 2 — Advertiser SDK beta.** npm + CDN loader, funnel events, wallet detection, `spclid` capture. Recruit 2–3 design partners; CoW is the obvious candidate *after* the network-data clause is agreed with Ravi — since there is no code-level opt-out, the IO language and a walkthrough of §5.3's participation model on the integration call are the mechanism for informed agreement.

**Phase 3 — Graph-targeted serving.** Ad server consumes `spid → wallet` resolution; launch the "reach known wallets on non-wallet inventory" pitch to expand publisher acquisition beyond crypto-native sites. Retargeting audiences GA.

Success metrics: % of ad requests carrying a resolvable `spid`; wallet-match rate on non-wallet publishers (target: double-digit % on Chrome traffic); graph size (unique wallets with ≥1 live edge); advertiser SDK adoption among top-10 accounts.

---

## 11. Open questions

1. **Edge domain choice** — needs to be neutral (not obviously "specify") for blocker longevity vs. transparent for privacy-disclosure credibility. Recommend transparent (`specifynetwork.com` or similar): the trust cost of a disguised domain outweighs a few extra months off filter lists.
2. **Safari `spclid` hardening** — worth the server-assisted first-party cookie (advertiser CNAMEs a subdomain to Specify) for big accounts? Adds integration friction; defer until data shows Safari click-loss matters.
3. **Solana (v2)** — Wallet Standard (`window.navigator.wallets`) detection is a straightforward addition to `@specify/core/wallet`; the graph schema already treats wallet as `{chain_namespace, address}` (CAIP-10) to make this a non-breaking change. Confirm CAIP-10 keying in Phase 1 even though only `eip155` populates it.
4. **Per-account graph scoping (deferred)** — v1 has no opt-out because severing the cross-site join also severs the advertiser's own view-through/funnel features (§5.3). If a strategic account demands scoping anyway, the `property_id` tag on every edge allows a query-time policy ("edges from property X resolve only for property X's campaigns") without schema changes. Decide then whether participation becomes an explicit priced IO term (retargeting-for-data trade, Addressable-style).
5. **Maru** — the extension is a first-party owned wallet↔browser identity source; decide whether/when its data feeds the same graph, and what its own privacy policy must say before it does.

