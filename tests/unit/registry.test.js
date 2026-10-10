import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('starts empty until the first tool card lands', () => {
    expect(registry.tools).toEqual([]);
    expect(Object.keys(registry.handlers)).toEqual([]);
  });
  it('merges namespaces in order', () => {
    const merged = mergeNamespaces([make('github_a'), make('github_b')]);
    expect(merged.tools.map((t) => t.name)).toEqual(['github_a', 'github_b']);
    expect(typeof merged.handlers.github_b).toBe('function');
  });
  it('throws on duplicate tool names across namespaces', () => {
    expect(() => mergeNamespaces([make('github_repo_get'), make('github_repo_get')])).toThrow(/Duplicate/);
  });
  it('throws when a tool has no handler', () => {
    expect(() => mergeNamespaces([{ tools: [{ name: 'github_broken' }], handlers: {} }])).toThrow(/Missing handler/);
  });
});
