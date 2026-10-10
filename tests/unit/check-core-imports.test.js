import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findCoreImportViolations } from '../../scripts/check-core-imports.mjs';

const SCRIPT = resolve('scripts/check-core-imports.mjs');
let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });
function repo(files) {
  dir = mkdtempSync(join(tmpdir(), 'github-mcp-core-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('core-imports check', () => {
  it('fails when src/core imports @octokit/core', () => {
    const root = repo({ 'src/core/x.js': "import { Octokit } from '@octokit/core';\nexport const o = Octokit;\n" });
    expect(findCoreImportViolations(root).violations).toEqual([{ file: 'src/core/x.js', specifier: '@octokit/core' }]);
    const run = spawnSync('node', [SCRIPT, root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('src/core/x.js imports "@octokit/core"');
  });

  it('fails on relative, re-export, dynamic and require imports of src/github or src/tools', () => {
    const root = repo({
      'src/core/a.js': "export { githubFor } from '../github/client.js';\n",
      'src/core/deep/b.js': "const m = await import('../../tools/index.js');\n",
      'src/core/c.cjs': "const x = require('@octokit/auth-app');\n"
    });
    const specs = findCoreImportViolations(root).violations.map((v) => v.specifier).sort();
    expect(specs).toEqual(['../../tools/index.js', '../github/client.js', '@octokit/auth-app']);
  });

  it('passes for generic imports and says so when src/core is empty', () => {
    const ok = repo({ 'src/core/ok.js': "import crypto from 'node:crypto';\nimport { x } from './y.js';\n" });
    expect(findCoreImportViolations(ok)).toEqual({ files: 1, violations: [] });
    rmSync(ok, { recursive: true, force: true });
    const empty = repo({ 'README.md': 'x' });
    const run = spawnSync('node', [SCRIPT, empty], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('src/core/ is empty');
  });

  it('passes on this repository', () => {
    expect(findCoreImportViolations(resolve('.')).violations).toEqual([]);
  });
});
