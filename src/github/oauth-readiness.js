// Owner-only diagnostics for the custom MCP OAuth connection, without tokens,
// hashes, client IDs or any claim of live acceptance. Render only after the
// existing admin-passphrase, origin, CSRF and lockout checks.
export function summarizeConnectorReadiness(row,{mcpUrl}){
  const keys=['registered_clients','unrevoked_sessions','usable_access_tokens','refresh_credentials'];
  if(!row||keys.some(k=>!Number.isSafeInteger(row[k])||row[k]<0)||
    typeof mcpUrl!=='string'||!/^https:\/\/[^/]+\/api\/mcp$/.test(mcpUrl))
    throw new TypeError('Exact aggregate OAuth readiness counts and HTTPS MCP URL required.');
  const registered=row.registered_clients,sessions=row.unrevoked_sessions,active=row.usable_access_tokens,refresh=row.refresh_credentials;
  const state=!registered?'client_registration_required':
    !sessions?'owner_authorization_required':
      !active&&refresh?'client_refresh_or_reconnect_required':
        !active?'reconnect_required':'connection_records_present';
  const nextAction={
    client_registration_required:'In your approved MCP client, add this HTTPS server URL. Its OAuth discovery and dynamic client registration will begin when you connect; authorize only through the protected sign-in page.',
    owner_authorization_required:'Return to your MCP client, finish its OAuth authorization in the browser with the administrator passphrase, and select only the scratch account in preview mode.',
    client_refresh_or_reconnect_required:'The client may refresh its existing credential. Reconnect through OAuth if refresh fails, then independently test the custom service.',
    reconnect_required:'No current access token or refreshable connection is recorded. Reconnect the MCP client and complete its OAuth flow.',
    connection_records_present:'An unexpired connector credential is stored. Verify actual custom MCP /api/mcp access and exact scratch isolation; records alone do not prove connected acceptance.'
  }[state];
  return {state,registered_clients:registered,unrevoked_sessions:sessions,
    usable_access_tokens:active,refresh_credentials:refresh,mcp_url:mcpUrl,
    custom_mcp_connected_acceptance_verified:false,production_access_granted:false,
    next_action:nextAction};
}
