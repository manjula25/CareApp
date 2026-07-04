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
    // Playwright specs live under e2e/ and run via `npm run test:e2e`;
    // exclude them here so `vitest run` doesn't try to collect them too.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
