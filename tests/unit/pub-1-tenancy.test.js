import { describe, expect, it, vi } from 'vitest';
import { tenantSchemaName, tenantConnectionString, assertTenantSearchPath,
  openAuthorizedTenantDb, initializeProvisionedTenant } from '../../src/tenancy/directory.js';

const A = '5ca85cbb-2222-4222-8222-333333333333';
const B = '5ca85cbb-2222-4222-8222-444444444444';
const DATABASE_URL = 'postgresql://user:fictional@localhost:5432/fixture?sslmode=require';

describe('PUB-1 PRIVATE tenant namespace entry points', () => {
  it('derives a schema only from a stable opaque UUID', () => {
    expect(tenantSchemaName(A)).toBe('gh_t_5ca85cbb222242228222333333333333');
    expect(tenantSchemaName(B)).not.toBe(tenantSchemaName(A));
    for (const bad of ['public', 'gh_t_same', '../public', 'not-a-uuid', '', 'x'.repeat(64), null]) {
      expect(() => tenantSchemaName(bad)).toThrow(/identity ID/);
    }
  });

  it('pins the search path through a per-connection option with NO public fallback', () => {
    const u = new URL(tenantConnectionString(DATABASE_URL, A));
    expect(u.searchParams.get('sslmode')).toBe('require');
    expect(u.searchParams.get('options')).toBe('-c search_path=' + tenantSchemaName(A));
    expect(u.username).toBe('user');
    expect(() => tenantConnectionString(DATABASE_URL + '&options=-c%20search_path%3Dpublic', A)).toThrow();
    expect(() => tenantConnectionString(DATABASE_URL + '&search_path=public', A)).toThrow();
    expect(() => tenantConnectionString('https://example.com', A)).toThrow();
    expect(() => tenantConnectionString('', A)).toThrow();
  });

  it('refuses any missing, ignored or wrong search_path, never initializing legacy tables', async () => {
    for (const [schema, path] of [
      ['public', tenantSchemaName(A)], [null, tenantSchemaName(A)],
      [tenantSchemaName(B), tenantSchemaName(A)],
      [tenantSchemaName(A), 'public,' + tenantSchemaName(A)],
      [tenantSchemaName(A), 'public']
    ]) {
      const sql = async () => [{ active_schema: schema, configured_path: path }];
      await expect(assertTenantSearchPath(sql, A)).rejects.toThrow(/namespace unavailable/);
    }
    await expect(assertTenantSearchPath(async () => [{ active_schema: tenantSchemaName(A),
      configured_path: tenantSchemaName(A) }], A)).resolves.toBe(tenantSchemaName(A));
  });

  it('refuses unauthorized identity BEFORE creating any SQL client', async () => {
    const sqlFactory = vi.fn(() => { throw new Error('must not connect'); });
    const directory = { authorized: vi.fn(async () => null) };
    await expect(openAuthorizedTenantDb({ directory, tenantId: A, verifiedIdentityId: B,
      connectionString: DATABASE_URL, sqlFactory })).rejects.toThrow(/membership is not authorized/);
    expect(directory.authorized).toHaveBeenCalledWith(A, B);
    expect(sqlFactory).not.toHaveBeenCalled();
  });

  it('rejects forged/mismatched directory namespace BEFORE touching the tenant', async () => {
    const sqlFactory = vi.fn();
    const directory = { authorized: async () => ({ tenantId: A, namespace: 'public', role: 'owner' }) };
    await expect(openAuthorizedTenantDb({ directory, tenantId: A, verifiedIdentityId: B,
      connectionString: DATABASE_URL, sqlFactory })).rejects.toThrow(/not authorized/);
    expect(sqlFactory).not.toHaveBeenCalled();
  });

  it('refuses to initialize any tenant on a driver that ignores its connection schema', async () => {
    const mock = vi.fn(async () => [{ active_schema: 'public', configured_path: 'public' }]);
    await expect(initializeProvisionedTenant({ tenantId: A, connectionString: DATABASE_URL,
      sqlFactory: () => mock })).rejects.toThrow(/namespace unavailable/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
