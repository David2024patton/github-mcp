import { describe, expect, it } from 'vitest';
import { marketplaceAccount, marketplaceResource, accountFromResource } from '../../src/marketplace/resource.js';
import { cronAuthorized, marketplaceEnabled } from '../../src/marketplace/lifecycle.js';
const env = {PUBLIC_BASE_URL:'https://mcp.example.test',VERCEL_ENV:'production',GITHUB_MARKETPLACE_CONNECT:'enabled'};
describe('Marketplace resource boundary',()=>{
  it('accepts only canonical positive account selectors and exact resources',()=>{
    expect(marketplaceAccount('123')).toBe(123);
    for(const invalid of ['0','01','-1','1e3','1.2','',null,9007199254740992]) expect(marketplaceAccount(invalid)).toBeNull();
    const url=marketplaceResource(123,env);
    expect(accountFromResource(url,env)).toBe(123);
    for(const invalid of [url+'&extra=yes',url.replace('123','0123'),url.replace('mcp.example','evil.example'),url+'#x']) expect(accountFromResource(invalid,env)).toBeNull();
  });
  it('is dark in previews and fails closed for cron credentials',()=>{
    expect(marketplaceEnabled(env)).toBe(true);
    expect(marketplaceEnabled({...env,VERCEL_ENV:'preview'})).toBe(false);
    const cron={CRON_SECRET:'FAKE-cron-secret-0000000000000000000000'};
    expect(cronAuthorized('Bearer '+cron.CRON_SECRET,cron)).toBe(true);
    expect(cronAuthorized('Bearer wrong',cron)).toBe(false);
    expect(cronAuthorized(undefined,cron)).toBe(false);
    expect(cronAuthorized('Bearer x',{CRON_SECRET:'x'})).toBe(false);
  });
});
