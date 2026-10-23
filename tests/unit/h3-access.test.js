import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as access from '../../src/tools/access-write.js';

const routes={
  permission:'GET /repos/{owner}/{repo}/collaborators/{username}/permission',
  people:'GET /repos/{owner}/{repo}/collaborators',
  invites:'GET /repos/{owner}/{repo}/invitations',
  add:'PUT /repos/{owner}/{repo}/collaborators/{username}',
  remove:'DELETE /repos/{owner}/{repo}/collaborators/{username}',
  invitePatch:'PATCH /repos/{owner}/{repo}/invitations/{invitation_id}',
  keyList:'GET /repos/{owner}/{repo}/keys',
  keyGet:'GET /repos/{owner}/{repo}/keys/{key_id}',
  keyAdd:'POST /repos/{owner}/{repo}/keys',
  keyDelete:'DELETE /repos/{owner}/{repo}/keys/{key_id}'};
const PUBLIC='ssh-ed25519 '+('A'.repeat(56))+' test-key';
const permission=(p='push')=>({permission:p,user:{login:'alice'}});
const invite=(p='pull')=>({id:9,invitee:{login:'alice'},permissions:p==='push'?'write':p==='pull'?'read':p});
// Real GitHub (2026-10-23) stores the key as "<type> <base64>" and drops the trailing comment.
const deploy={id:7,title:'automation key',key:PUBLIC.split(' ').slice(0,2).join(' '),read_only:false};
const definition=n=>({tool:access.tools.find(t=>t.name===n),handler:access.handlers[n]});
function arrangeAdd(gh,result){
  gh.when(routes.permission).replySequence([
    {status:404,body:{message:'Not Found'}},
    result==='ok'?{status:200,body:permission('push')}:
      {status:404,body:{message:'Not Found'}}]);
  gh.when(routes.invites).reply(200,[]);
  gh.when(routes.add).reply(204,null);
}
function arrangeRemove(gh,result){
  gh.when(routes.people).replySequence([
    {status:200,body:[{login:'alice'}]},
    {status:200,body:result==='ok'?[]:[{login:'alice'}]}]);
  gh.when(routes.invites).reply(200,[]);
  gh.when(routes.permission).replySequence([
    {status:200,body:permission()},
    {status:404,body:{message:'Not Found'}}]);
  gh.when(routes.remove).reply(204,null);
}
function arrangeInvitation(gh,result){
  gh.when(routes.invites).replySequence([
    {status:200,body:[invite()]},
    {status:200,body:[invite(result==='ok'?'push':'pull')]}]);
  gh.when(routes.invitePatch).reply(200,invite('push'));
}
function arrangeKeyAdd(gh,result){
  gh.when(routes.keyList).reply(200,[]);
  gh.when(routes.keyAdd).reply(201,deploy);
  gh.when(routes.keyGet).reply(200,result==='ok'?deploy:{...deploy,read_only:true});
}
function arrangeKeyDelete(gh,result){
  gh.when(routes.keyGet).replySequence([
    {status:200,body:deploy},
    result==='ok'?{status:404,body:{message:'Not Found'}}:{status:200,body:deploy}
  ]);
  gh.when(routes.keyDelete).reply(204,null);
}
runWriteContract({
  label:'github_collab_add exact invitation or membership',
  definition:definition('github_collab_add'),args:{repo:'hello',username:'alice',permission:'push'},
  production:true,needsConfirm:true,accessWidening:true,notifies:['alice'],
  profile:'full',arrange:arrangeAdd});
runWriteContract({
  label:'github_collab_remove direct collaborator',
  definition:definition('github_collab_remove'),args:{repo:'hello',username:'alice'},
  production:true,needsConfirm:true,profile:'full',arrange:arrangeRemove});
runWriteContract({
  label:'github_collab_manage_invitation permission',
  definition:definition('github_collab_manage_invitation'),
  args:{repo:'hello',invitationId:9,action:'update',permission:'push'},
  production:true,needsConfirm:true,accessWidening:true,profile:'full',
  arrange:arrangeInvitation});
runWriteContract({
  label:'github_deploykey_add write-capable',
  definition:definition('github_deploykey_add'),
  args:{repo:'hello',title:'automation key',key:PUBLIC,readOnly:false},
  production:true,needsConfirm:true,accessWidening:true,profile:'full',
  arrange:arrangeKeyAdd});
runWriteContract({
  label:'github_deploykey_delete exact ID',
  definition:definition('github_deploykey_delete'),
  args:{repo:'hello',keyId:7},
  production:true,needsConfirm:true,profile:'full',arrange:arrangeKeyDelete});

async function call(w,name,args){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const result=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return result.structuredContent??parse(result);
}
describe('H-3 repository access specific negative and independent read cases',()=>{
  it('rejects private SSH keys before a provider request, without echoing them',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const value=['-----BEGIN',' OPENSSH PRIVATE KEY-----', '\nSECRET_PRIVATE_TEST\n', '-----END OPENSSH PRIVATE KEY-----'].join('');
    const r=await call(w,'github_deploykey_add',{
      repo:'hello',title:'bad',key:value,readOnly:false,confirm:true});
    expect(r.done).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET_PRIVATE_TEST');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('refuses adding the same deploy key twice rather than duplicating access',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.keyList).reply(200,[deploy]);
    const r=await call(w,'github_deploykey_add',{
      repo:'hello',title:'automation key',key:PUBLIC,readOnly:false,confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.keyAdd)).toHaveLength(0);
  });
  it('public deploy key never enters journaled before/after snapshots',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeKeyAdd(w.gh,'ok');
    const r=await call(w,'github_deploykey_add',{
      repo:'hello',title:'automation key',key:PUBLIC,readOnly:false,confirm:true});
    expect(r.done).toBe(true);
    expect(JSON.stringify(await w.db.listChanges({limit:20}))).not.toContain(PUBLIC);
    expect(w.gh.invalid).toEqual([]);
  });
  it('pending collaborator invitations cannot be represented as already-effective access',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.permission).reply(404,{message:'Not Found'});
    w.gh.when(routes.invites).replySequence([
      {status:200,body:[]},
      {status:200,body:[invite('push')]}]);
    w.gh.when(routes.add).reply(201,invite('push'));
    const r=await call(w,'github_collab_add',{
      repo:'hello',username:'alice',permission:'push',confirm:true});
    expect(r).toMatchObject({done:true,status:'applied'});
    expect(r.result).toMatchObject({effective_permission:null,pending_invitation:true});
    expect(w.gh.invalid).toEqual([]);
  });
  it('cannot delete inherited access when direct membership is absent',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.people).reply(200,[]);
    w.gh.when(routes.permission).reply(200,permission());
    w.gh.when(routes.invites).reply(200,[]);
    const r=await call(w,'github_collab_remove',{
      repo:'hello',username:'alice',confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.remove)).toHaveLength(0);
  });
  it('refuses unverified invitation IDs without cancel or permission update',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.invites).reply(200,[invite()]);
    const r=await call(w,'github_collab_manage_invitation',{
      repo:'hello',invitationId:999,action:'cancel',confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('read tool inventories project only scoped membership and key metadata',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.people).reply(200,[{login:'alice',id:11,
      permissions:{push:true}}]);
    w.gh.when(routes.invites).reply(200,[invite()]);
    w.gh.when(routes.keyList).reply(200,[deploy]);
    const collaborators=await call(w,'github_collab_list',{repo:'hello'});
    const keys=await call(w,'github_deploykey_list',{repo:'hello'});
    expect(collaborators.collaborators).toHaveLength(1);
    expect(collaborators.pending_invitations).toHaveLength(1);
    expect(keys.keys).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(PUBLIC);
    expect(w.gh.invalid).toEqual([]);
  });
});
