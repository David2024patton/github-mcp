import {describe, expect, it} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {buildCapabilityInventory, sourceKeys, summarizeCapabilityInventory,
  validateCapabilityInventory, CREDENTIAL_KINDS, NON_SCHEMA_WORKFLOWS} from '../../src/github/capability-inventory.js';
import {restOperations} from '../../src/github/openapi-index.js';
import {githubGraphqlSchema} from '../../src/github/graphql-schema.js';
import {printSummary} from '../../scripts/capability-inventory.mjs';

const fakeSchema = {
  getQueryType: () => ({getFields: () => ({viewer: {
    name: 'viewer', type: 'User!', args: [], deprecationReason: null
  }})}),
  getMutationType: () => ({getFields: () => ({changeThing: {
    name: 'changeThing', type: 'ChangeThingPayload', args: [
      {name: 'input', type: 'ChangeThingInput!'}], deprecationReason: null
  }})})
};
const fakeRest = [{
  route: 'GET /user', method: 'GET', path: '/user', operationId: 'users-get-authenticated',
  category: 'users', summary: 'Get the authenticated user', deprecated: false, notifies: false
}, {
  route: 'GET /app', method: 'GET', path: '/app', operationId: 'apps-get-authenticated',
  category: 'apps', summary: 'Get the authenticated app', deprecated: false, notifies: false
}];
function fixture() {
  const options = {rest: fakeRest, schema: fakeSchema,
    workflows: NON_SCHEMA_WORKFLOWS.slice(0, 2), registryTools: registry.tools};
  return {options, result: buildCapabilityInventory(options)};
}
const get = (rows, prefix) => rows.find(x => x.key.startsWith(prefix));

describe('CAP-1 source inventory: no fabricated functional coverage', () => {
  it('enumerates each unique pinned REST method/path, GraphQL root field and independent transport workflow', () => {
    const inventory = buildCapabilityInventory({registryTools: registry.tools});
    const expected = sourceKeys({rest: restOperations(), schema: githubGraphqlSchema()});
    expect(restOperations()).toHaveLength(1232);
    expect(inventory.operations).toHaveLength(expected.length);
    expect(new Set(expected).size).toBe(expected.length);
    expect(new Set(inventory.operations.map(x => x.key)).size).toBe(expected.length);
    expect(validateCapabilityInventory(inventory).totalOperations).toBe(expected.length);
    expect(inventory.summary.coverageRatio).toBeNull();
    expect(inventory.summary.verifiedOperations).toBe(0);
  });

  it('does not convert universal finder visibility or unreviewed credentials into capability', () => {
    const {result} = fixture();
    const whoami = get(result.operations, 'rest:github.com@2026-03-10:GET /user');
    const app = get(result.operations, 'rest:github.com@2026-03-10:GET /app');
    const gql = get(result.operations, 'graphql:github.com@');
    expect(whoami.implementation.route).toBe('universal-candidate');
    expect(whoami.state).toBe('unresolved');
    expect(app.implementation.universalCandidate).toBe(false);
    expect(app.state).toBe('unresolved');
    expect(whoami.credentialSupport.app_user.disposition).toBe('unknown');
    expect(CREDENTIAL_KINDS).toHaveLength(8);
    expect(Object.values(whoami.credentialSupport).every(v => v.disposition === 'unknown')).toBe(true);
    expect(result.operations.filter(x => x.interface === 'graphql')).toHaveLength(2);
    expect(gql.credentialSupport.app_jwt.disposition).toBe('unsupported');
    expect(gql.credentialSupport.app_jwt.evidence).toContain('github.com');
  });

  it('does not infer GHE.com or GHES host parity from a GitHub.com schema', () => {
    const {result} = fixture();
    for (const row of result.operations) {
      expect(row.hostApplicability.map(x => x.host)).toEqual(['github.com','ghe.com','ghes']);
      expect(row.hostApplicability[0].disposition).toBe('source-pinned');
      expect(row.hostApplicability.slice(1).map(x => x.disposition)).toEqual(['unknown','unknown']);
      expect(new Set(row.hostApplicability.map(x => x.key)).size).toBe(3);
    }
  });

  it('rejects an orphan annotation, duplicate source operation and an unsupported fake credential', () => {
    const {options} = fixture();
    expect(() => buildCapabilityInventory({...options,
      annotations: [{key:'rest:github.com@2026-03-10:GET /absent',
        credential:'app_user', disposition:'supported', evidence:'https://docs.github.com'}]
    })).toThrow(/Orphan/);
    expect(() => buildCapabilityInventory({...options, rest: [...fakeRest, fakeRest[0]]}))
      .toThrow(/Duplicate/);
    expect(() => buildCapabilityInventory({...options, annotations: [{
      key: 'rest:github.com@2026-03-10:GET /user', credential: 'magic',
      disposition:'supported', evidence:'https://docs.github.com'}]
    })).toThrow(/Unknown credential/);
  });

  it('refuses duplicate, missing and fabricated verified rows and family summary tampering', () => {
    const {options,result} = fixture();
    const mutate = (cb) => {
      const c = structuredClone(result); cb(c);
      return () => validateCapabilityInventory(c, options);
    };
    expect(mutate(c => c.operations.push(structuredClone(c.operations[0])))).toThrow(/Duplicate/);
    expect(mutate(c => c.operations.pop())).toThrow(/Missing source/);
    expect(mutate(c => c.operations[0].state = 'verified')).toThrow(/False verified/);
    expect(mutate(c => c.operations[0].credentialSupport.app_jwt = null)).toThrow(/Incomplete credential/);
    expect(mutate(c => c.operations[0].hostApplicability.pop())).toThrow(/Incomplete host/);
    expect(mutate(c => c.summary.totalOperations += 1)).toThrow(/summary/);
  });

  it('reports exact family sums and credential unknowns without a misleading percentage', () => {
    const {result} = fixture();
    const summary = summarizeCapabilityInventory(result.operations);
    expect(Object.values(summary.families).reduce((n,f)=>n+f.total,0)).toBe(summary.totalOperations);
    expect(summary.unknownCredentialDecisions).toBeGreaterThan(0);
    expect(printSummary(result)).toContain('Functional coverage percentage: NOT COMPUTED');
    expect(printSummary(result)).toContain('git-transport |');
    expect(printSummary(result)).not.toMatch(/\d+(?:\.\d+)?%/);
  });

  it('records a reviewed credential disposition but never expands an actual user grant', () => {
    const {options} = fixture();
    const key = 'rest:github.com@2026-03-10:GET /user';
    const inventory = buildCapabilityInventory({...options, annotations: [{
      key, credential:'app_user', disposition:'supported',
      evidence:'https://docs.github.com/en/rest/users/users#get-the-authenticated-user',
      permissions: ['metadata:read']
    }]});
    expect(get(inventory.operations, key).credentialSupport.app_user.disposition).toBe('supported');
    expect(get(inventory.operations, key).state).toBe('unresolved');
    expect(validateCapabilityInventory(inventory, options).verifiedOperations).toBe(0);
  });
});
