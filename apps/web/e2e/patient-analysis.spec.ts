import { test, expect } from '@playwright/test';

/**
 * S2 D2 — Run Analysis / streaming Risk feed E2E.
 *
 * The idle-state and "Analyzing…" assertions exercise the real frontend
 * against the real backend (no interception needed — they don't require a
 * successful agent response).
 *
 * The full streaming/finding/citation-chip assertion intercepts the
 * `POST /api/patients/:id/analysis` network call via Playwright's
 * `page.route()` and serves a synthetic `text/event-stream` response in the
 * exact SSE frame format the real route (`apps/api/src/routes/analysis.ts`)
 * emits. This is a deliberate substitute for a live OpenAI call — there is
 * no `OPENAI_API_KEY` configured in this environment, so a real "Run
 * Analysis" click would hang/fail at the network step. Per CLAUDE.md's
 * "Evidence boundaries", this proves the frontend's SSE-consumption and
 * rendering logic end-to-end in a real headless browser (packaged UI / local
 * mock strength) — it is NOT live-model-call proof, and it does not exercise
 * the server-side citation validator (that's covered by the API-boundary
 * Supertest in B2, and by D3's live run).
 */
test('Coordinator runs analysis on Maria Chen and sees the Risk feed stream', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/panel$/);

  await page.goto('/patients/maria-chen');
  await expect(page.getByText('Maria Chen')).toBeVisible();

  const runButton = page.getByRole('button', { name: /run analysis/i });
  await expect(runButton).toBeVisible();

  // Pre-click: all four feed boxes are honest idle placeholders — no live
  // call has happened yet, so this needs no backend/network involvement.
  const idlePlaceholders = page.getByText('Awaiting analysis run…');
  await expect(idlePlaceholders).toHaveCount(4);

  // Intercept the analysis SSE call with a synthetic response matching the
  // real route's event format (`event: <type>\ndata: <json>\n\n`), using ids
  // that are real on Maria's seeded record (apps/api/src/fhir-data/seed-patients.ts)
  // so the citation chip looks like genuine data.
  await page.route('**/api/patients/*/analysis', async (route) => {
    // Small artificial delay so the "Analyzing…" in-flight state below is
    // reliably observable rather than racing a near-instant fulfill.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const frames = [
      ['token', { text: 'Elevated BNP and reduced eGFR ' }],
      ['token', { text: 'are consistent with a CHF exacerbation risk.' }],
      ['finding', { text: 'Elevated BNP consistent with CHF exacerbation', fhirResourceId: 'Observation/maria-chen-bnp' }],
      ['complete', { riskScore: 87, riskLevel: 'high', readmissionProbability: 0.62, findingCount: 1, droppedCount: 1 }],
    ] as const;
    const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body,
    });
  });

  await runButton.click();

  // Streaming has started: the button flips to the "Analyzing…"/spinner state
  // synchronously (running=true set before the fetch resolves) — no live call
  // needed for this assertion either.
  await expect(page.getByRole('button', { name: /analyzing/i })).toBeVisible();

  // Once the (mocked) stream completes: narrated text, the validated finding's
  // citation chip, and the summary line all render from real SSE parsing.
  await expect(page.getByText(/Elevated BNP and reduced eGFR/)).toBeVisible();
  await expect(page.getByText(/consistent with a CHF exacerbation risk/)).toBeVisible();
  await expect(page.getByText('Observation/maria-chen-bnp')).toBeVisible();
  await expect(page.getByTestId('risk-summary')).toHaveText(/high risk · score 87/i);

  // The button returns to its resting state, and the other three feed boxes
  // stay honest idle placeholders (not wired up until S3).
  await expect(page.getByRole('button', { name: /^run analysis$/i })).toBeVisible();
  await expect(idlePlaceholders).toHaveCount(3);
});
