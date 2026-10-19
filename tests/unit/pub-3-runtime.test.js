import { describe, expect, it, vi } from 'vitest';
import { claimTenantBudget, recordTenantMetric,
  withTenantStorageLimits, TenantCapacityError,
  TENANT_RUNTIME_LIMITS } from '../../src/tenancy/runtime-limits.js';

describe('PUB-3 scoped runtime fail-closed validation',()=>{
  it('rejects malformed/untrusted scope and nonfinite limits before SQL',async()=>{
    const sql=vi.fn();
    for(const props of [
      {operation:'arbitrary-code',clientId:'a',tenantMax:10,clientMax:2},
      {operation:'mcp',clientId:'',tenantMax:10,clientMax:2},
      {operation:'mcp',clientId:'x'.repeat(300),tenantMax:10,clientMax:2},
      {operation:'mcp',clientId:'a',tenantMax:2,clientMax:3},
      {operation:'mcp',clientId:'a',tenantMax:10,clientMax:2,amount:-1},
      {operation:'mcp',clientId:'a',tenantMax:10,clientMax:2,window:'year'}
    ]){
      await expect(claimTenantBudget(sql,props)).rejects.toThrow(/Invalid/);
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('throws a bounded public rate error when atomic Postgres refuses a claim',async()=>{
    const sql=vi.fn(async()=>[]);
    await expect(claimTenantBudget(sql,{operation:'mcp',clientId:'client',
      tenantMax:10,clientMax:2})).rejects.toBeInstanceOf(TenantCapacityError);
    expect(sql).toHaveBeenCalledOnce();
    const error=await claimTenantBudget(sql,{operation:'oauth',clientId:'client',
      tenantMax:10,clientMax:2}).catch(x=>x);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.message).not.toContain('client');
  });

  it('validates retained size and TTL before any database mutation',async()=>{
    const db={createJob:vi.fn(),putResult:vi.fn()};
    const sql=vi.fn();
    const store=withTenantStorageLimits(db,sql,'client-fixture');
    await expect(store.createJob({ttlMinutes:1441})).rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({ttlSeconds:86401,body:{a:1}}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({body:{big:'X'.repeat(
      TENANT_RUNTIME_LIMITS.resultMaxBytes+1)}}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({body:undefined})).rejects.toThrow(/valid JSON/);
    expect(db.putResult).not.toHaveBeenCalled();
    expect(db.createJob).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it('never admits raw tokens, repository names, errors or URLs into telemetry event classes',async()=>{
    const sql=vi.fn();
    const bad=[
      {event:'github_pat_FAKEsecret',outcome:'ok',durationMs:2},
      {event:'https://github.com/org/private',outcome:'ok',durationMs:2},
      {event:'mcp',outcome:'raw GitHub error contains key',durationMs:2},
      {event:'mcp',outcome:'ok',durationMs:-1},
      {event:'mcp',outcome:'ok',durationMs:Infinity}
    ];
    for(const v of bad)await expect(recordTenantMetric(sql,v)).rejects.toThrow();
    expect(sql).not.toHaveBeenCalled();
  });
});
