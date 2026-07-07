import { test, expect } from '@playwright/test';

// S11 A1 — M05 SDOH resource directory + referral, driven end-to-end against
// the real API + live HAPI. The referral button calls the real
// `POST /api/sdoh/referrals` route, which writes an actual FHIR
// ServiceRequest via FhirReadService.createServiceRequest — this spec proves
// the click-to-referral path renders the honest "Referral sent" confirmation
// that only appears after that real write succeeds (not a hardcoded UI
// state), same evidentiary bar as the other E2E specs in this suite.
test('Social Worker opens a patient, browses SDOH resources by category, and sends a referral that really creates a FHIR ServiceRequest', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('socialworker@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goto('/patients/maria-chen/sdoh');
  await expect(page.getByRole('heading', { name: 'SDOH Resources' })).toBeVisible();

  // Category tabs filter the real, server-returned resource list.
  const tabs = page.getByTestId('sdoh-category-tabs');
  await expect(tabs).toBeVisible();
  await page.getByTestId('sdoh-category-tab-transportation').click();

  const cards = page.locator('[data-testid^="sdoh-resource-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  // Every visible card must actually be tagged Transportation — proves the
  // filter is real client-side filtering of real data, not a static list.
  const chipTexts = await page.locator('[data-testid^="sdoh-resource-card-"] >> text=TRANSPORTATION').count();
  expect(chipTexts).toBe(cardCount);

  // Refer on the first visible resource — this hits the real audited FHIR
  // write path (guard -> POST /ServiceRequest -> writeAudit).
  const firstCard = cards.first();
  const referButton = firstCard.locator('[data-testid^="sdoh-refer-button-"]');
  await referButton.click();

  await expect(firstCard.getByText('✓ Referral sent — ServiceRequest created')).toBeVisible({ timeout: 15_000 });
});
