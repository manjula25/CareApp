import { test, expect } from '@playwright/test';

test('Social Worker is denied clinical reads and sees an error, not patient data', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('socialworker@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/coming-soon$/);

  await page.goto('/patients/maria-chen');
  // TanStack Query's default retry (3 attempts, exponential backoff) applies even to a
  // 403 — the error state doesn't settle for several seconds, so wait longer than default.
  await expect(page.getByText(/does not have 'clinical' scope/i)).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('Heart failure, unspecified')).not.toBeVisible();
  await expect(page.getByText('Medication reconciliation follow-up')).not.toBeVisible();
});
