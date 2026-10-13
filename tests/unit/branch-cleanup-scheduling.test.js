import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('branch maintenance schedule isolation', () => {
  const pruning = readFileSync('.github/workflows/prune-merged-branches.yml', 'utf8');
  const archive = readFileSync('.github/workflows/archive-legacy-branches.yml', 'utf8');

  it('runs normal cleanup only for a merged PR and serializes by that PR', () => {
    expect(pruning).toContain('types: [closed]');
    expect(pruning).toContain('github.event.pull_request.merged == true');
    expect(pruning).not.toMatch(/^\s*push:\s*$/m);
    expect(pruning).toContain('branch-prune-${{ github.event.pull_request.number }}');
    expect(pruning).not.toContain('branch-cleanup-${{ github.repository }}');
  });

  it('checks for a newly opened PR immediately before deleting any branch', () => {
    const pruningScript = readFileSync('scripts/prune-merged-branches.mjs', 'utf8');
    const archiveScript = readFileSync('scripts/archive-legacy-branches.mjs', 'utf8');
    expect(pruningScript).toContain('if ((await openPRHeads()).has(name))');
    expect(archiveScript).toContain('if ((await activePRHeads()).has(name))');
    expect(pruningScript.indexOf('if ((await openPRHeads()).has(name))')).toBeLessThan(
      pruningScript.indexOf("const removed = spawnSync('git'")
    );
    expect(archiveScript.indexOf('if ((await activePRHeads()).has(name))')).toBeLessThan(
      archiveScript.indexOf("const attempt = spawnSync('git', [")
    );
  });

  it('does not let unrelated cleanup runs cancel the one-time archive', () => {
    expect(archive).toContain("paths: ['.github/workflows/archive-legacy-branches.yml']");
    expect(archive).not.toMatch(/^concurrency:\s*$/m);
    expect(archive).not.toContain('branch-cleanup-${{ github.repository }}');
  });
});
