// Copilot cloud-agent selected repository membership: three-door provider write contract.
import {runWriteContract} from '../../test/helpers/write-contract.js';
import * as copilot from '../../src/tools/y9-copilot-repos.js';

const def={tool:copilot.tools.find(x=>x.name==='github_copilot_agent_repo_set'),
  handler:copilot.handlers.github_copilot_agent_repo_set};
function arrange(gh,outcome){
  gh.when('GET /orgs/{org}/copilot/coding-agent/permissions')
    .reply(200,{enabled_repositories:'selected'});
  gh.when('GET /repos/{owner}/{repo}')
    .reply(200,{id:101,full_name:'example-org/scratch',owner:{login:'example-org'}});
  gh.when('GET /orgs/{org}/copilot/coding-agent/permissions/repositories')
    .replySequence([
      {status:200,body:{total_count:0,repositories:[]}},
      {status:200,body:{total_count:outcome==='ok'?1:0,
        repositories:outcome==='ok'?
          [{id:101,full_name:'example-org/scratch',owner:{login:'example-org'}}]:[]}}
    ]);
  gh.when('PUT /orgs/{org}/copilot/coding-agent/permissions/repositories/{repository_id}')
    .reply(204,null);
}
runWriteContract({label:'Y-9d github_copilot_agent_repo_set',definition:def,
  args:{repo:'scratch',enable:true},arrange,needsConfirm:true,
  production:true,accessWidening:true,profile:'full',expectedWrites:1});
