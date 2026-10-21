import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runCredentialsContract } from '../../test/contract/credentials-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE gh_apps, gh_accounts, gh_installation_tokens, setup_states, one_time_secrets'); });

runCredentialsContract('isolated PostgreSQL', async () => db);

describe('GitHub credential store on throwaway Postgres only', () => {
  it('purges at most 100 expired one-time secrets and installation tokens per write', async () => {
    for (let i = 0; i < 130; i++) {
      await rawQuery(`INSERT INTO one_time_secrets (id, kind, ciphertext, expires_at) VALUES ($1, 'k', 'c', now() - interval '1 hour')`, [`old-${i}`]);
      await rawQuery(`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at) VALUES (1, $1, 'c', now() - interval '1 hour')`, [`old-${i}`]);
    }
    await db.addOneTimeSecret({ id: 'N'.repeat(32), kind: 'k', ciphertext: 'c', expiresAt: new Date(Date.now() + 60000) });
    await db.putInstallationToken(2, 'fresh', 'c', new Date(Date.now() + 3600000));
    expect((await rawQuery('SELECT count(*)::int AS n FROM one_time_secrets'))[0].n).toBe(31);
    expect((await rawQuery('SELECT count(*)::int AS n FROM gh_installation_tokens'))[0].n).toBe(31);
  });

  it('the first account is the default even when two handles add accounts in turn, and the database enforces unique GitHub ids', async () => {
    const other = createDb(neonShapedQuery());
    await db.upsertAccount({ login: 'one', accountId: 1, accountType: 'User', label: 'One' });
    await other.upsertAccount({ login: 'two', accountId: 2, accountType: 'User', label: 'Two' });
    expect((await rawQuery('SELECT login FROM gh_accounts WHERE is_default'))).toEqual([{ login: 'one' }]);
  });
});

describe('CAP-3 owner optional grant metadata CAS and rollback safety', () => {
  const proof=(fingerprint,extra={})=>({version:1,kind:'P',host:'github.com',
    actorId:4001,accountId:901,scope:'legacy-owner',fingerprint,
    verification:'identity-only',...extra});
  const hash=s=>createHash('sha256').update(s).digest('hex');
  it('migrates twice without trusting old tokens and binds only current ciphertext',async()=>{
    await db.upsertAccount({login:'fixture-org',accountId:901,accountType:'Organization',
      label:'Fixture',credentialKind:'app'});
    await db.setPackageToken('fixture-org',{enc:'sealed-package-token-A',
      scopes:['read:packages'],actor:'verified-human'});
    await db.initSchema();await db.initSchema();
    expect(await db.additionalCredentialProofs('fixture-org')).toEqual({});
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'P',
      expectedCipher:'different-token-1234',proof:proof(hash('different-token-1234'))})).toBe(false);
    const right='sealed-package-token-A';
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'P',
      expectedCipher:right,proof:proof(hash(right))})).toBe(true);
    expect(await db.additionalCredentialProofs('fixture-org')).toMatchObject({
      P:{kind:'P',actorId:4001,accountId:901,verification:'identity-only',
        fingerprint:hash(right),scope:'legacy-owner'}});
    expect(JSON.stringify(await db.additionalCredentialProofs('fixture-org'))).not.toContain(right);
    await db.setPackageToken('fixture-org',{enc:'sealed-package-token-B',
      scopes:['read:packages'],actor:'verified-human'});
    expect(await db.additionalCredentialProofs('fixture-org')).toEqual({});
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'P',
      expectedCipher:right,proof:proof(hash(right))})).toBe(false);
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'P',
      expectedCipher:'sealed-package-token-B',proof:proof(hash('sealed-package-token-B'))})).toBe(true);
    await db.clearPackageToken('fixture-org');
    expect(await db.additionalCredentialProofs('fixture-org')).toEqual({});
  });
  it('keeps kinds separate and refuses foreign account or forged evidence',async()=>{
    await db.upsertAccount({login:'fixture-org',accountId:901,accountType:'Organization',
      label:'Fixture',credentialKind:'app'});
    await db.upsertAccount({login:'other-org',accountId:902,accountType:'Organization',
      label:'Other',credentialKind:'app'});
    await db.setClassicToken('fixture-org',{enc:'sealed-classic-notifications',scopes:['notifications'],last4:'test'});
    const classic=proof(hash('sealed-classic-notifications'),{kind:'K'});
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'K',
      expectedCipher:'sealed-classic-notifications',proof:classic})).toBe(true);
    expect(await db.bindAdditionalCredentialProof({login:'other-org',kind:'K',
      expectedCipher:'sealed-classic-notifications',proof:classic})).toBe(false);
    expect(await db.additionalCredentialProofs('other-org')).toEqual({});
    await db.setFineGrainedToken('fixture-org',{enc:'sealed-fine-grained',last4:'test'});
    const fg=proof(hash('sealed-fine-grained'),{kind:'F'});
    expect(await db.bindAdditionalCredentialProof({login:'fixture-org',kind:'F',
      expectedCipher:'sealed-fine-grained',proof:fg})).toBe(true);
    await db.setClassicToken('fixture-org',{enc:'sealed-classic-replaced',scopes:['notifications'],last4:'last'});
    expect(await db.additionalCredentialProofs('fixture-org')).toMatchObject({F:{kind:'F'}});
    expect((await db.additionalCredentialProofs('fixture-org')).K).toBeUndefined();
    expect(await db.clearFineGrainedToken('fixture-org')).toBe(true);
    expect((await db.additionalCredentialProofs('fixture-org')).F).toBeUndefined();
    expect((await db.getAccount('fixture-org')).fine_grained_enc).toBeNull();
    await db.setClassicToken('fixture-org',{enc:'sealed-notification-proof',
      scopes:['notifications'],last4:'last'});
    const noticeHash=hash('sealed-notification-proof');
    expect(await db.bindAdditionalCredentialProof({
      login:'fixture-org',kind:'K',expectedCipher:'sealed-notification-proof',
      proof:{...proof(noticeHash),kind:'K',verification:'identity-and-capability-readback',
        operation:'GET /notifications',resource:'user/4001',scopes:['notifications']}
    })).toBe(true);
    expect((await db.additionalCredentialProofs('fixture-org')).K).toMatchObject({
      verification:'identity-and-capability-readback',operation:'GET /notifications'
    });
    await expect(db.bindAdditionalCredentialProof({
      login:'fixture-org',kind:'K',expectedCipher:'sealed-notification-proof',
      proof:{...proof(noticeHash),kind:'K',verification:'identity-and-capability-readback',
        operation:'DELETE /notifications',resource:'user/4001',scopes:['notifications']}
    })).rejects.toThrow(/invalid/);
    expect(await db.clearClassicToken('fixture-org')).toBe(true);
    expect((await db.getAccount('fixture-org')).classic_enc).toBeNull();
    await expect(db.bindAdditionalCredentialProof({login:'fixture-org',kind:'F',
      expectedCipher:'sealed-fine-grained',
      proof:{...fg,verification:'operation-authorized'}})).rejects.toThrow(/invalid/);
    await expect(db.bindAdditionalCredentialProof({login:'fixture-org',kind:'F',
      expectedCipher:'sealed-fine-grained',
      proof:{...fg,fingerprint:'0'.repeat(64)}})).rejects.toThrow(/invalid/);
  });
});
