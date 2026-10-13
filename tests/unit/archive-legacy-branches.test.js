import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHIVE_REF, OLD_HEADS, archiveCommitArgs, validateOldHeads } from '../../scripts/archive-legacy-branches.mjs';

describe('history-only branch archival', () => {
  it('pins the known 15 divergent source refs without permitting main/live', () => {
    expect(ARCHIVE_REF).toBe('archive/legacy-ai-2026-10-13');
    expect(validateOldHeads(OLD_HEADS)).toBe(true);
    expect(new Set(OLD_HEADS.map(([name]) => name)).size).toBe(15);
    expect(OLD_HEADS.some(([name]) => name === 'main' || name === 'live')).toBe(false);
    expect(() => validateOldHeads([['ai/a', 'a'.repeat(40)]])).toThrow();
    const bad = OLD_HEADS.map((x) => [...x]);
    bad[0][0] = 'main';
    expect(() => validateOldHeads(bad)).toThrow();
    bad[0][0] = bad[1][0];
    expect(() => validateOldHeads(bad)).toThrow();
    expect(() => archiveCommitArgs('invalid', 'a'.repeat(40))).toThrow();
  });

  it('archives all 15 source commits as ancestors without incorporating any source files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'github-mcp-archive-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      git('init', '-q');
      git('config', 'user.email', 'test@example.test');
      git('config', 'user.name', 'Archive Fixture');
      git('commit', '--allow-empty', '-m', 'main fixture');
      const main = git('rev-parse', 'HEAD');
      const tree = git('rev-parse', 'HEAD^{tree}');
      const heads = [];
      for (let i = 0; i < 15; i += 1) {
        git('checkout', '-q', '--detach', main);
        git('commit', '--allow-empty', '-m', 'historical unique commit ' + i);
        heads.push(['ai/fixture/' + i, git('rev-parse', 'HEAD')]);
      }
      const archived = git(...archiveCommitArgs(tree, main, heads));
      expect(git('rev-parse', archived + '^{tree}')).toBe(tree);
      expect(git('show', '--format=%P', '--no-patch', archived).split(' ').length).toBe(16);
      for (const [, sha] of heads) {
        const check = spawnSync('git', ['merge-base', '--is-ancestor', sha, archived], { cwd });
        expect(check.status).toBe(0);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
