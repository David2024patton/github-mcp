import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, operations } from '../../test/helpers/github-descriptions.js';
import { READBACKS, pointerGet } from '../../src/data/readbacks.js';
import { SETTINGS } from '../../src/data/dashboard-map.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
const ops = operations();
const resolve = (schema) => (schema?.$ref ? resolve(doc.components.schemas[schema.$ref.split('/').pop()]) : schema);
// All object shapes a schema may take (allOf merged, oneOf/anyOf alternatives).
const shapes = (schema) => {
  const s = resolve(schema); if (!s) return [];
  if (s.allOf) return [{ properties: Object.assign({}, ...s.allOf.flatMap(shapes).map((x) => x.properties)) }];
  if (s.oneOf || s.anyOf) return (s.oneOf ?? s.anyOf).flatMap(shapes);
  return [s];
};
const hasPointer = (schema, pointer) => {
  const [head, ...rest] = pointer.split('/');
  return shapes(schema).some((s) => s.properties && head in s.properties && (!rest.length || hasPointer(s.properties[head], rest.join('/'))));
};

describe('guided-setting read-backs', () => {
  const rows = Object.entries(READBACKS).flatMap(([id, e]) => Object.entries(e.fields).map(([field, spec]) => ({ id, field, spec })));
  it('every entry names a real guided setting of the right scope', () => {
    for (const id of Object.keys(READBACKS)) expect(SETTINGS.find((s) => s.id === id)?.scope, id).toBe(READBACKS[id].scope);
  });
  it.each(rows.map((r) => [`${r.id}.${r.field}`, r]))('%s: the route exists in the GitHub description and returns that value', (_, { spec }) => {
    const op = ops.find((o) => o.route === spec.route);
    expect(op, spec.route).toBeTruthy();
    const schema = op.operation.responses['200']?.content?.['application/json']?.schema;
    expect(hasPointer(schema, spec.pointer), `${spec.route} → ${spec.pointer}`).toBe(true);
  });
  it('pointerGet follows nested values', () => {
    expect(pointerGet({ a: { b: 'x' } }, 'a/b')).toBe('x');
    expect(pointerGet({ a: null }, 'a/b')).toBeUndefined();
  });
});

describe('github_admin_check_setting with a table read-back', () => {
  const run = async (w, args) => {
    const result = await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now })({ registry, name: 'github_admin_check_setting', args, connection: w.connection, db: w.db });
    let body; try { body = parse(result); } catch { body = { message: result.content?.[0]?.text }; }
    return { result, body };
  };
  it('verifies, reports a difference, and asks for the field and the expected value', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main', has_wiki: true, security_and_analysis: { secret_scanning: { status: 'enabled' } } });
    w.gh.when('GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention').reply(200, { days: 30, maximum_allowed_days: 90 });
    const base = { owner: 'example-org', repo: 'app' };
    expect((await run(w, { ...base, settingId: 'repo-page-general' })).body.status).toBe('needs_field');
    expect((await run(w, { ...base, settingId: 'repo-page-general', field: 'hasWiki' })).body.status).toBe('needs_expected_value');
    expect((await run(w, { ...base, settingId: 'repo-page-general', field: 'hasWiki', expectedBoolean: true })).body).toMatchObject({ status: 'verified', verified: true, observed: true });
    expect((await run(w, { ...base, settingId: 'repo-page-general', field: 'defaultBranch', expectedText: 'trunk' })).body).toMatchObject({ status: 'differs', verified: false, observed: 'main' });
    expect((await run(w, { ...base, settingId: 'repo-page-security', field: 'secretScanning', expectedText: 'enabled' })).body.verified).toBe(true);
    expect((await run(w, { ...base, settingId: 'repo-page-actions', field: 'artifactRetentionDays', expectedNumber: 30 })).body.verified).toBe(true);
    w.gh.when('GET /orgs/{org}/interaction-limits').reply(200, {});
    expect((await run(w, { owner: 'example-org', settingId: 'org-interaction-limit', expectedText: 'none' })).body).toMatchObject({ verified: true, observed: 'none' });
    expect((await run(w, { ...base, settingId: 'repo-page-general', field: 'nope' })).result.isError).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('web-only guides (Y-9c)', () => {
  it('each says there is no API, why, and finds by its plain words', async () => {
    const { SETTINGS, findSettings } = await import('../../src/data/dashboard-map.js');
    const guides = SETTINGS.filter((s) => s.apiAvailable === false);
    expect(guides.length).toBeGreaterThanOrEqual(12);
    for (const g of guides) {
      expect(g.reason, g.id).toEqual(expect.any(String));
      expect(g.browserAgent, g.id).toEqual(expect.any(String));
      expect(findSettings(g.words[0]).map((x) => x.id), g.id).toContain(g.id);
    }
    expect(new Set(SETTINGS.map((s) => s.id)).size).toBe(SETTINGS.length);
  });
});
