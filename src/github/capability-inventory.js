// CAP-1: source-pinned capability census. This module NEVER issues a provider request,
// grants authority, or treats an API finder / tool count as actual GitHub coverage.
import {restOperations} from './openapi-index.js';
import {githubGraphqlSchema} from './graphql-schema.js';
import {curatedTool} from './hand-built-map.js';
import {classifyUniversal, assertUniversalAuthority} from './operation-classes.js';

export const SOURCE = Object.freeze({
  checked: '2026-10-21',
  rest: Object.freeze({
    version: '2026-03-10',
    revision: '58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1',
    url: 'https://github.com/github/rest-api-description/blob/58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1/descriptions/api.github.com/api.github.com.2026-03-10.json'
  }),
  graphql: Object.freeze({
    version: 'schema-2026-10-09',
    revision: 'be38ec5d78e24172587e61b3c6ff40ace1865c71',
    url: 'https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/src/graphql/data/fpt/schema.docs.graphql'
  })
});

export const CREDENTIAL_KINDS = Object.freeze([
  'app_installation', 'app_user', 'oauth_app', 'fine_grained_pat',
  'classic_pat', 'app_jwt', 'git_ssh', 'workflow_token'
]);
export const STATES = Object.freeze([
  'missing', 'implemented-unverified', 'verified', 'provider-retired',
  'provider-UI-only', 'unresolved'
]);
const SUPPORT = new Set(['supported', 'unsupported', 'unknown']);
const ROOT_TYPES = Object.freeze(['query', 'mutation']);
const REQUIRED_HOSTS = Object.freeze(['github.com', 'ghe.com', 'ghes']);
const OFFICIAL_AUTH =
  'https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps';
const GITHUB_APP_AUTH =
  'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app';
const GHE_DOCS =
  'https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/installing-a-github-app-on-your-enterprise';

// This is a cross-version applicability ledger, NOT a claim that the pinned
// GitHub.com operation is implemented on another host or GHES release.
function hostApplicability(key) {
  return [
    {key: key + '|github.com|2026-03-10', host: 'github.com',
      product: 'GitHub.com', version: '2026-03-10',
      disposition: 'source-pinned', evidence: SOURCE.rest.url},
    {key: key + '|ghe.com|unverified', host: 'ghe.com',
      product: 'GitHub Enterprise Cloud with data residency', version: 'unverified',
      disposition: 'unknown', evidence: GHE_DOCS},
    {key: key + '|ghes|3.20', host: 'ghes',
      product: 'GitHub Enterprise Server', version: '3.20',
      disposition: 'unknown',
      evidence: 'https://docs.github.com/en/enterprise-server@3.20/rest'},
    {key: key + '|ghes|3.22', host: 'ghes',
      product: 'GitHub Enterprise Server', version: '3.22',
      disposition: 'unknown',
      evidence: 'https://docs.github.com/en/enterprise-server@3.22/rest'}
  ];
}
function graphqlHosts(key) {
  const hosts = hostApplicability(key);
  hosts[0] = {...hosts[0], key: key + '|github.com|' + SOURCE.graphql.version,
    version: SOURCE.graphql.version, evidence: SOURCE.graphql.url};
  return hosts;
}
function unknownCredentials(interfaceName) {
  const entries = Object.fromEntries(CREDENTIAL_KINDS.map(kind => [kind, {
    disposition: 'unknown', evidence: null, permissions: null, scopes: null
  }]));
  if (interfaceName === 'graphql') {
    // App JWTs cannot call GraphQL (official GitHub App auth documentation).
    entries.app_jwt = {disposition: 'unsupported', evidence: GITHUB_APP_AUTH,
      permissions: null, scopes: null};
  }
  return entries;
}
function prerequisites() {
  // Unknown is different from none. A documented grant must be checked at the
  // exact operation/host/resource, rather than inferred from the family name.
  return {permissions: null, scopes: null, actorRole: 'unknown', plan: 'unknown',
    sso: 'unknown', installation: 'unknown', resourceSelection: 'unknown',
    preview: 'unknown'};
}
function baseline({key, interfaceName, family, effect, source, officialReference}) {
  return {
    key, interface: interfaceName, host: 'github.com',
    version: source.version, family, effect,
    evidence: {pinnedRevision: source.revision, officialUrl: officialReference,
      sourceUrl: source.url, checked: SOURCE.checked, conflicts: []},
    credentialSupport: unknownCredentials(interfaceName),
    prerequisites: prerequisites(),
    hostApplicability: interfaceName === 'graphql' ? graphqlHosts(key) : hostApplicability(key),
    implementation: {status: 'unresolved', route: null, tool: null,
      source: null, requestShapeTest: null, universalCandidate: false,
      reason: 'No exact provider dispatch plus request-shape proof recorded'},
    safety: {targetBound: 'unverified', tenantBound: 'unverified', secrets: 'unverified',
      spending: 'unknown', confirmation: 'unverified', replay: 'unverified',
      readback: 'unverified'},
    state: 'unresolved',
    delivery: {owner: 'CAP-4', dependencies: ['CAP-1', 'CAP-2', 'CAP-3'],
      priority: 'inventory-review', nextAction: 'Verify credential and guarded route against official operation contract',
      externalAcceptance: 'pending'}
  };
}
function restKey(op) {return 'rest:github.com@' + SOURCE.rest.version + ':' + op.route;}
function gqlKey(root, name) {
  return 'graphql:github.com@' + SOURCE.graphql.version + ':' + root + ':' + name;
}
function routeEligibility(op) {
  try {
    assertUniversalAuthority(op, {}, {});
    // The input shape, account binding and provider token still require proof.
    // A candidate is never counted as implemented solely for being dispatchable.
    return {candidate: op.method === 'GET' || ['POST','PUT','PATCH','DELETE'].includes(op.method),
      reason: 'Requires per-operation scoped request/credential/readback proof'};
  } catch (error) {
    return {candidate: false, reason: String(error.message).slice(0,240)};
  }
}
function restRecord(op, names) {
  const key = restKey(op);
  const rec = baseline({key, interfaceName: 'rest',
    family: op.category || 'uncategorized',
    effect: ['GET','HEAD','OPTIONS'].includes(op.method) ? 'read' : 'write',
    source: SOURCE.rest, officialReference: OFFICIAL_AUTH});
  rec.operation = {method: op.method, path: op.path, operationId: op.operationId || null,
    deprecated: Boolean(op.deprecated), summary: op.summary || ''};
  const mapped = curatedTool(op);
  const route = routeEligibility(op);
  rec.implementation.universalCandidate = route.candidate;
  rec.implementation.reason = route.reason;
  if (mapped) {
    rec.implementation.route = 'curated';
    rec.implementation.tool = mapped;
    rec.implementation.source = 'src/github/hand-built-map.js';
    if (names.has(mapped)) {
      rec.implementation.status = 'implemented-unverified';
      rec.state = 'implemented-unverified';
      rec.delivery.nextAction = 'Verify curated tool exact request shape, credential kind and readback';
    } else {
      rec.implementation.reason = 'Orphan curated tool mapping: ' + mapped;
    }
  } else if (route.candidate) {
    rec.implementation.route = 'universal-candidate';
    rec.implementation.tool = op.method === 'GET' ? 'github_api_read' : 'github_api_write';
    rec.implementation.source = 'src/tools/universal.js';
  }
  const classified = classifyUniversal(op);
  rec.safety.spending = classified.spendRisk ? 'possible-or-unknown' : 'reviewed-route-or-read';
  rec.safety.notification = Boolean(classified.notifies);
  rec.safety.productionRisk = Boolean(classified.production);
  rec.safety.accessRisk = Boolean(classified.accessWidening);
  if (op.deprecated) rec.evidence.conflicts.push('Provider operation is deprecated; deprecation is not retirement');
  return rec;
}
function gqlRecord(root, field) {
  const key = gqlKey(root, field.name);
  const rec = baseline({key, interfaceName: 'graphql',
    family: 'graphql-' + root, effect: root === 'query' ? 'read' : 'write',
    source: SOURCE.graphql,
    officialReference: 'https://docs.github.com/en/graphql/guides/forming-calls-with-graphql'});
  rec.operation = {root, field: field.name, returnType: String(field.type),
    arguments: field.args.map(a => ({name: a.name, type: String(a.type)})),
    deprecated: Boolean(field.deprecationReason)};
  rec.implementation.route = 'universal-candidate';
  rec.implementation.tool = root === 'query' ? 'github_graphql_read' : 'github_graphql_write';
  rec.implementation.source = 'src/tools/universal-graphql.js';
  // GraphQL universal mutations require a writeSpec, ownership and before-state.
  // Even queries have restricted root fields and bounded pagination.
  rec.implementation.reason = 'Root field exists; scope, writeSpec, credential and shape not individually proved';
  rec.safety.spending = root === 'mutation' ? 'possible-or-unknown' : 'none-from-read';
  rec.safety.productionRisk = root === 'mutation';
  rec.safety.accessRisk = root === 'mutation';
  rec.safety.notification = 'unknown';
  return rec;
}
// The independent Git, Packages registry and exposed MCP transports cannot be
// credited merely because their metadata has a REST endpoint.
export const NON_SCHEMA_WORKFLOWS = Object.freeze([
  {id: 'git-smart-http-fetch', interface: 'git', family: 'git-transport', effect: 'read',
    url: 'https://git-scm.com/docs/http-protocol'},
  {id: 'git-smart-http-push', interface: 'git', family: 'git-transport', effect: 'write',
    url: 'https://git-scm.com/docs/http-protocol'},
  {id: 'git-ssh-fetch', interface: 'git', family: 'git-transport', effect: 'read',
    url: 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh'},
  {id: 'git-ssh-push', interface: 'git', family: 'git-transport', effect: 'write',
    url: 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh'},
  {id: 'registry-package-download', interface: 'registry', family: 'package-transport', effect: 'read',
    url: 'https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages'},
  {id: 'registry-package-publish', interface: 'registry', family: 'package-transport', effect: 'write',
    url: 'https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages'},
  {id: 'mcp-tools-list', interface: 'mcp', family: 'mcp-protocol', effect: 'read',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools'},
  {id: 'mcp-tools-call', interface: 'mcp', family: 'mcp-protocol', effect: 'write',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools'}
]);
function workflowRecord(item) {
  const key = item.interface + ':github.com@unversioned:' + item.id;
  const rec = baseline({key, interfaceName: item.interface, family: item.family,
    effect: item.effect,
    source: {version: 'unversioned', revision: 'official-reference-' + SOURCE.checked, url: item.url},
    officialReference: item.url});
  rec.operation = {workflow: item.id};
  rec.implementation.reason = 'No verified end-to-end protocol transport/readback evidence';
  rec.implementation.route = 'not-assessed';
  if (item.interface === 'mcp') {
    rec.implementation.source = 'src/runtime.js';
    rec.implementation.reason = 'Actual standalone transport not separately accepted by this inventory';
  }
  return rec;
}

export function sourceKeys({rest = restOperations(),
  schema = githubGraphqlSchema(), workflows = NON_SCHEMA_WORKFLOWS} = {}) {
  const keys = rest.map(restKey);
  for (const root of ROOT_TYPES) {
    const type = root === 'query' ? schema.getQueryType() : schema.getMutationType();
    for (const field of Object.values(type?.getFields() || {})) keys.push(gqlKey(root, field.name));
  }
  keys.push(...workflows.map(x => x.interface + ':github.com@unversioned:' + x.id));
  if (new Set(keys).size !== keys.length) throw new TypeError('Duplicate source operation key');
  return keys;
}
export function buildCapabilityInventory({
  rest = restOperations(), schema = githubGraphqlSchema(),
  workflows = NON_SCHEMA_WORKFLOWS, registryTools = [], annotations = []
} = {}) {
  if (!Array.isArray(registryTools)) throw new TypeError('Registry tool list is required');
  const names = new Set(registryTools.map(x => typeof x === 'string' ? x : x.name));
  const records = rest.map(op => restRecord(op, names));
  for (const root of ROOT_TYPES) {
    const type = root === 'query' ? schema.getQueryType() : schema.getMutationType();
    records.push(...Object.values(type?.getFields() || {}).map(field => gqlRecord(root, field)));
  }
  records.push(...workflows.map(workflowRecord));
  const map = new Map(records.map(x => [x.key, x]));
  if (map.size !== records.length) throw new TypeError('Duplicate built inventory rows');
  const applied = new Set();
  for (const annotation of annotations) {
    if (!annotation || !map.has(annotation.key))
      throw new TypeError('Orphan capability annotation: ' + String(annotation?.key));
    const annotationId = annotation.key + '/' + annotation.credential;
    if (applied.has(annotationId)) throw new TypeError('Duplicate capability annotation: ' + annotationId);
    applied.add(annotationId);
    const row = map.get(annotation.key);
    if (!CREDENTIAL_KINDS.includes(annotation.credential))
      throw new TypeError('Unknown credential kind for ' + annotation.key);
    if (!SUPPORT.has(annotation.disposition) || !annotation.evidence ||
        typeof annotation.evidence !== 'string' || !/^https:\/\//.test(annotation.evidence))
      throw new TypeError('Reviewed credential disposition requires official HTTPS evidence');
    row.credentialSupport[annotation.credential] = {
      disposition: annotation.disposition, evidence: annotation.evidence,
      permissions: annotation.permissions ?? null, scopes: annotation.scopes ?? null
    };
  }
  records.sort((a,b) => a.key.localeCompare(b.key, 'en'));
  return {format: 'capability-inventory/v1', source: SOURCE,
    registryToolCount: names.size, operations: records,
    summary: summarizeCapabilityInventory(records)};
}
export function summarizeCapabilityInventory(records) {
  const families = {};
  const statuses = Object.fromEntries(STATES.map(x => [x, 0]));
  let unknownCredentials = 0, unknownHostApplicability = 0;
  for (const row of records) {
    const family = families[row.family] ||= {total: 0, byState: Object.fromEntries(STATES.map(x => [x,0])),
      universalCandidates: 0, credentialUnknowns: 0};
    family.total++;
    family.byState[row.state]++;
    statuses[row.state]++;
    if (row.implementation.universalCandidate) family.universalCandidates++;
    const c = Object.values(row.credentialSupport).filter(x => x.disposition === 'unknown').length;
    family.credentialUnknowns += c;
    unknownCredentials += c;
    unknownHostApplicability += row.hostApplicability.filter(x => x.disposition === 'unknown').length;
  }
  return {totalOperations: records.length, byState: statuses,
    unknownCredentialDecisions: unknownCredentials,
    unverifiedHostApplicability: unknownHostApplicability,
    // Unknown and unverified rows are deliberately NOT a functional coverage numerator.
    verifiedOperations: statuses.verified,
    coverageRatio: null,
    families: Object.fromEntries(Object.entries(families).sort(([a],[b]) => a.localeCompare(b,'en')))};
}
export function validateCapabilityInventory(inventory, options = {}) {
  if (inventory?.format !== 'capability-inventory/v1' || !Array.isArray(inventory.operations))
    throw new TypeError('Invalid capability inventory format');
  const keys = sourceKeys(options), expected = new Set(keys), seen = new Set();
  for (const row of inventory.operations) {
    if (!row?.key || seen.has(row.key)) throw new TypeError('Duplicate or empty inventory key');
    seen.add(row.key);
    if (!expected.has(row.key)) throw new TypeError('Orphan inventory row: ' + row.key);
    if (!STATES.includes(row.state) || !row.evidence?.officialUrl || !row.evidence?.sourceUrl ||
        !row.evidence?.pinnedRevision || !row.evidence?.checked ||
        !row.delivery?.owner || !row.delivery?.nextAction)
      throw new TypeError('Missing required disposition/evidence: ' + row.key);
    if (Object.keys(row.credentialSupport || {}).length !== CREDENTIAL_KINDS.length ||
        CREDENTIAL_KINDS.some(x => !SUPPORT.has(row.credentialSupport[x]?.disposition)))
      throw new TypeError('Incomplete credential inventory: ' + row.key);
    if (row.hostApplicability?.length !== 4 ||
        REQUIRED_HOSTS.some(x => !row.hostApplicability.some(v => v.host === x && v.key && v.disposition)) ||
        new Set(row.hostApplicability.map(x => x.key)).size !== row.hostApplicability.length)
      throw new TypeError('Incomplete host applicability: ' + row.key);
    if (row.state === 'verified' &&
        (!row.implementation?.requestShapeTest || row.implementation?.status !== 'verified'))
      throw new TypeError('False verified operation without a request-shape test');
    if (row.implementation?.route === 'curated' && row.state === 'unresolved' &&
        row.implementation?.reason?.startsWith('Orphan curated tool mapping'))
      throw new TypeError('Curated tool not registered: ' + row.key);
  }
  for (const key of keys) if (!seen.has(key)) throw new TypeError('Missing source operation: ' + key);
  const expectedSummary = summarizeCapabilityInventory(inventory.operations);
  if (JSON.stringify(expectedSummary) !== JSON.stringify(inventory.summary))
    throw new TypeError('Family summary or totals do not reconcile to operation records');
  if (inventory.summary.coverageRatio !== null)
    throw new TypeError('Unproven coverage ratio is forbidden');
  return expectedSummary;
}
