import { describe, expect, it } from 'vitest';
import { mergeNamespaces } from '../../src/core/registry.js';
import { registry } from '../../src/tools/index.js';

const make = (name) => ({ tools: [{ name }], handlers: { [name]: async () => null } });

describe('tool registry', () => {
  it('holds exactly the tools built so far, each with a handler and only github_ names', () => {
    const names = ['github_search_tools', 'github_describe_tool', 'github_call', 'github_batch', 'github_whoami', 'github_list_accounts', 'github_list_protected_resources', 'github_list_connections', 'github_recent_changes', 'github_get_result', 'github_enable_production', 'github_disable_production',
      'github_set_spend_limit', 'github_set_default_account', 'github_revoke_connection', 'github_check_permissions', 'github_rate_status', 'github_where_is_setting', 'github_dev_list_scenarios', 'github_dev_list_runs', 'github_dev_create_scratch_repo', 'github_dev_seed', 'github_dev_cleanup',
      'github_repo_list', 'github_repo_get', 'github_repo_find', 'github_repo_get_insights', 'github_repo_get_traffic', 'github_repo_list_activity', 'github_repo_get_custom_properties',
      ...['create', 'create_from_template', 'update_settings', 'set_visibility', 'set_default_branch', 'rename', 'set_archived', 'transfer', 'delete', 'fork', 'sync_fork', 'set_custom_properties', 'star'].map((n) => `github_repo_${n}`),
      'github_content_get', 'github_content_get_tree', 'github_content_get_archive_link', 'github_content_check_codeowners', 'github_commit_list', 'github_commit_get', 'github_commit_compare', 'github_commit_list_prs', 'github_git_get_ref', 'github_git_get_commit',
      'github_content_put_file', 'github_content_delete_file', 'github_content_push_files', 'github_commit_comment', 'github_git_update_ref',
      'github_branch_list', 'github_branch_get', 'github_tag_list', 'github_branch_create', 'github_branch_rename', 'github_branch_delete', 'github_branch_merge', 'github_tag_create', 'github_tag_delete',
      'github_pr_list', 'github_pr_get', 'github_pr_get_diff', 'github_pr_list_files', 'github_pr_list_commits',
      'github_issue_list', 'github_issue_get', 'github_issue_list_comments', 'github_issue_list_timeline',
      'github_issue_create', 'github_issue_update', 'github_issue_comment', 'github_issue_lock', 'github_issue_edit_comment', 'github_issue_set_labels', 'github_issue_set_assignees',
      'github_issue_set_sub_issue', 'github_issue_set_dependency', 'github_issue_react', 'github_issue_transfer',
      'github_label_list', 'github_label_save', 'github_label_delete', 'github_milestone_list', 'github_milestone_save', 'github_milestone_delete', 'github_label_sync', 'github_search_github', 'github_discussion_list', 'github_discussion_get', 'github_discussion_create', 'github_discussion_comment', 'github_project_list', 'github_project_get', 'github_project_list_items', 'github_project_set_item', 'github_project_remove_item', 'github_protection_get', 'github_ruleset_list', 'github_ruleset_get', 'github_ruleset_list_rule_suites', 'github_ruleset_save', 'github_ruleset_delete', 'github_protection_set_required_checks', 'github_protection_set', 'github_protection_remove', 'github_webhook_list', 'github_webhook_get', 'github_webhook_list_deliveries', 'github_webhook_delete', 'github_webhook_redeliver', 'github_webhook_ping', 'github_webhook_save', 'github_webhook_rotate_secret',
      'github_collab_list', 'github_deploykey_list', 'github_collab_add', 'github_collab_remove', 'github_collab_manage_invitation', 'github_deploykey_add', 'github_deploykey_delete', 'github_security_list_alerts', 'github_security_get_alert', 'github_security_list_advisories', 'github_security_compare_dependencies', 'github_security_update_alert', 'github_security_get_settings', 'github_actions_get_settings', 'github_security_set_feature', 'github_actions_set_settings', 'github_admin_list_guided_settings', 'github_admin_check_setting', 'github_admin_overview', 'github_admin_review_security', 'github_org_get', 'github_org_list_members', 'github_org_list_invitations', 'github_org_update_settings', 'github_org_invite_member', 'github_org_cancel_invitation', 'github_org_set_member_role', 'github_org_remove_member', 'github_org_set_outside_collaborator', 'github_org_set_blocked', 'github_org_custom_properties', 'github_org_set_immutable_releases', 'github_team_list', 'github_team_get', 'github_role_list', 'github_team_save', 'github_team_delete', 'github_team_set_member', 'github_team_set_repo_access', 'github_role_assign', 'github_role_remove', 'github_billing_get_usage', 'github_billing_list_budgets', 'github_billing_list_marketplace', 'github_copilot_get_billing', 'github_codespace_list', 'github_billing_delete_budget', 'github_codespace_set_org_access', 'github_billing_save_budget', 'github_copilot_add_seats', 'github_copilot_remove_seats', 'github_codespace_create', 'github_codespace_set_state', 'github_codespace_delete',
      'github_app_list_installations', 'github_app_get_installation', 'github_tokenpolicy_list_requests', 'github_tokenpolicy_list_tokens', 'github_app_set_installation_repos', 'github_tokenpolicy_review_request', 'github_tokenpolicy_revoke_access',
      'github_pr_create', 'github_pr_update', 'github_pr_close', 'github_pr_set_draft', 'github_pr_update_branch',
      'github_pr_merge', 'github_pr_merge_async', 'github_pr_set_auto_merge', 'github_pr_list_stacks', 'github_pr_stack_manage',
      'github_review_list', 'github_review_list_threads', 'github_review_list_comments',
      'github_review_create', 'github_review_submit', 'github_review_dismiss', 'github_review_reply', 'github_review_resolve_thread', 'github_review_request_reviewers',
      'github_actions_list_workflows', 'github_actions_list_runs', 'github_actions_get_run', 'github_actions_get_job_log', 'github_actions_get_run_logs_summary', 'github_actions_list_pending_deployments',
      'github_actions_set_workflow_enabled', 'github_actions_dispatch', 'github_actions_rerun', 'github_actions_cancel_run', 'github_actions_delete_run', 'github_actions_review_pending_deployment',
      'github_check_get_ci_state', 'github_check_get_run', 'github_artifact_list', 'github_artifact_get_link', 'github_cache_list',
      'github_check_create_run', 'github_check_update_run', 'github_status_create', 'github_artifact_delete', 'github_cache_delete',
      'github_variable_list', 'github_secret_list', 'github_variable_set', 'github_variable_delete', 'github_secret_set', 'github_secret_delete', 'github_secret_set_repo_access', 'github_env_list', 'github_env_get', 'github_env_save', 'github_env_delete', 'github_env_policy_create', 'github_env_policy_update', 'github_env_policy_delete', 'github_deploy_list', 'github_deploy_create', 'github_deploy_set_status', 'github_release_list', 'github_release_get', 'github_release_create', 'github_release_update', 'github_release_delete', 'github_release_upload_asset', 'github_release_delete_asset', 'github_pages_get', 'github_package_list', 'github_pages_save', 'github_pages_disable', 'github_package_delete_version', 'github_package_delete', 'github_package_restore_version'];
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
