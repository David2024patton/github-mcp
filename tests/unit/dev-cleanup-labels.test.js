import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-label-001',OWNER='example-org',REPO='host-project',BR=`rtc/${RUN}/one`,SHA='c'.repeat(40),LABEL=`rtc-run-${RUN}`;
const def=mod.handlers.github_dev_cleanup;
async function make(){
 const w=await makeWorld();
 await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'branch',owner:OWNER,repo:REPO,objectId:BR,createdSha:SHA});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'label',owner:OWNER,repo:REPO,objectId:LABEL});
 w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:`${OWNER}/${REPO}`,default_branch:'main',private:true});
 w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
  ...Array.from({length:6},()=>({status:200,body:{name:BR,protected:false,commit:{sha:SHA}}})),
  {status:404,body:{message:'Not Found'}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
 w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
 w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').replySequence([
  ...Array.from({length:3},()=>({status:200,body:{name:LABEL,description:`rtc_run=${RUN}`}})),
  {status:404,body:{message:'Not Found'}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[]);
 w.gh.when('DELETE /repos/{owner}/{repo}/labels/{name}').reply(204);
 return w;
}
describe('V-2 reserved run-label cleanup',()=>{
 it('removes only a recorded label after its exact owned branch and no foreign label users',async()=>{
   const w=await make();
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.status).toBe('applied');
   expect(w.gh.calls.filter(c=>c.method==='DELETE').map(c=>c.route)).toEqual([
    'DELETE /repos/{owner}/{repo}/git/refs/{ref}','DELETE /repos/{owner}/{repo}/labels/{name}'
   ]);
   expect(w.gh.invalid).toEqual([]);
 });
 it('refuses to remove a run-label used by an unrelated issue or PR',async()=>{
   const w=await make();
   w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[{number:71}]);
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses a label whose description was repurposed after recording',async()=>{
   const w=await make();
   w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:LABEL,description:'ordinary team label'});
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
});
