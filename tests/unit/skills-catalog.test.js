// SKILLS-1, Lane 3: the generated skills catalog, and the search/route reads over it.
// The catalog is metadata only (Decision S3/S5): MIT-cleared records, no skill text, no file paths.
// Search and route are reads (defineRead, area 'skills') that refuse while SKILLS_CATALOG_ENABLED
// is not 'enabled', refuse RTC pass connections outright, and store executable route decisions
// per connection through putRouteDecision (Decision S8).
import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { SKILLS_BUNDLE, SKILLS_CATALOG } from '../../src/data/skills-catalog.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const clock = () => NOW;
const ENABLED = { SKILLS_CATALOG_ENABLED: 'enabled' };

const parse = (result) => {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return { errorText: text }; }
};

const ownerConnection = () => Object.freeze({ client_id: 'conn-1', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });
const passConnection = () => Object.freeze({ pass_id: 'pass-1', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });

/** The house fake db plus the route-decision store of src/db.js, in memory, with the same semantics:
 *  getRouteDecision returns null when the row is expired or belongs to another connection;
 *  consumeRouteDecision returns null when the row is already consumed. */
function withRouteDecisions(db) {
  const decisions = new Map();
  const connKey = (c) => (typeof c === 'string' ? c : c?.client_id ?? c?.pass_id ?? null);
  const view = (row) => (row ? {
    id: row.id, connection: row.connection, skill_id: row.skill_id, plan: structuredClone(row.plan),
    risk_class: row.risk_class, payload_sha256: row.payload_sha256,
    expires_at: new Date(row.expires_at), consumed_at: row.consumed_at ? new Date(row.consumed_at) : null,
    result: row.result ? structuredClone(row.result) : null
  } : null);
  db.putRouteDecision = async ({ id, connection, skillId, plan, riskClass, payloadSha256, ttlMinutes = 30 }) => {
    const row = { id, connection: connKey(connection), skill_id: skillId, plan: structuredClone(plan ?? null),
      risk_class: riskClass, payload_sha256: payloadSha256, expires_at: clock() + ttlMinutes * 60_000, consumed_at: null, result: null };
    decisions.set(id, row);
    return view(row);
  };
  db.getRouteDecision = async (id, connection) => {
    const row = decisions.get(id);
    if (!row || row.connection !== connKey(connection) || row.expires_at <= clock()) return null;
    return view(row);
  };
  db.consumeRouteDecision = async (id, connection, result = null) => {
    const row = decisions.get(id);
    if (!row || row.connection !== connKey(connection) || row.expires_at <= clock() || row.consumed_at) return null;
    row.consumed_at = clock();
    row.result = result ?? null;
    return view(row);
  };
  return db;
}

const fakeDb = () => withRouteDecisions(createFakeDb({ clock }));
const dispatchWith = (env) => createDispatch({ env, gates: [], now: clock });
const call = (dispatch, name, args, connection, db) => dispatch({ registry, name, args, connection, db });

describe('the generated skills catalog (src/data/skills-catalog.js)', () => {
  it('carries the bundle identity and exactly one record per catalog entry', () => {
    expect(String(SKILLS_BUNDLE.version).length).toBeGreaterThan(0);
    expect(String(SKILLS_BUNDLE.registryCommit).length).toBeGreaterThan(0);
    expect(String(SKILLS_BUNDLE.snapshot).length).toBeGreaterThan(0);
    expect(SKILLS_BUNDLE.records).toBe(SKILLS_CATALOG.length);
    expect(SKILLS_CATALOG.length).toBeGreaterThan(0);
  });

  it('contains only MIT-cleared records: no not-cleared record can be present', () => {
    // The generator excludes the registry's not-cleared section by construction (Decision S5),
    // so the check is universal, not a sample: every single record must be cleared.
    expect(SKILLS_CATALOG.filter((r) => r.license_status !== 'mit-cleared')).toEqual([]);
    for (const record of SKILLS_CATALOG) expect(record.license_status).toBe('mit-cleared');
  });

  it('records carry exactly the agreed metadata fields, unique ids and sha256 checksums', () => {
    const ids = SKILLS_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const record of SKILLS_CATALOG) {
      expect(Object.keys(record).sort()).toEqual(['category', 'checksum_sha256', 'description', 'id', 'keywords', 'kind', 'license_status', 'name', 'risk_class']);
      expect(record.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof record.name).toBe('string');
      expect(typeof record.description).toBe('string');
    }
  });

  it('registers github_skills_search and github_skills_route as reads in the skills area', () => {
    for (const name of ['github_skills_search', 'github_skills_route']) {
      const tool = registry.tools.find((t) => t.name === name);
      expect(tool, `${name} must be registered`).toBeTruthy();
      expect(tool.area).toBe('skills');
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.writes).not.toBe(true);
    }
  });
});

describe('the skills gate (SKILLS_CATALOG_ENABLED, entitlement, passes)', () => {
  it('refuses search and route while the switch is not exactly "enabled"', async () => {
    for (const env of [{}, { SKILLS_CATALOG_ENABLED: 'true' }, { SKILLS_CATALOG_ENABLED: 'disabled' }]) {
      const dispatch = dispatchWith(env);
      const db = fakeDb();
      const search = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, ownerConnection(), db));
      expect(search).toMatchObject({ done: false, status: 'refused' });
      expect(typeof search.error).toBe('string');
      const route = parse(await call(dispatch, 'github_skills_route', { intent: 'open a pull request' }, ownerConnection(), db));
      expect(route).toMatchObject({ done: false, status: 'refused' });
      expect(typeof route.error).toBe('string');
    }
  });

  it('answers search and route when the switch is enabled for an owner connection', async () => {
    const dispatch = dispatchWith(ENABLED);
    const db = fakeDb();
    const search = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, ownerConnection(), db));
    expect(search.status).not.toBe('refused');
    expect(search.count).toBeGreaterThan(0);
    const route = parse(await call(dispatch, 'github_skills_route', { intent: 'open a pull request' }, ownerConnection(), db));
    expect(route.status).not.toBe('refused');
    expect(route.decision).toBeTruthy();
  });

  it('refuses a pass connection (pass_id) even when the switch is enabled', async () => {
    const dispatch = dispatchWith(ENABLED);
    const db = fakeDb();
    const search = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, passConnection(), db));
    expect(search).toMatchObject({ done: false, status: 'refused' });
    const route = parse(await call(dispatch, 'github_skills_route', { intent: 'open a pull request' }, passConnection(), db));
    expect(route).toMatchObject({ done: false, status: 'refused' });
  });
});

describe('github_skills_search', () => {
  it('finds the github skill by query and reports the bundle it came from', async () => {
    const dispatch = dispatchWith(ENABLED);
    const out = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, ownerConnection(), fakeDb()));
    expect(out.count).toBeGreaterThanOrEqual(1);
    expect(out.count).toBe(out.skills.length);
    const github = out.skills.find((s) => s.id === 'github');
    expect(github, 'query "github" must return the github skill').toBeTruthy();
    expect(github.risk_class).toBe('write');
    expect(out.bundle).toMatchObject({
      version: SKILLS_BUNDLE.version, registryCommit: SKILLS_BUNDLE.registryCommit,
      snapshot: SKILLS_BUNDLE.snapshot, records: SKILLS_CATALOG.length
    });
  });

  it('narrows by category: every hit is in the category, and an unknown category finds nothing', async () => {
    const dispatch = dispatchWith(ENABLED);
    const narrowed = parse(await call(dispatch, 'github_skills_search', { query: 'github', category: 'software-development' }, ownerConnection(), fakeDb()));
    expect(narrowed.skills.length).toBeGreaterThanOrEqual(1);
    expect(narrowed.skills.every((s) => s.category === 'software-development')).toBe(true);
    expect(narrowed.skills.some((s) => s.id === 'github')).toBe(true);
    const none = parse(await call(dispatch, 'github_skills_search', { category: 'no-such-category' }, ownerConnection(), fakeDb()));
    expect(none.count).toBe(0);
    expect(none.skills).toEqual([]);
  });

  it('maxRisk "read" excludes the write-class github skill', async () => {
    const dispatch = dispatchWith(ENABLED);
    const out = parse(await call(dispatch, 'github_skills_search', { query: 'github', maxRisk: 'read' }, ownerConnection(), fakeDb()));
    expect(out.skills.some((s) => s.id === 'github')).toBe(false);
    expect(out.skills.every((s) => s.risk_class === 'read')).toBe(true);
  });
});

describe('github_skills_route', () => {
  it('asks when required context is missing, naming what is missing', async () => {
    const dispatch = dispatchWith(ENABLED);
    const out = parse(await call(dispatch, 'github_skills_route', { intent: 'open a pull request' }, ownerConnection(), fakeDb()));
    expect(out.decision).toBe('ask');
    expect(out.missing).toEqual(expect.arrayContaining(['owner', 'title']));
    expect(out.executable).not.toBe(true);
  });

  it('asks when no cleared skill fits the intent', async () => {
    const dispatch = dispatchWith(ENABLED);
    const out = parse(await call(dispatch, 'github_skills_route', { intent: 'water the plants' }, ownerConnection(), fakeDb()));
    expect(out.decision).toBe('ask');
    expect(out.executable).not.toBe(true);
  });

  it('routes a full pull-request intent to the pr_open plan and stores the decision for this connection only', async () => {
    const dispatch = dispatchWith(ENABLED);
    const db = fakeDb();
    const connection = ownerConnection();
    const out = parse(await call(dispatch, 'github_skills_route',
      { intent: 'open a pull request', context: { owner: 'octo', repo: 'demo', head: 'feat', title: 'Add thing' } }, connection, db));
    expect(out.decision).toBe('route');
    expect(out.plan_id).toBe('pr_open');
    expect(out.risk_class).toBe('write');
    expect(out.confirmation_required).toBe(true);
    expect(out.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.task_id).toMatch(/^skd_/);
    expect(out.executable).toBe(true);
    expect(out.execute_with).toBe('github_skills_execute');
    expect(out.selected?.[0]?.skill_id).toBe('github');
    expect(typeof out.selected?.[0]?.confidence).toBe('number');
    expect(out.plan).toEqual(expect.arrayContaining(['github_pr_create']));

    const stored = await db.getRouteDecision(out.task_id, 'conn-1');
    expect(stored).toMatchObject({ id: out.task_id, connection: 'conn-1', skill_id: 'github', risk_class: 'write', payload_sha256: out.payload_sha256, consumed_at: null });
    expect(stored.plan).toBeTruthy();
    expect(await db.getRouteDecision(out.task_id, 'conn-2')).toBeNull();
  });

  it('routes a non-GitHub cleared skill named by id as metadata only: not executable', async () => {
    const dispatch = dispatchWith(ENABLED);
    const other = SKILLS_CATALOG.find((r) => r.id !== 'github');
    expect(other, 'the catalog must hold cleared skills beyond the github family').toBeTruthy();
    const out = parse(await call(dispatch, 'github_skills_route', { intent: other.id }, ownerConnection(), fakeDb()));
    expect(JSON.stringify(out)).toContain(other.id);
    expect(out.executable).toBe(false);
    expect(out.execute_with).not.toBe('github_skills_execute');
  });
});

describe('tenant entitlement (SKILLS_CATALOG_TENANTS)', () => {
  // The house connection carries no tenant field (Lane 1 finding, documented in src/tools/skills.js):
  // tenancy resolves from client_id markers, with an explicit tenantId field taking precedence.
  const tenantConnection = () => Object.freeze({ client_id: 'tcl-abc', tenantId: 'tenant-1', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });
  const publicConnection = () => Object.freeze({ client_id: 'pcl_abcdefghijklmnopqrstuvwx', accounts: Object.freeze(['octo']), profile: 'full', mode: 'preview' });

  it('refuses a tenant connection when its tenant is not listed', async () => {
    const dispatch = dispatchWith(ENABLED);
    const out = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, tenantConnection(), fakeDb()));
    expect(out.status).toBe('refused');
  });

  it('answers a tenant connection listed by id in SKILLS_CATALOG_TENANTS', async () => {
    const dispatch = dispatchWith({ ...ENABLED, SKILLS_CATALOG_TENANTS: 'tenant-9, tenant-1' });
    const out = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, tenantConnection(), fakeDb()));
    expect(out.status).not.toBe('refused');
    expect(out.skills?.some((s) => s.id === 'github')).toBe(true);
  });

  it('answers a tenant connection under the star entitlement', async () => {
    const dispatch = dispatchWith({ ...ENABLED, SKILLS_CATALOG_TENANTS: '*' });
    const out = parse(await call(dispatch, 'github_skills_search', { query: 'github' }, tenantConnection(), fakeDb()));
    expect(out.skills?.some((s) => s.id === 'github')).toBe(true);
  });

  it('a public client (pcl_) is entitled only by the star, never by a tenant list', async () => {
    const listed = parse(await call(dispatchWith({ ...ENABLED, SKILLS_CATALOG_TENANTS: 'tenant-1' }), 'github_skills_search', { query: 'github' }, publicConnection(), fakeDb()));
    expect(listed.status).toBe('refused');
    const starred = parse(await call(dispatchWith({ ...ENABLED, SKILLS_CATALOG_TENANTS: '*' }), 'github_skills_search', { query: 'github' }, publicConnection(), fakeDb()));
    expect(starred.skills?.some((s) => s.id === 'github')).toBe(true);
  });
});
