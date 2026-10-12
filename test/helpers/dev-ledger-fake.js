// Fake V-1 ledger behind the same contract as PostgreSQL. No global run visibility.
import { validateRun, validateRunObject, boundedRunLimit } from '../../src/dev/ledger.js';
export function createFakeDevLedger({ clock = Date.now } = {}) {
  const runs = new Map(), objects = new Map();
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
    async listDevObjects({ runId, account, connection, limit=50 }) {
      boundedRunLimit(limit);
      if (!scoped({ id:runId,account,connection })) return [];
      return [...objects.values()].filter(x=>x.run_id===runId)
        .sort((a,b)=>a.created_at-b.created_at||a.object_type.localeCompare(b.object_type)||a.object_id.localeCompare(b.object_id))
        .slice(0,limit).map(x=>structuredClone(x));
    }
  };
}
