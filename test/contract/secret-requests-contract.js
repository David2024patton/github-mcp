// Contract for secret entry requests (G-3): a waiting request is used once, expires, and can be put back. Run against the in-memory fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const id = (c) => c.repeat(43);
const scope = { kind: 'actions', level: 'repo', owner: 'example-org', repo: 'hello', name: 'DEPLOY_KEY' };

export function runSecretRequestContract(name, make) {
  describe(`secret entry requests: ${name}`, () => {
    it('keeps a request until it is used, and shows where it goes but never a value', async () => {
      const db = await make();
      await db.createSecretRequest({ id: id('a'), account: 'example-org', scope, connection: 'client-1' });
      expect(await db.getSecretRequest(id('a'))).toMatchObject({ id: id('a'), account: 'example-org', scope });
      expect(await db.getSecretRequest(id('b'))).toBeNull();
      await expect(db.createSecretRequest({ id: 'short', account: 'x', scope })).rejects.toThrow(TypeError);
    });

    it('can be claimed exactly once, and put back when GitHub refused the secret', async () => {
      const db = await make();
      await db.createSecretRequest({ id: id('c'), account: 'example-org', scope });
      expect(await db.claimSecretRequest(id('c'))).toMatchObject({ account: 'example-org', scope });
      expect(await db.claimSecretRequest(id('c'))).toBeNull();
      expect(await db.getSecretRequest(id('c'))).toBeNull();
      await db.releaseSecretRequest(id('c'));
      expect(await db.claimSecretRequest(id('c'))).toMatchObject({ account: 'example-org' });
    });

    it('stops working after it expires', async () => {
      const db = await make();
      await db.createSecretRequest({ id: id('d'), account: 'example-org', scope, ttlSeconds: -5 });
      expect(await db.getSecretRequest(id('d'))).toBeNull();
      expect(await db.claimSecretRequest(id('d'))).toBeNull();
    });
  });
}
