# Mux Frontend

Mux Protocol provides invisible wallets and account abstraction on Stellar/Soroban.
This repository contains the Mux frontend.

## Source maps production policy

Source maps are a **development-only** affordance. Shipping readable source maps
to production would expose internal module structure, comments, and any
accidentally-inlined values to anyone who opens devtools — an information
disclosure risk on a wallet/AA surface. The policy is therefore **fail-closed**:
production builds never emit browser source maps.

- **Production (`NODE_ENV=production`):** browser source maps are **disabled**.
  `next.config.ts` sets `productionBrowserSourceMaps: false`, so no `.map` files
  are emitted and devtools cannot reconstruct the original sources.
- **Development / test:** source maps are **enabled** (Next.js default) so
  contributors get readable stack traces and can debug locally.
- **Fail-closed:** the setting is pinned to `false` in the config rather than
  left to an environment variable, so a misconfigured deploy cannot silently
  turn production source maps back on. Any future change to this setting must
  update the policy here and the gating test below.

This policy is enforced by an automated test (`tests/ci-workflow.test.ts`) that
asserts `productionBrowserSourceMaps` is `false`, so the guarantee cannot
regress unnoticed. See [`docs/security-ux-guards.md`](docs/security-ux-guards.md)
for the broader security/UX invariants and `tests/e2e/` for end-to-end coverage.

## Settings danger zone confirm phrase

The Settings **danger zone** (account deletion, key rotation, recovery reset,
and other irreversible actions) is gated behind a typed **confirm-phrase guard**.
Destructive actions stay disabled until the operator types the exact phrase, and
the guard is **fail-closed**: empty, mismatched, or adversarial input never
unlocks the action.

- **Typed guard**: the danger zone uses a typed confirm-phrase guard that takes
the expected phrase and the current input and returns a discriminated result
  (`ok` / `mismatch` / `empty` / `locked`). Callers cannot invoke the destructive
  handler directly — the handler is only reachable through the guard, so there
  is no bypass path.
- **Normalization rule**: input is compared after trimming leading/trailing
  whitespace and collapsing internal whitespace runs to a single space. The
  comparison is **case-sensitive** — the phrase must match exactly after
  whitespace normalization. This is the documented rule; do not loosen it.
- **Stable state codes**: the guard returns stable, actionable codes so the UI
  can render precise messages and correlate failures:
  - `CONFIRM_PHRASE_EMPTY` — no phrase entered; action stays disabled.
  - `CONFIRM_PHRASE_MISMATCH` — phrase does not match; action stays disabled.
  - `CONFIRM_PHRASE_LOCKED` — the danger zone is locked (e.g. after a failed
    attempt or while a prior destructive action is in flight); action stays
    disabled until the lock clears.
- **Fail-closed**: on any non-`ok` result the destructive action remains
  disabled and the handler is never called. Oversized input is rejected rather
  than truncated, and the confirm step is idempotent — re-submitting the same
  confirmed action does not re-run the destructive handler.
- **No secrets**: the guard never logs or renders raw key material, JWTs, or
  secrets; only the stable state code and a correlation id are surfaced.

See [`docs/security-ux-guards.md`](docs/security-ux-guards.md) for the
security/UX invariants and `tests/e2e/` for the end-to-end coverage of the
danger-zone flow.

## Empty project CTA

When a user has no wallets/projects yet, the app renders an **empty project
CTA** instead of a blank or broken dashboard. The CTA is the single, typed
entrypoint for the empty state and is deliberately **deny-by-default**: it only
offers the non-privileged "create your first wallet" action and never exposes
admin, recovery, or spend surfaces.

- **Typed entrypoint**: the empty state is rendered by a typed component that
  takes an explicit `onCreate` callback and an optional `error` prop. Callers
  cannot render the CTA without wiring the primary action, so the empty state
  can never silently dead-end.
- **Stable, accessible copy**: the heading, description, and primary button use
  fixed copy with an associated `<h2>`/`<button>` relationship and a visible
  focus indicator, so the CTA is announced correctly by assistive technology
  and is fully keyboard-operable.
- **Fail-closed**: if the create action fails, the CTA surfaces an actionable
  error (with a stable error code) and keeps the primary action available for
  retry — it never reports success or navigates on failure. No secrets, keys,
  or JWTs are ever placed in the CTA copy, props, or logs.
- **Deny-by-default**: the CTA does not render privileged actions (spending
  limits, recovery, delegate management). Those remain gated behind their own
  authorized surfaces.

See [`docs/security-ux-guards.md`](docs/security-ux-guards.md) for the
security/UX invariants and `tests/e2e/` for the end-to-end coverage of the
empty-state flow.

## Receive QR + network badge

The wallet receive view renders a scannable QR that encodes the wallet's
Stellar/Soroban receive address, together with an unambiguous network badge
(`testnet` vs `mainnet`).

- **QR payload**: the receive address is encoded using the standard Stellar URI
  scheme (`web+stellar:pay?destination=<address>`), so any Stellar-compatible
  wallet can scan and pre-fill the destination. The raw address is also shown as
  text for manual copy.
- **Network badge**: the badge is derived from configuration, never hard-coded.
  The network is resolved from `NEXT_PUBLIC_STELLAR_NETWORK` (falling back to the
  app's configured network).
- **Fail-closed**: if the network is unknown or misconfigured, the receive view
  refuses to render a QR/badge and surfaces an actionable error instead of
  silently defaulting to mainnet. This prevents a user from sending funds to the
  wrong network.

See [`docs/security-ux-guards.md`](docs/security-ux-guards.md) for the
security/UX invariants that back this behavior, and `tests/e2e/` for the
end-to-end coverage of the receive flow.

## Copy address clipboard UX

Copying a wallet address must be reliable and fail-closed: the UI never reports
success unless the address actually reached the clipboard.

- Use the shared `useCopyAddress` hook (or `copyAddress` helper) instead of
  calling `navigator.clipboard` directly. It returns a typed result with stable
error codes so callers can render actionable messages and correlate failures.
- Stable error codes:
  - `CLIPBOARD_UNAVAILABLE` — the Clipboard API is missing (insecure context,
    unsupported browser, or blocked by policy).
  - `CLIPBOARD_PERMISSION_DENIED` — the user or browser denied clipboard write.
  - `CLIPBOARD_WRITE_FAILED` — the write was attempted but rejected/failed.
- On any failure the UI must surface the error and offer a manual-copy fallback
  (a selectable, read-only address field) rather than silently succeeding.
- Never log or emit raw address/key material to telemetry; redact addresses in
  logs and metrics.

See `docs/security-ux-guards.md` for the broader security/UX guardrails.

## Spending limits accessibility

The spending-limits controls are fully operable with assistive technology and
the keyboard:

- **Labels & descriptions**: every limit input, toggle, and action button has an
  associated `<label>` (via `htmlFor`/`id`) and help text wired through
  `aria-describedby`, so screen readers announce the control's purpose and the
  current value.
- **Validation state**: inline errors are exposed with `role="alert"` and
  `aria-invalid` on the offending field, so validation failures are announced
  immediately.
- **Dynamic updates**: saving a limit, a validation error, and loading states are
  announced through polite/assertive live regions (`aria-live`), without ever
  echoing secrets or raw key material.
- **Keyboard & focus**: all controls are reachable in a logical tab order with a
  visible focus indicator; no action depends on pointer-only interaction.

See [`docs/security-ux-guards.md`](docs/security-ux-guards.md) for the
security/UX invariants and `tests/e2e/` for the accessibility coverage of the
spending-limits surface.

## Development

```bash
npm install
npm run dev
```

### Git hooks (Husky)

This repo uses [Husky](https://typicode.github.io/husky/) to run a
pre-commit check. The hook is **clone-safe and CI-safe**: it is a no-op
whenever Husky is not installed (fresh clones, CI runners, tarball
checkouts), and only enforces locally for contributors who have run
`pnpm install` (which triggers the `prepare` script and installs the
hooks).

* **Contributors with Husky installed:** the pre-commit hook runs
  automatically on `git commit`; fix any reported issues before
  committing.
* **Fresh clones / CI:** if Husky is absent, the hook exits successfully
  instead of failing the commit or the pipeline. No install step is
  required for CI to stay green.

If you ever need to bypass the hook for a single commit, use
`git commit --no-verify` (use sparingly).

### Environment variables

All variables are optional in local development — sensible mock/default
behavior kicks in when they're unset (see `src/lib/env.ts` for the
validation schema). Copy `.env.example` to `.env.local` and fill in real
values for testnet/mainnet-connected work.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | No | _(none)_ | Base URL for the Mux backend API used by client-side requests, e.g. `https://api.muxprotocol.com` for mainnet or a testnet-specific URL. When unset, API routes such as `/api/auth/login` and `/api/wallets` fall back to an in-repo mock so `pnpm run dev` and CI work without a live backend — but only when `NODE_ENV` is not `production` (see the production note below). **Set this in new deploys; use the aliases below only for backward compatibility.** An alias set to an empty string (e.g. `NEX

/* … truncated 1540 chars — edit only what you need near the top … */
