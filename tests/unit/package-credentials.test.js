import { describe, expect, it } from 'vitest';
import { githubFor } from '../../src/github/client.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const TOKEN = 'fixture-package-token-value-only';
const LIST = 'GET /orgs/{org}/packages';
const RECORD = 'GET /orgs/{org}/packages/{package_type}/{package_name}';
const params = { org: 'example-org', package_type: 'container', package_name: 'widgets' };
const world = opts => makeWorld({ packageToken: true, profile: 'full', ...opts });
const client = w => githubFor(w.ctx, { owner: 'example-org', cred: 'P' });

describe('supported package credential isolation', () => {
  it('uses the dedicated token, supports read-only metadata and safe scoped package names', async () => {
    const w = await world({ profile: 'read_only' });
    w.gh.when(RECORD).reply(200, { id: 1, name: '@example-org/widgets' });
    const octokit = await client(w);
    expect((await octokit.request(RECORD, { ...params, package_name: '@example-org/widgets' })).data.id).toBe(1);
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.calls[0].headers.authorization).toBe(`token ${TOKEN}`);
    expect(w.gh.invalid).toEqual([]);
    await expect(w.credentials.token({ account: 'example-org', cred: 'K' })).rejects.toMatchObject({ code: 'no_credentials' });
  });
  it('fails missing or expired P without falling back to the available installation or U token', async () => {
    const w = await world();
    await w.db.clearPackageToken('example-org');
    await expect(client(w)).rejects.toMatchObject({ code: 'no_credentials' });
    await w.credentials.storePackage('example-org', TOKEN, { scopes: ['read:packages'], actor: 'example-owner', expiresAt: new Date(0) });
    await expect(client(w)).rejects.toMatchObject({ code: 'no_credentials' });
    expect(w.gh.calls).toEqual([]);
  });
  it('binds ciphertext to the package purpose and exact account', async () => {
    const w = await world();
    const row = await w.db.getAccount('example-org');
    await w.db.setClassicToken('example-org', { enc: row.package_enc, scopes: ['notifications'], last4: 'test' });
    await expect(w.credentials.token({ account: 'example-org', cred: 'K' })).rejects.toMatchObject({ code: 'no_credentials' });
    await w.db.upsertAccount({ login: 'other-org', accountId: 12345, accountType: 'Organization', label: 'Other' });
    await w.db.setPackageToken('other-org', { enc: row.package_enc, scopes: ['read:packages'], actor: row.package_actor });
    await expect(w.credentials.token({ account: 'other-org', cred: 'P' })).rejects.toMatchObject({ code: 'no_credentials' });
  });
  it.each([
    { repos: ['example-org/hello'] }, { repos: [] }
  ])('refuses repository-limited passes before obtaining a credential: %j', async limits => {
    const w = await world();
    w.ctx.connection = { ...w.ctx.connection, ...limits };
    await expect(client(w)).rejects.toMatchObject({ code: 'outside_scope' });
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses permission-limited credentials', async () => {
    const w = await world();
    await expect(githubFor(w.ctx, { owner: 'example-org', cred: 'P', scope: { permissions: { packages: 'read' } } })).rejects.toMatchObject({ code: 'outside_scope' });
  });
  it.each([
    ['GET /orgs/{org}/packages', { ...params, org: 'foreign-org' }],
    ['GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }],
    ['POST /graphql', { query: 'query { viewer { login } }' }],
    ['PATCH /orgs/{org}/packages/{package_type}/{package_name}', params],
    ['GET https://example.test/orgs/example-org/packages', {}]
  ])('blocks non-package or foreign requests without any fetch: %s', async (route, args) => {
    const w = await world();
    await expect((await client(w)).request(route, args)).rejects.toMatchObject({ code: 'outside_scope' });
    expect(w.gh.calls).toEqual([]);
  });
  it.each([
    ['DELETE /orgs/{org}/packages/{package_type}/{package_name}', 'delete:packages'],
    ['POST /orgs/{org}/packages/{package_type}/{package_name}/restore', 'write:packages']
  ])('checks exact operation scopes before dispatch: %s', async (route, required) => {
    const w = await world();
    await w.credentials.storePackage('example-org', TOKEN, { scopes: ['read:packages'], actor: 'example-owner' });
    await expect((await client(w)).request(route, params)).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining(required) });
    expect(w.gh.calls).toEqual([]);
  });
  it('blocks mutations through read-only clients even when the saved token has write scopes', async () => {
    const w = await world({ profile: 'read_only' });
    await expect((await client(w)).request('DELETE /orgs/{org}/packages/{package_type}/{package_name}', params)).rejects.toMatchObject({ code: 'outside_scope' });
    expect(w.gh.calls).toEqual([]);
  });
  it('rechecks removal before fetch and preserves provider permission/revocation errors', async () => {
    const w = await world();
    const octokit = await client(w);
    await w.db.clearPackageToken('example-org');
    await expect(octokit.request(LIST, { org: 'example-org', package_type: 'container' })).rejects.toMatchObject({ code: 'no_credentials' });
    expect(w.gh.calls).toEqual([]);
    await w.credentials.storePackage('example-org', TOKEN, { scopes: ['read:packages'], actor: 'example-owner' });
    w.gh.when(LIST).reply(403, { message: 'Resource protected by organization SAML enforcement.' });
    await expect((await client(w)).request(LIST, { org: 'example-org', package_type: 'container' })).rejects.toMatchObject({ status: 403 });
    expect(w.gh.calls).toHaveLength(1);
  });
});

describe('authenticated private personal package routes',()=>{
  it('permits implicit /user packages only for the enrolled personal token actor',async()=>{
    const w=await world({packageUser:true,profile:'read_only'});
    const route='GET /user/packages/{package_type}/{package_name}/versions';
    w.gh.when(route).reply(200,[{id:12,name:'private-version'}]);
    const data=(await (await client(w)).request(route,{package_type:'container',package_name:'private-image',per_page:20,page:1})).data;
    expect(data[0].id).toBe(12);expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls[0].headers.authorization).toBe(`token ${TOKEN}`);
  });
  it('refuses implicit personal routes for an organization-associated token, even if that actor owns packages',async()=>{
    const w=await world();
    await expect((await client(w)).request('GET /user/packages',{package_type:'container'})).rejects.toMatchObject({code:'outside_scope'});
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses a personal route when stored token actor differs from the enrolled account',async()=>{
    const w=await world({packageUser:true});
    await w.credentials.storePackage('example-org',TOKEN,{scopes:['read:packages'],actor:'foreign-user'});
    await expect((await client(w)).request('GET /user/packages',{package_type:'container'})).rejects.toMatchObject({code:'outside_scope'});
    expect(w.gh.calls).toEqual([]);
  });
});
