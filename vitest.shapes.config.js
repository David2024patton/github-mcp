import { defineConfig } from 'vitest/config';
// Request-shape suite: Octokit wired to the fake GitHub (test/helpers/fake-github.js). `npm run test:shapes`.
export default defineConfig({
  test: { include: ['tests/shapes/**/*.test.js'], environment: 'node', testTimeout: 15000 }
});
