import {describe,it,expect} from 'vitest';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import * as seed from '../../src/tools/dev-seed-write.js';
import {seedReviewScenario} from '../../src/dev/review-scenario.js';

const ID='run-seeded-101',REPO='seed-demo',OWNER='example-org',MARK=`rtc_run=${ID}`;
const SHA0='a'.repeat(40),SHA1='b'.repeat(40),SHA2='c'.repeat(40),
 BLOB='d'.repeat(40),BRANCH=`rtc/${ID}/review`,PATH=`rtc/${ID}/review.md`;
const initial=`RTC review fixture ${MARK}\nkeep alpha\nkeep beta\nobsolete line\n`;
const revised=`RTC review fixture ${MARK}\nkeep alpha\nkeep beta\nreplacement line\n`;
const def={tool:seed.tools[0],handler:seed.handlers.github_dev_seed};
function reviewFixture(gh,outcome){
 const repo={full_name:`${OWNER}/${REPO}`,private:true,default_branch:'main',
  description:`Developer fixture for ${MARK} (pr-with-threads)`};
 gh.when('GET /repos/{owner}/{repo}').replySequence([
  {status:404,body:{message:'Not Found'}},{status:200,body:repo},
  {status:200,body:{...repo,...(outcome==='mismatch'?{private:false}:{})}}
 ]);
 gh.when('POST /orgs/{org}/repos').reply(201,repo);
 gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
 let branchReads=0;
 gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,r=>{
  const main=r.params.ref==='heads/main';
  return {ref:`refs/${r.params.ref}`,object:{sha:main?SHA0:++branchReads>=3?SHA2:SHA1}};
 });
 gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,r=>({
  ref:r.body.ref,object:{sha:r.body.sha}
 }));
 gh.when('PUT /repos/{owner}/{repo}/contents/{path}').replySequence([
  {status:201,body:{content:{path:PATH},commit:{sha:SHA1}}},
  {status:200,body:{content:{path:PATH},commit:{sha:SHA2}}}
 ]);
 gh.when('GET /repos/{owner}/{repo}/contents/{path}').replySequence([
  {status:200,body:{path:PATH,sha:BLOB}},
  {status:200,body:{path:PATH,content:Buffer.from(revised).toString('base64')}}
 ]);
 gh.when('POST /repos/{owner}/{repo}/labels').reply(201,{name:'rtc-run',description:MARK});
 gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:'rtc-run',description:MARK});
 const pr=(sha)=>({number:47,state:'open',draft:true,head:{ref:BRANCH,sha},
  base:{ref:'main'},body:`Run-owned draft review fixture.\n\n<!-- ${MARK} -->`});
 gh.when('POST /repos/{owner}/{repo}/pulls').reply(201,pr(SHA1));
 let prReads=0;
 gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,()=>pr(++prReads>=4?SHA2:SHA1));
 gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-run'}]);
 gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-run'}]);
 gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments').reply(201,r=>({
  id:500+r.body.line,body:r.body.body,path:PATH,commit_id:SHA1,line:r.body.line
 }));
 gh.when('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}').reply(200,r=>{
  const i=Number(r.params.comment_id)-501;
  return {id:Number(r.params.comment_id),body:`${MARK} review discussion ${i}`,
    path:PATH,commit_id:SHA1,original_line:i+1};
 });
 const nodes=outdated=>[1,2,3].map(i=>({
  id:`PRRT_test_${i}`,isResolved:false,isOutdated:outdated&&i===3,
  path:PATH,comments:{totalCount:1,nodes:[{databaseId:501+i}]}
 }));
 let gql=0;
 gh.when('POST /graphql').reply(200,()=>({data:{repository:{pullRequest:{
  reviewThreads:{totalCount:3,nodes:nodes(++gql>=4)}
 }}}}));
}
runWriteContract({label:'github_dev_seed(pr-with-threads)',definition:def,
 args:{repo:REPO,runId:ID,scenario:'pr-with-threads'},
 arrange:reviewFixture,scratchAccount:true,previewOnly:true,needsConfirm:false,
 expectedWrites:10,advanceClockOnSleep:true});
describe('V-1 real three review threads, exactly one outdated',()=>{
 it('refuses another run ID in the scratch repository description before creating a fixture',async()=>{
  const calls=[];
  const github={request:async(route)=>{
    calls.push(route);
    return {data:{full_name:OWNER+'/'+REPO,private:true,default_branch:'main',
      description:'Developer fixture for rtc_run='+ID+'-other (pr-with-threads)'}};
  }};
  await expect(seedReviewScenario({}, {github,run:{owner:OWNER,repo:REPO,runId:ID}}))
    .rejects.toThrow(/run-marked/);
  expect(calls).toEqual(['GET /repos/{owner}/{repo}']);
 });

 it('records thirteen exact objects and updates only the line behind the third thread',async()=>{
  const w=await makeWorld({scratchAccount:true,advanceClockOnSleep:true});
  reviewFixture(w.gh,'ok');
  const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'pr-with-threads',confirm:true},w.ctx));
  expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
  const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1',limit:50});
  expect(rows).toHaveLength(13);
  expect(rows.filter(x=>x.object_type==='review_comment').map(x=>x.object_id).sort()).toEqual(['502','503','504']);
  expect(rows.filter(x=>x.object_type==='review_thread').map(x=>x.object_id).sort())
    .toEqual(['PRRT_test_1','PRRT_test_2','PRRT_test_3']);
  const puts=w.gh.calls.filter(x=>x.route==='PUT /repos/{owner}/{repo}/contents/{path}');
  expect(puts).toHaveLength(2);
  expect(puts[1].body).toMatchObject({branch:BRANCH,sha:BLOB});
  expect(Buffer.from(puts[0].body.content,'base64').toString('utf8')).toBe(initial);
  expect(Buffer.from(puts[1].body.content,'base64').toString('utf8')).toBe(revised);
  expect(w.gh.invalid).toEqual([]);
  expect(w.gh.calls.some(x=>/\/merge$|\/dispatches$/.test(x.path))).toBe(false);
 });
});
