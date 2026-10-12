import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as seeded from '../../src/tools/dev-seed-write.js';

const ID='run-seeded-101',REPO='seed-demo',OWNER='example-org',COMMIT='b'.repeat(40);
const PATH=`.github/workflows/rtc-${ID}.yml`,LABEL=`rtc-run-${ID}`,BRANCH=`rtc/${ID}/failure-ref`;
const MARK=`rtc_run=${ID}`;
const workflow=(failing)=>`name: RTC ${ID}
on:
  workflow_dispatch:
jobs:
  fixture:
    runs-on: ubuntu-latest
    steps:
      - name: ${failing?'Fail':'Pass'} controlled scenario
        run: ${failing?'exit 1':'echo "RTC fixture passed"'}
`;
const repository=(v={})=>({full_name:`${OWNER}/${REPO}`,private:true,
  description:`Developer fixture for ${MARK} (repo-basic)`,default_branch:'main',...v});
const arrange=(scenario)=>(gh,outcome)=>{
  const failing=scenario==='failing-ci';
  const after=repository(failing?{description:`Developer fixture for ${MARK} (failing-ci)`}:{});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:repository({...after,...(outcome==='mismatch'?{private:false}:{})})},
    {status:200,body:after}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,after);
  gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201,{
    content:{path:PATH,sha:'a'.repeat(40)},commit:{sha:COMMIT}
  });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,{
    path:PATH,sha:'a'.repeat(40),content:Buffer.from(workflow(failing)).toString('base64'),encoding:'base64'
  });
  if(failing){
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,{ref:`refs/heads/${BRANCH}`,object:{sha:COMMIT}});
    gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{ref:`refs/heads/${BRANCH}`,object:{sha:COMMIT}});
  }else{
    gh.when('POST /repos/{owner}/{repo}/labels').reply(201,{name:LABEL,color:'0969da',description:MARK});
    gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:LABEL,color:'0969da',description:MARK});
  }
};
const def={tool:seeded.tools[0],handler:seeded.handlers.github_dev_seed};
for(const scenario of ['repo-basic','failing-ci']){
  runWriteContract({label:`github_dev_seed(${scenario})`,definition:def,
    args:{repo:REPO,runId:ID,scenario},arrange:arrange(scenario),
    scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:3});
}
describe('V-1 real multi-step GitHub scenario safeguards',()=>{
  it('records all three exact returned objects with immutable run identity',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange('repo-basic')(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const list=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(list.map(x=>x.object_type).sort()).toEqual(['label','repo','workflow_file']);
    expect(list.map(x=>x.object_id).sort()).toEqual([PATH,LABEL,`${OWNER}/${REPO}`].sort());
    for(const step of ['seed-repo','seed-workflow','seed-label'])
      expect(await w.db.getDevIntent({runId:ID,account:OWNER,connection:'client-1',stepId:step}))
        .toMatchObject({status:'recorded'});
    const run=await w.db.getDevRun({id:ID,account:OWNER,connection:'client-1'});
    expect(run.scenarios).toEqual(['repo-basic']);
  });
  it('does not permit a run to silently switch scenario after it was registered',async()=>{
    const w=await makeWorld({scratchAccount:true});
    await w.db.createDevRun({id:ID,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'failing-ci',confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses non-scratch organizations, production mode and unimplemented scenario names without GitHub calls',async()=>{
    const basic=await makeWorld();expect(parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},basic.ctx)).done).toBe(false);
    expect(basic.gh.calls).toEqual([]);
    const prod=await makeWorld({scratchAccount:true,mode:'production'});
    expect(parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},prod.ctx)).done).toBe(false);
    expect(prod.gh.calls).toEqual([]);
    expect(seeded.SEEDABLE).toEqual(['repo-basic','failing-ci']);
  });
  it('never blindly repeats a failed downstream GitHub write after repo creation',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange('repo-basic')(w.gh,'ok');
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(403,{message:'Forbidden'});
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},w.ctx));
    expect(out.done).toBe(false);
    const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(rows).toEqual([expect.objectContaining({object_type:'repo',object_id:`${OWNER}/${REPO}`})]);
    expect(await w.db.getDevIntent({runId:ID,account:OWNER,connection:'client-1',stepId:'seed-workflow'}))
      .toMatchObject({status:'uncertain'});
    expect(w.gh.calls.filter(x=>x.route==='POST /orgs/{org}/repos')).toHaveLength(1);
  });
});

const releaseArrange=(gh,outcome)=>{
  const repo=repository({description:`Developer fixture for ${MARK} (release-train)`});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:{...repo,...(outcome==='mismatch'?{private:false}:{})}},
    {status:200,body:repo}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,repo);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
    request=>({ref:`refs/${request.params.ref}`,object:{sha:COMMIT}}));
  gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,
    request=>({ref:request.body.ref,object:{sha:request.body.sha}}));
  gh.when('POST /repos/{owner}/{repo}/releases').reply(201,
    {id:128,tag_name:'v0.3.0',draft:true,body:`Draft-only release fixture ${MARK}`});
  gh.when('GET /repos/{owner}/{repo}/releases/{release_id}').reply(200,
    {id:128,tag_name:'v0.3.0',draft:true,body:`Draft-only release fixture ${MARK}`});
};
runWriteContract({label:'github_dev_seed(release-train)',definition:def,
  args:{repo:REPO,runId:ID,scenario:'release-train'},arrange:releaseArrange,
  scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:5});
describe('release-train durable draft fixture',()=>{
  it('records three exact tags and the draft release, never publishes',async()=>{
    const w=await makeWorld({scratchAccount:true});releaseArrange(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'release-train',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(rows.map(x=>x.object_type).sort()).toEqual(['release','repo','tag','tag','tag']);
    expect(rows.filter(x=>x.object_type==='tag').map(x=>x.object_id).sort())
      .toEqual(['v0.1.0','v0.2.0','v0.3.0']);
    expect(rows.find(x=>x.object_type==='release').object_id).toBe('128');
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/releases')[0].body.draft).toBe(true);
  });
});
