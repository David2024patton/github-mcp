import { describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { curatedTargets, curatedGraphqlMutation } from '../../src/github/mutation-classes.js';
import { handBuiltTargets } from '../../src/github/hand-built-map.js';

// Y-1: the universal tools tell the caller "use <tool>" for operations a specialised tool owns. If that tool does not
// exist the caller is stuck (the changeUserStatus deadlock). This test fails when a pointer names a missing tool.
const names = new Set(registry.tools.map((t) => t.name));

describe('registry consistency', () => {
  it('every curated GraphQL mutation points at a registered tool', () => {
    expect(curatedTargets().length).toBeGreaterThan(10);
    for (const tool of curatedTargets()) expect(names.has(tool), `curated GraphQL target ${tool}`).toBe(true);
  });
  it('every hand-built REST pointer names a registered tool', () => {
    expect(handBuiltTargets().length).toBeGreaterThan(10);
    for (const tool of handBuiltTargets()) expect(names.has(tool), `hand-built REST target ${tool}`).toBe(true);
  });
  it('changeUserStatus is owned by github_account_set_status', () => {
    expect(curatedGraphqlMutation('changeUserStatus')).toBe('github_account_set_status');
  });
});
