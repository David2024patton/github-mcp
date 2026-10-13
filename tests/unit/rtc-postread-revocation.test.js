import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {request,call,json} from '../../test/helpers/http-harness.js';

const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const row={client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
  accounts:['scratch-org'],areas:['server','meta'],mode:'preview',
  profile:'read_only',listing:'compact',expires_at:new Date(Date.now()+600000),
  allow_writes:false,production_access:false,money_limit_cents:0};
const account={login:'scratch-org',is_scratch:true,production_enabled:false,
  account_type:'Organization',installation_status:'active',repository_selection:'all'};
const read={name:'github_authority_fixture',description:'Safe read for revocation race',
  area:'server',annotations:{readOnlyHint:true},inputSchema:{
    type:'object',properties:{},additionalProperties:false}};

async function fixture({change='none',changeAfter=1,rateLimit=Infinity}={}){
  let reads=0,lookups=0,rates=0;
  const db={
    getRtcPass:async()=>{
      lookups++;
      if(change==='db_error'&&reads>=changeAfter)
        throw Error('private pass-table detail');
      return {...row,
        ...(change==='revoked'&&reads>=changeAfter?{revoked_at:new Date()}:{}),
        ...(change==='expired'&&reads>=changeAfter?{expires_at:new Date(0)}:{})};
    },
    getAccount:async()=>({...account,
      ...(change==='scratch'&&reads>=changeAfter?{is_scratch:false}:{})}),
    consumeRtcPassRate:async()=>{rates++;return rates<=rateLimit;}
  };
  const registry={tools:[read],handlers:{}};
  const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
    reads++;
    return {structuredContent:{items:[{note:'private read result withheld after revocation'}]}};
  }});
  const invoke=async(route='tool',body={})=>{
    const req=request('POST',body,{authorization:'Bearer '+pass});
    req.query=route==='tool'?{name:read.name}:{};
    return call((a,b)=>handler(a,b,route),req);
  };
  return {invoke,reads:()=>reads,lookups:()=>lookups,rates:()=>rates};
}

describe('RTC successful reply final authority check',()=>{
  it('withholds an in-flight read if its pass is revoked before response',async()=>{
    const f=await fixture({change:'revoked'});
    const res=await f.invoke();
    expect(res.statusCode).toBe(401);
    expect(json(res).error.code).toBe('pass_revoked');
    expect(res.body).not.toContain('private read result');
    expect(f.reads()).toBe(1);
    expect(f.lookups()).toBe(2);
    expect(f.rates()).toBe(1);
  });
  it('withholds an in-flight read if pass expiry or scratch removal occurs',async()=>{
    for(const change of ['expired','scratch']){
      const f=await fixture({change});
      const res=await f.invoke();
      expect(res.statusCode).toBe(change==='expired'?401:403);
      expect(json(res).error.code).toBe(change==='expired'?'pass_expired':'refused_by_guard');
      expect(res.body).not.toContain('private read result');
      expect(f.reads()).toBe(1);
      expect(f.rates()).toBe(1);
    }
  });
  it('rechecks at end of a batch, after the last read, without exposing results',async()=>{
    const f=await fixture({change:'revoked',changeAfter:2});
    const res=await f.invoke('batch',{calls:[
      {name:read.name,args:{}},{name:read.name,args:{}}
    ]});
    expect(res.statusCode).toBe(401);
    expect(json(res).error.code).toBe('pass_revoked');
    expect(res.body).not.toContain('private read result');
    expect(f.reads()).toBe(2);
    expect(f.lookups()).toBe(3);
    expect(f.rates()).toBe(2);
  });
  it('does not double-charge the pass rate for the final authority check',async()=>{
    const f=await fixture({rateLimit:1});
    const res=await f.invoke();
    expect(res.statusCode).toBe(200);
    expect(json(res).result.items).toHaveLength(1);
    expect(f.lookups()).toBe(2);
    expect(f.rates()).toBe(1);
  });
  it('fails sanitized if the final authorization read fails',async()=>{
    const f=await fixture({change:'db_error'});
    const res=await f.invoke();
    expect(res.statusCode).toBe(503);
    expect(json(res).error.code).toBe('service_error');
    expect(res.body).not.toContain('private pass-table detail');
    expect(res.body).not.toContain('private read result');
    expect(f.reads()).toBe(1);
  });
});
