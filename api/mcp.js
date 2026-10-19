import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { createGithubPolicy } from '../src/oauth/policy.js';
import { createDispatch } from '../src/tools/dispatch.js';
import { createGates } from '../src/tools/gates.js';
import { getSecretsRuntime } from '../src/runtime.js';
import { isPrivateTenantBearer, resolvePrivateTenantMcpBearer } from '../src/tenancy/mcp-route.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
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
    const policy = createGithubPolicy();
    return await createMcpHandler({
      db, registry, toConnection: policy.toConnection, dispatch: createDispatch({ credentials, gates: createGates({ db }) }), serverInfo: { name: 'robinson-github-mcp', version: '0.1.0' }
    })(req, res);
  } catch {
    if (!res.headersSent) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
    }
  }
}
