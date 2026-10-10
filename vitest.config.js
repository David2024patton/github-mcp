import { defineConfig } from 'vitest/config';
// Unit suite: no network, no database, no real GitHub. `npm test`.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node', testTimeout: 15000 }
});
