import { registry } from '../src/tools/index.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    name: 'Robinson GitHub MCP', status: 'setup-required', tools: registry.tools.length,
    oauth: '/.well-known/oauth-authorization-server', endpoint: '/api/mcp',
    note: 'No GitHub account is usable until it is connected through the setup page.'
  });
}
