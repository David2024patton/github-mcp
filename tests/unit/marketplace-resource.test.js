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

import { createHmac } from 'node:crypto';
import { createMarketplaceWebhook } from '../../src/marketplace/lifecycle.js';
import { marketplaceSetup } from '../../src/marketplace/setup.js';
import { call, request } from '../../test/helpers/http-harness.js';

describe('Marketplace public boundaries',()=>{
  const secret='FAKE-webhook-secret-0000000000000000000';
  const sql=async()=>{throw new Error('No database call is allowed before signature verification');};
  const hook=createMarketplaceWebhook({sql,env:{GITHUB_MARKETPLACE_WEBHOOK_SECRET:secret}});
  const signed=(rawBody,event='ping')=>({...request('POST'),rawBody,headers:{'x-github-event':event,
    'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex')}});
  it('rejects invalid signatures, oversized bodies and malformed payloads before storage',async()=>{
    expect((await call(hook,{...signed(Buffer.from('{}')),headers:{}})).statusCode).toBe(401);
    expect((await call(hook,signed(Buffer.alloc(256*1024+1)))).statusCode).toBe(413);
    expect((await call(hook,signed(Buffer.from('{'),'marketplace_purchase'))).statusCode).toBe(400);
  });
  it('accepts ping and ignores unrelated signed events without creating customers',async()=>{
    expect((await call(hook,signed(Buffer.from('{}')))).statusCode).toBe(200);
    expect((await call(hook,signed(Buffer.from('{}'),'issues'))).statusCode).toBe(202);
    expect((await call(hook,request('GET'))).statusCode).toBe(405);
    expect((await call(createMarketplaceWebhook({sql,env:{}}),request('POST'))).statusCode).toBe(503);
  });
  it('resolves the installed account using this App and shows its separate connection URL',async()=>{
    const setupEnv={...env,GITHUB_PILOT_APP_ID:'960001'};
    const db=async(parts)=>parts.join('').includes('SELECT account_id,plan_id,status,effective_at') ? [{status:'active'}] : [];
    const res=await call((req,res)=>marketplaceSetup(req,res,{sql:db,credentials:{appJwt:async()=> 'ghs_FAKE-app-jwt'},env:setupEnv,
      fetchImpl:async(url,options)=>{
        expect(url).toBe('https://api.github.com/app/installations/940001');
        expect(options.headers.authorization).toBe('token ghs_FAKE-app-jwt');
        return Response.json({app_id:960001,suspended_at:null,account:{id:51001}});
      }}),request('GET',{installation_id:'940001'}));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('https://mcp.example.test/api/marketplace/mcp?account=51001');
    expect(res.body).not.toContain('ghs_FAKE');
  });
});
