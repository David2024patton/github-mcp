// Durable V-1 stacked draft PR fixtures. Caller must enforce verified scratch+preview gate.
import {createOwnedFixtureBranch,commitOwnedFixtureFile} from './fixtures.js';
import {createOwnedDraftPr,createOwnedRunLabel,labelOwnedDraftPr} from './pull-fixtures.js';
import {refusal} from '../tools/github-write.js';
import {matchesRunDescription} from './run-marker.js';

const SHA=/^[a-f0-9]{40}$/;
export const stackBranch=(id,i)=>`rtc/${id}/stack-${i}`;
export const stackPath=(id,i)=>`rtc/${id}/stack-${i}.md`;
export const stackContent=(id,i)=>`RTC draft stack ${i} for rtc_run=${id}\n`;
export async function seedStack(ctx,{github,run}) {
  const p={owner:run.owner,repo:run.repo},id=run.runId;
  const repository=(await github.request('GET /repos/{owner}/{repo}',p)).data;
  const base=repository?.default_branch;
  if(repository?.private!==true||!matchesRunDescription(repository?.description,id)||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(base??'')||base.includes('..'))
    throw refusal('A private, run-owned scratch repository with a safe default branch is required.');
  const ref=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
    ...p,ref:`heads/${base}`})).data;
  if(ref?.ref!==`refs/heads/${base}`||!SHA.test(ref?.object?.sha??''))
    throw refusal('GitHub did not confirm the initial scratch commit.');
  const objects=[await createOwnedRunLabel(ctx,{github,run})];
  let headSha=ref.object.sha,prior=null;
  for(let i=1;i<=3;i++){
    const branch=stackBranch(id,i),path=stackPath(id,i);
    const b=await createOwnedFixtureBranch(ctx,{github,run,stepId:`seed-stack-branch-${i}`,
      name:branch,sha:headSha});
    const f=await commitOwnedFixtureFile(ctx,{github,run,stepId:`seed-stack-file-${i}`,
      path,branch,content:stackContent(id,i)});
    const pr=await createOwnedDraftPr(ctx,{github,run,stepId:`seed-stack-pr-${i}`,
      head:branch,base:prior??base,defaultBranch:base,expectedHeadSha:f.createdSha,
      title:`RTC ${id} draft ${i}`});
    const label=await labelOwnedDraftPr(ctx,{github,run,stepId:`seed-stack-label-${i}`,
      prNumber:Number(pr.objectId)});
    objects.push(b,f,pr,label);
    headSha=f.createdSha;prior=branch;
  }
  return objects;
}
export async function readStack({github,id,owner,repo,response}) {
  const p={owner,repo},o=response?.data?.objects;
  if(o?.length!==14)throw refusal('Incomplete recorded draft stack.');
  const [repository,label,entries]=await Promise.all([
    github.request('GET /repos/{owner}/{repo}',p).then(x=>x.data),
    github.request('GET /repos/{owner}/{repo}/labels/{name}',{
      ...p,name:'rtc-run'}).then(x=>x.data),
    Promise.all([1,2,3].map(async i=>{
      const number=Number(o[4+4*(i-1)].objectId),branch=stackBranch(id,i);
      const [pr,labels,ref,file]=await Promise.all([
        github.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{
          ...p,pull_number:number}).then(x=>x.data),
        github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels',{
          ...p,issue_number:number}).then(x=>x.data),
        github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
          ...p,ref:`heads/${branch}`}).then(x=>x.data),
        github.request('GET /repos/{owner}/{repo}/contents/{path}',{
          ...p,path:stackPath(id,i),ref:branch}).then(x=>x.data)
      ]);
      return {pr,labels,ref,file};
    }))
  ]);
  return {repository,label,entries};
}
export function verifyStack({id,after,response}) {
  const o=response?.data?.objects;
  if(o?.length!==14||after?.label?.name!=='rtc-run'||
    after.label.description!==mark(id)||!after.repository?.default_branch||
    after.entries?.length!==3||o[1]?.objectId!=='rtc-run')return false;
  for(let i=1;i<=3;i++){
    const ix=2+(i-1)*4,branch=stackBranch(id,i),path=stackPath(id,i);
    const f=o[ix+1],pr=o[ix+2],relation=o[ix+3],row=after.entries[i-1];
    if(o[ix]?.objectId!==branch||f?.objectId!==path||!SHA.test(f?.createdSha??'')||
      !Number.isSafeInteger(Number(pr?.objectId))||Number(pr.objectId)<=0||
      relation?.objectId!==`${pr.objectId}:rtc-run`||
      row?.pr?.number!==Number(pr.objectId)||row.pr.state!=='open'||row.pr.draft!==true||
      row.pr.head?.ref!==branch||row.pr.head?.sha!==f.createdSha||
      row.pr.base?.ref!==(i===1?after.repository.default_branch:stackBranch(id,i-1))||
      !String(row.pr.body??'').includes(`<!-- rtc_run=${id} -->`)||
      !row.labels?.some(x=>x.name==='rtc-run')||
      row.ref?.ref!==`refs/heads/${branch}`||row.ref.object?.sha!==f.createdSha||
      row.file?.path!==path||typeof row.file.content!=='string')return false;
    if(Buffer.from(row.file.content.replace(/\s/g,''),'base64').toString('utf8')!==stackContent(id,i))
      return false;
  }
  return true;
}
