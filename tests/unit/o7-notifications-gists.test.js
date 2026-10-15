import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as o7 from '../../src/tools/notifications-gists.js';

const user='GET /user',notifications='GET /notifications',
  markAll='PUT /notifications',threadSub='GET /notifications/threads/{thread_id}/subscription',
  setSub='PUT /notifications/threads/{thread_id}/subscription',
  getGist='GET /gists/{gist_id}',newGist='POST /gists',
  deleteGist='DELETE /gists/{gist_id}',listGists='GET /gists';
const who={id:1,login:'example-owner',type:'User'};
const note={id:'7',unread:true,reason:'mention',
  subject:{type:'Issue',title:'Changes'},repository:{id:22,
    full_name:'example-org/sample'},updated_at:'2026-10-14T12:00:00Z'};
const gist=(content='hello')=>({id:'abc123',owner:{id:1,login:'example-owner'},
  public:true,description:'a sample gist',
  files:{'hello.txt':{filename:'hello.txt',content,size:content.length,
    truncated:false,type:'text/plain'}}});
const arrangeNotifications=(gh,result)=>{
  gh.when(user).reply(200,who);
  gh.when(notifications).replySequence([
    {status:200,body:[note]},
    {status:200,body:result==='ok'?[]:[note]}
  ]);
  gh.when(markAll).reply(202,{});
};
const arrangeSubscription=(gh,result)=>{
  gh.when(user).reply(200,who);
  gh.when(threadSub).replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:result==='ok'?
      {subscribed:true,ignored:false}:{subscribed:false,ignored:true}}
  ]);
  gh.when(setSub).reply(200,{subscribed:true,ignored:false});
};
const arrangeCreate=(gh,result)=>{
  gh.when(user).reply(200,who);
  gh.when(newGist).reply(201,gist());
  gh.when(getGist).reply(200,result==='ok'?gist():gist('wrong'));
};
const arrangeDelete=(gh,result)=>{
  gh.when(user).reply(200,who);
  gh.when(getGist).replySequence([
    {status:200,body:gist()},
    result==='ok'?{status:404,body:{message:'Not Found'}}:
      {status:200,body:gist()}
  ]);
  gh.when(deleteGist).reply(204,null);
};
const specs=[
  {name:'github_notify_mark',args:{scope:'all',action:'read'},
    arrange:arrangeNotifications},
  {name:'github_notify_set_subscription',
    args:{scope:'thread',threadId:7,action:'watch'},
    arrange:arrangeSubscription},
  {name:'github_gist_save',args:{public:true,description:'a sample gist',
    files:[{name:'hello.txt',content:'hello'}]},
    arrange:arrangeCreate,accessWidening:true},
  {name:'github_gist_delete',args:{gistId:'abc123'},
    arrange:arrangeDelete}
];
for(const s of specs)runWriteContract({
  label:s.name,definition:{tool:o7.tools.find(x=>x.name===s.name),
    handler:o7.handlers[s.name]},args:s.args,arrange:s.arrange,
  needsConfirm:true,production:true,profile:s.name==='github_gist_delete'?'full':'everyday',
  accessWidening:s.accessWidening??false,
  ...(s.name.startsWith('github_notify_')?{
    prepare:async(w)=>w.credentials.storeClassic(
      'example-org','ghp_FAKE0123456789abcdefghij',['notifications'])
  }:{})
});
async function call(w,name,args={}){
  const run=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  return parse(await run({registry,name,args,connection:w.connection,db:w.db}));
}
describe('O-7 notification and gist owner boundaries',()=>{
  it('registers exactly the seven approved O-7 names',()=>{
    expect(o7.tools.map(x=>x.name)).toEqual([
      'github_notify_list','github_gist_list','github_gist_get',
      'github_notify_mark','github_notify_set_subscription',
      'github_gist_save','github_gist_delete'
    ]);
    for(const x of o7.tools)
      expect(registry.tools.some(y=>y.name===x.name)).toBe(true);
  });
  it('refuses to invent a classic notification credential when K is absent',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const run=createDispatch({env:w.ctx.env,credentials:w.credentials,
      fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
    const result=await run({registry,name:'github_notify_list',
      args:{max:10},connection:w.connection,db:w.db});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/notifications token|classic|setup page/i);
    expect(w.gh.calls.filter(y=>y.method!=='GET')).toHaveLength(0);
  });
  it('lists authorized gist metadata without content or secrets',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(user).reply(200,who);
    w.gh.when(listGists).reply(200,[gist('private body')]);
    const x=await call(w,'github_gist_list',{max:5});
    expect(x.gists[0]).toMatchObject({id:'abc123',public:true});
    expect(JSON.stringify(x)).not.toContain('private body');
  });
  it('caps gist file content and makes truncation explicit',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(user).reply(200,who);
    w.gh.when(getGist).reply(200,gist('Z'.repeat(64000)));
    const x=await call(w,'github_gist_get',{gistId:'abc123'});
    expect(x.files[0].content.length).toBeLessThanOrEqual(16384);
    expect(x.files[0].truncated).toBe(true);
    expect(x.complete).toBe(false);
  });
  it('refuses gist deletion for an unverified owner without POST or DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(user).reply(200,who);
    w.gh.when(getGist).reply(200,{...gist(),owner:{id:888,login:'outsider'}});
    const x=await call(w,'github_gist_delete',
      {gistId:'abc123',confirm:true,requestKey:'delete-unowned'});
    expect(x.done).toBe(false);
    expect(w.gh.calls.filter(y=>!['GET','HEAD'].includes(y.method))).toEqual([]);
  });
  it('requires explicit create visibility and valid bounded file changes',async()=>{
    const w=await makeWorld({mode:'production',profile:'everyday'});
    w.gh.when(user).reply(200,who);
    const x=await call(w,'github_gist_save',
      {files:[{name:'hello.txt',content:'data'}],confirm:true});
    expect(x.done).toBe(false);
    expect(w.gh.calls.filter(y=>!['GET','HEAD'].includes(y.method))).toEqual([]);
  });
  it('does not send bulk notification mutation when inbox was not readable',async()=>{
    const w=await makeWorld({mode:'production',profile:'everyday'});
    w.gh.when(user).reply(200,who);
    w.gh.when(notifications).reply(403,{message:'Forbidden'});
    const x=await call(w,'github_notify_mark',
      {scope:'all',action:'read',confirm:true});
    expect(x.done).toBe(false);
    expect(w.gh.calls.filter(y=>!['GET','HEAD'].includes(y.method))).toEqual([]);
  });
});
