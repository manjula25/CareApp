import { test, expect } from '@playwright/test';

// S8 Phase B — Director → W06 Governance dashboard, driven end-to-end against
// the real API + live HAPI (audit_log, analysis_cache, and HAPI demographics
// for the parity join). `docs/eval-report.json` does not exist on this branch
// (S9 hasn't shipped), so the eval tile is expected to render its real,
// honest empty state — not a mocked one.
test('Director logs in, navigates to Governance from the nav link, and sees real audit/model/parity data plus the S9 eval placeholder', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('director@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/population$/);

  // Nav link only a Director sees (S8 B3).
  await page.getByRole('link', { name: 'Governance' }).click();
  await expect(page).toHaveURL(/\/governance$/);
  await expect(page.getByRole('heading', { name: 'AI Governance Center' })).toBeVisible();

  // Zone 2 metric tiles computed from real aggregates — not the mockup's
  // hardcoded 84.2% / 2,847 / 23 / 0.94.
  const analysesTile = page.getByTestId('governance-tile-analyses-cached');
  await expect(analysesTile).toBeVisible({ timeout: 15_000 });

  // Column A — real audit trail rows (ts/actor/action/resource/outcome),
  // most-recent-first. Every FHIR read/write across the whole demo (logins,
  // coordinator panel reads, etc.) writes an audit_log row, so this dev DB's
  // table is never empty by the time this spec runs — assert on the real
  // outcome vocabulary (success/denied/error) rather than a specific actor,
  // since which actor most recently wrote a row depends on E2E run order.
  const auditTrail = page.getByTestId('governance-audit-trail');
  await expect(auditTrail).toBeVisible();
  await expect(auditTrail.getByText('No audit events yet.')).not.toBeVisible();
  await expect(auditTrail.getByText(/success|denied|error/i).first()).toBeVisible({ timeout: 15_000 });

  // Column B — native Canvas confidence chart renders (no chart library).
  const confidenceChart = page.getByTestId('governance-confidence-chart');
  await expect(confidenceChart).toBeVisible();
  await expect(confidenceChart.locator('canvas')).toBeAttached();

  // Column C — native Canvas parity radar renders.
  const parityChart = page.getByTestId('governance-parity-chart');
  await expect(parityChart).toBeVisible();
  await expect(parityChart.locator('canvas')).toBeAttached();

  // Eval tile — S9 doesn't exist on this branch, so this must be the honest
  // empty state, not a fabricated number.
  const evalTile = page.getByTestId('governance-eval-tile');
  await expect(evalTile).toBeVisible();
  await expect(evalTile.getByText(/not yet available/i)).toBeVisible({ timeout: 15_000 });
});
