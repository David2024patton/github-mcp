import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {runConformance} from '../../test/upstream/rtc/src/run.js';
import {startFakeServer} from '../../test/upstream/rtc/fake/server.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';

describe('Pinned Hub RTC 1 conformance runner',()=>{
  it('executes upstream named probes against its real HTTP reference and reports skipped checks honestly',async()=>{
    const reference=await startFakeServer();
    try{
      const result=await runConformance({url:reference.url,passes:reference.passes,oauth:reference.oauth});
      for(const name of ['manifest','manifest.openapi','catalog','meta','reads','writes',
        'passes','passes.read_only','passes.expired','passes.revoked','safety','budget','oauth.refresh_settings']){
        expect(result.checks.find(x=>x.name===name),name).toMatchObject({ok:true});
      }
      expect(result.checks.find(x=>x.name==='limits.two_instance')).toMatchObject({ok:false,skipped:true});
      expect(result.ok).toBe(false);
    }finally{await reference.close();}
  });
  it('recognizes this server as NOT certified while still checking actual pass rejection over HTTP',async()=>{
    const pass='rtc_pass_'+randomBytes(32).toString('base64url');
    const expired='rtc_pass_'+randomBytes(32).toString('base64url');
    const revoked='rtc_pass_'+randomBytes(32).toString('base64url');
    const account={login:'scratch-org',is_scratch:true,production_enabled:false,
      account_type:'Organization',installation_status:'active',repository_selection:'all'};
    const registry={tools:[{name:'github_whoami',area:'server',description:'Read scope',
      inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},compact:true}],handlers:{}};
    const db={
      async getRtcPass(value){
        if(![pass,expired,revoked].includes(value))return null;
        return {client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
          accounts:['scratch-org'],mode:'preview',profile:'read_only',listing:'compact',
          expires_at:value===expired?new Date(0):new Date(Date.now()+60000),
          revoked_at:value===revoked?new Date():null};
      },
      async getAccount(){return account;},
      async consumeRtcPassRate(){return true;}
    };
    const dispatch=async()=>({structuredContent:{profile:'read_only'}});
    const handler=createRtcHttpHandler({db,registry,dispatch});
    const server=createServer(async(req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      const path=url.pathname,query=Object.fromEntries(url.searchParams);
      let route=path==='/api/contract'?'contract':path==='/api/whoami'?'whoami':
        path==='/api/openapi.json'?'openapi':path==='/api/tools'?'tools':
        path.startsWith('/api/tools/')?'tool':'missing';
      if(path==='/api/tools/_batch')route='batch';
      if(route==='tool')query.name=decodeURIComponent(path.split('/').at(-1));
      let data='';
      for await(const chunk of req){data+=chunk;if(data.length>65536)break;}
      let body={};try{if(data)body=JSON.parse(data);}catch{body=null;}
      const headers={};
      const result={
        setHeader(k,v){headers[k]=v;},
        status(n){this.code=n;return this;},
        json(value){res.writeHead(this.code??200,{'Content-Type':'application/json',...headers});
          res.end(JSON.stringify(value));return this;}
      };
      await handler({method:req.method,headers:req.headers,query,body},result,route);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    try{
      const result=await runConformance({url,passes:{readOnly:pass,expired,revoked}});
      expect(result.checks.find(x=>x.name==='manifest')).toMatchObject({ok:false});
      expect(result.checks.find(x=>x.name==='manifest').skipped).not.toBe(true);
      for(const name of ['passes','passes.expired','passes.revoked'])
        expect(result.checks.find(x=>x.name===name),name).toMatchObject({ok:true});
      expect(result.checks.find(x=>x.name==='catalog')).toMatchObject({ok:false,skipped:true});
      expect(result.ok).toBe(false);
    }finally{await new Promise(resolve=>server.close(resolve));}
  });
});
