// V-1: account- and connection-scoped run ledger; all SQL statements are static.
export const RUN_ID = /^[a-z][a-z0-9-]{2,42}$/;
const TYPES = new Set(['repo','branch','pr','issue','label','webhook','check_run','tag','release','workflow_file','fixture_file','forwarder','ruleset','review_thread','pr_label']);
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
export function boundedRunLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TypeError('Limit must be 1–50.');
  return limit;
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
    async listDevRuns({ account, connection, limit = 20 }) {
      validateRun({ id: 'run-list', account, connection }); boundedRunLimit(limit);
      return await sql`SELECT id, account, connection, description, scenarios, status, created_at, cleaned_at
        FROM dev_runs WHERE account = ${account} AND connection = ${connection}
        ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
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
      const rows = await sql`SELECT i.step_id, i.object_type, i.owner, i.repo, i.object_name,
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
      const rows = await sql`WITH claimed AS (
          UPDATE dev_run_intents i SET status = 'recorded', object_id = ${objectId},
            created_sha = ${createdSha}, updated_at = now()
          FROM dev_runs r WHERE r.id = i.run_id AND r.id = ${runId}
            AND r.account = ${account} AND r.connection = ${connection}
            AND r.status = 'active' AND i.step_id = ${stepId}
            AND i.status IN ('claimed', 'uncertain')
          RETURNING i.run_id, i.object_type, i.owner, i.repo, i.object_id, i.created_sha
        ), recorded AS (
          INSERT INTO dev_run_objects (run_id, object_type, owner, repo, object_id, created_sha)
          SELECT run_id, object_type, owner, repo, object_id, created_sha FROM claimed
          ON CONFLICT (run_id, object_type, owner, object_id) DO NOTHING RETURNING object_id
        )
        SELECT object_id FROM claimed`;
      return rows.length === 1;
    },
    async listDevIntents({ runId, account, connection, limit = 50 }) {
      validateRun({ id: runId, account, connection }); boundedRunLimit(limit);
      return await sql`SELECT i.step_id, i.object_type, i.owner, i.repo, i.object_name,
          i.status, i.object_id, i.created_sha, i.created_at, i.updated_at
        FROM dev_run_intents i JOIN dev_runs r ON r.id = i.run_id
        WHERE r.id = ${runId} AND r.account = ${account} AND r.connection = ${connection}
        ORDER BY i.created_at, i.step_id LIMIT ${limit}`;
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
