import { test, expect } from '@playwright/test';

/**
 * E2E coverage for the wallets surface, including the empty-project CTA.
 *
 * The empty state must render accessible, stable copy and expose a single
 * non-privileged primary action (create the first wallet/project). It must
 * never surface privileged actions (admin, recovery, key export) or leak
 * secrets/keys/JWTs into the DOM.
 */

test.describe('wallets', () => {
  test('empty project shows the create-first-wallet CTA', async ({ page }) => {
    await page.goto('/wallets');

    const cta = page.getByTestId('empty-project-cta');
    await expect(cta).toBeVisible();

    // Stable, accessible copy for the empty state.
    await expect(
      cta.getByRole('heading', { name: /no wallets yet/i }),
    ).toBeVisible();
    await expect(
      cta.getByText(/create your first wallet to get started/i),
    ).toBeVisible();

    // Exactly one primary action, and it is the non-privileged create action.
    const primaryAction = cta.getByRole('button', {
      name: /create (your )?first wallet/i,
    });
    await expect(primaryAction).toBeVisible();
    await expect(primaryAction).toBeEnabled();
  });

  test('empty project CTA does not expose privileged actions or secrets', async ({
    page,
  }) => {
    await page.goto('/wallets');

    const cta = page.getByTestId('empty-project-cta');
    await expect(cta).toBeVisible();

    // Deny-by-default: no privileged surfaces in the empty state.
    await expect(
      cta.getByRole('button', { name: /admin|recovery|export|reveal/i }),
    ).toHaveCount(0);

    // No raw key material, JWTs, or secrets rendered into the DOM.
    const html = await cta.innerHTML();
    expect(html).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(html).not.toMatch(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/);
    expect(html).not.toMatch(/\b(secret|privateKey|mnemonic|seed)\b\s*[:=]/i);
  });

  test('empty project CTA primary action starts wallet creation', async ({
    page,
  }) => {
    await page.goto('/wallets');

    const cta = page.getByTestId('empty-project-cta');
    await expect(cta).toBeVisible();

    await cta
      .getByRole('button', { name: /create (your )?first wallet/i })
      .click();

    // The action routes into the create flow rather than performing a
    // privileged operation inline.
    await expect(page).toHaveURL(/\/wallets\/new(\?|$)/);
  });
});
