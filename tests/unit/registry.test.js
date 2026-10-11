import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('holds exactly the tools built so far, each with a handler and only github_ names', () => {
    const names = ['github_whoami', 'github_list_accounts', 'github_list_protected_resources', 'github_list_connections', 'github_recent_changes', 'github_get_result', 'github_enable_production', 'github_disable_production',
      'github_set_spend_limit', 'github_set_default_account', 'github_revoke_connection', 'github_check_permissions', 'github_rate_status', 'github_where_is_setting'];
    expect(registry.tools.map((t) => t.name)).toEqual(names);
    expect(Object.keys(registry.handlers)).toEqual(names);
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
