import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(dirname, '../..');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: 'npm run dev --workspace apps/api',
      cwd: REPO_ROOT,
      url: 'http://localhost:4000/health',
      timeout: 30_000,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev --workspace apps/web',
      cwd: REPO_ROOT,
      url: 'http://localhost:5173',
      timeout: 30_000,
      reuseExistingServer: true,
    },
  ],
});
