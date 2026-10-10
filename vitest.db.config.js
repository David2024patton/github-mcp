import { defineConfig } from 'vitest/config';
// Database suite: throwaway localhost Postgres only (scripts/local-postgres-test.sh). `npm run test:db`.
export default defineConfig({
  test: { include: ['tests/db/**/*.test.js'], environment: 'node', testTimeout: 30000, hookTimeout: 30000, fileParallelism: false }
});
