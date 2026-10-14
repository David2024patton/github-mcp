import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as hooks from '../../src/tools/webhooks-save.js';

const one='GET /repos/{owner}/{repo}/hooks/{hook_id}';
const create='POST /repos/{owner}/{repo}/hooks';
const update='PATCH /repos/{owner}/{repo}/hooks/{hook_id}';
const rotate='PATCH /repos/{owner}/{repo}/hooks/{hook_id}/config';
const orgCreate='POST /orgs/{org}/hooks';
const dest='https://hooks.fictional.net/receiver?hidden=private-callback-query';
const hook=(events=['push'],date='2026-10-13T00:00:01Z')=>({
  id:7,name:'web',active:true,events,updated_at:date,
  config:{url:dest,content_type:'json',insecure_ssl:'0',
    secret:'MASKED_PROVIDER_SECRET_SHOULD_NOT_ESCAPE'}});
const definition=n=>({tool:hooks.tools.find(t=>t.name===n),handler:hooks.handlers[n]});
const arrangeCreate=(gh,result)=>{
  gh.when(create).reply(201,{id:7});
  gh.when(one).reply(200,hook(result==='ok'?['push']:['issues']));
};
const arrangeRotate=(gh,result)=>{
  gh.when(one).replySequence([
    {status:200,body:hook(['push'],'2026-10-13T00:00:01Z')},
    {status:200,body:hook(['push'],result==='ok'?'2026-10-13T00:01:01Z':'2026-10-13T00:00:01Z')}]);
  gh.when(rotate).reply(200,{});
};
const opts={mode:'production',profile:'full'};
async function call(w,name,args){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return r.structuredContent??parse(r);
}
runWriteContract({
  label:'github_webhook_save creates a signed endpoint',
  definition:definition('github_webhook_save'),
  args:{repo:'hello',url:dest,events:['push'],active:true},
  production:true,needsConfirm:true,profile:'full',
  arrange:arrangeCreate
});
runWriteContract({
  label:'github_webhook_rotate_secret preserves subscription',
  definition:definition('github_webhook_rotate_secret'),
  args:{repo:'hello',hookId:7},production:true,needsConfirm:true,
  profile:'full',arrange:arrangeRotate
});
describe('H-2 webhook signing secret lifecycle',()=>{
  it('never exposes the signing value, original callback query or masked provider config in the tool result or journal',async()=>{
    const w=await makeWorld(opts);arrangeCreate(w.gh,'ok');
    const result=await call(w,'github_webhook_save',{
      repo:'hello',url:dest,events:['push'],confirm:true});
    expect(result).toMatchObject({done:true,status:'applied'});
    const post=w.gh.calls.find(x=>x.route===create);
    expect(post.body.config.secret).toMatch(/^[a-f0-9]{64}$/);
    const recorded=JSON.stringify({result,rows:await w.db.listChanges({limit:50,includePreviews:true})});
    expect(recorded).not.toContain(post.body.config.secret);
    expect(recorded).not.toContain('private-callback-query');
    expect(recorded).not.toContain('MASKED_PROVIDER_SECRET_SHOULD_NOT_ESCAPE');
    expect(result.result.signing_secret_reveal).toMatch(/\/api\/github\/setup\?show=/);
    const row=await w.db.consumeOneTimeSecret(
      result.result.signing_secret_reveal.split('show=')[1]);
    expect(row?.ciphertext).toEqual(expect.any(String));
    expect(JSON.stringify(row)).not.toContain(post.body.config.secret);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses unsafe callback destinations before posting',async()=>{
    const w=await makeWorld(opts);
    for(const url of ['http://localhost/webhook','https://127.0.0.1/cb',
      'https://user:pass@hooks.fictional.net/cb','https://hooks.internal/cb']){
      const result=await call(w,'github_webhook_save',{
        repo:'hello',url,events:['push'],confirm:true,requestKey:url});
      expect(result.done).toBe(false);
    }
    expect(w.gh.calls.filter(x=>x.route===create)).toHaveLength(0);
  });
  it('updates an existing webhook without raw provider configuration in the journal',async()=>{
    const w=await makeWorld(opts);
    w.gh.when(update).reply(200,hook(['push']));
    // Preflight, transient complete-config reread, then independent post-write readback.
    w.gh.when(one).replySequence([
      {status:200,body:hook(['issues'])},
      {status:200,body:hook(['issues'])},
      {status:200,body:hook(['push'])}]);
    const result=await call(w,'github_webhook_save',{
      repo:'hello',hookId:7,events:['push'],confirm:true});
    expect(result,JSON.stringify({result,invalid:w.gh.invalid})).toMatchObject({done:true,status:'applied'});
    const patch=w.gh.calls.find(x=>x.route===update);
    expect(patch.body.config.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(patch.body.events).toEqual(['push']);
    expect(JSON.stringify(await w.db.listChanges({limit:10}))).not.toContain(patch.body.config.secret);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses rotation for an HTTP or TLS-insecure existing receiver',async()=>{
    for(const config of [
      {url:'http://192.168.1.2/callback',insecure_ssl:'0'},
      {url:dest,insecure_ssl:'1'}]){
      const w=await makeWorld(opts);
      w.gh.when(one).reply(200,{...hook(),config:{...hook().config,...config}});
      const result=await call(w,'github_webhook_rotate_secret',{
        repo:'hello',hookId:7,confirm:true});
      expect(result.done).toBe(false);
      expect(w.gh.calls.filter(x=>x.route===rotate)).toHaveLength(0);
    }
  });
  it('organization webhook saves use organization-only API paths',async()=>{
    const w=await makeWorld(opts);
    w.gh.when(orgCreate).reply(201,{id:7});
    w.gh.when('GET /orgs/{org}/hooks/{hook_id}').reply(200,hook());
    const result=await call(w,'github_webhook_save',{
      scope:'org',url:dest,events:['push'],confirm:true});
    expect(result.done).toBe(true);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.find(x=>x.route===orgCreate)?.params?.org).toBe('example-org');
  });
  it('without an encryption key, refuses and never attempts a remote mutation',async()=>{
    const w=await makeWorld(opts);arrangeCreate(w.gh,'ok');
    w.ctx.env={};
    const result=await call(w,'github_webhook_save',{
      repo:'hello',url:dest,events:['push'],confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===create)).toHaveLength(0);
  });
});
