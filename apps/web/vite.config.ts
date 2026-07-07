/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    // 15s default timeout — the W06 Governance / MoreScreens tests issue
    // 4 parallel TanStack queries through a mocked apiFetch and occasionally
    // spike past the 5s default when the full 220-test suite runs back-to-back
    // under jsdom. Bumped from 5s → 15s to keep the suite stable without
    // touching the tests themselves.
    testTimeout: 15000,
    // Playwright specs live under e2e/ and run via `npm run test:e2e`;
    // exclude them here so `vitest run` doesn't try to collect them too.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
