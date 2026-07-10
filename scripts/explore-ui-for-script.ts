import { chromium } from '@playwright/test';

/**
 * Exploration script for generating the Loom demo script's menu map.
 * Logs in as each demo role, navigates to every sidebar route, and logs
 * a one-sentence summary of what the page shows.
 *
 * Run after the local stack is up:
 *   npx tsx scripts/explore-ui-for-script.ts
 */

const BASE_URL = 'http://localhost:5173';

const roles = [
  { name: 'Director', email: 'director@caresync.demo', password: 'Demo1234!', home: '/population' },
  { name: 'Coordinator', email: 'coordinator@caresync.demo', password: 'Demo1234!', home: '/coordinator' },
  { name: 'Social Worker', email: 'socialworker@caresync.demo', password: 'Demo1234!', home: '/tasks' },
];

const routes = [
  { path: '/population', label: 'Population', roles: ['Director'] },
  { path: '/coordinator', label: 'Patients', roles: ['Director', 'Coordinator', 'Social Worker'] },
  { path: '/quality', label: 'Quality', roles: ['Director'] },
  { path: '/governance', label: 'Governance', roles: ['Director'] },
  { path: '/cost-roi', label: 'Cost/ROI', roles: ['Director', 'Coordinator', 'Social Worker'] },
  { path: '/alerts', label: 'Alerts', roles: ['Director', 'Coordinator', 'Social Worker'] },
  { path: '/settings', label: 'Settings', roles: ['Director', 'Coordinator', 'Social Worker'] },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  for (const role of roles) {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel('Email').fill(role.email);
    await page.getByLabel('Password').fill(role.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(new RegExp(`${role.home}$`));

    console.log(`\n## ${role.name} (${role.email})`);

    for (const route of routes) {
      if (!route.roles.includes(role.name)) continue;
      await page.goto(`${BASE_URL}${route.path}`);
      await page.waitForLoadState('networkidle');

      const heading = await page.locator('h1').first().textContent().catch(() => '—');
      const summary = await page.locator('[data-testid="page-summary"]').textContent().catch(() => '');
      console.log(`- ${route.label}: ${heading.trim()}${summary ? ` — ${summary.trim()}` : ''}`);
    }

    await page.close();
  }

  await browser.close();
}

main().catch(console.error);
