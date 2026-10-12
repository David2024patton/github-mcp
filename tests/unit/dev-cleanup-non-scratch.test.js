import {describe,expect,it} from 'vitest';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-branch-204',BR=`rtc/${RUN}/change`,REPO='host-project',OWNER='example-org',SHA='a'.repeat(40);
const host={full_name:`${OWNER}/${REPO}`,private:true,default_branch:'main'};
const branch={name:BR,protected:false,commit:{sha:SHA}};
const def={tool:mod.tools[0],handler:mod.handlers.github_dev_cleanup};
async function prepare(w) {
 await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
   type:'branch',owner:OWNER,repo:REPO,objectId:BR,createdSha:SHA});
}
function arrange(gh,kind) {
 gh.when('GET /repos/{owner}/{repo}').reply(200,host);
 gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
   {status:200,body:branch},{status:200,body:branch},{status:200,body:branch},
   {status:200,body:branch},{status:200,body:branch},
   kind==='mismatch'?{status:200,body:branch}:{status:404,body:{message:'Not Found'}},
   kind==='mismatch'?{status:200,body:branch}:{status:404,body:{message:'Not Found'}}
 ]);
 gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
 gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
}
runWriteContract({label:'github_dev_cleanup standalone exact branch',definition:def,
  args:{runId:RUN,repo:REPO},needsConfirm:true,expectedWrites:1,prepare,arrange});
describe('non-scratch safety hardening',()=>{
 it('does not delete the host repository and refuses foreign run refs',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.status).toBe('applied');
  expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE').map(c=>c.params.ref)).toEqual([`heads/${BR}`]);
 });
 it('does not touch a default or protected branch, even if journaled',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200,{...branch,protected:true});
  expect(parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx)).done).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses a changed test branch SHA and never guesses ownership',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200,{...branch,commit:{sha:'b'.repeat(40)}});
  const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
});
