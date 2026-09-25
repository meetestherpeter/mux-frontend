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

## Audit log filters

The audit log is a privileged, read-only surface that exposes who did what, to
which resource, and when. Filters narrow that view; they must never widen
access. Filtering is **deny by default**: a caller only sees audit entries they
are authorized to read, and filters can only further restrict that set.

### Filter contract

- Filters are expressed as a typed, validated object (actor, action, resource,
  outcome, time range, network). Unknown filter keys are rejected, not ignored.
- The time range is a half-open interval `[from, to)`; `from` must be `<=` `to`.
  An inverted or malformed range fails closed to an empty result, never to the
  full log.
- Pagination is cursor-based and stable: the cursor encodes the last-seen sort
  key so concurrent inserts cannot cause skipped or duplicated rows.
- The active filter set is echoed back with the result so callers and support
  can confirm exactly what was applied.

### Typed entrypoints and error codes

Audit log queries are exposed through a typed entrypoint that returns a
discriminated result. Callers must branch on the error code rather than on
message text. Stable error codes:

| Code | Meaning |
| --- | --- |
| `AUDIT_OK` | Query succeeded; results (possibly empty) returned. |
| `AUDIT_FORBIDDEN` | Caller is not authorized to read the requested scope. |
| `AUDIT_AUTH_EXPIRED` | Session/JWT expired; re-auth required. |
| `AUDIT_INVALID_FILTER` | Filter failed validation (unknown key, bad range). |
| `AUDIT_RANGE_TOO_LARGE` | Requested time range exceeds the maximum window. |
| `AUDIT_DEPENDENCY_UNAVAILABLE` | Upstream DB/index unavailable; fail closed. |
| `AUDIT_RATE_LIMITED` | Too many queries; retry later. |

Every query carries a correlation id propagated to logs and the user-facing
error surface so support can trace a single request.

### Authorization

- Reads require an authorized owner/delegate/guardian session or a scoped
  API-key/JWT. The server resolves the caller's permitted scope; the client
  cannot request a broader scope than it holds.
- A revoked delegate or expired session fails closed with `AUDIT_AUTH_EXPIRED`
  or `AUDIT_FORBIDDEN`; filters never substitute for authorization.
- Deny by default: a new filter dimension is unreadable until the server grants
  it, so adding a filter cannot leak a previously hidden field.

### Idempotency and fail-closed behavior

- Reads are idempotent and safe to retry; the cursor makes replays return the
  same page rather than duplicating or skipping entries.
- If the DB/index is unavailable, the query fails closed with
  `AUDIT_DEPENDENCY_UNAVAILABLE`; it never returns a partial or stale-success
  result that could hide activity.
- Export/write paths derived from a filtered view (for example CSV export) must
  re-validate the filter and authorization server-side before producing output.

### Edge cases and failure modes

- **Concurrent/replayed requests:** cursor-based pagination plus idempotent
  reads keep concurrent queries consistent; replayed requests return the same
  page.
- **Dependency outage:** DB/index outage fails closed; no silent empty-success
  that could mask missing entries.
- **Auth expiry / wrong role / revoked delegate:** fail closed and prompt
  re-auth; the filter set is never used to escalate scope.
- **Adversarial input:** oversized filter payloads, unknown keys, and inverted
  ranges are rejected before querying; queries are rate-limited per session and
  per IP to prevent griefing.
- **Testnet vs mainnet:** the `network` filter is explicit and validated; a
  mainnet query is never satisfied by testnet data and vice versa.

### Observability

- Emit structured logs with the correlation id, the resolved error code, and
  the applied filter dimensions (never raw key material, JWTs, or webhook
  secrets).
- Track query success/failure counts, rate-limit events, and rejected-filter
  counts so ops can alert on abuse or misconfiguration.

### Rollout and rollback

- Changes to audit log filtering that touch money paths or mainnet behavior
  must land behind a feature flag or kill-switch.
- Document the rollback path in the PR description: disabling the flag must
  restore the previous behavior without data migration.

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
| `WAL