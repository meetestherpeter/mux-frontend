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

## Settings danger zone confirm phrase

The Settings danger zone hosts destructive, irreversible actions (for example
account/wallet deletion and recovery reset). These actions are gated behind a
typed confirm-phrase guard so a stray click or a scripted request cannot trigger
them. The guard is **fail closed**: the destructive action stays disabled until
the exact phrase is entered.

### Confirm phrase contract

- The required phrase is a fixed, documented constant (for example
  `DELETE MY ACCOUNT`). It is never derived from user input or remote config.
- Matching is **case-insensitive** and **whitespace-normalized**: leading and
trailing whitespace is trimmed and internal runs of whitespace collapse to a
single space before comparison. No other normalization (no unicode folding, no
punctuation stripping) is applied.
- The guard exposes a typed entrypoint that returns a discriminated result.
  Callers must branch on the state code, never on message text.

### Typed states and error codes

| Code | Meaning |
| --- | --- |
| `DANGER_CONFIRM_OK` | Phrase matches; the destructive action may proceed. |
| `DANGER_CONFIRM_EMPTY` | Input is empty or whitespace-only. |
| `DANGER_CONFIRM_MISMATCH` | Input does not match the required phrase. |
| `DANGER_CONFIRM_TOO_LONG` | Input exceeds the maximum accepted length. |
| `DANGER_CONFIRM_LOCKED` | Guard is locked (in-flight or rate-limited); retry later. |

Every evaluation carries a correlation id propagated to logs and the
user-facing error surface so support can trace a single attempt.

### Fail-closed behavior

- The destructive action is **disabled** unless the guard returns
  `DANGER_CONFIRM_OK`. Empty, mismatched, oversized, or locked input keeps it
  disabled.
- The guard is the only path to the destructive handler. The handler must
  re-validate the confirm result server-side; a client cannot bypass policy by
  invoking the handler directly.
- Inputs longer than the maximum accepted length are rejected with
  `DANGER_CONFIRM_TOO_LONG` before any comparison, so adversarial oversized
  input cannot be used to grief the surface.

### Edge cases and failure modes

- **Replay / concurrency:** confirmation is single-use. Once a destructive
  action is confirmed it is consumed; replayed or concurrent confirmations for
  the same action fail closed with `DANGER_CONFIRM_LOCKED` and must not trigger
  a second write.
- **Dependency outage:** if the server cannot validate the confirmation, the
  action fails closed; the client never proceeds on a degraded dependency.
- **Auth expiry / wrong role / revoked delegate:** the destructive action
  requires an authorized owner session. Expired sessions or revoked delegates
  fail closed and prompt re-auth; the confirm phrase never substitutes for
  authorization.
- **Adversarial input:** oversized or malformed input is rejected before
  comparison; rate-limit confirmation attempts per session and per IP.
- **Testnet vs mainnet:** the guard applies identically on both; a mainnet
  destructive action is never unlocked by a testnet confirmation.

### Observability

- Emit structured logs with the correlation id, the resolved state code, and
  the action identifier. Never log the entered phrase, raw key material, JWTs,
  or webhook secrets.
- Track confirmation success/failure counts and lock events so ops can alert on
  abuse or repeated mismatches.

### Rollout and rollback

- Changes to the danger-zone guard that touch money paths or mainnet behavior
  must land behind a feature flag or kill-switch.
- Document the rollback path in the PR description: disabling the flag must
  restore the previous behavior without data migration.

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
- **delegate** — access only while the delegation is active and
