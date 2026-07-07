import { test, expect } from '@playwright/test';

// The `request` fixture resolves relative paths against `use.baseURL`
// (the WEB dev server, :5173, per playwright.config.ts) — this spec talks to
// FHIR directly, so it needs HAPI's own origin instead (same pattern as
// coordinator-live-assignment.spec.ts's API_BASE_URL constant).
const FHIR_BASE_URL = 'http://localhost:8080/fhir';

const TASK_DOMAIN_SYSTEM = 'https://caresync.demo/fhir/task-domain';

// maria-chen-task-medrec predates S7 A0's domain tagging and so carries no
// domain tag today — fail-open, visible to every role. That means it doesn't
// exercise the sdoh-vs-clinical filter this spec is here to prove. Tag it
// 'clinical' for the duration of this spec (restored in afterAll to its exact
// original resource, so repeat runs stay idempotent) so a real clinical-only
// task exists for the Social Worker assertion to fail against if the filter
// ever regresses.
const CLINICAL_TASK_ID = 'maria-chen-task-medrec';
// maria-chen-task-housing has no domain tag either — untagged, so it's
// visible to the Social Worker too (fail-open) and is the task this spec
// drives through "Done".
const HOUSING_TASK_ID = 'maria-chen-task-housing';

test.describe('M02 Task Queue (S7 B1)', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${FHIR_BASE_URL}/Task/${CLINICAL_TASK_ID}`);
    const task = await res.json();
    const tagged = {
      ...task,
      meta: {
        ...task.meta,
        tag: [...((task.meta?.tag as unknown[]) ?? []), { system: TASK_DOMAIN_SYSTEM, code: 'clinical' }],
      },
    };
    await request.put(`${FHIR_BASE_URL}/Task/${CLINICAL_TASK_ID}`, {
      headers: { 'Content-Type': 'application/fhir+json' },
      data: tagged,
    });
  });

  test.afterAll(async ({ request }) => {
    // A plain PUT cannot remove the domain tag added in beforeAll: HAPI treats
    // meta.tag as sticky metadata that survives a normal resource update
    // regardless of what the PUT body contains (verified against the local
    // instance — a PUT with the tag omitted left it in place). The FHIR
    // `$meta-delete` operation is the actual removal mechanism.
    await request.post(`${FHIR_BASE_URL}/Task/${CLINICAL_TASK_ID}/$meta-delete`, {
      headers: { 'Content-Type': 'application/fhir+json' },
      data: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'meta', valueMeta: { tag: [{ system: TASK_DOMAIN_SYSTEM, code: 'clinical' }] } },
        ],
      },
    });

    // The Social Worker flow below completes the housing task via the UI —
    // reset it back to 'requested' (no businessStatus) so a repeat run finds
    // it in its original open state, not already-completed.
    const res = await request.get(`${FHIR_BASE_URL}/Task/${HOUSING_TASK_ID}`);
    const housing = await res.json();
    housing.status = 'requested';
    delete housing.businessStatus;
    await request.put(`${FHIR_BASE_URL}/Task/${HOUSING_TASK_ID}`, {
      headers: { 'Content-Type': 'application/fhir+json' },
      data: housing,
    });
  });

  test('Social Worker lands on the mobile queue, sees only sdoh/uncategorized tasks, and can complete one', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('socialworker@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByText('My Tasks')).toBeVisible();

    // sdoh/uncategorized tasks remain visible (fail-open per A0/A1).
    await expect(page.getByText('SDOH referral: housing navigator')).toBeVisible();
    // The clinical-tagged task must be filtered out for this role.
    await expect(page.getByText('Medication reconciliation follow-up')).not.toBeVisible();

    const card = page.getByTestId(`task-${HOUSING_TASK_ID}`);
    await card.getByRole('button', { name: 'Done' }).click();

    // On success the list refetches and the card renders in its completed state.
    await expect(card.getByText('Done')).toBeVisible();
    await expect(card.getByText('SDOH referral: housing navigator')).toHaveClass(/line-through/);
  });

  test('Coordinator reaches /tasks and sees the full unfiltered set', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    // Direct nav — the desktop Sidebar has no Tasks entry (MobileNav is
    // md:hidden and TaskQueue is the social-worker's roleHome, so social
    // workers reach it via login, coordinators via this path). The
    // "via the nav link" framing was a Phase 1 holdover; the assertion that
    // matters is that the coordinator sees the clinical-tagged task.
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks$/);

    // Coordinator holds both 'clinical' and 'sdoh' scope — sees the
    // clinical-tagged probe task too.
    await expect(page.getByText('Medication reconciliation follow-up')).toBeVisible();
  });
});
