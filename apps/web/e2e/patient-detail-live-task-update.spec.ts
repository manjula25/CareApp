import { test, expect } from '@playwright/test';

// The `request` fixture resolves relative paths against `use.baseURL` (the
// WEB dev server, :5173, per playwright.config.ts) — direct backend/FHIR
// calls in this spec need their own origins (same pattern as
// coordinator-live-assignment.spec.ts / task-queue.spec.ts).
const API_BASE_URL = 'http://localhost:4000';
const FHIR_BASE_URL = 'http://localhost:8080/fhir';

// maria-chen-task-medrec is a seed Task also used by
// coordinator-live-assignment.spec.ts (owner assignment) and
// task-queue.spec.ts (domain-tag probe) — this spec drives its FHIR
// `status`/`businessStatus` instead, restored below so repeat runs stay
// idempotent.
const TASK_ID = 'maria-chen-task-medrec';

async function resetTaskToOpen(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get(`${FHIR_BASE_URL}/Task/${TASK_ID}`);
  const task = await res.json();
  task.status = 'requested';
  delete task.businessStatus;
  await request.put(`${FHIR_BASE_URL}/Task/${TASK_ID}`, {
    headers: { 'Content-Type': 'application/fhir+json' },
    data: task,
  });

  // Verify via a direct HAPI read that the reset actually took, rather than
  // just trusting the PUT's 2xx (same restoration discipline as
  // task-queue.spec.ts's afterAll).
  const verifyRes = await request.get(`${FHIR_BASE_URL}/Task/${TASK_ID}`);
  const restored = await verifyRes.json();
  expect(restored.status).toBe('requested');
  expect(restored.businessStatus).toBeUndefined();
}

// S7 B3 — cross-surface sync, the real testable half of B3 (W13 itself is a
// nav-only shell per GD9 — see TaskCenter.tsx; PatientDetail is the existing,
// already demo-critical screen that owns a patient's task list). Proves the
// S6 relay pattern generalizes past the owner-scoped 'assignment' event: a
// status transition on maria-chen-task-medrec — triggered via a direct
// `request.patch` call, not a UI button, same spirit as
// coordinator-live-assignment.spec.ts's direct `/assign` call (the point is
// the already-open SSE connection, not simulating a second human session) —
// broadcasts 'task-updated' to every connection, and the already-open
// /patients/maria-chen tab invalidates its own patient query and re-renders
// the new status live, with no page reload and no re-navigation.
test.describe('PatientDetail — S7 B3 live task-updated relay', () => {
  test.beforeAll(async ({ request }) => {
    await resetTaskToOpen(request);
  });

  test.afterAll(async ({ request }) => {
    await resetTaskToOpen(request);
  });

  test('completing a task via a direct API call live-updates the already-open patient page, no reload', async ({
    page,
    request,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    const coordinatorToken = await page.evaluate(() => localStorage.getItem('caresync_token'));
    if (!coordinatorToken) throw new Error('coordinator did not persist a token after login');

    await page.goto('/patients/maria-chen');
    await expect(page.getByText('Maria Chen')).toBeVisible();

    const card = page.getByTestId(`existing-${TASK_ID}`);
    await expect(card.getByText('Medication reconciliation follow-up')).toBeVisible();
    await expect(card.getByText('Open')).toBeVisible();

    // The already-rendered /patients/maria-chen tab holds an open
    // `/api/events` SSE connection (PatientDetail's S7 B3 effect) — this
    // PATCH is the only action in this test; everything after it must
    // happen without page interaction: no page.reload(), no re-navigation.
    const statusRes = await request.patch(`${API_BASE_URL}/api/tasks/${TASK_ID}/status`, {
      headers: { Authorization: `Bearer ${coordinatorToken}` },
      data: { transition: 'complete' },
    });
    expect(statusRes.ok()).toBe(true);

    // Generous timeout: HAPI's Subscription is bootstrapped asynchronously
    // at API boot and takes a few seconds to reach 'active' after being
    // created (confirmed against the local instance, same rationale as
    // coordinator-live-assignment.spec.ts) — a cold `webServer` start in
    // this suite can still be within that window when the PATCH above fires.
    await expect(card.getByText('Done')).toBeVisible({ timeout: 20_000 });
  });
});
