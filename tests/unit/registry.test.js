import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('holds exactly the tools built so far, each with a handler and only github_ names', () => {
    const names = ['github_search_tools', 'github_describe_tool', 'github_call', 'github_batch', 'github_whoami', 'github_list_accounts', 'github_list_protected_resources', 'github_list_connections', 'github_recent_changes', 'github_get_result', 'github_enable_production', 'github_disable_production',
      'github_set_spend_limit', 'github_set_default_account', 'github_revoke_connection', 'github_check_permissions', 'github_rate_status', 'github_where_is_setting',
      'github_repo_list', 'github_repo_get', 'github_repo_find', 'github_repo_get_insights', 'github_repo_get_traffic', 'github_repo_list_activity', 'github_repo_get_custom_properties',
      ...['create', 'create_from_template', 'update_settings', 'set_visibility', 'set_default_branch', 'rename', 'set_archived', 'transfer', 'delete', 'fork', 'sync_fork', 'set_custom_properties', 'star'].map((n) => `github_repo_${n}`),
      'github_content_get', 'github_content_get_tree', 'github_content_get_archive_link', 'github_content_check_codeowners', 'github_commit_list', 'github_commit_get', 'github_commit_compare', 'github_commit_list_prs', 'github_git_get_ref', 'github_git_get_commit',
      'github_content_put_file', 'github_content_delete_file', 'github_content_push_files', 'github_commit_comment', 'github_git_update_ref'];
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
