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
      'github_content_put_file', 'github_content_delete_file', 'github_content_push_files', 'github_commit_comment', 'github_git_update_ref',
      'github_branch_list', 'github_branch_get', 'github_tag_list', 'github_branch_create', 'github_branch_rename', 'github_branch_delete', 'github_branch_merge', 'github_tag_create', 'github_tag_delete',
      'github_pr_list', 'github_pr_get', 'github_pr_get_diff', 'github_pr_list_files', 'github_pr_list_commits',
      'github_pr_create', 'github_pr_update', 'github_pr_close', 'github_pr_set_draft', 'github_pr_update_branch',
      'github_pr_merge', 'github_pr_merge_async', 'github_pr_set_auto_merge', 'github_pr_list_stacks', 'github_pr_stack_manage',
      'github_review_list', 'github_review_list_threads', 'github_review_list_comments',
      'github_review_create', 'github_review_submit', 'github_review_dismiss', 'github_review_reply', 'github_review_resolve_thread', 'github_review_request_reviewers',
      'github_actions_list_workflows', 'github_actions_list_runs', 'github_actions_get_run', 'github_actions_get_job_log', 'github_actions_get_run_logs_summary', 'github_actions_list_pending_deployments',
      'github_actions_set_workflow_enabled', 'github_actions_dispatch', 'github_actions_rerun', 'github_actions_cancel_run', 'github_actions_delete_run', 'github_actions_review_pending_deployment',
      'github_check_get_ci_state', 'github_check_get_run', 'github_artifact_list', 'github_artifact_get_link', 'github_cache_list',
      'github_check_create_run', 'github_check_update_run', 'github_status_create', 'github_artifact_delete', 'github_cache_delete',
      'github_variable_list', 'github_secret_list', 'github_variable_set', 'github_variable_delete', 'github_secret_set', 'github_secret_delete', 'github_secret_set_repo_access', 'github_env_list', 'github_env_get', 'github_env_save', 'github_env_delete', 'github_env_policy_create', 'github_env_policy_update', 'github_env_policy_delete', 'github_deploy_list', 'github_deploy_create', 'github_deploy_set_status', 'github_release_list', 'github_release_get', 'github_release_create', 'github_release_update', 'github_release_delete', 'github_release_delete_asset'];
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
