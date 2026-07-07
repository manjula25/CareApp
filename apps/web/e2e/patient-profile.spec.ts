import { test, expect } from '@playwright/test';

// Phase 3 — M03 / Phase 3 PatientProfile surface. The page is reached via
// `/patients/:id/profile` and renders against the real `getPatient` API +
// the lead's Maria-only rich-detail fixtures (labs / meds / SDOH / phone).
// `MARIA_ID` must match the real HAPI seed id so the rich-detail branch is
// reachable from a real navigation path (see
// apps/web/src/pages/PatientProfile.fixtures.ts's MARIA_ID note).
const MARIA_ID = 'maria-chen';
const NON_MARIA_ID = 'samuel-wright'; // also seeded by HAPI; any non-Maria id works

test.describe('M03 Patient Profile (Phase 3)', () => {
  test('Coordinator opens Maria Chen profile — rich detail branch shows labs, meds, SDOH, phone', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.goto(`/patients/${MARIA_ID}/profile`);

    // Header card carries name + age/sex + the "Risk score unavailable" pill
    // (real API has no riskScore; honest placeholder, not a fabrication).
    await expect(page.getByTestId('patient-profile-header')).toBeVisible();
    await expect(page.getByTestId('patient-profile-name')).toHaveText('Maria Chen');
    await expect(page.getByTestId('patient-profile-risk-unknown')).toBeVisible();

    // Conditions come from the real getPatient response (FHIR Condition.display).
    const conditionsCard = page.getByTestId('patient-profile-conditions-card');
    await expect(conditionsCard).toBeVisible();

    // Maria's rich-detail branches — labs, meds, SDOH card — are sourced from
    // lead's fixtures (PatientProfile.fixtures.ts) and only render when
    // `patient.id === MARIA_ID`.
    await expect(page.getByTestId('patient-profile-labs-card')).toBeVisible();
    await expect(page.getByTestId('patient-profile-labs-list')).toBeVisible();
    await expect(page.getByTestId('patient-profile-lab-HbA1c')).toBeVisible();
    await expect(page.getByTestId('patient-profile-lab-NT-proBNP')).toBeVisible();

    await expect(page.getByTestId('patient-profile-meds-card')).toBeVisible();
    await expect(page.getByTestId('patient-profile-meds-list')).toBeVisible();

    await expect(page.getByTestId('patient-profile-sdoh-card')).toBeVisible();
    const flags = page.getByTestId('patient-profile-sdoh-flag');
    expect(await flags.count()).toBeGreaterThanOrEqual(2);

    // Call Patient anchor renders only for Maria (lead's hardcoded
    // +1-555-0142 — the real HAPI seed's Maria phone (real API has no
    // phone in PatientDetail, so this is fixture-only).
    const callLink = page.getByTestId('patient-profile-call-patient');
    await expect(callLink).toBeVisible();
    await expect(callLink).toHaveAttribute('href', 'tel:+1-555-0142');

    // Quick actions: Create Task navigates to /tasks; SDOH Resources navigates
    // to /patients/:id/sdoh (the existing Sdoh.tsx route).
    await expect(page.getByTestId('patient-profile-create-task')).toBeVisible();
    await expect(page.getByTestId('patient-profile-sdoh-link')).toBeVisible();
  });

  test('Opening a non-Maria patient hides the rich-detail cards and shows honest placeholders', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.goto(`/patients/${NON_MARIA_ID}/profile`);
    await expect(page.getByTestId('patient-profile-header')).toBeVisible();

    // Rich-detail branches are Maria-only — empty-state copy mirrors lead.
    await expect(page.getByTestId('patient-profile-labs-empty')).toBeVisible();
    await expect(page.getByTestId('patient-profile-labs-empty')).toHaveText('No recent labs on file');
    await expect(page.getByTestId('patient-profile-meds-empty')).toBeVisible();
    await expect(page.getByTestId('patient-profile-meds-empty')).toHaveText('Medication list not available in demo');

    // SDOH card is Maria-only (lead's isMaria branch); SDOH Resources quick
    // action is still rendered so non-Maria patients can still reach Sdoh.tsx.
    await expect(page.getByTestId('patient-profile-sdoh-card')).not.toBeVisible();
    await expect(page.getByTestId('patient-profile-sdoh-link')).toBeVisible();

    // Call Patient button is Maria-only (real API has no phone).
    await expect(page.getByTestId('patient-profile-call-patient')).not.toBeVisible();
  });

  test('Clicking "SDOH Resources" navigates to the existing /patients/:id/sdoh screen', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.goto(`/patients/${MARIA_ID}/profile`);
    await expect(page.getByTestId('patient-profile-header')).toBeVisible();
    await page.getByTestId('patient-profile-sdoh-link').click();
    await expect(page).toHaveURL(new RegExp(`/patients/${MARIA_ID}/sdoh$`));
    await expect(page.getByRole('heading', { name: 'SDOH Resources' })).toBeVisible();
  });

  test('Back link returns to /tasks', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('coordinator@caresync.demo');
    await page.getByLabel('Password').fill('Demo1234!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/panel$/);

    await page.goto(`/patients/${MARIA_ID}/profile`);
    await expect(page.getByTestId('patient-profile-header')).toBeVisible();
    await page.getByRole('link', { name: /Back to Tasks/i }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });
});