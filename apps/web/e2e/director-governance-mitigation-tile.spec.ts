import { test, expect } from '@playwright/test';

// S19 Thread B — Director → W06 Governance dashboard → "Mitigation Recommended"
// tile end-to-end. Asserts the tile is hidden when parity.mitigation is empty
// and visible (with the documented content) when flags fire.
//
// Per CLAUDE.md § Verification rules: "For any change to what a screen renders
// or how it behaves, 'exercised end-to-end' means a real (headless) browser
// run via the frontend-e2e-verification skill." This spec is the S19 binding
// evidence for that rule.
//
// Evidence strength (per the skill's labeling guidance): "local mock" —
// Playwright drives a real headless Chromium against the dev server + real
// API + mocked parity payload (the spec intercepts /api/governance/parity
// via route.fulfill to deterministically exercise both tile states). The
// spec is NOT a target-environment acceptance — production acceptance for
// the parity pipeline requires a real patient cohort.
test.describe('Director → Governance → Mitigation Recommended tile (S19 Thread B)', () => {
  test.beforeEach(async ({ page }) => {
    // Auth as Director (same path as director-governance.spec.ts).
    await page.goto('/login');
    await page.getByLabel('Email').fill('director@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/population$/);
    await page.goto('/governance');
    await expect(page.getByRole('heading', { name: 'AI Governance Center' })).toBeVisible();
  });

  test('hides the Mitigation Recommended tile when parity.mitigation is empty', async ({ page }) => {
    // Intercept the /api/governance/parity call to deterministically return
    // an empty mitigation array — a live DB run might or might not fire flags
    // depending on the cached-analysis cohort, which would make this spec
    // flaky. Mocking the parity payload pins the tile-hidden state.
    await page.route('**/api/governance/parity', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          byAgeBand: [{ group: '50-64', patientCount: 10, avgRiskScore: 55 }],
          bySex: [{ group: 'female', patientCount: 8, avgRiskScore: 50 }],
          byRace: [{ group: 'White', patientCount: 6, avgRiskScore: 60 }],
          byEthnicity: [{ group: 'Not Hispanic or Latino', patientCount: 9, avgRiskScore: 55 }],
          mitigation: [],
        }),
      }),
    );
    // Reload to pick up the intercepted response.
    await page.goto('/governance');
    await expect(page.getByTestId('governance-parity-chart')).toBeVisible();
    await expect(page.getByTestId('governance-mitigation-tile')).toHaveCount(0);
  });

  test('renders the Mitigation Recommended tile with each flag\'s dimension, evidence, and recommended action when present', async ({ page }) => {
    await page.route('**/api/governance/parity', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          byAgeBand: [{ group: '50-64', patientCount: 10, avgRiskScore: 55 }],
          bySex: [{ group: 'female', patientCount: 8, avgRiskScore: 50 }],
          byRace: [
            { group: 'White', patientCount: 10, avgRiskScore: 50 },
            { group: 'Black or African American', patientCount: 10, avgRiskScore: 80 },
          ],
          byEthnicity: [
            { group: 'Hispanic or Latino', patientCount: 12, avgRiskScore: 50 },
            { group: 'Not Hispanic or Latino', patientCount: 2, avgRiskScore: 50 },
          ],
          mitigation: [
            {
              dimension: 'byRace',
              severity: 'red',
              evidence: 'byRace: max "White" avg 80 vs min "Black or African American" avg 50 — delta 30',
              recommendedAction: 'audit rubric for that group',
            },
            {
              dimension: 'byEthnicity',
              severity: 'amber',
              evidence: 'group "Hispanic or Latino" has n=2 (< 3) — too few for reliable inference',
              recommendedAction: 'insufficient sample',
            },
          ],
        }),
      }),
    );
    await page.goto('/governance');
    const tile = page.getByTestId('governance-mitigation-tile');
    await expect(tile).toBeVisible();
    await expect(tile.getByText(/Mitigation Recommended/i)).toBeVisible();
    await expect(tile.getByText(/2 flag/i)).toBeVisible();
    // Both flags' evidence strings render.
    await expect(tile.getByText(/byRace.*max.*White.*Black.*delta.*30/i)).toBeVisible();
    await expect(tile.getByText(/Hispanic or Latino.*n=2/i)).toBeVisible();
    // Severity color markers.
    await expect(tile.getByText(/red.*byRace/i)).toBeVisible();
    await expect(tile.getByText(/amber.*byEthnicity/i)).toBeVisible();
    // Recommended actions.
    await expect(tile.getByText(/recommended: audit rubric for that group/i)).toBeVisible();
    await expect(tile.getByText(/recommended: insufficient sample/i)).toBeVisible();
  });
});