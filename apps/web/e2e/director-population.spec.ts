import { test, expect } from '@playwright/test';
import { SCATTER_PADDING, QUADRANT_RISK_THRESHOLD, QUADRANT_URGENCY_THRESHOLD } from '../src/lib/populationScatterGeometry';

// Clicks a point deep inside the "critical" quadrant (risk >= threshold AND
// urgency >= threshold) by inverting the same left/right/top/bottom padding
// the scatter paints with (`populationScatterGeometry.ts`), so this test
// can't drift from the real projection the way a guessed pixel offset could.
function criticalQuadrantOffset(box: { width: number; height: number }) {
  const innerW = box.width - SCATTER_PADDING.left - SCATTER_PADDING.right;
  const innerH = box.height - SCATTER_PADDING.top - SCATTER_PADDING.bottom;
  const riskValue = Math.min(95, QUADRANT_RISK_THRESHOLD + 20); // well past the >=60 threshold
  const urgencyValue = Math.min(95, QUADRANT_URGENCY_THRESHOLD + 20);
  return {
    x: SCATTER_PADDING.left + (riskValue / 100) * innerW,
    // higher urgency paints nearer the top of the canvas (y1), not the bottom
    y: box.height - SCATTER_PADDING.bottom - (urgencyValue / 100) * innerH,
  };
}

test('Director logs in, sees the population dashboard computed from real aggregates, and drills into a patient', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('director@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/population$/);
  await expect(page.getByRole('heading', { name: 'Population Dashboard' })).toBeVisible();

  // KPI tiles are computed by the S5 aggregate API, not the mockup's
  // hardcoded 23 / $247,400 — assert real, non-mock, non-zero values render.
  // getPopulationSummary/getPopulationScatter bulk-read ~500 patients'
  // RiskAssessment + Encounter from live HAPI, so this is the slowest fetch
  // in the whole E2E suite — longer timeout than the default 5s, especially
  // when other specs' API calls are contending for the same shared HAPI
  // under parallel workers.
  const criticalZoneTile = page.getByTestId('kpi-critical-zone');
  await expect(criticalZoneTile).toBeVisible({ timeout: 15_000 });
  const criticalZoneText = await criticalZoneTile.locator('div').first().textContent();
  const criticalZoneCount = Number(criticalZoneText);
  expect(criticalZoneCount).toBeGreaterThan(0);

  const costAvoidanceTile = page.getByTestId('kpi-cost-avoidance');
  await expect(costAvoidanceTile).toBeVisible();
  const costAvoidanceText = await costAvoidanceTile.locator('div').first().textContent();
  expect(costAvoidanceText).toMatch(/^\$[\d,]+$/);
  expect(costAvoidanceText).not.toBe('$247,400'); // the mockup's static demo figure

  const totalPatientsTile = page.getByTestId('kpi-total-patients');
  await expect(totalPatientsTile.locator('div').first()).toHaveText('506');

  // Native Canvas scatter renders (no chart library) — click the critical
  // (high-risk, high-urgency) quadrant, which the API confirmed is non-empty.
  const chart = page.getByTestId('population-scatter-chart');
  await expect(chart).toBeVisible();
  const canvas = chart.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('scatter canvas has no bounding box');
  const clickOffset = criticalQuadrantOffset(box);
  await canvas.click({ position: clickOffset });

  // Drill-in: filtered patient list.
  await expect(page).toHaveURL(/\/population\/patients$/);
  await expect(page.getByText('Critical — Act Now')).toBeVisible();
  // Rows are `<Link role="listitem">` — the explicit role overrides the
  // implicit link role, so getByRole('link') would miss them; query by
  // listitem and click the row itself.
  const rows = page.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  // While its per-id getPatient() fetch is in flight, a row renders as a
  // plain (non-Link) div reading "Loading…" — clicking it does nothing.
  // Wait for it to resolve into the real Link before clicking.
  await expect(rows.first()).not.toHaveText('Loading…');

  // Open the first patient in the filtered list → existing PatientDetail.
  await rows.first().click();
  await expect(page).toHaveURL(/\/patients\/[\w-]+$/);
  await expect(page.getByText('Active Conditions')).toBeVisible();
});
