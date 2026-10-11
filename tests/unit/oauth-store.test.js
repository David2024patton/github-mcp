import { describe, expect, it } from 'vitest';
import { CONNECTION_LISTINGS, CONNECTION_MODES, CONNECTION_PROFILES, checkConnection } from '../../src/db.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runOAuthContract } from '../../test/contract/oauth-contract.js';

runOAuthContract('in-memory fake', async () => createFakeDb());

describe('checkConnection', () => {
  it('accepts a consistent connection and returns a copy of the account list', () => {
    const accounts = ['a', 'b'];
    const checked = checkConnection({ defaultAccount: 'b', accounts, mode: 'production', profile: 'full', listing: 'compact' });
    expect(checked).toEqual({ defaultAccount: 'b', accounts: ['a', 'b'], mode: 'production', profile: 'full', listing: 'compact' });
    expect(checked.accounts).not.toBe(accounts);
  });

  it('knows exactly the modes, profiles and listings of BATCH-A A6', () => {
    expect(CONNECTION_MODES).toEqual(['preview', 'production']);
    expect(CONNECTION_PROFILES).toEqual(['read_only', 'everyday', 'full']);
    expect(CONNECTION_LISTINGS).toEqual(['catalog', 'compact']);
  });

  it('rejects non-string and empty account names', () => {
    for (const accounts of [[''], [1], [null], 'a', {}]) {
      expect(() => checkConnection({ defaultAccount: 'a', accounts, mode: 'preview', profile: 'everyday', listing: 'catalog' })).toThrow(TypeError);
    }
  });
});
