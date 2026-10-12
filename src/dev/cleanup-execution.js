// V-2 cross-request serialization. A crash/uncertain provider outcome keeps
// the durable claim: expiry is not evidence that the old worker stopped.
import {randomUUID} from 'node:crypto';
import {refusal} from '../tools/github-write.js';
import {classifyGithubError} from '../tools/define-github-write.js';

export async function withCleanupExecution(ctx,{owner,runId},action) {
  const scope={runId,account:owner,connection:ctx.connection.client_id,executorId:randomUUID()};
  if(!(await ctx.db.claimDevCleanupExecution(scope)))
    throw refusal('This run has an active or unresolved cleanup execution. Inspect its scoped journal and independent remote state; no concurrent cleanup is allowed.');
  let release=true,result,failure;
  try {
    result=await action();
  } catch(error) {
    release=classifyGithubError(error)==='rejected';
    failure=error;
  }
  if(release&&!(await ctx.db.releaseDevCleanupExecution(scope)))
    throw refusal('Cleanup execution ownership could not be released. Reconcile the exact run before retrying.');
  if(failure)throw failure;
  return result;
}
