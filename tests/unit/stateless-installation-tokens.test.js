// GitHub's new stateless installation tokens (2026): `ghs_` + a JWT (three base64url parts joined by dots, ~520 characters).
// https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header
// Every value here is an obvious fake; keys are generated at run time.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { containsCredential, redact } from '../../src/tools/util.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const part = (seed, n) => (seed.repeat(Math.ceil(n / seed.length))).slice(0, n);
// Shaped like the new format: dots between three parts, and '-' / '_' inside them (base64url), about 520 characters.
const STATELESS = `ghs_FAKE${part('eyJhbGciOiJSUzI1Ni-_', 40)}.${part('eyJmYWtlIjoidHJ1ZSJ9-_', 300)}.${part('FAKEsig-_x', 172)}`;
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY = crypto.randomBytes(32).toString('base64url');
const APP = { id: 424242, slug: 'example-org-mcp', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', pem: PEM, webhook_secret: 'fixture-webhook-secret-value', permissions: { contents: 'write' } };

async function setup(extraEnv = {}) {
  const db = createFakeDb({ clock: () => Date.UTC(2026, 9, 24, 12) });
  await db.initSchema();
  const gh = makeFakeGitHub();
  const credentials = createCredentials({ db, env: { TOKEN_ENCRYPTION_KEY: KEY, ...extraEnv }, fetch: (u, i) => gh.fetch(u, i), now: () => Date.UTC(2026, 9, 24, 12) });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app' });
  await credentials.storeApp(APP, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', appId: 424242 });
  await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  gh.when('POST /app/installations/{installation_id}/access_tokens').reply(201, () => ({
    token: STATELESS, expires_at: new Date(Date.UTC(2026, 9, 24, 13)).toISOString(), permissions: { contents: 'write' }, repository_selection: 'all'
  }));
  return { db, gh, credentials };
}

describe('stateless installation tokens', () => {
  it('the fake has the new shape: ghs_ prefix, two dots, about 520 characters', () => {
    expect(STATELESS.startsWith('ghs_')).toBe(true);
    expect(STATELESS.split('.')).toHaveLength(3);
    expect(STATELESS.length).toBeGreaterThanOrEqual(520);
    expect(STATELESS).toMatch(/^ghs_[A-Za-z0-9._-]{36,}$/); // GitHub's recommended validation pattern
  });

  it('redaction hides the WHOLE token, not just the part before the first dot', () => {
    const text = `token=${STATELESS} done`;
    const out = redact(text);
    expect(out).toBe('token=[hidden] done');
    for (const piece of STATELESS.split('.')) expect(out).not.toContain(piece.slice(-12));
    expect(containsCredential(text)).toBe(true);
    expect(redact('old ghs_FAKEshortopaque1234567890 token')).toBe('old [hidden] token');
  });

  it('is minted, stored sealed and returned unchanged (no length assumption anywhere)', async () => {
    const { db, credentials } = await setup();
    expect(await credentials.token({ account: 'example-org' })).toBe(STATELESS);
    const cached = await db.getInstallationToken(777, 'all');
    expect(cached.token_enc).not.toContain(STATELESS.slice(4, 40));
    expect(await credentials.token({ account: 'example-org' })).toBe(STATELESS); // read back from the sealed cache
  });

  it('sends GitHub\'s per-request override header only when the setting says enabled or disabled', async () => {
    for (const [value, expected] of [['enabled', 'enabled'], ['disabled', 'disabled'], [undefined, undefined], ['true', undefined]]) {
      const { gh, credentials } = await setup(value === undefined ? {} : { GITHUB_STATELESS_INSTALLATION_TOKENS: value });
      await credentials.token({ account: 'example-org' });
      expect(gh.calls[0].headers['x-github-stateless-s2s-token']).toBe(expected);
      expect(gh.calls[0].body ?? {}).not.toHaveProperty('headers');
      expect(gh.invalid).toEqual([]);
    }
  });
});
