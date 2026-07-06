import { test, expect } from '@playwright/test';

// The `request` fixture resolves relative paths against `use.baseURL` (the WEB
// dev server, :5173, per playwright.config.ts) — this spec talks to FHIR
// directly, so it needs HAPI's own origin instead (same pattern as
// task-queue.spec.ts's FHIR_BASE_URL constant).
const FHIR_BASE_URL = 'http://localhost:8080/fhir';

// S7 B2 — M03 Task Detail. A fresh probe Task (not a seed/mutated Task) so
// cleanup is a plain delete, no restore-to-original-state dance needed.
// Carries two Task.input citation entries (the same shape createTask now
// writes — see apps/api/src/fhir/client.ts's doc on createTask) pointing at
// Maria Chen's real seed Condition/Observation resources, so the detail
// screen has real citations to resolve and display.
test.describe('M03 Task Detail (S7 B2)', () => {
  let probeTaskId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${FHIR_BASE_URL}/Task`, {
      headers: { 'Content-Type': 'application/fhir+json' },
      data: {
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        priority: 'urgent',
        description: 'S7 B2 task-detail probe: cardiology follow-up',
        for: { reference: 'Patient/maria-chen' },
        authoredOn: new Date().toISOString(),
        input: [
          { type: { text: 'citation' }, valueReference: { reference: 'Condition/maria-chen-chf' } },
          { type: { text: 'citation' }, valueReference: { reference: 'Observation/maria-chen-hba1c' } },
        ],
      },
    });
    const created = await res.json();
    probeTaskId = created.id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${FHIR_BASE_URL}/Task/${probeTaskId}`);
  });

  test('Coordinator opens a task from the queue, sees justifying context + citations, defers it, and finds a Call link', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    // Clicking the card (not the Done button) navigates to the detail screen.
    await page.getByTestId(`task-${probeTaskId}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${probeTaskId}$`));

    await expect(page.getByText('S7 B2 task-detail probe: cardiology follow-up')).toBeVisible();
    await expect(page.getByText('Maria Chen')).toBeVisible();

    const citations = page.getByTestId('task-citations');
    await expect(citations.getByText(/Heart failure/)).toBeVisible();
    await expect(citations.getByText(/Hemoglobin A1c/)).toBeVisible();

    await page.getByRole('button', { name: 'Defer' }).click();
    await expect(page.getByText('Deferred')).toBeVisible();

    // Maria Chen's seed phone (S7 B2 Decision 2) renders a working tel: Call link.
    const callLink = page.getByRole('link', { name: 'Call' });
    await expect(callLink).toHaveAttribute('href', 'tel:+1-555-0142');
  });
});
