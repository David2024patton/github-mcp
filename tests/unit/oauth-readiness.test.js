import {describe,it,expect} from 'vitest';
import {summarizeConnectorReadiness} from '../../src/github/oauth-readiness.js';
const url='https://github-mcp.example.test/api/mcp';
const counts={registered_clients:0,unrevoked_sessions:0,
  usable_access_tokens:0,refresh_credentials:0};
describe('owner-only custom-MCP OAuth readiness interpretation',()=>{
  it('identifies missing dynamic client registration without inventing acceptance',()=>{
    expect(summarizeConnectorReadiness(counts,{mcpUrl:url})).toMatchObject({
      state:'client_registration_required',registered_clients:0,
      custom_mcp_connected_acceptance_verified:false,
      production_access_not_assessed:true});
  });
  it('separates unfinished authorization, refresh, and recorded access',()=>{
    expect(summarizeConnectorReadiness({...counts,registered_clients:1},{mcpUrl:url}).state)
      .toBe('owner_authorization_required');
    expect(summarizeConnectorReadiness({...counts,registered_clients:1,
      unrevoked_sessions:1,refresh_credentials:1},{mcpUrl:url}).state)
      .toBe('client_refresh_or_reconnect_required');
    expect(summarizeConnectorReadiness({...counts,registered_clients:1,
      unrevoked_sessions:1,usable_access_tokens:1,refresh_credentials:1},
      {mcpUrl:url})).toMatchObject({state:'connection_records_present',
      custom_mcp_connected_acceptance_verified:false,production_access_not_assessed:true});
  });
  it('rejects malformed counts and non-HTTPS service addresses',()=>{
    for(const row of [{...counts,registered_clients:-1},
      {...counts,unrevoked_sessions:'1'},null])
      expect(()=>summarizeConnectorReadiness(row,{mcpUrl:url})).toThrow();
    expect(()=>summarizeConnectorReadiness(counts,{mcpUrl:'http://localhost/api/mcp'})).toThrow();
  });
});
