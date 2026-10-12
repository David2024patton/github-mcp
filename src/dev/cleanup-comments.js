// V-2: a run's metadata does not authorize deleting unrelated conversations.
// GitHub issue comments are never created by V-1; REST PR comments are
// journaled independently from GraphQL review thread IDs.
import { listAll } from '../github/client.js';
import { refusal } from '../tools/github-write.js';

export async function inspectScratchComments(github,{owner,repo,run,objects}) {
  const common={owner,repo,per_page:100};
  const [issues,reviews]=await Promise.all([
    listAll(github,'GET /repos/{owner}/{repo}/issues/comments',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/pulls/comments',common,{max:100})
  ]);
  if(issues.capped||reviews.capped||!Array.isArray(issues.items)||!Array.isArray(reviews.items))
    throw refusal('Scratch conversation inventory is incomplete. Deletion refused.');
  if(issues.items.length)
    throw refusal('Scratch repository has issue comments not created by the run. Deletion refused.');
  const saved=objects.filter(x=>x.object_type==='review_comment');
  const seen=new Set();
  for(const c of reviews.items) {
    const id=String(c?.id??'');
    const matches=saved.filter(x=>x.object_id===id&&
      x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
    const prPrefix=`https://api.github.com/repos/${owner}/${repo}/pulls/`;
    const source=typeof c?.pull_request_url==='string'&&
      c.pull_request_url.toLowerCase().startsWith(prPrefix.toLowerCase())
      ? c.pull_request_url.slice(prPrefix.length):'';
    if(!Number.isSafeInteger(c?.id)||c.id<=0||seen.has(id)||matches.length!==1||
      !/^[1-9][0-9]*$/.test(source)||!objects.some(o=>o.object_type==='pr'&&
        o.owner.toLowerCase()===owner.toLowerCase()&&o.repo===repo&&o.object_id===source)||
      !/^[a-f0-9]{40}$/.test(matches[0].created_sha??'')||
      c.commit_id!==matches[0].created_sha||
      c.path!==`rtc/${run.id}/review.md`||
      !/^rtc_run=[a-z][a-z0-9-]* review discussion [1-3]$/.test(c.body??'')||
      c.body!==`rtc_run=${run.id} review discussion ${c.body.slice(-1)}`)
      throw refusal('Scratch review comment is foreign, changed or lacks a recorded run PR. Deletion refused.');
    seen.add(id);
  }
  if(saved.length!==seen.size)
    throw refusal('A recorded scratch review comment is missing from the complete live inventory.');
  return {issue_comment_count:0,review_comment_count:seen.size};
}
