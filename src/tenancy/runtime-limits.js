// PUB-3 PRIVATE capacity budget for independently authenticated tenant schemas.
// Owner legacy connections are intentionally outside this runtime. The limits
// defend shared infrastructure, not which GitHub capabilities a customer can
// authorize or the developer's separate zero-spend restrictions.
import { createHash } from 'node:crypto';

export const TENANT_RUNTIME_LIMITS = Object.freeze({
  mcpClientPerMinute: 120,
  mcpTenantPerMinute: 600,
  oauthClientPerMinute: 30,
  oauthTenantPerMinute: 150,
  jobsClientPerDay: 32,
  jobsTenantPerDay: 200,
  resultMaxBytes: 256 * 1024,
  resultsClientBytesPerDay: 8 * 1024 * 1024,
  resultsTenantBytesPerDay: 40 * 1024 * 1024,
  jobMaxTtlMinutes: 1440,
  resultMaxTtlSeconds: 86400
});

const allowedKinds = new Set(['mcp', 'oauth', 'job', 'result']);
const allowedEvents = new Set(['mcp', 'oauth', 'job', 'result', 'provider', 'refresh']);
const allowedOutcomes = new Set(['ok', 'refused', 'throttled', 'error']);
const bound = (number, low, high) => Number.isSafeInteger(number) && number >= low && number <= high;
const bucketFor = ms => ms < 100 ? 'lt100ms' : ms < 500 ? 'lt500ms' : ms < 2000 ? 'lt2s' : 'gte2s';
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

export class TenantCapacityError extends Error {
  constructor(operation, waitSeconds) {
    super('The private tenant is temporarily busy. Retry after the indicated interval.');
    this.name = 'TenantCapacityError';
    this.operation = operation;
    this.retryAfterSeconds = waitSeconds;
  }
}

/** Execute only on a TENANT-BOUND connection after exact search_path has been
 * independently verified. Non-public provisioning/migration owns DDL; no MCP
 * request is permitted to create or silently migrate tables at runtime. */
export async function initTenantRuntimeSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS gh_tenant_budget_windows (
    scope TEXT NOT NULL CHECK (length(scope) BETWEEN 2 AND 80),
    window_start TIMESTAMPTZ NOT NULL,
    used BIGINT NOT NULL CHECK (used >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (scope, window_start)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS gh_tenant_budget_expiry
    ON gh_tenant_budget_windows (expires_at)`;
  await sql`CREATE TABLE IF NOT EXISTS gh_tenant_runtime_metrics (
    hour TIMESTAMPTZ NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('mcp','oauth','job','result','provider','refresh')),
    outcome TEXT NOT NULL CHECK (outcome IN ('ok','refused','throttled','error')),
    latency_bucket TEXT NOT NULL CHECK (latency_bucket IN ('lt100ms','lt500ms','lt2s','gte2s')),
    count BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY(hour,event,outcome,latency_bucket)
  )`;
}

export async function claimTenantBudget(sql, { operation, clientId, amount = 1,
  tenantMax, clientMax, window = 'minute' }) {
  if (!allowedKinds.has(operation) || typeof clientId !== 'string' ||
      !clientId || clientId.length > 256 || !bound(amount, 1, 50 * 1024 * 1024) ||
      !bound(tenantMax, 1, 1000000000) || !bound(clientMax, 1, tenantMax) ||
      !['minute','day'].includes(window)) throw new TypeError('Invalid tenant capacity request.');
  const length = window === 'minute' ? 60 : 86400;
  const clientScope = operation + ':client:' + digest(clientId);
  const tenantScope = operation + ':tenant';
  // PostgreSQL row-level UPSERT serialization prevents concurrent instances
  // from both accepting a request at the final slot. Two limit claims are
  // intentionally conservative: tenant capacity can be reserved when the
  // client claim fails, but neither limit can be exceeded or borrowed.
  const at = window === 'minute' ? 'minute' : 'day';
  const tenant = await sql`INSERT INTO gh_tenant_budget_windows
      (scope,window_start,used,expires_at)
    SELECT ${tenantScope},date_trunc(${at},now()),${amount},
      date_trunc(${at},now())+make_interval(secs => ${length})
    WHERE ${amount}<=${tenantMax}
    ON CONFLICT (scope,window_start) DO UPDATE
      SET used=gh_tenant_budget_windows.used+EXCLUDED.used
      WHERE gh_tenant_budget_windows.used+EXCLUDED.used<=${tenantMax}
    RETURNING used`;
  if (tenant.length !== 1) throw new TenantCapacityError(operation,length);
  const client = await sql`INSERT INTO gh_tenant_budget_windows
      (scope,window_start,used,expires_at)
    SELECT ${clientScope},date_trunc(${at},now()),${amount},
      date_trunc(${at},now())+make_interval(secs => ${length})
    WHERE ${amount}<=${clientMax}
    ON CONFLICT (scope,window_start) DO UPDATE
      SET used=gh_tenant_budget_windows.used+EXCLUDED.used
      WHERE gh_tenant_budget_windows.used+EXCLUDED.used<=${clientMax}
    RETURNING used`;
  if (client.length !== 1) throw new TenantCapacityError(operation,length);
  return { allowed: true, clientUsed: Number(client[0].used), tenantUsed: Number(tenant[0].used) };
}

export async function admitTenantMcp(sql, clientId) {
  return claimTenantBudget(sql, { operation: 'mcp', clientId,
    clientMax: TENANT_RUNTIME_LIMITS.mcpClientPerMinute,
    tenantMax: TENANT_RUNTIME_LIMITS.mcpTenantPerMinute });
}
export async function admitTenantOAuth(sql, clientId) {
  return claimTenantBudget(sql, { operation: 'oauth', clientId,
    clientMax: TENANT_RUNTIME_LIMITS.oauthClientPerMinute,
    tenantMax: TENANT_RUNTIME_LIMITS.oauthTenantPerMinute });
}

/** Measurements are aggregate, per-tenant SQL namespace, and contain only
 * fixed event/outcome/latency classes: no tokens, repository text, URL, user
 * identity, client IDs or untrusted exception messages. Never block cleanup
 * or leak credentials if telemetry storage is temporarily unavailable. */
export async function recordTenantMetric(sql, { event, outcome, durationMs }) {
  if (!allowedEvents.has(event) || !allowedOutcomes.has(outcome) ||
      !Number.isFinite(durationMs) || durationMs < 0)
    throw new TypeError('Tenant metric must use fixed nonsecret fields.');
  const latency = bucketFor(durationMs);
  await sql`INSERT INTO gh_tenant_runtime_metrics (hour,event,outcome,latency_bucket,count)
    VALUES (date_trunc('hour',now()),${event},${outcome},${latency},1)
    ON CONFLICT (hour,event,outcome,latency_bucket) DO UPDATE
      SET count=gh_tenant_runtime_metrics.count+1`;
}

export async function purgeExpiredTenantRuntime(sql) {
  const buckets = await sql`DELETE FROM gh_tenant_budget_windows WHERE ctid IN (
    SELECT ctid FROM gh_tenant_budget_windows WHERE expires_at < now()
      ORDER BY expires_at LIMIT 200) RETURNING scope`;
  const metrics = await sql`DELETE FROM gh_tenant_runtime_metrics WHERE ctid IN (
    SELECT ctid FROM gh_tenant_runtime_metrics
      WHERE hour < date_trunc('hour',now())-interval '24 hours'
      ORDER BY hour LIMIT 200) RETURNING event`;
  return { budgetRows: buckets.length, metricRows: metrics.length };
}

/** Facade scopes existing job/result store capacity to THIS tenant. Original
 * owner db and original GitHub write/approval gates are preserved verbatim. */
export function withTenantStorageLimits(db, sql, clientId) {
  if (!db || typeof db.createJob !== 'function' || typeof db.putResult !== 'function')
    throw new TypeError('Tenant capacity needs an existing isolated result/job store.');
  return {
    ...db,
    async createJob(input) {
      if (!bound(input?.ttlMinutes ?? 1440,1,TENANT_RUNTIME_LIMITS.jobMaxTtlMinutes))
        throw new TenantCapacityError('job',86400);
      await claimTenantBudget(sql,{operation:'job',clientId,window:'day',
        clientMax:TENANT_RUNTIME_LIMITS.jobsClientPerDay,
        tenantMax:TENANT_RUNTIME_LIMITS.jobsTenantPerDay});
      return db.createJob(input);
    },
    async putResult(input) {
      if (!bound(input?.ttlSeconds ?? 86400,1,TENANT_RUNTIME_LIMITS.resultMaxTtlSeconds))
        throw new TenantCapacityError('result',86400);
      let encoded;
      try { encoded=JSON.stringify(input?.body); } catch { throw new TypeError('Result is not valid JSON.'); }
      const bytes=typeof encoded==='string'?Buffer.byteLength(encoded):0;
      if (!bound(bytes,1,TENANT_RUNTIME_LIMITS.resultMaxBytes))
        throw new TenantCapacityError('result',86400);
      await claimTenantBudget(sql,{operation:'result',clientId,amount:bytes,window:'day',
        clientMax:TENANT_RUNTIME_LIMITS.resultsClientBytesPerDay,
        tenantMax:TENANT_RUNTIME_LIMITS.resultsTenantBytesPerDay});
      return db.putResult(input);
    }
  };
}
