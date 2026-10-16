// Y-1 (Batch Y decision Y2): reviewed-free universal routes.
// The spend words in operation-classes.js stay a conservative default: any write whose summary/path
// matches stays blocked unless its exact "METHOD /path/template" key is listed here. Every key is
// checked against the vendored OpenAPI description in tests/unit/spend-classes.test.js, so a typo can
// never fail open, and the number of still-blocked operations is pinned there too.
//
// What qualifies: self-hosted runner administration (no GitHub charge), runner-group membership,
// OIDC claim customisation, deployment approvals, deletes and restores of packages (never add cost),
// a Pages rebuild of an existing site, and artifact-metadata records.
// What does NOT qualify (Y3: cost cannot be computed, stays behind the spend guard): hosted/larger
// runners and images, cache/artifact retention and storage limits, Codespaces, Copilot, billing,
// code-security configurations, Marketplace.
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
