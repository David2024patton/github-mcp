import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('permanent branch cleanup policy', () => {
  const pruning = readFileSync('.github/workflows/prune-merged-branches.yml', 'utf8');

  it('runs only on merged PR closures and serializes by exact PR', () => {
    expect(pruning).toContain('types: [closed]');
    expect(pruning).toContain('github.event.pull_request.merged == true');
    expect(pruning).not.toMatch(/^\s*push:\s*$/m);
    expect(pruning).toContain('branch-prune-${{ github.event.pull_request.number }}');
    expect(pruning).not.toContain('branch-cleanup-${{ github.repository }}');
  });

  it('rechecks newly opened PRs immediately before deleting any branch', () => {
    const pruningScript = readFileSync('scripts/prune-merged-branches.mjs', 'utf8');
    expect(pruningScript).toContain('if ((await openPRHeads()).has(name))');
    expect(pruningScript.indexOf('if ((await openPRHeads()).has(name))')).toBeLessThan(
      pruningScript.indexOf("const removed = spawnSync('git'")
    );
  });

  it('leaves no privileged one-time historical archival workflow or helper', () => {
    expect(existsSync('.github/workflows/archive-legacy-branches.yml')).toBe(false);
    expect(existsSync('scripts/archive-legacy-branches.mjs')).toBe(false);
    expect(existsSync('tests/unit/archive-legacy-branches.test.js')).toBe(false);
    expect(pruning).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(pruning).toContain('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1');
  });
});
