// G-3 part 1: variable change tools pass the write contract through all three doors, then the rules the contract does not cover.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as vars from '../../src/tools/variables.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (name) => ({ tool: vars.tools.find((t) => t.name === name), handler: vars.handlers[name] });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const gatesFor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const base = { gatesFor, conveyor: true };
const strict = { gatesFor: undefined, conveyor: false }; // production work is refused under pr-only (the fixture gate does that)
const gone = [404, { message: 'Not Found' }];
const V = (value) => ({ name: 'API_URL', value, updated_at: '2026-10-11T00:00:00Z' });

const PLACES = [
  ['repository', { repo: 'hello' }, 'repos/{owner}/{repo}/actions/variables', false],
  ['production environment', { repo: 'hello', environment: 'production' }, 'repos/{owner}/{repo}/environments/{environment_name}/variables', true],
  ['organization', {}, 'orgs/{org}/actions/variables', true]
];

for (const [label, where, path, production] of PLACES) {
  const opts = { ...base, ...(production ? strict : {}), production };
  runWriteContract({
    ...opts, needsConfirm: production, label: `github_variable_set create (${label})`, definition: def('github_variable_set'), args: { ...where, name: 'API_URL', value: 'https://x.test' },
    arrange(gh, outcome) {
      seq(gh, `GET /${path}/{name}`, outcome === 'ok' ? [gone, [200, V('https://x.test')]] : [gone, gone]);
      gh.when(`POST /${path}`).reply(201, {});
    }
  });
  runWriteContract({
    ...opts, needsConfirm: true, label: `github_variable_delete (${label})`, definition: def('github_variable_delete'), args: { ...where, name: 'API_URL' },
    arrange(gh, outcome) {
      seq(gh, `GET /${path}/{name}`, outcome === 'ok' ? [[200, V('old')], gone] : [[200, V('old')], [200, V('old')]]);
      gh.when(`DELETE /${path}/{name}`).reply(204, null);
    }
  });
}

async function read(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: w.connection, db: w.db });
  return { error: result.isError, text: JSON.stringify(result), body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const call = async (name, w, args) => parse(await vars.handlers[name](args, w.ctx));
const ONE = 'GET /repos/{owner}/{repo}/actions/variables/{name}';

describe('variable rules', () => {
  it('an existing variable is changed in place, and undo puts the old value back', async () => {
    const w = await makeWorld({});
    seq(w.gh, ONE, [[200, V('old')], [200, V('new')]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/actions/variables/{name}').reply(204, null);
    await call('github_variable_set', w, { repo: 'hello', name: 'API_URL', value: 'new', confirm: true });
    expect(w.gh.calls.some((c) => c.method === 'PATCH')).toBe(true);
    expect(w.gh.calls.some((c) => c.method === 'POST')).toBe(false);
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_variable_set', args: { name: 'API_URL', value: 'old' } });
    expect(w.gh.invalid).toEqual([]);
  });

  it('a new variable\'s undo deletes it', async () => {
    const w = await makeWorld({});
    seq(w.gh, ONE, [gone, [200, V('v')]]);
    w.gh.when('POST /repos/{owner}/{repo}/actions/variables').reply(201, {});
    await call('github_variable_set', w, { repo: 'hello', name: 'API_URL', value: 'v', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_variable_delete', args: { name: 'API_URL' } });
  });

  it('deleting a variable keeps its value in the undo', async () => {
    const w = await makeWorld({});
    seq(w.gh, ONE, [[200, V('keep me')], gone]);
    w.gh.when('DELETE /repos/{owner}/{repo}/actions/variables/{name}').reply(204, null);
    await call('github_variable_delete', w, { repo: 'hello', name: 'API_URL', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_variable_set', args: { value: 'keep me' } });
  });

  it('visibility only applies to organization variables', async () => {
    const w = await makeWorld({});
    seq(w.gh, ONE, [gone]);
    const out = await call('github_variable_set', w, { repo: 'hello', name: 'A', value: 'v', visibility: 'all', confirm: true });
    expect(JSON.stringify(out)).toMatch(/Visibility only applies to organization/);
    expect(w.gh.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('an environment without a repository is refused', async () => {
    const w = await makeWorld({});
    const out = await call('github_variable_set', w, { environment: 'qa', name: 'A', value: 'v' });
    expect(out.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });

  it('the organization is production: nothing is written on a preview connection', async () => {
    const w = await makeWorld({ mode: 'preview' });
    seq(w.gh, 'GET /orgs/{org}/actions/variables/{name}', [gone]);
    await call('github_variable_set', w, { name: 'A', value: 'v', confirm: true });
    expect(w.gh.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('variable and secret reads', () => {
  it('variable_list shows values; secret_list shows names and dates only, never values', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/variables').reply(200, { total_count: 1, variables: [V('https://x.test')] });
    w.gh.when('GET /repos/{owner}/{repo}/actions/secrets').reply(200, { total_count: 1, secrets: [{ name: 'TOKEN', created_at: 'a', updated_at: 'b', value: 'leak', encrypted_value: 'leak' }] });
    expect((await read(w, 'github_variable_list', { repo: 'hello' })).text).toMatch(/https:\/\/x\.test/);
    const secrets = await read(w, 'github_secret_list', { repo: 'hello' });
    expect(secrets.text).toMatch(/TOKEN/);
    expect(secrets.text).not.toMatch(/leak/);
    expect(w.gh.invalid).toEqual([]);
  });

  it('an organization secret limited to chosen repositories lists them', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /orgs/{org}/actions/secrets').reply(200, { total_count: 1, secrets: [{ name: 'S', created_at: 'a', updated_at: 'b', visibility: 'selected' }] });
    w.gh.when('GET /orgs/{org}/actions/secrets/{secret_name}/repositories').reply(200, { total_count: 1, repositories: [{ full_name: 'acme/hello' }] });
    expect((await read(w, 'github_secret_list', {})).text).toMatch(/acme\/hello/);
    expect(w.gh.invalid).toEqual([]);
  });

  it('only Actions secrets exist per environment', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const out = await read(w, 'github_secret_list', { repo: 'hello', environment: 'qa', kind: 'dependabot' });
    expect(out.text).toMatch(/Only Actions secrets/);
    expect(w.gh.calls).toEqual([]);
  });
});
