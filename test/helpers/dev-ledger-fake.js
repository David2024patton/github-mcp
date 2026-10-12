// Fake V-1 ledger behind the same contract as PostgreSQL. No global run visibility.
import { validateRun, validateRunObject, boundedRunLimit } from '../../src/dev/ledger.js';
export function createFakeDevLedger({ clock = Date.now } = {}) {
  const runs = new Map(), objects = new Map(), intents = new Map();
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
    async listDevRuns({ account, connection, limit=20 }) {
      validateRun({ id:'run-list',account,connection }); boundedRunLimit(limit);
      return [...runs.values()].filter(x=>x.account===account&&x.connection===connection)
        .sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id)).slice(0,limit).map(x=>structuredClone(x));
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
      intents.set(key,{step_id:stepId,object_type:type,owner,repo,object_name:objectName,
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
      if(!objects.has(key))objects.set(key,{run_id:runId,object_type:row.object_type,owner:row.owner,repo:row.repo,
        object_id:objectId,created_sha:createdSha,created_at:new Date(clock()),cleaned:false});
      row.status='recorded';row.object_id=objectId;row.created_sha=createdSha;row.updated_at=new Date(clock());
      return true;
    },
    async listDevIntents({runId,account,connection,limit=50}) {
      validateRun({id:runId,account,connection});boundedRunLimit(limit);
      if(!scoped({id:runId,account,connection}))return [];
      return [...intents].filter(([key])=>JSON.parse(key)[0]===runId)
        .map(([,row])=>structuredClone(row))
        .sort((a,b)=>a.created_at-b.created_at||a.step_id.localeCompare(b.step_id)).slice(0,limit);
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
