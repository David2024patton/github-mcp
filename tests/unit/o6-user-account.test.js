import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as account from '../../src/tools/user-account.js';

const who='GET /user',p='PATCH /user',allEmails='GET /user/emails',
  addEmail='POST /user/emails',keyList='GET /user/keys',
  keyOne='GET /user/keys/{key_id}',keyAdd='POST /user/keys',
  keyDelete='DELETE /user/keys/{key_id}',checkBlock='GET /user/blocks/{username}',
  putBlock='PUT /user/blocks/{username}',invites='GET /user/repository_invitations',
  accept='PATCH /user/repository_invitations/{invitation_id}',repo='GET /repos/{owner}/{repo}';
const base={id:1,login:'example-owner',type:'User',name:'Before',
  bio:'Before bio',two_factor_authentication:true,plan:{name:'Free'}};
const profile=(gh,scenario)=>{
  gh.when(who).replySequence([
    {status:200,body:base},{status:200,body:base},
    {status:200,body:{...base,name:scenario==='mismatch'?'Before':'After'}}
  ]);
  gh.when(p).reply(200,{...base,name:'After'});
};
const primary={email:'owner@example.com',primary:true,verified:true,visibility:'private'};
const extra={email:'new@example.com',primary:false,verified:false,visibility:null};
const email=(gh,scenario)=>{
  gh.when(who).reply(200,base);
  gh.when(allEmails).replySequence([
    {status:200,body:[primary]},
    {status:200,body:scenario==='mismatch'?[primary]:[primary,extra]}
  ]);
  gh.when(addEmail).reply(201,[extra]);
};
const publicKey='ssh-ed25519 '+('A'.repeat(54))+' user@example.com';
const newKey={id:8,key:publicKey,title:'workstation',created_at:'2026-10-14T00:00:00Z'};
const keyCreate=(gh,scenario)=>{
  gh.when(who).reply(200,base);
  gh.when(keyList).reply(200,[]);
  gh.when(keyAdd).reply(201,newKey);
  gh.when(keyOne).reply(200,scenario==='mismatch'?{...newKey,id:9}:newKey);
};
const keyRemove=(gh,scenario)=>{
  gh.when(who).reply(200,base);
  gh.when(keyOne).replySequence([
    {status:200,body:newKey},
    scenario==='mismatch'?{status:200,body:newKey}:{status:404,body:{message:'Not Found'}}
  ]);
  gh.when(keyDelete).reply(204,null);
};
const blocked=(gh,scenario)=>{
  gh.when(who).reply(200,base);
  gh.when(checkBlock).replySequence([
    {status:404,body:{message:'Not Found'}},
    scenario==='mismatch'?{status:404,body:{message:'Not Found'}}:{status:204,body:null}
  ]);
  gh.when(putBlock).reply(204,null);
};
const inv={id:7,repository:{id:42,full_name:'example-org/sample',private:true},
  inviter:{login:'example-admin'},permissions:'write'};
const invitation=(gh,scenario)=>{
  gh.when(who).reply(200,base);
  gh.when(invites).replySequence([
    {status:200,body:[inv]},
    {status:200,body:scenario==='mismatch'?[inv]:[]}
  ]);
  gh.when(accept).reply(204,null);
  gh.when(repo).reply(200,{id:scenario==='mismatch'?43:42,
    full_name:'example-org/sample'});
};
const config=[
  {name:'github_account_update_profile',args:{name:'After'},arrange:profile},
  {name:'github_account_manage_email',
    args:{action:'add',email:'new@example.com'},arrange:email,
    notifies:['new@example.com']},
  {name:'github_account_add_key',
    args:{kind:'ssh',publicKey,title:'workstation'},arrange:keyCreate,
    accessWidening:true},
  {name:'github_account_delete_key',
    args:{kind:'ssh',keyId:8},arrange:keyRemove},
  {name:'github_account_set_blocked',
    args:{username:'unwanted-person',blocked:true},arrange:blocked},
  {name:'github_account_respond_invitation',
    args:{invitationId:7,action:'accept'},arrange:invitation,
    accessWidening:true}
];
for(const v of config){
  runWriteContract({label:v.name,definition:{
    tool:account.tools.find(x=>x.name===v.name),handler:account.handlers[v.name]},
    args:v.args,arrange:v.arrange,production:true,needsConfirm:true,
    profile:'full',accessWidening:v.accessWidening??false,
    notifies:v.notifies??[]});
}
const direct=async(w,name,args={})=>{
  const d=createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch,
    now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  return d({registry,name,args,connection:w.connection,db:w.db});
};
describe('O-6 personal account boundaries',()=>{
  it('registers exactly the nine intended personal-account catalog tools',()=>{
    expect(account.tools).toHaveLength(9);
    for(const t of account.tools)
      expect(registry.tools.some(r=>r.name===t.name)).toBe(true);
  });
  it('reads the authorized user and verified mail states without claiming absent permissions',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(who).reply(200,base);
    w.gh.when(allEmails).reply(200,[primary]);
    w.gh.when('GET /user/orgs').reply(403,{message:'Forbidden'});
    w.gh.when('GET /user/blocks').reply(200,[]);
    const x=parse(await direct(w,'github_account_get'));
    expect(x.principal).toMatchObject({id:1,login:'example-owner',
      two_factor_authentication:true});
    expect(x.emails.items[0]).toMatchObject({email:primary.email,verified:true});
    expect(x.organizations.status).toBe('not_readable');
  });
  it('does not return private or public raw key material in the key inventory',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(who).reply(200,base);
    w.gh.when('GET /user/keys').reply(200,[newKey]);
    w.gh.when('GET /user/ssh_signing_keys').reply(200,[]);
    w.gh.when('GET /user/gpg_keys').reply(200,[]);
    const x=parse(await direct(w,'github_account_list_keys'));
    expect(x.keys.ssh.items[0]).toMatchObject({id:8,kind:'ssh'});
    expect(JSON.stringify(x)).not.toContain(publicKey);
    expect(x.keys.ssh.complete).toBe(true);
  });
  it('refuses a private key without echo and without a write',async()=>{
    const secret='-----BEGIN OPENSSH PRIVATE KEY FAKE-----'+('X'.repeat(110));
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(who).reply(200,base);
    const res=parse(await direct(w,'github_account_add_key',
      {kind:'ssh',publicKey:secret,confirm:true}));
    expect(res.done).toBe(false);
    expect(JSON.stringify(res)).not.toContain(secret);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('refuses account update with no requested fields',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(who).reply(200,base);
    const res=parse(await direct(w,'github_account_update_profile',{confirm:true}));
    expect(res.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('refuses a new deletion for a key already absent, without provider DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(who).reply(200,base);
    w.gh.when(keyOne).reply(404,{message:'Not Found'});
    const res=parse(await direct(w,'github_account_delete_key',
      {kind:'ssh',keyId:8,confirm:true,requestKey:'not-an-existing-change'}));
    expect(res.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('requires a verified invitation ID before accepting',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(who).reply(200,base);
    w.gh.when(invites).reply(200,[]);
    const res=parse(await direct(w,'github_account_respond_invitation',
      {invitationId:7,action:'accept',confirm:true}));
    expect(res.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
});
