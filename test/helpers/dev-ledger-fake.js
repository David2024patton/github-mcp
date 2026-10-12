// Fake V-1 ledger behind the same contract as PostgreSQL. No global run visibility.
import { validateRun, validateRunObject, boundedRunLimit, validateScratchBirthLabels, validateCleanupExecutor } from '../../src/dev/ledger.js';
export function createFakeDevLedger({ clock = Date.now } = {}) {
  const runs = new Map(), objects = new Map(), intents = new Map(), births = new Map(), executions = new Map();
  const scoped = ({ id, account, connection }) => {
    validateRun({ id, account, connection });
    const row = runs.get(id);
    return row?.account === account && row?.connection === connection ? row : null;
  };
  return {
    async createDevRun({ id, account, connection, description = '', scenarios = [] }) {
      validateRun({ id, account, connection });
      if (!Array.isArray(scenarios) || scenarios.some((x)=>typeof x !== 'string')) throw new TypeError('Invalid scenario names.');
      if (runs.has(id)) return false;
      runs.set(id, { id, account, connection, description: String(description).slice(0,500), scenarios:[...scenarios],
        status:'active', created_at:new Date(clock()), cleaned_at:null });
      return true;
    },
    async getDevRun(a) { const v=scoped(a); return v ? structuredClone(v) : null; },
    async countDevRuns({account,connection}) {
      validateRun({id:'run-list',account,connection});
      return [...runs.values()].filter(x=>x.account===account&&x.connection===connection).length;
    },
    async listDevRuns({ account, connection, limit=20, after=null }) {
      validateRun({ id:'run-list',account,connection }); boundedRunLimit(limit);
      if(after&&(!/^[a-z][a-z0-9-]{2,42}$/.test(after.id??'')||
        typeof after.createdAt!=='string'||!Number.isFinite(Date.parse(after.createdAt))))
        throw new TypeError('Invalid run page boundary.');
      return [...runs.values()].filter(x=>x.account===account&&x.connection===connection)
        .filter(x=>!after||+x.created_at<Date.parse(after.createdAt)||
          (+x.created_at===Date.parse(after.createdAt)&&x.id<after.id))
        .sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id))
        .slice(0,limit).map(x=>structuredClone(x));
    },
    async recordDevObject({ runId, account, connection, type, owner, repo=null, objectId, createdSha=null }) {
      validateRun({ id:runId,account,connection }); validateRunObject({ type,owner,repo,objectId,createdSha });
      const v=scoped({ id:runId,account,connection });
      if (!v || v.status !== 'active') return false;
      const key=JSON.stringify([runId,type,owner,objectId]);
      if (objects.has(key)) return false;
      objects.set(key,{run_id:runId,object_type:type,owner,repo,object_id:objectId,
        created_sha:createdSha,created_at:new Date(clock()),cleaned:false});
      return true;
    },
    async claimDevIntent({ runId, account, connection, stepId, type, owner, repo=null, objectName }) {
      validateRun({id:runId,account,connection});
      validateRunObject({type,owner,repo,objectId:objectName});
      if(!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))throw new TypeError('Invalid scenario step ID.');
      const run=scoped({id:runId,account,connection}),key=JSON.stringify([runId,stepId]);
      if(!run||run.status!=='active'||intents.has(key))return false;
      intents.set(key,{run_id:runId,step_id:stepId,object_type:type,owner,repo,object_name:objectName,
        status:'claimed',object_id:null,created_sha:null,created_at:new Date(clock()),updated_at:new Date(clock())});
      return true;
    },
    async getDevIntent({runId,account,connection,stepId}) {
      validateRun({id:runId,account,connection});
      if(!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))throw new TypeError('Invalid scenario step ID.');
      if(!scoped({id:runId,account,connection}))return null;
      const row=intents.get(JSON.stringify([runId,stepId]));
      return row?structuredClone(row):null;
    },
    async markDevIntentUncertain({runId,account,connection,stepId}) {
      validateRun({id:runId,account,connection});
      if(!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))throw new TypeError('Invalid scenario step ID.');
      const run=scoped({id:runId,account,connection});
      const row=intents.get(JSON.stringify([runId,stepId]));
      if(!run||run.status!=='active'||row?.status!=='claimed')return false;
      row.status='uncertain';row.updated_at=new Date(clock());return true;
    },
    async completeDevIntent({runId,account,connection,stepId,objectId,createdSha=null}) {
      validateRun({id:runId,account,connection});
      if(!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))throw new TypeError('Invalid scenario step ID.');
      if(typeof objectId!=='string'||!objectId.trim()||objectId.length>255||
          (createdSha!=null&&!/^[a-f0-9]{40}$/.test(createdSha)))throw new TypeError('Invalid created-object identity.');
      const run=scoped({id:runId,account,connection}),row=intents.get(JSON.stringify([runId,stepId]));
      if(!run||run.status!=='active'||!['claimed','uncertain'].includes(row?.status))return false;
      const key=JSON.stringify([runId,row.object_type,row.owner,objectId]);
      if(objects.has(key))return false;
      objects.set(key,{run_id:runId,object_type:row.object_type,owner:row.owner,repo:row.repo,
        object_id:objectId,created_sha:createdSha,created_at:new Date(clock()),cleaned:false});
      row.status='recorded';row.object_id=objectId;row.created_sha=createdSha;row.updated_at=new Date(clock());
      return true;
    },
    async completeDevBirthIntent({runId,account,connection,stepId,objectId,createdSha,labels}) {
      validateRun({id:runId,account,connection});
      const inventory=validateScratchBirthLabels(labels);
      const match=/^([^/]+)\/([^/]+)$/.exec(objectId??'');
      if(!['seed-repo','create-scratch-repo'].includes(stepId)||!match||
        match[1].toLowerCase()!==account.toLowerCase()||
        !/^[a-f0-9]{40}$/.test(createdSha??''))
        throw new TypeError('Exact scratch repository birth identity and SHA are required.');
      const [,owner,repo]=match,run=scoped({id:runId,account,connection});
      const row=intents.get(JSON.stringify([runId,stepId]));
      const key=JSON.stringify([runId,'repo',row?.owner,objectId]);
      if(!run||run.status!=='active'||row?.status!=='claimed'||
        row.object_type!=='repo'||row.owner.toLowerCase()!==owner.toLowerCase()||
        row.repo!==repo||row.object_name!==repo||objects.has(key)||births.has(runId))return false;
      objects.set(key,{run_id:runId,object_type:'repo',owner:row.owner,repo,
        object_id:objectId,created_sha:createdSha,created_at:new Date(clock()),cleaned:false});
      births.set(runId,{owner,repo,source_sha:createdSha,labels:structuredClone(inventory),captured_at:new Date(clock())});
      Object.assign(row,{status:'recorded',object_id:objectId,created_sha:createdSha,updated_at:new Date(clock())});
      return true;
    },
    async getDevBirthLabels({runId,account,connection}) {
      const run=scoped({id:runId,account,connection});
      return run&&births.has(runId)?structuredClone(births.get(runId)):null;
    },
    async listDevIntents({runId,account,connection,limit=50}) {
      validateRun({id:runId,account,connection});boundedRunLimit(limit);
      if(!scoped({id:runId,account,connection}))return [];
      return [...intents].filter(([key])=>JSON.parse(key)[0]===runId)
        .map(([,row])=>structuredClone(row))
        .sort((a,b)=>a.created_at-b.created_at||a.step_id.localeCompare(b.step_id)).slice(0,limit);
    },

    async claimDevCleanupExecution({runId,account,connection,executorId}) {
      validateCleanupExecutor(executorId);
      const run=scoped({id:runId,account,connection});
      if(!run||!['active','cleaning'].includes(run.status)||executions.has(runId))return false;
      executions.set(runId,{executor_id:executorId,acquired_at:new Date(clock())});return true;
    },
    async releaseDevCleanupExecution({runId,account,connection,executorId}) {
      validateCleanupExecutor(executorId);
      if(!scoped({id:runId,account,connection})||executions.get(runId)?.executor_id!==executorId)return false;
      executions.delete(runId);return true;
    },
    async getDevCleanupExecution({runId,account,connection}) {
      if(!scoped({id:runId,account,connection})||!executions.has(runId))return null;
      return {acquired_at:new Date(executions.get(runId).acquired_at)};
    },
    async beginDevCleanup({runId,account,connection}) {
      const run=scoped({id:runId,account,connection});
      if(!run||!['active','cleaning'].includes(run.status)||
        [...intents].some(([k,i])=>JSON.parse(k)[0]===runId&&i.status!=='recorded'))return false;
      run.status='cleaning';return true;
    },
    async markDevObjectCleaned({runId,account,connection,type,owner,objectId}) {
      validateRun({id:runId,account,connection});validateRunObject({type,owner,objectId});
      const run=scoped({id:runId,account,connection});
      const object=objects.get(JSON.stringify([runId,type,owner,objectId]));
      if(run?.status!=='cleaning'||!object||object.cleaned)return false;
      object.cleaned=true;return true;
    },
    async completeDevCleanup({runId,account,connection}) {
      const run=scoped({id:runId,account,connection});
      if(run?.status!=='cleaning'||[...objects.values()].some(o=>o.run_id===runId&&!o.cleaned)||
        [...intents].some(([k,i])=>JSON.parse(k)[0]===runId&&i.status!=='recorded'))return false;
      run.status='cleaned';run.cleaned_at=new Date(clock());return true;
    },
    async listDevObjects({ runId, account, connection, limit=50 }) {
      boundedRunLimit(limit);
      if (!scoped({ id:runId,account,connection })) return [];
      return [...objects.values()].filter(x=>x.run_id===runId)
        .sort((a,b)=>a.created_at-b.created_at||a.object_type.localeCompare(b.object_type)||a.object_id.localeCompare(b.object_id))
        .slice(0,limit).map(x=>structuredClone(x));
    }
  };
}
