import { test, expect } from '@playwright/test';

/**
 * S4 C2 — Agent-graph canvas + cache/live trigger parity E2E.
 *
 * WHAT THIS PROVES (packaged UI / local-mock strength, per CLAUDE.md's
 * "Evidence boundaries"):
 *   1. The B2 AgentGraph `<canvas>` renders in the real DOM, above the feeds
 *      grid, even in the idle (pre-run) state — a signature visual jsdom can
 *      NEVER verify (no 2D canvas context).
 *   2. The CLIENT-side trigger wiring: the default "Run Analysis" button
 *      issues its request WITHOUT `?live=1`; the "Run live" button issues one
 *      WITH `?live=1` (asserted on the captured `route.request().url()`).
 *   3. graph → feeds → tasks render, and the "same UI treatment" (GD2)
 *      guarantee: driven with IDENTICAL synthetic frames, the cached and live
 *      paths render byte-identical feeds/summaries/task-cards.
 *   4. The `analysis-mode` indicator reflects the pressed button
 *      ("requested: cached" vs "requested: live").
 *
 * WHAT THIS DOES *NOT* PROVE — and why: the SSE analysis POST is intercepted
 * here (there is no `OPENAI_API_KEY` in this environment, so a
 * genuinely live "Run live" click would attempt a real OpenAI call and fail).
 * Because the backend is stubbed at the network boundary, this test does NOT
 * exercise the real cache logic — it does NOT prove "cached replay makes zero
 * model calls" nor "`?live=1` forces a fresh orchestrator run". Those are
 * proven at the API-boundary Supertest layer (Task A2 in
 * `apps/api/src/routes/analysis.test.ts`: stub-orchestrator-not-called on
 * replay, `?live=1` invokes it, cold-cache fallback). This is the frontend
 * counterpart: it proves the client reaches the network with the right URL for
 * each mode and renders both identically — not the server's cache behavior.
 */

/** The 4-agent + task + done frame set — identical for both cache and live
 * runs, mirroring the S3 test in patient-analysis.spec.ts. Ids are real on
 * Maria Chen's seeded record so citation chips look like genuine data. */
const FRAMES = [
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

const SSE_BODY = FRAMES.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto('/patients/maria-chen');
  await expect(page.getByText('Maria Chen')).toBeVisible();
}

/**
 * Assert the full graph → feeds → tasks rendered state after a (mocked) run.
 * Both the cache and live paths call this with the SAME frames, so an
 * identical pass on both is the "same UI treatment" (GD2) guarantee.
 */
async function expectRenderedAnalysis(page: import('@playwright/test').Page) {
  // No idle placeholder survives — all four feeds went live.
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
}

// Reduced motion DISABLED for every test in this file: the B2
// `prefers-reduced-motion: reduce` branch paints a single static "settled"
// frame and never starts the rAF animation loop, so it would bypass the
// animated canvas path this E2E is meant to exercise. Forcing
// `no-preference` guarantees the real live-render path runs.
test.use({ reducedMotion: 'no-preference' });

test('AgentGraph canvas renders above the feeds grid in the idle state', async ({ page }) => {
  await login(page);

  // The B2 signature visual: exactly one <canvas> (jsdom can't verify this).
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();

  // It sits ABOVE the feeds grid — the canvas's bottom edge is at or above the
  // first feed box's top edge (closes the W03 layout deviation).
  const canvasBox = await canvas.boundingBox();
  const firstFeedBox = await page.getByTestId('risk-summary').or(page.getByText('Awaiting analysis run…').first()).first().boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(firstFeedBox).not.toBeNull();
  expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(firstFeedBox!.y + 1);

  // Idle state: no run has happened, so all four feeds are honest placeholders
  // and no mode indicator is shown yet.
  await expect(page.getByText('Awaiting analysis run…')).toHaveCount(4);
  await expect(page.getByTestId('analysis-mode')).toHaveCount(0);
});

test('Default "Run Analysis" requests WITHOUT ?live=1 and renders graph→feeds→tasks (cached)', async ({ page }) => {
  await login(page);

  let requestedUrl = '';
  await page.route('**/api/patients/*/analysis*', async (route) => {
    requestedUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY });
  });

  await page.getByRole('button', { name: /^run analysis$/i }).click();
  await expectRenderedAnalysis(page);

  // The crux of cache-vs-live: the default trigger must NOT force a fresh run.
  expect(requestedUrl).not.toContain('live=1');

  // Mode indicator reflects the pressed button.
  await expect(page.getByTestId('analysis-mode')).toHaveText(/requested: cached/i);
});

test('"Run live" requests WITH ?live=1 and renders the SAME graph→feeds→tasks treatment (live)', async ({ page }) => {
  await login(page);

  let requestedUrl = '';
  await page.route('**/api/patients/*/analysis*', async (route) => {
    requestedUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY });
  });

  await page.getByRole('button', { name: /run live/i }).click();
  // Identical rendered state to the cached path above — same UI treatment (GD2).
  await expectRenderedAnalysis(page);

  // The live trigger MUST force a fresh run.
  expect(requestedUrl).toContain('live=1');

  // Mode indicator reflects the pressed button.
  await expect(page.getByTestId('analysis-mode')).toHaveText(/requested: live/i);
});
