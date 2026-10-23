import {describe,it,expect,vi} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {optionalConsentChallenge} from '../../src/tenancy/optional-challenge.js';

const env={PUBLIC_BASE_URL:'https://service.example'};
const connection={client_id:'tcl_FAKEprivate',accounts:['fixture-org'],
  default_account:'fixture-org',mode:'preview',profile:'read_only',listing:'compact'};
describe('CAP-3 native client reauthorization',()=>{
  it('carries the OAuth challenge through github_call without decrypting or calling the provider',async()=>{
    const credentials={operationAuthority:vi.fn(async()=>({status:'needs-consent'})),token:vi.fn()};
    const dispatch=createDispatch({env,credentials});
    const result=await dispatch({registry,name:'github_call',args:{name:'github_notify_list',args:{}},connection,db:{}});
    expect(result.isError).toBe(true);
    expect(result._meta['mcp/www_authenticate'][0]).toContain('scope="github.notifications.read"');
    expect(result._meta['mcp/www_authenticate'][0]).toContain('error="insufficient_scope"');
    expect(credentials.token).not.toHaveBeenCalled();
  });
  it('does not use reauthorization to bypass foreign accounts, service passes or unsupported repository routes',async()=>{
    const credentials={operationAuthority:vi.fn(async()=>({status:'needs-consent'}))};
    for(const change of [{args:{owner:'foreign'}},{args:{repo:'repo'}},
      {connection:{...connection,pass:true}},{connection:{...connection,client_id:'owner-client'}}]){
      expect(await optionalConsentChallenge({name:'github_notify_list',args:{},connection,credentials,env,...change})).toBeNull();
    }
    expect(credentials.operationAuthority).not.toHaveBeenCalled();
  });
  it('preserves a nested read-only batch challenge instead of hiding it inside result text',async()=>{
    const credentials={operationAuthority:async()=>({status:'needs-consent'})};
    const result=await createDispatch({env,credentials})({registry,name:'github_batch',
      args:{calls:[{name:'github_notify_list',args:{}}]},connection,db:{}});
    expect(result.isError).toBe(true);
    expect(result._meta['mcp/www_authenticate'][0]).toContain('insufficient_scope');
  });
  it('leaves current verified grants and provider denials on their normal guarded path',async()=>{
    for(const status of ['verified-for-scope','denied','unknown'])
      expect(await optionalConsentChallenge({name:'github_notify_list',args:{},connection,
        credentials:{operationAuthority:async()=>({status})},env})).toBeNull();
  });
});
