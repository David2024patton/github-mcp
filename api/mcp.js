import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { createGithubPolicy } from '../src/oauth/policy.js';
import { createDispatch } from '../src/tools/dispatch.js';
import { createGates } from '../src/tools/gates.js';
import { getSecretsRuntime } from '../src/runtime.js';
import { isPrivateTenantBearer, resolvePrivateTenantMcpBearer } from '../src/tenancy/mcp-route.js';
import { admitTenantMcp, TenantCapacityError, recordTenantMetric } from '../src/tenancy/runtime-limits.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  const began = Date.now();
  let tenantSql = null;
  let eventOutcome = 'error';
  try {
    // Tenant-marked access tokens are NEVER retried against the owner database.
    // When the closed pilot is disabled or its grant is revoked, return 401.
    const tenantRoute = isPrivateTenantBearer(req.headers?.authorization);
    const context = tenantRoute
      ? await resolvePrivateTenantMcpBearer({ authorization: req.headers.authorization })
      : await getSecretsRuntime();
    if (!context) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({ error: 'invalid_token' });
    }
    const { db, credentials } = context;
    if (tenantRoute) {
      tenantSql = context.sql;
      // All active tenant clients share one DB-backed budget; each connection
      // has a smaller independent burst limit. Original owner unchanged.
      await admitTenantMcp(tenantSql, context.clientId);
    }
    const policy = createGithubPolicy();
    const answer = await createMcpHandler({
      ...(tenantRoute?{toolSecuritySchemes:tool=>[{type:'oauth2',
        scopes:tool.name==='github_notify_list'?['github.notifications.read']:[]}]}:{}),
      db, registry, toConnection: policy.toConnection, dispatch: createDispatch({ credentials, gates: createGates({ db }) }), serverInfo: { name: 'robinson-github-mcp', version: '0.1.0' }
    })(req, res);
    eventOutcome = 'ok';
    return answer;
  } catch (error) {
    if (!res.headersSent && error instanceof TenantCapacityError) {
      eventOutcome = 'throttled';
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(429).json({ error:'rate_limited',
        error_description:'This private connection is temporarily busy. Retry later.',
        retry_after_seconds:error.retryAfterSeconds });
    }
    if (!res.headersSent) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
    }
  } finally {
    if (tenantSql) await recordTenantMetric(tenantSql,{
      event:'mcp',outcome:eventOutcome,durationMs:Math.max(0,Date.now()-began)
    }).catch(()=>{});
  }
}
