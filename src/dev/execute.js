// V-1 durable step runner. Never apply twice; an ambiguous GitHub outcome needs explicit reconciliation.
export async function runDevMutationOnce(ctx,{runId,account,connection,stepId,type,owner,repo,objectName,scenarios=[],create}){
  const db=ctx.db;
  let run=await db.getDevRun({id:runId,account,connection});
  if(!run){
    const made=await db.createDevRun({id:runId,account,connection,scenarios});
    if(!made)run=await db.getDevRun({id:runId,account,connection});
    else run=await db.getDevRun({id:runId,account,connection});
  }
  if(!run||run.status!=='active')throw new TypeError('This run cannot be claimed by your connection or is no longer active.');
  const entry={runId,account,connection,stepId,type,owner,repo,objectName};
  const claimed=await db.claimDevIntent(entry);
  if(!claimed){
    const old=await db.getDevIntent({runId,account,connection,stepId});
    if(old?.status==='recorded'&&old.owner===owner&&old.repo===repo&&
      old.object_type===type&&old.object_name===objectName&&old.object_id)
      return {objectId:old.object_id,createdSha:old.created_sha,replayed:true};
    throw new TypeError('This step is already claimed or uncertain. Inspect its run and reconcile the exact GitHub object; never re-send it blindly.');
  }
  try{
    const created=await create();
    if(!created?.objectId||typeof created.objectId!=='string')throw new TypeError('GitHub did not return the exact created object ID.');
    // Repository birth evidence is inserted atomically with the first recorded
    // repo intent. It is immutable observational evidence, not delete permission.
    const birth=Object.hasOwn(created,'birthLabels');
    const saved=birth
      ? await db.completeDevBirthIntent({runId,account,connection,stepId,
          objectId:created.objectId,createdSha:created.createdSha,labels:created.birthLabels})
      : await db.completeDevIntent({runId,account,connection,stepId,objectId:created.objectId,createdSha:created.createdSha??null});
    if(!saved)throw new TypeError('The created object could not be durably recorded; inspect the run before further changes.');
    const result={...created,replayed:false};
    delete result.birthLabels;
    return result;
  }catch(error){
    await db.markDevIntentUncertain({runId,account,connection,stepId}).catch(()=>{});
    throw error;
  }
}
