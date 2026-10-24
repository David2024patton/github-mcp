import { defineConfig } from 'vitest/config';
// Local-only load test of the public sign-in (tests/load): real api/ handlers, fake GitHub and app, throwaway localhost Postgres.
// `npm run test:load` (or `node scripts/load-test-public.mjs`). Never part of CI and never pointed at a real service.
export default defineConfig({
  test: { include: ['tests/load/**/*.test.js'], environment: 'node', testTimeout: 600000, hookTimeout: 120000, fileParallelism: false }
});
