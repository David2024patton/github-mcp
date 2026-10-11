import { createMcpHandler } from '../src/core/mcp-server.js';
import { registry } from '../src/tools/index.js';
import { createGithubPolicy } from '../src/oauth/policy.js';
import { createReadOnlyDispatch } from '../src/tools/dispatch.js';
import { getDb } from '../src/runtime.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const policy = createGithubPolicy();
    return await createMcpHandler({
      db, registry, toConnection: policy.toConnection, dispatch: createReadOnlyDispatch(), serverInfo: { name: 'robinson-github-mcp', version: '0.1.0' }
    })(req, res);
  } catch {
    if (!res.headersSent) {
      return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
    }
  }
}
