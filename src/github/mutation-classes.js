import {visit,Kind,valueFromASTUntyped} from 'graphql';
// U-2: policy belongs outside the schema parser. A valid mutation is not proof
// that it is permitted, belongs to the account, is free, or is reversible.
const curated=new Map(Object.entries({
  mergePullRequest:'github_pr_merge',
  createPullRequest:'github_pr_create',
  updatePullRequest:'github_pr_update',
  closePullRequest:'github_pr_close',
  reopenPullRequest:'github_pr_update',
  createIssue:'github_issue_create',
  updateIssue:'github_issue_update',
  addStar:'github_repo_star',
  removeStar:'github_repo_star',
  createDiscussion:'github_discussion_create',
  addDiscussionComment:'github_discussion_comment',
  createCommitOnBranch:'github_content_push_files',
  updateRepository:'github_repo_update_settings',
  changeUserStatus:'github_account_update_profile',
  updateBranchProtectionRule:'github_protection_set',
  createBranchProtectionRule:'github_protection_set',
  deleteBranchProtectionRule:'github_protection_remove',
  createRepositoryRuleset:'github_ruleset_save',
  updateRepositoryRuleset:'github_ruleset_save',
  deleteRepositoryRuleset:'github_ruleset_delete'
}));
export const curatedGraphqlMutation=name=>curated.get(name)??null;
const money=/codespace|copilot|enterprise|billing|budget|sponsor|purchase|paid|marketplace|license|runner|securityFeature|storage|minutes|payment/i;
const secretKey=/(?:token|secret|password|passphrase|private.?key|auth.?code|invitation.?code|webhook.?signature|credential)/i;
const secretValue=/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{18,}|rtc_pass_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const dangerousKey=/(bypass.?rules|bypassRules|force.?push|skip.?checks)/i;
function scan(value,key='',depth=0){
  if(depth>16)throw new TypeError('GraphQL variables nested too deeply.');
  if(dangerousKey.test(key)&&Boolean(value))
    throw new TypeError('GraphQL rule bypass, skipped checks or forced updates cannot use the universal route.');
  if(secretKey.test(key)&&value!==null&&value!==undefined)
    throw new TypeError('Secrets and credential arguments require their curated sealed/credential tool.');
  if(typeof value==='string'){
    if(secretValue.test(value))throw new TypeError('Credential or private key material is forbidden in GraphQL.');
    if(value.length>12000)throw new TypeError('GraphQL argument value exceeds safe length.');
  }else if(Array.isArray(value)){
    if(value.length>250)throw new TypeError('GraphQL argument list exceeds safe size.');
    value.forEach(x=>scan(x,key,depth+1));
  }else if(value&&typeof value==='object'){
    if(Object.keys(value).length>100)throw new TypeError('GraphQL input object has too many keys.');
    for(const [k,v]of Object.entries(value))scan(v,k,depth+1);
  }
}
/** Scan both coerced variable values and document literal/default values.
 * A valid schema argument is not authorization to put credentials in an MCP tool. */
export function assertSafeGraphqlArguments(entry){
  scan(entry.variables);
  visit(entry.ast,{
    Argument(node){scan(valueFromASTUntyped(node.value,entry.variables),node.name.value);},
    VariableDefinition(node){if(node.defaultValue)scan(valueFromASTUntyped(node.defaultValue,entry.variables),node.variable.name.value);},
    Field(node){
      // Credentials supplied as aliased output fields are still handled by the
      // dispatcher's redaction; provider text is never treated as instructions.
      if(node.kind!==Kind.FIELD)throw new TypeError('Unknown GraphQL AST field.');
    }
  });
}
export function classifyGraphqlMutation(name,input){
  if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_]{1,100}$/.test(name))
    throw new TypeError('Unknown or unsupported GraphQL mutation field.');
  scan(input);
  const curatedTool=curatedGraphqlMutation(name);
  if(curatedTool)throw new TypeError('The specialist '+curatedTool+' tool must handle '+name+'; the generic GraphQL route cannot bypass its guards.');
  if(money.test(name))throw new TypeError('Potentially priced mutation '+name+' has no reviewed price estimate. Use the cost-aware specialized tool.');
  // There is no safe "ordinary" mutation class until an owner-reviewed policy
  // explicitly names its resource and consequences. Default both high-risk marks.
  return Object.freeze({name,production:true,accessWidening:true,notifies:true,spendRisk:false});
}
/** Derive all existing resource IDs, not just a six-name allowlist.
 * Every ID must independently resolve into the enrolled account before dispatch.
 * Unknown node families fail closed until a typed ownership proof is added. */
export function relevantGraphqlNodeId(input){
  const source=input?.input;
  if(!source||typeof source!=='object'||Array.isArray(source))
    throw new TypeError('Universal GraphQL mutation needs one typed input object.');
  const ids=[];
  const collect=(obj,depth=0)=>{
    if(depth>12)throw new TypeError('GraphQL resource IDs are nested too deeply.');
    for(const [name,value] of Object.entries(obj)){
      if(name==='clientMutationId')continue;
      if(/(?:Id|ID)$/.test(name)||name==='id'){
        if(typeof value!=='string'||!value)throw new TypeError('GraphQL resource '+name+' must be a nonempty existing node ID.');
        ids.push({name,value});
      }else if(value&&typeof value==='object'&&!Array.isArray(value))collect(value,depth+1);
    }
  };
  collect(source);
  if(ids.length<1||ids.length>12||new Set(ids.map(x=>x.value)).size!==ids.length)
    throw new TypeError('Universal GraphQL mutation requires one to twelve distinct, independently verifiable resource IDs.');
  const primary=ids.find(x=>x.name==='projectId')??ids.find(x=>/discussionId|issueId|pullRequestId|repositoryId|subjectId/.test(x.name))??ids[0];
  return {...primary,ids,changes:Object.fromEntries(Object.entries(source).filter(([k])=>k!=='clientMutationId'&&!ids.some(x=>x.name===k)))};
}
