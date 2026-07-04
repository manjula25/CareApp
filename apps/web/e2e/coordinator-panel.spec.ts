import { test, expect } from '@playwright/test';

test('Coordinator logs in, browses the panel, and reads Maria Chen live from HAPI', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('coordinator@caresync.demo');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/panel$/);
  await expect(page.getByText('My Patients')).toBeVisible();
  const mariaRow = page.getByRole('link', { name: /Maria Chen/ });
  await expect(mariaRow).toBeVisible();
  await expect(mariaRow.getByText('CHF')).toBeVisible();

  await mariaRow.click();
  await expect(page).toHaveURL(/\/patients\/maria-chen$/);
  await expect(page.getByText('Maria Chen')).toBeVisible();

  await expect(page.getByText('Active Conditions')).toBeVisible();
  await expect(page.getByText('Heart failure, unspecified')).toBeVisible();

  await expect(page.getByText('Tasks')).toBeVisible();
  await expect(page.getByText('2 open')).toBeVisible();
  await expect(page.getByText('Medication reconciliation follow-up')).toBeVisible();
  await expect(page.getByText('SDOH referral: housing navigator')).toBeVisible();
  await expect(page.getByText('HIGH')).toBeVisible();
  await expect(page.getByText('Task/maria-chen-task-medrec')).toBeVisible();
  await expect(page.getByText('Open').first()).toBeVisible();
});
