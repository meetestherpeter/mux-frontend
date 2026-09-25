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
| `NEXT_PUBLIC_API_URL` | No | _(none)_ | Base URL for the Mux backend API used by client-side requests, e.g. `https://api.muxprotocol.com` for mainnet or a testnet-specific URL. When unset, API routes such as `/api/auth/login` and `/api/wallets` fall back to an in-repo mock so `pnpm run dev` and CI work without a live backend — but only when `NODE_ENV` is not `production` (see the production note below). **Set this in new deploys; use the aliases below only for backward compatibility.** An alias set to an empty string (e.g. `NEXT_PUBLIC_API_URL=`) is treated as unset and the next alias in the chain is tried (see `API_URL_CANDIDATES` in `src/lib/api/config.ts`). |
| `NEXT_PUBLIC_MUX_API_URL` | No | `https://api.muxprotocol.com` | Legacy alias for the API base URL, checked after `NEXT_PUBLIC_API_URL` (see `src/lib/api/config.ts`). Kept for backward compatibility with older deploys. |
| `NEXT_PUBLIC_API_BASE` | No | _(none)_ | Third fallback in the API base URL resolution chain, checked after the two vars above. |
| `NEXT_PUBLIC_APP_URL` | No | `http://localhost:3000` | Public-facing URL of this application, used for building absolute links (e.g. callback URLs). |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | No | _(none)_ | WalletConnect project ID, needed only if wallet-connect based flows are enabled. |
| `MUX_API_KEY` | No | _(none)_ | Server-only Mux Protocol API key. Used exclusively by Next.js API routes (`src/app/api/**`) to authenticate upstream requests to the backend. Never exposed to the browser — do not prefix it with `NEXT_PUBLIC_`. |
| `MUX_API_SECRET` | No | _(none)_ | Server-only Mux Protocol API secret, paired with `MUX_API_KEY` and sent alongside it on every upstream request. |
| `MUX_BACKEND_URL` | No | _(none)_ | Server-only base URL of `mux-backend`. Used by `/api/spending-limits` to proxy `GET`/`PUT` (spending limits and the real `todayUsage`). When unset the route returns `503` rather than fabricating usage — the frontend never persists spending limits itself (see `getBackendApiBaseUrl()` in `src/lib/api/config.ts`). |

There is no client-visible Mux API key. Project credentials only ever
live in `MUX_API_KEY`/`MUX_API_SECRET` and are attached server-side, in
Next.js API routes, to requests made to the backend — the browser talks
only to this app's own same-origin `/api/*` routes and never holds a Mux
credential.

**API URL alias chain (invariant).** The client resolves the backend base
URL from a fixed, ordered alias chain — `NEXT_PUBLIC_API_URL` →
`NEXT_PUBLIC_MUX_API_URL` → `NEXT_PUBLIC_API_BASE` — defined as
`API_URL_CANDIDATES` in `src/lib/api/config.ts`. Every alias in the chain
resolves to the *same* canonical base URL: the first alias that is set to a
non-empty value wins, and the remaining aliases are ignored. An alias set to
an empty string (e.g. `NEXT_PUBLIC_API_URL=`) is treated as unset and the
next alias is tried, so a blank value never silently resolves to an
unintended host. When *no* alias is set, the chain resolves to no base URL
(`undefined`) — it never falls back to a hardcoded or guessed host. In a
production build that missing base URL is fail-closed: the API routes return
`503 backend_unavailable` instead of serving mock data (see
`isMockFallbackAllowed()` in `src/lib/api/config.ts`). The alias chain is
covered end-to-end by `tests/api-client.test.js`.

**Testnet vs. mainnet:** which *backend* this frontend talks to is driven
entirely by the configured API base URL above; the frontend never guesses a
network. Set the appropriate URL per environment and keep production pointed
at the mainnet backend only after the readiness checklist is satisfied.
