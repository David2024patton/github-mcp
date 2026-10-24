import { scopeCovered } from './personal-cred.js';
// GOD-3: one row per God-mode area — the plain name, the classic scope that unlocks it, and the tools it opens.
// Later cards (GOD-4, ENT-1) append their tool names to the right rows; keep the list in this one file.
export const MASTER_AREAS = Object.freeze([
  { area: 'Gists', scope: 'gist', tools: ['github_gist_list', 'github_gist_get', 'github_gist_save', 'github_gist_delete'] },
  { area: 'Notifications', scope: 'notifications', tools: ['github_notify_list', 'github_notify_mark', 'github_notify_set_subscription'] },
  { area: 'Packages', scope: 'write:packages', tools: ['github_package_list', 'github_package_delete', 'github_package_delete_version', 'github_package_restore_version'] },
  { area: 'SSH keys', scope: 'admin:public_key', tools: ['github_account_list_keys', 'github_account_add_key', 'github_account_delete_key'] },
  { area: 'GPG and signing keys', scope: 'admin:gpg_key', tools: [] },
  { area: 'Your profile, emails, follows and blocks', scope: 'user', tools: ['github_account_update_profile', 'github_account_manage_email', 'github_account_set_blocked', 'github_user_follow', 'github_user_set_social', 'github_account_set_status'] },
  { area: 'Stars, watching and star lists', scope: 'repo', tools: ['github_repo_star', 'github_repo_watch', 'github_star_list_manage', 'github_user_hovercard'] },
  { area: 'Classroom and Marketplace reads', scope: 'repo', tools: ['github_classroom_list', 'github_classroom_get', 'github_classroom_assignments', 'github_classroom_grades', 'github_marketplace_listing'] },
  { area: 'Copilot Spaces', scope: 'user', tools: ['github_copilot_space_list', 'github_copilot_space_get', 'github_copilot_space_save', 'github_copilot_space_delete', 'github_copilot_space_collaborators', 'github_copilot_space_set_collaborator', 'github_copilot_space_remove_collaborator', 'github_copilot_space_resources', 'github_copilot_space_set_resource', 'github_copilot_space_remove_resource'] },
  { area: 'Your Codespaces', scope: 'codespace', tools: ['github_codespace_list', 'github_codespace_create', 'github_codespace_set_state', 'github_codespace_delete', 'github_codespace_list_machines', 'github_secret_set', 'github_secret_delete', 'github_secret_list'] },
  { area: 'Your account export', scope: 'repo', tools: ['github_account_export_start', 'github_account_export_status', 'github_account_export_link', 'github_account_export_delete'] },
  { area: 'Organization admin extras (migrations)', scope: 'admin:org', tools: ['github_org_migration_start', 'github_org_migration_status'] },
  { area: 'Projects', scope: 'project', tools: ['github_project_view_create'] },
  { area: 'Enterprise (ENT-1)', scope: 'admin:enterprise', tools: ['github_enterprise_list', 'github_enterprise_overview', 'github_enterprise_security_configs', 'github_enterprise_security_config_save', 'github_enterprise_security_config_delete',
    'github_enterprise_security_config_apply', 'github_enterprise_dependabot', 'github_enterprise_dependabot_access_set', 'github_enterprise_copilot_metrics', 'github_enterprise_actions_settings', 'github_enterprise_actions_settings_set', 'github_enterprise_policy_set', 'github_enterprise_profile_set'] }
]);

/** [{area, unlocked, needs}] — `needs` is the permission to tick on GitHub when locked. Never includes the token. */
export function masterUnlocks(scopes = []) {
  return MASTER_AREAS.map((a) => {
    const unlocked = scopeCovered(scopes, a.scope);
    return { area: a.area, unlocked, ...(unlocked ? {} : { needs: a.scope }) };
  });
}
