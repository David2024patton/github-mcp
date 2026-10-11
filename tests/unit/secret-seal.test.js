import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import { bareOctokit } from '../../src/github/client.js';
import { generateSecretValue, putSecret, sealSecret, secretRoutes } from '../../src/github/secret-seal.js';

async function keypair() {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  return { ...pair, text: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL) };
}
const open = (pair, sealed) => sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), pair.publicKey, pair.privateKey));

describe('sealing a secret', () => {
  it('seals so only the holder of the private key can read it, and never leaves the plain value in the sealed text', async () => {
    const pair = await keypair();
    const sealed = await sealSecret(pair.text, 'hunter2-value');
    expect(sealed).not.toContain('hunter2');
    expect(open(pair, sealed)).toBe('hunter2-value');
  });

  it('generates a different 64-character hex value each time', () => {
    const a = generateSecretValue(); const b = generateSecretValue();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(generateSecretValue(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('writing a secret to each place', () => {
  const places = [
    ['repository', { kind: 'actions', level: 'repo', owner: 'o', repo: 'r', name: 'S' }, 'repos/{owner}/{repo}/actions/secrets'],
    ['Dependabot repository', { kind: 'dependabot', level: 'repo', owner: 'o', repo: 'r', name: 'S' }, 'repos/{owner}/{repo}/dependabot/secrets'],
    ['environment', { kind: 'actions', level: 'environment', owner: 'o', repo: 'r', environment: 'qa', name: 'S' }, 'repos/{owner}/{repo}/environments/{environment_name}/secrets'],
    ['organization', { kind: 'codespaces', level: 'org', owner: 'o', name: 'S' }, 'orgs/{org}/codespaces/secrets'],
    ['organization agents', { kind: 'agents', level: 'org', owner: 'o', name: 'S' }, 'orgs/{org}/agents/secrets']
  ];
  for (const [label, scope, path] of places) {
    it(`${label}: asks for the public key, seals with it and sends key_id`, async () => {
      const pair = await keypair();
      const gh = makeFakeGitHub();
      gh.when(`GET /${path}/public-key`).reply(200, { key_id: 'k1', key: pair.text });
      gh.when(`PUT /${path}/{secret_name}`).reply(201, {});
      await putSecret(bareOctokit({ token: 'ghp_FAKE0123456789abcdefghij', fetch: gh.fetch }), scope, 'the-value');
      const put = gh.calls.find((c) => c.method === 'PUT');
      expect(put.body.key_id).toBe('k1');
      expect(open(pair, put.body.encrypted_value)).toBe('the-value');
      expect(JSON.stringify(gh.calls)).not.toContain('"the-value"');
      expect(gh.invalid).toEqual([]);
    });
  }

  it('an organization secret limited to chosen repositories sends their ids', async () => {
    const pair = await keypair();
    const gh = makeFakeGitHub();
    gh.when('GET /orgs/{org}/actions/secrets/public-key').reply(200, { key_id: 'k1', key: pair.text });
    gh.when('PUT /orgs/{org}/actions/secrets/{secret_name}').reply(201, {});
    await putSecret(bareOctokit({ token: 'ghp_FAKE0123456789abcdefghij', fetch: gh.fetch }), { kind: 'actions', level: 'org', owner: 'o', name: 'S' }, 'v', { visibility: 'selected', selectedRepositoryIds: [7] });
    expect(gh.calls.find((c) => c.method === 'PUT').body).toMatchObject({ visibility: 'selected', selected_repository_ids: [7] });
    expect(gh.invalid).toEqual([]);
  });

  it('refuses an unknown kind and a non-Actions environment secret', () => {
    expect(() => secretRoutes({ kind: 'pages', level: 'repo', owner: 'o', repo: 'r' })).toThrow(TypeError);
    expect(() => secretRoutes({ kind: 'dependabot', level: 'environment', owner: 'o', repo: 'r', environment: 'qa' })).toThrow(/Only Actions/);
  });
});
