# Security & UX Guards

This document describes the security and UX guardrails enforced across the Mux
frontend. It is the canonical reference for contributors working on privileged
surfaces (wallets, account abstraction, payments, activity feeds, notification
preferences).

## Principles

- **Server/contract is the source of truth.** The frontend never decides spends,
  recovery, or admin actions on its own; it only reflects and requests them.
- **Deny by default.** New privileged surfaces must explicitly authorize every
  caller before returning data or performing a write.
- **Fail closed on writes.** If a dependency (RPC, DB, Horizon) is unavailable,
  write paths must reject rather than silently succeed.
- **No secrets in the repo or logs.** Redact keys, JWTs, and webhook secrets.

## Source maps production policy

Source maps expose original source, internal module structure, and any inlined
values to anyone who can fetch the deployed bundle. Shipping readable source
maps to production is a security and IP risk, so the policy is **fail closed**.

### Policy

- **Production: source maps are disabled.** Production builds must never emit
  or serve browser source maps. `productionBrowserSourceMaps` is `false` in
  `next.config.ts` and must stay `false`.
- **Development / test: source maps are enabled.** Local dev and test builds
  keep source maps for debuggability; this is not a production surface.
- **No public exposure.** Even when maps exist in non-production, they must not
  be uploaded to a public CDN or served from a production origin.

### Enforcement

- The setting lives in `next.config.ts` as `productionBrowserSourceMaps: false`.
  It is the single source of truth for the production policy.
- A CI test asserts the production setting is disabled so the policy cannot
  regress silently. Any change that re-enables production source maps must fail
  CI and require an explicit, reviewed policy change.
- If a future need requires production maps (e.g. private error tracking), they
  must be uploaded to a private, access-controlled store and never served from
  the public origin. That change requires a design note and a feature flag.

### Edge cases and failure modes

- **Misconfigured environment:** if an environment cannot be classified as
  production, treat it as production and keep source maps disabled.
- **Accidental upload:** build steps must not publish maps to public storage;
  treat any such upload as a security incident and rotate/remove the artifact.
- **Testnet vs mainnet:** both are production-like for this policy; neither
  ships readable source maps.

### Observability

- CI reports the resolved `productionBrowserSourceMaps` value so reviewers can
  confirm the policy at a glance. No secrets or source content are logged.

### Rollback

- Re-enabling production source maps is a policy change, not a routine edit. It
  requires a design note, a private upload target, and a documented rollback in
  the PR description.

## Wallet detail deep links

Wallet detail views are addressable via deep links so that support, ops, and
partner surfaces can hand a user a stable URL to a specific wallet. Deep links
are a privileged surface: they resolve a wallet identifier to wallet detail and
must not become a policy bypass.

### Route contract

- Canonical route: `/wallets/:walletId` (wallet detail).
- The route accepts an optional `?network=` query parameter. Only `testnet` and
  `mainnet` are valid values; any other value is rejected and the link fails
  closed to the default network for the session.
- Unknown or malformed `walletId` values render the wallet-not-found state; they
  must never fall back to a different wallet or to a list view.

### Typed entrypoints and error codes

Deep-link resolution is exposed through a typed entrypoint that returns a
discriminated result. Callers must branch on the error code rather than on
message text. Stable error codes:

| Code | Meaning |
| --- | --- |
| `WALLET_NOT_FOUND` | No wallet matches the identifier. |
| `WALLET_FORBIDDEN` | Caller is not authorized for this wallet. |
| `WALLET_AUTH_EXPIRED` | Session/JWT expired; re-auth required. |
| `WALLET_NETWORK_MISMATCH` | Requested network does not match the wallet. |
| `WALLET_DEPENDENCY_UNAVAILABLE` | Upstream RPC/Horizon/DB unavailable. |
| `WALLET_INVALID_INPUT` | Malformed identifier or query parameters. |

Every resolution carries a correlation id that is propagated to logs and to the
user-facing error surface so support can trace a single deep-link attempt.

### Authorization

- Deny by default. A deep link does not grant access; it only identifies the
  wallet to resolve.
- The server remains the source of truth for ownership, delegation, and
  guardian relationships. The client must not infer access from the URL.
- Owner, delegate, and guardian roles are evaluated server-side. Revoked
  delegates and expired sessions must fail closed with `WALLET_FORBIDDEN` or
  `WALLET_AUTH_EXPIRED` respectively.
- API-key/JWT callers are subject to the same policy as interactive users; a
  valid token is not sufficient on its own.

### Edge cases and failure modes

- **Replay / concurrency:** resolution is read-only and idempotent. Repeated or
  concurrent deep-link opens for the same wallet must produce the same result
  and must not trigger writes.
- **Dependency outage:** if RPC/Horizon/DB is unavailable, reads fail closed
  with `WALLET_DEPENDENCY_UNAVAILABLE`. No write path may proceed on a degraded
  dependency.
- **Auth expiry / wrong role / revoked delegate:** surface the specific error
  code and prompt re-auth; never silently downgrade to a less privileged view.
- **Adversarial input:** oversized or malformed identifiers are rejected with
  `WALLET_INVALID_INPUT` before any upstream call. Rate-limit deep-link
  resolution per session and per IP.
- **Testnet vs mainnet misconfig:** a network mismatch is an error, not a
  silent switch. Never resolve a mainnet wallet under a testnet session or vice
  versa.

### Observability

- Emit structured logs with the correlation id, the resolved error code, and
  the network. Do not log raw key material, JWTs, webhook secrets, or full
  wallet secrets.
- Redact identifiers in logs where they could be used to correlate a user
  across surfaces.
- Track resolution success/failure counts and latency so ops can alert on
  dependency outages and auth failures.

### Rollout and rollback

- Deep-link resolution changes that touch money paths or mainnet behavior must
  land behind a feature flag or kill-switch.
- Document the rollback path in the PR description: disabling the flag must
  restore the previous resolution behavior without data migration.

## Activity feed pagination

The activity feed is a privileged read surface: it exposes wallet, payment, and
account-abstraction history. Pagination must be cursor-based and authorized.

### Request contract

- `limit` — integer, `1..100` (default `25`). Values outside the range are
  rejected with `ACTIVITY_INVALID_LIMIT`; oversized batches are never silently
  truncated.
- `cursor` — opaque, server-issued token. Clients must treat it as opaque and
  must not construct or mutate it. Malformed cursors are rejected with
  `ACTIVITY_INVALID_CURSOR`.

### Response contract

- `items` — array of activity entries for the requested page.
- `nextCursor` — opaque token for the next page, or `null` when exhausted.
- `hasMore` — boolean mirror of `nextCursor !== null`.

Cursors are stable and monotonic: a cursor issued for a page continues to
resolve to the same position even as new activity is appended, so clients never
skip or duplicate entries across concurrent requests.

### Authorization

Every activity feed request is authorized before any data is read. The caller
must present a valid session (JWT) and hold one of the following roles for the
requested account:

- **owner** — full access to their own activity.
- **delegate** — access only while the delegation is active and not revoked.
- **guardian** — access only for accounts they guard.
- **API key** — scoped to the accounts and actions granted to the key.

Requests with an expired session, wrong role, or revoked delegate are rejected
with `ACTIVITY_UNAUTHORIZED` (deny by default). Authorization is re-evaluated on
every page request; a cursor does not carry or extend authorization.

### Error codes

| Code | Meaning |
| --- | --- |
| `ACTIVITY_INVALID_LIMIT` | `limit` missing, non-integer, or out of range. |
| `ACTIVITY_INVALID_CURSOR` | Cursor malformed, tampered, or expired. |
| `ACTIVITY_UNAUTHORIZED` | Missing/expired session, wrong role, or revoked delegate. |
| `ACTIVITY_DEPENDENCY_UNAVAILABLE` | Upstream RPC/DB/Horizon outage; fail closed. |

Errors are actionable and never include raw key material, JWTs, or webhook
secrets. Each response carries a correlation id for support and tracing.

### Idempotency & concurrency

- Read requests are safe to retry; a repeated request with the same cursor
  returns the same page.
- Concurrent requests with the same cursor do not advance shared state.
- Writes triggered from the feed (e.g. retry/claim actions) require an
  idempotency key and are rejected on replay.

### Observability

- Emit metrics for request count, latency, and error code on the activity feed
  path.
- Log correlation ids and error codes only; never log cursors, tokens, keys, or
  full request bodies.

### Environment safety

- Testnet and mainnet configurations are distinct; a mainnet-affecting change to
  the feed must be gated behind a feature flag or kill-switch with a documented
  rollback.
- Misconfigured environments fail closed rather than serving cross-environment
  data.

## Notification preferences

The notification preferences page is a privileged surface: it reads and writes
per-account delivery settings (channels and event subscriptions). Reads and
writes must be authorized and fail closed.

### Request contract

- `channels` — object keyed by channel (`email`, `push`, `webhook`), each with a
  boolean `enabled` flag. Unknown channels are rejected with
  `NOTIFICATIONS_INVALID_CHANNEL`.
- `events` — object keyed by event type (e.g. `payment.re

/* … truncated 10224 chars — edit only what you need near the top … */
