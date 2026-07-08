import { test, expect } from '@playwright/test';

// Regression coverage for the S12 alerts auth/fallback fixes:
//   1. Acknowledge actually works (was a ReferenceError: setAlerts undefined).
//   2. DemoFallbackBadge names the real failure (network vs other), instead of
//      always saying "server unreachable".
//   3. An expired-but-well-formed token redirects to /login instead of
//      stranding the user on a protected page behind the demo badge.

async function loginAsCoordinator(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/panel|\/tasks|\/population/);
}

test.describe('Clinical Alerts — auth & demo-fallback (S12)', () => {
  test('Acknowledge marks an alert acknowledged and drops it from the unacked list', async ({ page }) => {
    await loginAsCoordinator(page);
    // Force the deterministic MOCK_ALERTS set (6 unacked) so the count is
    // stable — this still drives the real acknowledge() handler on real DOM.
    await page.route('**/api/alerts', (route) => route.abort('failed'));
    await page.goto('/alerts');

    const ackButtons = page.getByRole('button', { name: 'Acknowledge', exact: true });
    await expect(ackButtons).toHaveCount(6);

    await ackButtons.first().click();

    // Default view hides acknowledged alerts, so exactly one Acknowledge
    // button should disappear — proving state updated (no thrown handler).
    await expect(ackButtons).toHaveCount(5);
  });

  test('network failure → badge says "server unreachable"', async ({ page }) => {
    await loginAsCoordinator(page);
    await page.route('**/api/alerts', (route) => route.abort('failed'));

    await page.goto('/alerts');
    const badge = page.getByTestId('demo-fallback-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('server unreachable');
    await expect(page).toHaveURL(/\/alerts/); // authed → stays put, no redirect
  });

  test('HTTP 500 → badge says "data unavailable" (not "server unreachable")', async ({ page }) => {
    await loginAsCoordinator(page);
    await page.route('**/api/alerts', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
    );

    await page.goto('/alerts');
    const badge = page.getByTestId('demo-fallback-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('data unavailable');
  });

  test('expired token redirects to /login instead of showing the demo badge', async ({ page }) => {
    await page.addInitScript(() => {
      const past = Math.floor(Date.now() / 1000) - 3600; // 1h ago
      const payload = { id: 'demo-user', role: 'coordinator', name: 'Expired', exp: past };
      const b64 = btoa(JSON.stringify(payload));
      localStorage.setItem('caresync_token', `eyJhbGciOiJIUzI1NiJ9.${b64}.sig`);
    });

    await page.goto('/alerts');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId('demo-fallback-badge')).toHaveCount(0);
  });
});
