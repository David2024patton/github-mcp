import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('holds exactly the tools built so far, each with a handler and only github_ names', () => {
    expect(registry.tools.map((t) => t.name)).toEqual(['github_whoami', 'github_list_accounts']);
    expect(Object.keys(registry.handlers)).toEqual(['github_whoami', 'github_list_accounts']);
    for (const tool of registry.tools) expect(tool.name).toMatch(/^github_[a-z_]+$/);
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
