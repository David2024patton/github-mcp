// Y-1 end-user authority remediation: 54 pinned, individually reviewed cost-free
// universal REST writes. EVERY other non-GET REST operation remains UNKNOWN COST,
// whether or not its name happens to contain a billing/runner/Copilot keyword.
// This list grants zero-cost classification only; actual scoped GitHub permission,
// confirm, protected-resource, pass-spend and request-key guards never disappear.
// The developer's own $0/production-OFF restrictions do not become a product ban.
// Tested against the pinned OpenAPI index; never extend without an explicit
// provider-cost review and dated owner decision.
//
// What qualifies: self-hosted runner administration (no GitHub charge), runner-group membership,
// OIDC claim customisation, deployment approvals, deletes and restores of packages (never add cost),
// a Pages rebuild of an existing site, and artifact-metadata records.
// Unknown/metered: hosted runners, retention and storage, Codespaces, Copilot,
// billing, code security, Marketplace and ANY operation not explicitly reviewed here.
const RUNNER_SCOPES = ['/orgs/{org}', '/repos/{owner}/{repo}'];
const keys = [];
const add = (method, ...paths) => { for (const p of paths) keys.push(`${method} ${p}`); };

for (const base of RUNNER_SCOPES) {
  const r = `${base}/actions/runners`;
  add('DELETE', `${r}/{runner_id}`, `${r}/{runner_id}/labels`, `${r}/{runner_id}/labels/{name}`);
  add('POST', `${r}/registration-token`, `${r}/remove-token`, `${r}/generate-jitconfig`, `${r}/{runner_id}/labels`);
  add('PUT', `${r}/{runner_id}/labels`);
}

const groups = '/orgs/{org}/actions/runner-groups';
add('POST', groups);
add('PATCH', `${groups}/{runner_group_id}`);
add('DELETE', `${groups}/{runner_group_id}`, `${groups}/{runner_group_id}/repositories/{repository_id}`,
  `${groups}/{runner_group_id}/runners/{runner_id}`);
add('PUT', `${groups}/{runner_group_id}/repositories`, `${groups}/{runner_group_id}/repositories/{repository_id}`,
  `${groups}/{runner_group_id}/runners`, `${groups}/{runner_group_id}/runners/{runner_id}`);

const selfHosted = '/orgs/{org}/actions/permissions/self-hosted-runners';
add('PUT', selfHosted, `${selfHosted}/repositories`, `${selfHosted}/repositories/{repository_id}`);
add('DELETE', `${selfHosted}/repositories/{repository_id}`);

add('PUT', '/orgs/{org}/actions/oidc/customization/sub', '/repos/{owner}/{repo}/actions/oidc/customization/sub');
add('POST', '/orgs/{org}/actions/oidc/customization/properties/repo');
add('DELETE', '/orgs/{org}/actions/oidc/customization/properties/repo/{custom_property_name}');

add('POST', '/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule',
  '/repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules');
add('DELETE', '/repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules/{protection_rule_id}');

for (const owner of ['/user', '/orgs/{org}', '/users/{username}']) {
  const p = `${owner}/packages/{package_type}/{package_name}`;
  add('DELETE', p, `${p}/versions/{package_version_id}`);
  add('POST', `${p}/restore`, `${p}/versions/{package_version_id}/restore`);
}

add('POST', '/repos/{owner}/{repo}/pages/builds',
  '/orgs/{org}/artifacts/metadata/deployment-record',
  '/orgs/{org}/artifacts/metadata/deployment-record/cluster/{cluster}',
  '/orgs/{org}/artifacts/metadata/deployment-record/cluster/{cluster}/jobs',
  '/orgs/{org}/artifacts/metadata/storage-record');

/** @type {ReadonlySet<string>} keys like 'POST /orgs/{org}/actions/runners/registration-token' */
export const FREE_ROUTES = Object.freeze(new Set(keys));
/** @param {{method:string,path:string}} op @returns {boolean} true when reviewed free */
export const isReviewedFree = (op) => Boolean(op) && FREE_ROUTES.has(`${op.method} ${op.path}`);
