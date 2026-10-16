// Y-9b: independent read-backs for guided dashboard settings. Each entry names a guided setting (an id in dashboard-map.js), and for each
// field a GET route, the JSON pointer of the value and its type. A guide never says "done" unless the value read from GitHub matches.
// `{org}` / `{owner}` / `{repo}` in a route are filled from the call. `absent` is what a missing value means (GitHub omits a limit that is off).
const f = (route, pointer, type, extra = {}) => ({ route, pointer, type, ...extra });
const ORG = 'GET /orgs/{org}';
const REPO = 'GET /repos/{owner}/{repo}';

export const READBACKS = Object.freeze({
  'org-page-general': { scope: 'org', fields: { displayName: f(ORG, 'name', 'string'), description: f(ORG, 'description', 'string') } },
  'org-page-member-privileges': { scope: 'org', fields: {
    defaultRepositoryPermission: f(ORG, 'default_repository_permission', 'string'),
    membersCanCreateRepositories: f(ORG, 'members_can_create_repositories', 'boolean'),
    membersCanCreatePrivateRepositories: f(ORG, 'members_can_create_private_repositories', 'boolean'),
    webCommitSignoffRequired: f(ORG, 'web_commit_signoff_required', 'boolean') } },
  'org-page-repo-defaults': { scope: 'org', fields: { immutableReleasesEnforcedFor: f('GET /orgs/{org}/settings/immutable-releases', 'enforced_repositories', 'string') } },
  'org-page-actions': { scope: 'org', fields: {
    enabledRepositories: f('GET /orgs/{org}/actions/permissions', 'enabled_repositories', 'string'),
    allowedActions: f('GET /orgs/{org}/actions/permissions', 'allowed_actions', 'string'),
    artifactRetentionDays: f('GET /orgs/{org}/actions/permissions/artifact-and-log-retention', 'days', 'number') } },
  'org-interaction-limit': { scope: 'org', fields: { limit: f('GET /orgs/{org}/interaction-limits', 'limit', 'string', { absent: 'none' }) } },
  'repo-page-general': { scope: 'repo', fields: {
    defaultBranch: f(REPO, 'default_branch', 'string'), private: f(REPO, 'private', 'boolean'), archived: f(REPO, 'archived', 'boolean'),
    hasIssues: f(REPO, 'has_issues', 'boolean'), hasWiki: f(REPO, 'has_wiki', 'boolean'), hasProjects: f(REPO, 'has_projects', 'boolean'), hasDiscussions: f(REPO, 'has_discussions', 'boolean'),
    allowSquashMerge: f(REPO, 'allow_squash_merge', 'boolean'), allowMergeCommit: f(REPO, 'allow_merge_commit', 'boolean'), allowRebaseMerge: f(REPO, 'allow_rebase_merge', 'boolean'),
    deleteBranchOnMerge: f(REPO, 'delete_branch_on_merge', 'boolean'),
    immutableReleases: f('GET /repos/{owner}/{repo}/immutable-releases', 'enabled', 'boolean') } },
  'repo-page-actions': { scope: 'repo', fields: {
    actionsEnabled: f('GET /repos/{owner}/{repo}/actions/permissions', 'enabled', 'boolean'),
    allowedActions: f('GET /repos/{owner}/{repo}/actions/permissions', 'allowed_actions', 'string'),
    artifactRetentionDays: f('GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention', 'days', 'number') } },
  'repo-page-security': { scope: 'repo', fields: {
    secretScanning: f(REPO, 'security_and_analysis/secret_scanning/status', 'string'),
    secretScanningPushProtection: f(REPO, 'security_and_analysis/secret_scanning_push_protection/status', 'string'),
    dependabotSecurityUpdates: f(REPO, 'security_and_analysis/dependabot_security_updates/status', 'string'),
    privateVulnerabilityReporting: f('GET /repos/{owner}/{repo}/private-vulnerability-reporting', 'enabled', 'boolean') } },
  'repo-page-pages': { scope: 'repo', fields: {
    sourceBranch: f('GET /repos/{owner}/{repo}/pages', 'source/branch', 'string'), buildType: f('GET /repos/{owner}/{repo}/pages', 'build_type', 'string') } }
});

export function readbackFields(id) { return READBACKS[id] ? Object.keys(READBACKS[id].fields) : []; }

/** Follows a "a/b/c" pointer; undefined when any step is missing. */
export function pointerGet(value, pointer) {
  let at = value;
  for (const step of pointer.split('/')) { if (at === null || typeof at !== 'object' || !(step in at)) return undefined; at = at[step]; }
  return at;
}
