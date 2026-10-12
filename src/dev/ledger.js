// V-1: account- and connection-scoped run ledger; all SQL statements are static.
export const RUN_ID = /^[a-z][a-z0-9-]{2,42}$/;
const TYPES = new Set(['repo','branch','pr','issue','label','webhook','check_run','tag','release','workflow_file','fixture_file','forwarder','ruleset','review_thread','review_comment','fixture_revision','pr_label']);
export function validateRun({ id, account, connection }) {
  if (!RUN_ID.test(id ?? '')) throw new TypeError('Run ID must contain 3–43 lowercase letters, digits or hyphens and start with a letter.');
  if (typeof account !== 'string' || !account.trim()) throw new TypeError('Account is required.');
  if (typeof connection !== 'string' || !connection.trim()) throw new TypeError('Connection is required.');
}
export function validateRunObject({ type, owner, repo, objectId, createdSha }) {
  if (!TYPES.has(type) || typeof owner !== 'string' || !owner.trim() ||
      typeof objectId !== 'string' || !objectId.trim() || objectId.length > 255 ||
      (repo != null && (typeof repo !== 'string' || !repo.trim() || repo.length > 100)) ||
      (createdSha != null && !/^[a-f0-9]{40}$/.test(createdSha))) throw new TypeError('Invalid dev run object.');
}
// A complete first-create label inventory must preserve exact immutable GitHub
// IDs and metadata. It is evidence for later review, NEVER a deletion grant.
export function validateScratchBirthLabels(labels) {
  if(!Array.isArray(labels)||labels.length>100)
    throw new TypeError('Scratch birth label inventory must be a bounded complete array.');
  const ids=new Set(),names=new Set();
  return labels.map(label=>{
    const {id,name,color,description=null}=label??{};
    if(!Number.isSafeInteger(id)||id<=0||typeof name!=='string'||
      !name.trim()||name.length>255||!/^[a-fA-F0-9]{6}$/.test(color??'')||
      (description!==null&&(typeof description!=='string'||description.length>1024))||
      ids.has(id)||names.has(name))
      throw new TypeError('Scratch birth labels have missing, duplicate or invalid exact identities.');
    ids.add(id);names.add(name);
    return {id,name,color:color.toLowerCase(),description};
  });
}
export function boundedRunLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('Limit must be 1–50.');
  return limit;
}
// Cursor is an opaque display handle, never an authorization or cleanup claim.
export function encodeDevRunCursor(row) {
  if(!RUN_ID.test(row?.id??''))throw new TypeError('Invalid run cursor identity.');
  const t=new Date(row.created_at).toISOString();
  return Buffer.from(JSON.stringify({t,id:row.id})).toString('base64url');
}
export function decodeDevRunCursor(cursor) {
  if(typeof cursor!=='string'||cursor.length>256||!/^[A-Za-z0-9_-]{12,256}$/.test(cursor))
    throw new TypeError('Invalid run cursor.');
  let value;
  try {
    if(Buffer.from(cursor,'base64url').toString('base64url')!==cursor)throw new Error('Noncanonical encoding');
    value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  }catch{throw new TypeError('Invalid run cursor.');}
  if(!value||!RUN_ID.test(value.id??'')||typeof value.t!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.t)||
    !Number.isFinite(Date.parse(value.t))||new Date(value.t).toISOString()!==value.t)
    throw new TypeError('Invalid run cursor.');
  return {createdAt:value.t,id:value.id};
}
export function createDevLedger(sql) {
  return {
    async createDevRun({ id, account, connection, description = '', scenarios = [] }) {
      validateRun({ id, account, connection });
      if (!Array.isArray(scenarios) || scenarios.some((x) => typeof x !== 'string')) throw new TypeError('Invalid scenario names.');
      const rows = await sql`INSERT INTO dev_runs (id, account, connection, description, scenarios)
        VALUES (${id}, ${account}, ${connection}, ${String(description).slice(0, 500)}, ${scenarios})
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      return rows.length === 1;
    },
    async getDevRun({ id, account, connection }) {
      validateRun({ id, account, connection });
      const rows = await sql`SELECT id, account, connection, description, scenarios, status, created_at, cleaned_at
        FROM dev_runs WHERE id = ${id} AND account = ${account} AND connection = ${connection}`;
      return rows[0] ?? null;
    },
    async countDevRuns({account,connection}) {
      validateRun({id:'run-list',account,connection});
      const rows=await sql`SELECT COUNT(*) AS n FROM dev_runs
        WHERE account = ${account} AND connection = ${connection}`;
      const n=Number(rows[0]?.n??0);
      if(!Number.isSafeInteger(n)||n<0)throw new TypeError('Run count exceeds the safe reporting range.');
      return n;
    },
    async listDevRuns({ account, connection, limit = 20, after = null }) {
      validateRun({ id: 'run-list', account, connection }); boundedRunLimit(limit);
      if(after&&(!RUN_ID.test(after.id??'')||typeof after.createdAt!=='string'||
        !Number.isFinite(Date.parse(after.createdAt))))
        throw new TypeError('Invalid run page boundary.');
      if(after)return await sql`SELECT id, account, connection, description, scenarios, status, created_at, cleaned_at
        FROM dev_runs WHERE account = ${account} AND connection = ${connection}
          AND (date_trunc('milliseconds',created_at),id) < (${after.createdAt}::timestamptz,${after.id})
        ORDER BY date_trunc('milliseconds',created_at) DESC, id DESC LIMIT ${limit}`;
      return await sql`SELECT id, account, connection, description, scenarios, status, created_at, cleaned_at
        FROM dev_runs WHERE account = ${account} AND connection = ${connection}
        ORDER BY date_trunc('milliseconds',created_at) DESC, id DESC LIMIT ${limit}`;
    },
    async recordDevObject({ runId, account, connection, type, owner, repo = null, objectId, createdSha = null }) {
      validateRun({ id: runId, account, connection });
      validateRunObject({ type, owner, repo, objectId, createdSha });
      const rows = await sql`INSERT INTO dev_run_objects (run_id, object_type, owner, repo, object_id, created_sha)
        SELECT id, ${type}, ${owner}, ${repo}, ${objectId}, ${createdSha}
        FROM dev_runs WHERE id = ${runId} AND account = ${account}
          AND connection = ${connection} AND status = 'active'
        ON CONFLICT (run_id, object_type, owner, object_id) DO NOTHING RETURNING object_id`;
      return rows.length === 1;
    },
    async claimDevIntent({ runId, account, connection, stepId, type, owner, repo = null, objectName }) {
      validateRun({ id: runId, account, connection });
      validateRunObject({ type, owner, repo, objectId: objectName });
      if (!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId ?? '')) throw new TypeError('Invalid scenario step ID.');
      const rows = await sql`INSERT INTO dev_run_intents (run_id, step_id, object_type, owner, repo, object_name)
        SELECT id, ${stepId}, ${type}, ${owner}, ${repo}, ${objectName}
        FROM dev_runs WHERE id = ${runId} AND account = ${account}
          AND connection = ${connection} AND status = 'active'
        ON CONFLICT (run_id, step_id) DO NOTHING RETURNING step_id`;
      return rows.length === 1;
    },
    async getDevIntent({ runId, account, connection, stepId }) {
      validateRun({ id: runId, account, connection });
      if (!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId ?? '')) throw new TypeError('Invalid scenario step ID.');
      const rows = await sql`SELECT i.run_id, i.step_id, i.object_type, i.owner, i.repo, i.object_name,
          i.status, i.object_id, i.created_sha, i.created_at, i.updated_at
        FROM dev_run_intents i JOIN dev_runs r ON r.id = i.run_id
        WHERE r.id = ${runId} AND r.account = ${account} AND r.connection = ${connection}
          AND i.step_id = ${stepId}`;
      return rows[0] ?? null;
    },
    async markDevIntentUncertain({ runId, account, connection, stepId }) {
      validateRun({ id: runId, account, connection });
      if (!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId ?? '')) throw new TypeError('Invalid scenario step ID.');
      const rows = await sql`UPDATE dev_run_intents i SET status = 'uncertain', updated_at = now()
        FROM dev_runs r WHERE r.id = i.run_id AND r.id = ${runId}
          AND r.account = ${account} AND r.connection = ${connection}
          AND r.status = 'active' AND i.step_id = ${stepId} AND i.status = 'claimed'
        RETURNING i.step_id`;
      return rows.length === 1;
    },
    async completeDevIntent({ runId, account, connection, stepId, objectId, createdSha = null }) {
      validateRun({ id: runId, account, connection });
      if (!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId ?? '')) throw new TypeError('Invalid scenario step ID.');
      if (typeof objectId !== 'string' || !objectId.trim() || objectId.length > 255 ||
          (createdSha != null && !/^[a-f0-9]{40}$/.test(createdSha))) throw new TypeError('Invalid created-object identity.');
      // One statement: the intent becomes recorded IFF the corresponding durable object
      // can be inserted. A failed write never leaves an untracked successful intent.
      // Acquire the intent row before inserting. Only the worker that actually inserts
      // the unique object may mark its step recorded; ON CONFLICT is not success.
      const rows = await sql`WITH candidate AS (
          SELECT i.run_id, i.object_type, i.owner, i.repo
          FROM dev_run_intents i JOIN dev_runs r ON r.id = i.run_id
          WHERE r.id = ${runId} AND r.account = ${account}
            AND r.connection = ${connection} AND r.status = 'active'
            AND i.step_id = ${stepId} AND i.status IN ('claimed', 'uncertain')
          FOR UPDATE OF i
        ), inserted AS (
          INSERT INTO dev_run_objects (run_id, object_type, owner, repo, object_id, created_sha)
          SELECT run_id, object_type, owner, repo, ${objectId}, ${createdSha} FROM candidate
          ON CONFLICT (run_id, object_type, owner, object_id) DO NOTHING
          RETURNING run_id, object_id
        ), recorded AS (
          UPDATE dev_run_intents i SET status = 'recorded', object_id = ${objectId},
            created_sha = ${createdSha}, updated_at = now()
          FROM inserted o WHERE i.run_id = o.run_id AND i.step_id = ${stepId}
          RETURNING i.object_id
        )
        SELECT object_id FROM recorded`;
      return rows.length === 1;
    },
    // The repo object, its claimed create step and the first observed label
    // inventory all become durable in ONE statement, or none do. Refuse
    // uncertain/legacy requests instead of manufacturing origin evidence later.
    async completeDevBirthIntent({runId,account,connection,stepId,objectId,createdSha,labels}) {
      validateRun({id:runId,account,connection});
      const inventory=validateScratchBirthLabels(labels);
      const match=/^([^/]+)\/([^/]+)$/.exec(objectId??'');
      if(!['seed-repo','create-scratch-repo'].includes(stepId)||!match||
        match[1].toLowerCase()!==account.toLowerCase()||
        !/^[a-f0-9]{40}$/.test(createdSha??''))
        throw new TypeError('Exact scratch repository birth identity and SHA are required.');
      const [owner,repo]=match;
      const rows=await sql`WITH candidate AS (
          SELECT i.run_id,i.object_type,i.owner,i.repo
          FROM dev_run_intents i JOIN dev_runs r ON r.id=i.run_id
          WHERE r.id=${runId} AND r.account=${account} AND r.connection=${connection}
            AND r.status='active' AND i.step_id=${stepId} AND i.status='claimed'
            AND i.object_type='repo' AND lower(i.owner)=lower(${owner}) AND i.repo=${repo}
          FOR UPDATE OF i
        ), inserted AS (
          INSERT INTO dev_run_objects (run_id,object_type,owner,repo,object_id,created_sha)
          SELECT run_id,object_type,owner,repo,${objectId},${createdSha} FROM candidate
          ON CONFLICT (run_id,object_type,owner,object_id) DO NOTHING
          RETURNING run_id
        ), birth AS (
          INSERT INTO dev_repo_birth_labels (run_id,owner,repo,source_sha,labels)
          SELECT run_id,${owner},${repo},${createdSha},${JSON.stringify(inventory)}::jsonb FROM inserted
          RETURNING run_id
        ), recorded AS (
          UPDATE dev_run_intents i SET status='recorded',object_id=${objectId},
            created_sha=${createdSha},updated_at=now()
          FROM birth b WHERE i.run_id=b.run_id AND i.step_id=${stepId}
          RETURNING i.object_id
        ) SELECT object_id FROM recorded`;
      return rows.length===1;
    },
    async getDevBirthLabels({runId,account,connection}) {
      validateRun({id:runId,account,connection});
      const rows=await sql`SELECT b.owner,b.repo,b.source_sha,b.labels,b.captured_at
        FROM dev_repo_birth_labels b JOIN dev_runs r ON r.id=b.run_id
        WHERE r.id=${runId} AND r.account=${account} AND r.connection=${connection}`;
      return rows[0]??null;
    },
    async listDevIntents({ runId, account, connection, limit = 50 }) {
      validateRun({ id: runId, account, connection }); boundedRunLimit(limit);
      return await sql`SELECT i.run_id, i.step_id, i.object_type, i.owner, i.repo, i.object_name,
          i.status, i.object_id, i.created_sha, i.created_at, i.updated_at
        FROM dev_run_intents i JOIN dev_runs r ON r.id = i.run_id
        WHERE r.id = ${runId} AND r.account = ${account} AND r.connection = ${connection}
        ORDER BY i.created_at, i.step_id LIMIT ${limit}`;
    },

    // Run freeze is atomic with the unresolved-intent test; it prevents seeds from racing teardown.
    async beginDevCleanup({runId,account,connection}) {
      validateRun({id:runId,account,connection});
      const rows=await sql`UPDATE dev_runs r SET status='cleaning' WHERE r.id=${runId}
        AND r.account=${account} AND r.connection=${connection} AND r.status IN ('active','cleaning')
        AND NOT EXISTS (SELECT 1 FROM dev_run_intents i WHERE i.run_id=r.id AND i.status<>'recorded')
        RETURNING r.id`;
      return rows.length===1;
    },
    async markDevObjectCleaned({runId,account,connection,type,owner,objectId}) {
      validateRun({id:runId,account,connection});validateRunObject({type,owner,objectId});
      const rows=await sql`UPDATE dev_run_objects o SET cleaned=TRUE FROM dev_runs r
        WHERE r.id=o.run_id AND r.id=${runId} AND r.account=${account}
        AND r.connection=${connection} AND r.status='cleaning'
        AND o.object_type=${type} AND o.owner=${owner} AND o.object_id=${objectId}
        AND o.cleaned=FALSE RETURNING o.object_id`;
      return rows.length===1;
    },
    async completeDevCleanup({runId,account,connection}) {
      validateRun({id:runId,account,connection});
      const rows=await sql`UPDATE dev_runs r SET status='cleaned', cleaned_at=now()
        WHERE r.id=${runId} AND r.account=${account} AND r.connection=${connection}
        AND r.status='cleaning'
        AND NOT EXISTS (SELECT 1 FROM dev_run_objects o WHERE o.run_id=r.id AND o.cleaned=FALSE)
        AND NOT EXISTS (SELECT 1 FROM dev_run_intents i WHERE i.run_id=r.id AND i.status<>'recorded')
        RETURNING r.id`;
      return rows.length===1;
    },
    async listDevObjects({ runId, account, connection, limit = 50 }) {
      validateRun({ id: runId, account, connection }); boundedRunLimit(limit);
      return await sql`SELECT o.run_id, o.object_type, o.owner, o.repo, o.object_id, o.created_sha,
          o.created_at, o.cleaned FROM dev_run_objects o
        JOIN dev_runs r ON r.id = o.run_id
        WHERE r.id = ${runId} AND r.account = ${account} AND r.connection = ${connection}
        ORDER BY o.created_at, o.object_type, o.object_id LIMIT ${limit}`;
    }
  };
}
