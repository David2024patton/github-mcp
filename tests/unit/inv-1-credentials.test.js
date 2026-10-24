// INV-1: every REST operation gets credential decisions only where GitHub's own evidence exists; conflicts carry written resolutions;
// every honest unknown carries its reason. Nothing here says a connection can do anything (that needs live evidence).
import { beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { buildCapabilityInventory, validateCapabilityInventory } from '../../src/github/capability-inventory.js';
import { REST_CREDENTIAL_EVIDENCE } from '../../src/github/capability-evidence.js';
import { deriveRestCredentials, PERMISSION_DATA_SOURCE, NO_EVIDENCE } from '../../src/github/credential-derivation.js';
import { restOperations } from '../../src/github/openapi-index.js';
import { printReport } from '../../scripts/capability-inventory.mjs';

let inv;
const row = (route) => inv.operations.find((r) => r.key === 'rest:github.com@2026-03-10:' + route);
beforeAll(() => { inv = buildCapabilityInventory({ registryTools: registry.tools }); });

describe('conflicts and unknowns', () => {
  it('has no unresolved conflict rows, and every resolved one says how it was resolved', () => {
    expect(validateCapabilityInventory(inv).unresolvedConflictRows).toBe(0);
    let resolved = 0;
    for (const r of inv.operations) for (const c of r.evidence.conflicts) {
      expect(c.status, r.key).toBe('resolved');
      expect(c.resolution.length, r.key).toBeGreaterThan(40);
      expect(c.officialUrl, r.key).toMatch(/^https:\/\//);
      resolved++;
    }
    expect(resolved).toBeGreaterThanOrEqual(65);
  });
  it('every unknown credential decision carries a reason; GraphQL is not decided by default', () => {
    for (const r of inv.operations) for (const [kind, v] of Object.entries(r.credentialSupport)) {
      if (v.disposition === 'unknown') expect(v.reason, r.key + '/' + kind).toBeTruthy();
    }
    const gql = inv.operations.find((r) => r.interface === 'graphql');
    expect(gql.credentialSupport.app_installation).toMatchObject({ disposition: 'unknown', reason: NO_EVIDENCE });
  });
  it('every derived decision names an official https source and the matched text or list', () => {
    let derived = 0;
    for (const r of inv.operations) for (const [kind, v] of Object.entries(r.credentialSupport)) {
      if (v.derived !== true) continue;
      derived++;
      expect(v.evidence, r.key + '/' + kind).toMatch(/^https:\/\//);
      expect(v.note, r.key + '/' + kind).toBeTruthy();
      expect(['supported', 'unsupported']).toContain(v.disposition);
    }
    expect(derived).toBeGreaterThan(4000);
  });
});

describe('specific operations', () => {
  it('GET /app/hook/config is recorded as JWT-only, not as a classic-token operation', () => {
    const c = row('GET /app/hook/config').credentialSupport;
    expect(c.app_jwt.disposition).toBe('supported');
    for (const kind of ['classic_pat', 'oauth_app', 'app_installation', 'app_user', 'fine_grained_pat']) expect(c[kind].disposition, kind).toBe('unsupported');
  });
  it('a Packages operation takes its classic scopes from its own text and its App rights from the per-operation list', () => {
    const r = row('DELETE /orgs/{org}/packages/{package_type}/{package_name}');
    expect(r.credentialSupport.classic_pat).toMatchObject({ disposition: 'supported', scopes: expect.arrayContaining(['read:packages', 'delete:packages']) });
    expect(r.credentialSupport.app_installation.disposition).toBe('supported');
    expect(r.evidence.conflicts.map((c) => c.id)).toContain('packages-rest-token-contradiction');
  });
  it('where the description says "not for Apps" but GitHub\'s list includes the operation, the list wins and both are kept', () => {
    const hits = inv.operations.filter((r) => r.evidence.conflicts.some((c) => c.id === 'description-flag-vs-endpoint-list'));
    expect(hits.length).toBeGreaterThan(50);
    const one = hits[0];
    const c = one.evidence.conflicts.find((x) => x.id === 'description-flag-vs-endpoint-list');
    for (const kind of c.credentialKinds) expect(one.credentialSupport[kind].disposition).toBe('supported');
    expect(c.resolution).toContain('newer');
  });
  it('where the two official sources disagree and neither is stronger, the answer stays unknown with the reason written down', () => {
    const hits = inv.operations.filter((r) => r.evidence.conflicts.some((c) => c.id === 'description-enables-apps-list-omits'));
    expect(hits.length).toBeGreaterThan(0);
    const c = hits[0].evidence.conflicts.find((x) => x.id === 'description-enables-apps-list-omits');
    for (const kind of c.credentialKinds) expect(hits[0].credentialSupport[kind]).toMatchObject({ disposition: 'unknown', reason: expect.stringContaining('sources disagree') });
  });
});

describe('derived decisions never contradict the hand-reviewed ones', () => {
  it('agrees with every hand-reviewed route', () => {
    const byRoute = new Map(restOperations().map((o) => [o.route, o]));
    for (const [route, review] of Object.entries(REST_CREDENTIAL_EVIDENCE)) {
      const op = byRoute.get(route);
      if (!op) continue;
      const derived = deriveRestCredentials(op).decisions;
      for (const [kind, decision] of Object.entries(review.decisions)) {
        if (derived[kind] && derived[kind].disposition !== 'unknown') expect(derived[kind].disposition, route + '/' + kind).toBe(decision.disposition);
      }
    }
  });
});

describe('honesty of the totals', () => {
  it('claims nothing verified, prints no percentage, and states the credential coverage as counts', () => {
    expect(inv.summary.verifiedOperations).toBe(0);
    const report = printReport(inv);
    expect(report).not.toMatch(/\d+(?:\.\d+)?%/);
    expect(report).toContain('unresolved official-source conflicts: 0 of ');
    expect(report).toContain('not what a connection can do');
  });
  it('the vendored list is pinned to an exact GitHub commit', () => {
    expect(PERMISSION_DATA_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(PERMISSION_DATA_SOURCE.repository).toBe('https://github.com/github/docs');
  });
});
