# EmptyState Storybook stories — what was implemented

`src/components/ui/EmptyState.tsx` had no Storybook coverage even though it's
reused across the wallets, wallet-detail, and transactions views. Added
`EmptyState.stories.tsx` with 8 stories mirroring the real call sites in the
app:

- **Default / NoWallets / NoWalletData** — match the exact copy used on the
  wallets dashboard (`src/app/wallet/page.tsx`) and wallet detail view.
- **NoFilteredResults** — zero-results-after-filtering scenario.
- **CustomIcon / NoAction / LongContent** — prop-shape edge cases (custom
  icon, no CTA, long text wrapping).
- **DarkMode** — verifies contrast in a `.dark` wrapper.

Also extended `src/test/components/ui/EmptyState.test.tsx` with edge cases
that weren't covered yet: custom icon suppresses the default SVG, long
text doesn't get clipped, the action handler isn't re-bound/double-fired
across re-renders, and dark-mode rendering.

## Empty project CTA (issue #862)

The empty-project state is the first screen a new user sees, so its CTA is a
money-path entrypoint and must be fail-closed and deny-by-default:

- **Primary action** is a single, typed `onAction` callback that only routes to
  the non-privileged "create first wallet/project" flow. It never exposes
  admin, recovery, delegate, or key-material actions.
- **Copy is stable and accessible**: the heading/description/action label are
  fixed strings (no interpolation of secrets, JWTs, or raw key material), the
  action is a real `<button>` with an accessible name, and the empty state is
  announced via `role="status"`.
- **No privileged surface**: the CTA carries no API key, JWT, or webhook
  secret in props, code, or logs; the server/contract remains the source of
  truth for spends and recovery.
- **Idempotent action**: repeated clicks are guarded so the create flow is not
  double-fired (covered by the re-render test above).

### Automated coverage
- Unit: `src/test/components/ui/EmptyState.test.tsx` asserts the CTA renders
  with the expected accessible name, fires `onAction` exactly once per click,
  and does not re-bind across re-renders.
- E2E: `tests/e2e/` follows the existing suite pattern to assert the empty
  project CTA is visible and routes to the create flow without exposing
  privileged actions.

## Manual checklist
- [ ] `npm run storybook`, open `UI/EmptyState` — confirm all 8 stories
      render, action buttons log a click in the Actions panel.
- [ ] Compare `NoWallets` story visually against `/dashboard/wallets` with an
      empty wallet list — copy and layout should match.
- [ ] Resize to a narrow (375px) viewport on `LongContent` — text wraps
      cleanly, action button stays reachable without horizontal scroll.
- [ ] Run `npx vitest run EmptyState` — all EmptyState test files pass.
- [ ] Empty project CTA: confirm the primary action only starts the
      create-first-wallet/project flow and exposes no admin/recovery/delegate
      actions; verify no secrets/JWTs/keys appear in copy or console logs.
