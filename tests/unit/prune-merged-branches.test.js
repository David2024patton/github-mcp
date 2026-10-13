import { describe, expect, it } from 'vitest';
import { cleanupCandidate, parseTrackingRefs } from '../../scripts/prune-merged-branches.mjs';

describe('merged branch cleanup guardrails', () => {
  it('allows only AI working refs, never main/live or arbitrary names', () => {
    expect(cleanupCandidate('ai/gpt6/task')).toBe(true);
    expect(cleanupCandidate('ai/codex/fix-race')).toBe(true);
    for (const name of [
      'main', 'live', 'refs/heads/main', 'release/main', 'archive/old',
      'ai/../main', 'ai//x', 'ai/.', 'ai/task..other', 'ai/x.lock',
      'ai/target.', 'ai/x;echo-bad'
    ]) expect(cleanupCandidate(name)).toBe(false);
  });

  it('limits a merged-PR cleanup to the exact source branch', () => {
    expect(cleanupCandidate('ai/gpt6/task', 'ai/gpt6/task')).toBe(true);
    expect(cleanupCandidate('ai/gpt6/task', 'ai/gpt6/another')).toBe(false);
  });

  it('requires strict names and complete immutable SHA values', () => {
    const sha = 'a'.repeat(40);
    expect(parseTrackingRefs('ai/gpt6/task\t' + sha + '\n')).toEqual([
      { name: 'ai/gpt6/task', sha }
    ]);
    for (const sample of [
      'ai/gpt6/task\tinvalid\n',
      'main\t' + sha + '\n',
      'ai/../live\t' + sha + '\n',
      'ai/gpt6/task\t' + sha + '\textra\n'
    ]) expect(() => parseTrackingRefs(sample)).toThrow();
  });
});
