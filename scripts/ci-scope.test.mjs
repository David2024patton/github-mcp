import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsCode } from './ci-scope.mjs';

test('documentation that no test reads skips the heavy jobs', () => {
  assert.equal(needsCode(['docs/designs/FINISH-PLAN.md', 'docs/status/2026-10-23-x.md', 'README.md'], ['nothing here']), false);
});
test('code, config, data files and documents read by tests always run everything', () => {
  assert.equal(needsCode(['src/db.js'], []), true);
  assert.equal(needsCode(['.github/workflows/ci.yml'], []), true);
  assert.equal(needsCode(['docs/pr-cards/work-index.json'], []), true);              // not Markdown
  assert.equal(needsCode(['docs/TOOL-CATALOG.md'], ["readFileSync('../../docs/TOOL-CATALOG.md')"]), true);
  assert.equal(needsCode(['docs/a.md', 'scripts/x.mjs'], []), true);
  assert.equal(needsCode([], []), true);                                                // unknown → run
});
test('every timed CI job has the scope step and gates its heavy steps on it', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobs = ci.split(/^jobs:\s*$/m)[1].split(/^  (?=[a-z]+[a-z0-9_-]*:\s*$)/m);
  for (const id of ['unit', 'db', 'shapes', 'rtc', 'browser']) {
    const block = jobs.find((b) => b.startsWith(id + ':'));
    assert.ok(block, id);
    assert.match(block, /id: scope/, id + ' has the scope step');
    assert.match(block, /if: steps\.scope\.outputs\.code == 'true'\n\s+run: node scripts\/ci-phase\.mjs/, id + ' gates its test step');
  }
  assert.doesNotMatch(ci.split(/^  check:\s*$/m)[1].split(/^  [a-z]+:\s*$/m)[0], /id: scope/, 'check always runs in full');
});
