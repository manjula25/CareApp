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
      ['token', { agentId: 'risk', text: 'Elevated BNP and reduced eGFR ' }],
      ['token', { agentId: 'risk', text: 'are consistent with a CHF exacerbation risk.' }],
      ['finding', { agentId: 'risk', text: 'Elevated BNP consistent with CHF exacerbation', fhirResourceId: 'Observation/maria-chen-bnp' }],
      ['complete', { agentId: 'risk', riskScore: 87, riskLevel: 'high', readmissionProbability: 0.62, findingCount: 1, droppedCount: 1 }],
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

/**
 * S3 D2 — four-agent orchestration + Task creation E2E.
 *
 * Same substitute-for-a-live-call rationale as the S2 test above (no
 * `OPENAI_API_KEY` in this environment): intercepts the SSE call and serves
 * synthetic frames in the real route's `agentId`-tagged format
 * (`apps/api/src/routes/analysis.ts`), covering all four agents plus a
 * `task` and `done` event. Proves the frontend's per-agent routing
 * (`streamAnalysis`'s `onToken(agentId, text)`) and Task-card rendering in a
 * real headless browser — packaged UI / local-mock strength. Live-model and
 * live-HAPI-write proof is D3.
 */
test('Coordinator runs analysis and sees all four feeds stream plus a created Task', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/panel$/);

  await page.goto('/patients/maria-chen');
  await expect(page.getByText('Maria Chen')).toBeVisible();

  await page.route('**/api/patients/*/analysis', async (route) => {
    const frames = [
      ['token', { agentId: 'risk', text: 'Elevated BNP consistent with CHF exacerbation risk.' }],
      ['token', { agentId: 'careGap', text: 'Cardiology follow-up is overdue.' }],
      ['token', { agentId: 'sdoh', text: 'Housing instability flagged on AHC-HRSN screening.' }],
      ['finding', { agentId: 'risk', text: 'Elevated BNP', fhirResourceId: 'Observation/maria-chen-bnp' }],
      ['complete', { agentId: 'risk', riskScore: 87, riskLevel: 'high', readmissionProbability: 0.62, findingCount: 1, droppedCount: 0 }],
      ['finding', { agentId: 'careGap', gapType: 'follow-up', description: 'Cardiology follow-up overdue', urgency: 'high', fhirResourceId: 'Condition/maria-chen-chf' }],
      ['complete', { agentId: 'careGap', findingCount: 1, droppedCount: 0 }],
      ['finding', { agentId: 'sdoh', domain: 'housing', finding: 'Housing instability', severity: 'high', fhirResourceId: 'Observation/maria-chen-sdoh' }],
      ['complete', { agentId: 'sdoh', findingCount: 1, droppedCount: 0, referralsNeeded: ['housing navigator'] }],
      ['token', { agentId: 'actionPlanner', text: 'Synthesizing prioritized tasks.' }],
      [
        'task',
        {
          agentId: 'actionPlanner',
          id: 'maria-chen-task-e2e',
          reference: 'Task/maria-chen-task-e2e',
          title: 'Schedule cardiology follow-up',
          description: 'Overdue per Care Gap agent',
          priority: 'high',
          assignTo: 'coordinator',
          dueInDays: 2,
          fhirResources: ['Condition/maria-chen-chf', 'Observation/maria-chen-bnp'],
        },
      ],
      ['complete', { agentId: 'actionPlanner', findingCount: 1, droppedCount: 0 }],
      ['done', {}],
    ] as const;
    const body = frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  await page.getByRole('button', { name: /run analysis/i }).click();

  // All four feeds go live — none stay on the idle placeholder.
  await expect(page.getByText('Awaiting analysis run…')).toHaveCount(0);
  await expect(page.getByTestId('risk-summary')).toHaveText(/high risk · score 87/i);
  await expect(page.getByTestId('care-gap-summary')).toHaveText(/1 findings · 0 dropped/i);
  await expect(page.getByTestId('sdoh-summary')).toHaveText(/1 findings · 0 dropped/i);
  await expect(page.getByTestId('action-planner-summary')).toHaveText(/1 findings · 0 dropped/i);

  // The created Task renders as a card with its citation chips.
  const taskCard = page.getByTestId('created-maria-chen-task-e2e');
  await expect(taskCard.getByText('Schedule cardiology follow-up')).toBeVisible();
  await expect(taskCard.getByText('Task/maria-chen-task-e2e')).toBeVisible();
  await expect(taskCard.getByText('Condition/maria-chen-chf')).toBeVisible();
  await expect(taskCard.getByText('Observation/maria-chen-bnp')).toBeVisible();

  await expect(page.getByRole('button', { name: /^run analysis$/i })).toBeVisible();
});
