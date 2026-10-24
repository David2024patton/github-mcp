import { defineConfig } from 'vitest/config';
// Real-browser sign-in suite (tests/browser): real api/ handlers, fake GitHub and app, throwaway localhost Postgres.
// `npm run test:browser`. Browser engines come from Playwright (`npx playwright install chromium webkit`).
export default defineConfig({
  test: { include: ['tests/browser/**/*.test.js'], environment: 'node', testTimeout: 60000, hookTimeout: 60000, fileParallelism: false }
});
