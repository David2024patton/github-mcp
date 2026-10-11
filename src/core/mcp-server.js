// Contract-generic MCP endpoint (A-3b). Authenticates the bearer, then serves tools/list from the registry and sends
// tools/call to an injected `dispatch`. The default dispatch answers every call with "unknown tool", so a registered
// tool can never run until the safety layer (Batch B) supplies a dispatcher that enforces it: default deny.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpToken } from './mcp-auth.js';
import { toolsForProfile } from './registry.js';

const unknownTool = (name) => ({ isError: true, content: [{ type: 'text', text: `Unknown or unavailable tool: ${String(name).slice(0, 80)}` }] });
export const denyAll = async ({ name }) => unknownTool(name);
const publicToolInfo = ({ name, description, inputSchema }) => ({ name, description, inputSchema });

export function createMcpHandler({ db, registry, env = process.env, toConnection, dispatch = denyAll, serverInfo = { name: 'robinson-mcp', version: '0.1.0' } }) {
  return async function mcp(req, res) {
    const connection = await requireMcpToken(req, res, db, env, { toConnection });
    if (!connection) return;
    const server = new Server(serverInfo, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsForProfile(registry, connection.profile).map(publicToolInfo) }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      dispatch({ registry, name: request.params?.name, args: request.params?.arguments, connection, db }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on?.('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}
