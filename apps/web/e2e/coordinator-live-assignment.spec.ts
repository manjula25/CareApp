import { test, expect } from '@playwright/test';

// The `request` fixture resolves relative paths against `use.baseURL`
// (the WEB dev server, :5173, per playwright.config.ts) — direct backend
// calls in this spec need the API's own origin instead.
const API_BASE_URL = 'http://localhost:4000';

function decodeUserId(token: string): string {
  const [, payloadB64] = token.split('.');
  return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8')).id;
}

// S6 C2 — the real-time loop, end to end: a Director's assignment PATCH
// updates the FHIR Task in HAPI, HAPI's real rest-hook Subscription
// (fhir/subscription.ts, bootstrapped at API boot) fires the API's webhook
// (routes/events.ts), which relays over the already-open `/api/events` SSE
// connection to the Coordinator's browser tab — no page reload. The
// assignment itself is triggered via a direct API call (not through a UI
// button): S6 builds the real-time relay only; a Director-facing "assign"
// control doesn't exist until S7's task management UI.
test('assigning a task live-updates the Coordinator panel with a notification, no refresh', async ({ page, request }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/panel$/);
  await expect(page.getByText('My Patients')).toBeVisible();

  const coordinatorToken = await page.evaluate(() => localStorage.getItem('caresync_token'));
  if (!coordinatorToken) throw new Error('coordinator did not persist a token after login');
  const coordinatorId = decodeUserId(coordinatorToken);

  const directorLogin = await request.post(`${API_BASE_URL}/api/auth/login`, {
    data: { email: 'director@caresync.demo', password: 'Demo1234!' },
  });
  const { token: directorToken } = await directorLogin.json();
  const authHeader = { Authorization: `Bearer ${directorToken}` };

  // Arrange: HAPI does not create a new resource version — and therefore
  // never fires the Subscription — for a PUT whose content is unchanged
  // from the current version (confirmed against the local instance). A
  // re-run of this spec against the same disposable HAPI would otherwise
  // silently no-op if the Task is already assigned to this coordinator from
  // a prior run, so reset the owner to a value guaranteed to differ first.
  await request.patch(`${API_BASE_URL}/api/tasks/maria-chen-task-medrec/assign`, {
    headers: authHeader,
    data: { coordinatorId: 'e2e-reset-placeholder' },
  });

  // The already-rendered /panel tab holds an open `/api/events` SSE
  // connection (AppShell's S6 B1 effect) — this PATCH is the only action in
  // this test; everything after it must happen without page interaction.
  const assignRes = await request.patch(`${API_BASE_URL}/api/tasks/maria-chen-task-medrec/assign`, {
    headers: authHeader,
    data: { coordinatorId },
  });
  expect(assignRes.ok()).toBe(true);

  // Generous timeout: HAPI's Subscription is bootstrapped asynchronously at
  // API boot and takes a few seconds to reach 'active' after being created
  // (confirmed against the local instance) — a cold `webServer` start in
  // this suite can still be within that window when the PATCH above fires.
  const toast = page.getByText(/New task assigned: Medication reconciliation follow-up/);
  await expect(toast).toBeVisible({ timeout: 20_000 });
  // HAPI has been observed to deliver a single Task update's rest-hook
  // twice in quick succession (confirmed against the local instance) —
  // AppShell (S6 B1) de-dupes by message, so exactly one toast should show.
  await expect(toast).toHaveCount(1);
});
