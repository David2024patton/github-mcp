// G-3 part 2: secret change tools pass the write contract through all three doors, then the rules the contract does not cover.
// Above all: no tool takes a secret value, and none ever returns or logs one.
import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as secrets from '../../src/tools/secrets.js';
import { registry } from '../../src/tools/index.js';

await sodium.ready;
const PAIR = sodium.crypto_box_keypair();
const KEY = { key_id: 'k1', key: sodium.to_base64(PAIR.publicKey, sodium.base64_variants.ORIGINAL) };
const def = (name) => ({ tool: secrets.tools.find((t) => t.name === name), handler: secrets.handlers[name] });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const gatesFor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const base = { gatesFor, conveyor: true, profile: 'full' };
const strict = { gatesFor: undefined, conveyor: false };
const gone = [404, { message: 'Not Found' }];
const S = (updated_at, extra = {}) => ({ name: 'DEPLOY_KEY', updated_at, ...extra });

const PLACES = [
  ['repository', { repo: 'hello' }, 'repos/{owner}/{repo}/actions/secrets', false],
  ['production environment', { repo: 'hello', environment: 'production' }, 'repos/{owner}/{repo}/environments/{environment_name}/secrets', true],
  ['organization', {}, 'orgs/{org}/actions/secrets', true]
];

for (const [label, where, path, production] of PLACES) {
  const opts = { ...base, ...(production ? strict : {}), production, needsConfirm: true };
  runWriteContract({
    ...opts, label: `github_secret_set generate (${label})`, definition: def('github_secret_set'), args: { ...where, name: 'DEPLOY_KEY', valueFrom: 'generate' },
    arrange(gh, outcome) {
      seq(gh, `GET /${path}/{secret_name}`, [[200, S('2026-10-10T00:00:00Z')], [200, S(outcome === 'ok' ? '2026-10-11T00:00:00Z' : '2026-10-10T00:00:00Z')]]);
      gh.when(`GET /${path}/public-key`).reply(200, KEY);
      gh.when(`PUT /${path}/{secret_name}`).reply(204, null);
    }
  });
  runWriteContract({
    ...opts, label: `github_secret_delete (${label})`, definition: def('github_secret_delete'), args: { ...where, name: 'DEPLOY_KEY' },
    arrange(gh, outcome) {
      seq(gh, `GET /${path}/{secret_name}`, outcome === 'ok' ? [[200, S('a')], gone] : [[200, S('a')], [200, S('a')]]);
      gh.when(`DELETE /${path}/{secret_name}`).reply(204, null);
    }
  });
}

runWriteContract({
  ...base, ...strict, production: true, accessWidening: true, needsConfirm: true, label: 'github_secret_set_repo_access', definition: def('github_secret_set_repo_access'), args: { name: 'DEPLOY_KEY', repositoryIds: [7, 9] },
  arrange(gh, outcome) {
    gh.when('GET /orgs/{org}/actions/secrets/{secret_name}').reply(200, S('a', { visibility: 'selected' }));
    seq(gh, 'GET /orgs/{org}/actions/secrets/{secret_name}/repositories', [[200, { total_count: 1, repositories: [{ id: 7, full_name: 'example-org/a' }] }],
      [200, { total_count: 2, repositories: outcome === 'ok' ? [{ id: 7, full_name: 'example-org/a' }, { id: 9, full_name: 'example-org/b' }] : [{ id: 7, full_name: 'example-org/a' }] }]]);
    gh.when('PUT /orgs/{org}/actions/secrets/{secret_name}/repositories').reply(204, null);
  }
});

const call = async (name, w, args) => parse(await secrets.handlers[name](args, w.ctx));
const R = { repo: 'hello' };
const GET = 'GET /repos/{owner}/{repo}/actions/secrets/{secret_name}';

describe('secret rules', () => {
  it('no secret tool takes a value, a token or a password as an argument', () => {
    for (const name of ['github_secret_set', 'github_secret_delete', 'github_secret_set_repo_access', 'github_secret_list']) {
      const tool = registry.tools.find((t) => t.name === name);
      expect(Object.keys(tool.inputSchema.properties).filter((k) => /value|token|password|secret$|key/i.test(k) && !/valueFrom|bytes|kind|requestKey/.test(k))).toEqual([]);
    }
  });

  it('the default sends nothing to GitHub: it records a request and returns a link without any value', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when(GET).reply(404, { message: 'Not Found' });
    const out = await call('github_secret_set', w, { ...R, name: 'DEPLOY_KEY', confirm: true });
    expect(out).toMatchObject({ done: true, status: 'applied' });
    expect(JSON.stringify(out)).toMatch(/api\/github\/setup\?secret=[A-Za-z0-9_-]{43}/);
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    const id = JSON.stringify(out).match(/secret=([A-Za-z0-9_-]{43})/)[1];
    expect(await w.db.getSecretRequest(id)).toMatchObject({ account: 'example-org', scope: { kind: 'actions', level: 'repo', repo: 'hello', name: 'DEPLOY_KEY' } });
  });

  it('the generated value is sealed for GitHub and appears nowhere in the result, the log or the request body', async () => {
    const w = await makeWorld({ profile: 'full' });
    seq(w.gh, GET, [[200, S('a')], [200, S('b')]]);
    w.gh.when('GET /repos/{owner}/{repo}/actions/secrets/public-key').reply(200, KEY);
    w.gh.when('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}').reply(204, null);
    const out = await call('github_secret_set', w, { ...R, name: 'DEPLOY_KEY', valueFrom: 'generate', bytes: 16, confirm: true });
    expect(out.status).toBe('applied');
    const put = w.gh.calls.find((c) => c.method === 'PUT');
    const plain = sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(put.body.encrypted_value, sodium.base64_variants.ORIGINAL), PAIR.publicKey, PAIR.privateKey));
    expect(plain).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(out)).not.toContain(plain);
    expect(JSON.stringify(await w.db.getChange(1))).not.toContain(plain);
    expect(w.gh.invalid).toEqual([]);
  });

  it('a name starting with GITHUB_ is refused by the tool\'s own name rule', () => {
    const rule = new RegExp(registry.tools.find((t) => t.name === 'github_secret_set').inputSchema.properties.name.pattern);
    expect(rule.test('GITHUB_TOKEN')).toBe(false);
    expect(rule.test('github_token')).toBe(false);
    expect(rule.test('DEPLOY_KEY')).toBe(true);
  });

  it('visibility is for organization secrets only', async () => {
    const w = await makeWorld({ profile: 'full' });
    w.gh.when(GET).reply(404, { message: 'Not Found' });
    const out = await call('github_secret_set', w, { ...R, name: 'K', visibility: 'all', confirm: true });
    expect(JSON.stringify(out)).toMatch(/Visibility only applies to organization/);
  });

  it('deleting says plainly that the value cannot come back, and keeps no undo', async () => {
    const w = await makeWorld({ profile: 'full' });
    seq(w.gh, GET, [[200, S('a')], gone]);
    w.gh.when('DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}').reply(204, null);
    const preview = await call('github_secret_delete', w, { ...R, name: 'DEPLOY_KEY', dryRun: true });
    expect(preview.preview).toMatch(/cannot be recovered/);
    expect((await w.db.getChange(1)).inverse ?? null).toBeNull();
  });

  it('repository access cannot be set for a secret that is open to all repositories', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /orgs/{org}/actions/secrets/{secret_name}').reply(200, S('a', { visibility: 'all' }));
    const out = await call('github_secret_set_repo_access', w, { name: 'DEPLOY_KEY', repositoryIds: [7], confirm: true });
    expect(JSON.stringify(out)).toMatch(/not limited to selected repositories|available to "all"/);
    expect(w.gh.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
