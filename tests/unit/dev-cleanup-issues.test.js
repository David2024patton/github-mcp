import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-issue-021',OWNER='example-org',REPO='host-project',BR=`rtc/${RUN}/one`,SHA='c'.repeat(40);
const num=42;
const issue={number:num,state:'open',body:`Fixture <!-- rtc_run=${RUN} -->`,labels:[]};
const cleaned={...issue,state:'closed',state_reason:'not_planned'};
async function world(){
 const w=await makeWorld();
 await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'branch',owner:OWNER,repo:REPO,objectId:BR,createdSha:SHA});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'issue',owner:OWNER,repo:REPO,objectId:String(num)});
 w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:`${OWNER}/${REPO}`,default_branch:'main',private:true});
 w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
  ...Array.from({length:6},()=>({status:200,body:{name:BR,protected:false,commit:{sha:SHA}}})),
  {status:404,body:{message:'Not Found'}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
 w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
 w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:'rtc-cleaned'});
 w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').replySequence([
  {status:200,body:issue},{status:200,body:issue},{status:200,body:issue},
  {status:200,body:cleaned},{status:200,body:cleaned},
  {status:200,body:{...cleaned,labels:[{name:'rtc-cleaned'}]}}
 ]);
 w.gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200,cleaned);
 w.gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-cleaned'}]);
 return w;
}
describe('V-2 recorded issue close-only cleanup',()=>{
 it('closes exactly the run issue as not planned, labels it and only then deletes an owned branch',async()=>{
  const w=await world();
  const out=parse(await mod.handlers.github_dev_cleanup({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.status).toBe('applied');
  expect(w.gh.calls.filter(x=>['PATCH','POST','DELETE'].includes(x.method)).map(x=>x.route))
    .toEqual(['PATCH /repos/{owner}/{repo}/issues/{issue_number}',
      'POST /repos/{owner}/{repo}/issues/{issue_number}/labels',
      'DELETE /repos/{owner}/{repo}/git/refs/{ref}']);
  expect(w.gh.invalid).toEqual([]);
 });
 it('refuses a foreign issue with a forged or absent run marker, with zero remote writes',async()=>{
  const w=await world();
  w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').reply(200,{...issue,body:'Unrelated issue'});
  const out=parse(await mod.handlers.github_dev_cleanup({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.filter(x=>['PATCH','POST','DELETE'].includes(x.method))).toHaveLength(0);
 });
 it('refuses issue cleanup when the shared rtc-cleaned label was not provisioned',async()=>{
  const w=await world();
  w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(404,{message:'Not Found'});
  const out=parse(await mod.handlers.github_dev_cleanup({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.filter(x=>['PATCH','POST','DELETE'].includes(x.method))).toHaveLength(0);
 });
 it('does not close an issue that is actually a pull request',async()=>{
  const w=await world();
  w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').reply(200,{...issue,pull_request:{url:'https://api.github.com/other'}});
  const out=parse(await mod.handlers.github_dev_cleanup({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.filter(x=>['PATCH','POST','DELETE'].includes(x.method))).toHaveLength(0);
 });
});
