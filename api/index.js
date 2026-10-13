import { registry } from '../src/tools/index.js';
import { profileCounts } from '../src/core/registry.js';

// The anonymous root proves that this process can answer HTTP only.
// No public endpoint may infer owner setup, OAuth consent, provider access or acceptance.
export function publicInfo(buildSha = process.env.VERCEL_GIT_COMMIT_SHA) {
  const sourceSha = typeof buildSha === 'string' && /^[a-f0-9]{40}$/.test(buildSha)
    ? buildSha : null;
  return {
    name: 'Robinson GitHub MCP', status: 'service-online',
    connected_provider: 'not_assessed', custom_mcp_acceptance: 'not_assessed',
    deployed_source_sha: sourceSha, source_sha_independently_verified: false,
    tools: registry.tools.length, tools_by_profile: profileCounts(registry),
    oauth: '/.well-known/oauth-authorization-server', endpoint: '/api/mcp',
    note: 'HTTP reachability is not GitHub App setup, developer OAuth, provider or Hub acceptance. Use authenticated owner diagnostics and direct custom MCP calls to verify those separately.'
  };
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(publicInfo());
}
