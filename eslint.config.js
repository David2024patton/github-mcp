// Copied from Robinson-AI-Systems/stripe-mcp eslint.config.js @ e2f90e8 (vendor/ excluded: vendored descriptions are data).
// Deliberately lightweight Node/ESM lint; correctness is exercised by tests.
export default [{
  files: ['**/*.{js,mjs}'],
  ignores: ['node_modules/**', 'coverage/**', 'vendor/**', '.cache/**'],
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-dupe-keys': 'error',
    'no-self-assign': 'error'
  }
}];
