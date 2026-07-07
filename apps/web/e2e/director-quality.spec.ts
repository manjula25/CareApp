import { test, expect } from '@playwright/test';

// S11 A2 — W05/W07 Quality/HEDIS view, driven end-to-end against the real
// API + live HAPI. The measure rate/gap/incentive figures come from two real
// bulk FHIR searches (Condition E11.9, Observation LOINC 4548-4) — this spec
// proves the screen actually renders that live-computed data (not a
// hardcoded mockup number) and that the native Canvas gauge attaches.
test('Director navigates to Quality from the nav link and sees the real diabetes/HbA1c measure', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('director@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/population$/);

  // Nav link only a Director sees.
  await page.getByRole('link', { name: 'Quality' }).click();
  await expect(page).toHaveURL(/\/quality$/);
  await expect(page.getByRole('heading', { name: 'Quality & HEDIS Measures' })).toBeVisible();

  // Real computed rate — the seeded environment has a diabetes Condition
  // denominator far larger than the HbA1c Observation numerator, so this
  // should never render as 0% or 100% (both would indicate fabricated/
  // stuck data rather than a genuine gap computation).
  const rateTile = page.getByTestId('quality-measure-rate');
  await expect(rateTile).toBeVisible({ timeout: 15_000 });
  const rateText = (await rateTile.textContent()) ?? '';
  expect(rateText).toMatch(/%/);
  expect(rateText).not.toBe('0%');
  expect(rateText).not.toBe('100%');

  // Real gap-patient count — must be a positive integer, not a placeholder.
  const gapTile = page.getByTestId('quality-gap-count');
  await expect(gapTile).toBeVisible();
  const gapText = (await gapTile.textContent()) ?? '';
  expect(Number(gapText.replace(/[^\d]/g, ''))).toBeGreaterThan(0);

  // Illustrative incentive figure, clearly labeled as an estimate.
  const incentiveTile = page.getByTestId('quality-incentive-estimate');
  await expect(incentiveTile).toBeVisible();
  await expect(page.getByText(/illustrative/i)).toBeVisible();

  // Native Canvas gauge (no chart library, GD10) renders.
  const gauge = page.getByTestId('quality-gauge-chart');
  await expect(gauge).toBeVisible();
  await expect(gauge.locator('canvas')).toBeAttached();

  // Honest-staging: none of the mockup's fabricated ROI figures leaked in.
  await expect(page.getByText('$4.78M')).not.toBeVisible();
  await expect(page.getByText('Robert Kim')).not.toBeVisible();
});
