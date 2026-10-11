// What each area of this server's tools needs from a GitHub App installation (B-8). One list, reviewed here; every
// permission name must also appear in the App manifest (`tests/unit/diagnostic-tools.test.js` checks that). Levels:
// read < write. Areas follow the sections of docs/TOOL-CATALOG.md.
export const LEVELS = Object.freeze({ read: 1, write: 2, admin: 3 });

export const AREAS = Object.freeze([
  { id: 'repositories', title: 'Repositories and settings', tools: 'github_repo_*', needs: { metadata: 'read', administration: 'write' } },
  { id: 'content', title: 'Files, commits and git data', tools: 'github_content_*, github_commit_*, github_git_*', needs: { contents: 'write' } },
  { id: 'branches', title: 'Branches and tags', tools: 'github_branch_*, github_tag_*', needs: { contents: 'write' } },
  { id: 'pull-requests', title: 'Pull requests and reviews', tools: 'github_pr_*, github_review_*', needs: { pull_requests: 'write', contents: 'write' } },
  { id: 'issues', title: 'Issues, labels and milestones', tools: 'github_issue_*, github_label_*, github_milestone_*', needs: { issues: 'write' } },
  { id: 'discussions-projects', title: 'Discussions and projects', tools: 'github_discussion_*, github_project_*', needs: { discussions: 'write', organization_projects: 'write' } },
  { id: 'actions', title: 'Actions runs and jobs', tools: 'github_actions_*', needs: { actions: 'write' } },
  { id: 'workflow-files', title: 'Editing workflow files', tools: 'github_content_* on .github/workflows', needs: { workflows: 'write' } },
  { id: 'checks', title: 'Checks, statuses, artifacts and caches', tools: 'github_check_*, github_status_*, github_artifact_*', needs: { checks: 'write', statuses: 'write', actions: 'write' } },
  { id: 'secrets', title: 'Secrets and variables', tools: 'github_secret_*, github_variable_*',
    needs: { secrets: 'write', actions_variables: 'write', dependabot_secrets: 'write', codespaces_secrets: 'write', organization_secrets: 'write', organization_actions_variables: 'write' } },
  { id: 'environments', title: 'Environments and deployments', tools: 'github_env_*, github_deploy_*', needs: { environments: 'write', deployments: 'write' } },
  { id: 'releases', title: 'Releases', tools: 'github_release_*', needs: { contents: 'write' } },
  { id: 'pages', title: 'Pages', tools: 'github_pages_*', needs: { pages: 'write' } },
  { id: 'developer', title: 'Developer tools', tools: 'github_dev_*', needs: { actions: 'write', contents: 'write', checks: 'write', statuses: 'write', repository_hooks: 'write' } },
  { id: 'protection', title: 'Branch protection and rulesets', tools: 'github_protection_*, github_ruleset_*', needs: { administration: 'write' } },
  { id: 'webhooks', title: 'Webhooks', tools: 'github_webhook_*', needs: { repository_hooks: 'write', organization_hooks: 'write' } },
  { id: 'collaborators', title: 'Collaborators and deploy keys', tools: 'github_collab_*, github_deploykey_*', needs: { administration: 'write' } },
  { id: 'security', title: 'Security features and alerts', tools: 'github_security_*', needs: { security_events: 'write', secret_scanning_alerts: 'write', vulnerability_alerts: 'write', administration: 'write' } },
  { id: 'organization', title: 'Organization, members and teams', tools: 'github_org_*, github_team_*, github_role_*',
    needs: { members: 'write', organization_administration: 'read', organization_custom_org_roles: 'read' } },
  { id: 'billing', title: 'Billing, Copilot and Codespaces', tools: 'github_billing_*, github_copilot_*, github_codespace_*',
    needs: { organization_plan: 'read', organization_copilot_seat_management: 'write', organization_codespaces: 'write', codespaces: 'write' } },
  { id: 'tokens', title: 'Fine-grained token approvals', tools: 'github_tokenpolicy_*', needs: { organization_personal_access_tokens: 'write', organization_personal_access_token_requests: 'write' } }
]);
