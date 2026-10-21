// CAP-2: static, scoped explanation. This never fetches a bearer, executes a
// provider action, expands a grant or claims that a registered tool is usable.
import {isToolVisible} from '../core/registry.js';
import {reviewedRestEvidence} from './capability-evidence.js';
const ADVICE={
  I:'Accept the exact GitHub App installation and its permissions for this account, then recheck; installation alone is not provider acceptance.',
  U:'Sign in to GitHub through this server-owned consent flow and reverify the exact user and installation.',
  P:'Use the protected package-token setup page; the P grant cannot replace App permissions or restricted passes.',
  K:'Use the protected notifications-only setup page; K cannot serve unrelated routes.'
};
export function effectiveToolAccess({connection,account,tool}){
  if(!connection?.accounts?.some(a=>String(a).toLowerCase()===String(account?.login).toLowerCase()))
    throw new TypeError('The account is not in this connection.');
  if(!tool?.name?.startsWith('github_'))throw new TypeError('Choose a registered GitHub tool.');
  const profileAllowed=isToolVisible(tool,connection.profile);
  const kind=tool.declarations?.cred??(tool.writes===true?'I':null);
  const stored=kind==='I'
    ? account.credential_kind==='fine_grained'?account.has_fine_grained===true
      : account.credential_kind==='app'&&account.installation_status==='active'&&!!account.installation_id&&!!account.app_id
    : kind==='U'?account.has_user_token===true
      :kind==='P'?account.has_package===true
        :kind==='K'?account.has_classic===true:null;
  const credential={kind:kind??'not-declared',state:stored===null?'unknown':stored?'stored-unverified':'missing',
    note:ADVICE[kind]??'Credential kind and exact provider scopes have not been reviewed for this read tool.'};
  const production=tool.writes!==true?{state:'not-a-write'}
    :tool.declarations?.production==='always'&&connection.mode!=='production'
      ?{state:'denied',note:'Full does not enable production; independently authorize production per account.'}
      :{state:'guard-required',note:'Classify the exact target and enforce existing production and confirmation gates at execution.'};
  const resource=account.repository_selection==='selected'
    ?{state:'not-enumerated',note:'Selected installed repositories must be verified for the exact target.'}
    :{state:'not-verified',note:'Resource ownership, tenant membership and host limits need a guarded provider check.'};
  const refusedBy=[...(profileAllowed?[]:['profile']),...(stored===false?['credential']:[]),
    ...(production.state==='denied'?['mode']:[])];
  return {tool:tool.name,account:account.login,mode:connection.mode,
    profile:{value:connection.profile,status:profileAllowed?'selected':'denied',
      ...(profileAllowed?{}:{how:'Reconnect through the server-owned consent page and explicitly choose Full; existing grants are not silently widened.'})},
    credential,production,resource,policy:{state:'guard-required',
      note:'Protected resources, spending, notifications and RTC pass limits cannot be bypassed by this diagnostic.'},
    status:refusedBy.length?'denied':'unverified',refusedBy,
    permissionProof:'not-performed',
    note:refusedBy.length?'Only these source-layer denials are known; other provider and policy layers remain unverified.'
      :'No listed source blocker was found. Actual GitHub capability is NOT verified.'};
}

// Source-pinned REST documentation is not an access token or a verified
// provider request. Never infer one credential may be substituted for another.
export function documentedOperationAccess({account,route}){
  if(!account?.login || typeof route!=='string')throw new TypeError('A scoped account and exact operation are required.');
  const reviewed=reviewedRestEvidence(route);
  const mainType=account.credential_kind==='fine_grained'?'fine_grained_pat':'app_installation';
  const detail=type=>{
    const value=reviewed?.decisions?.[type];
    return {credentialType:type,documentation:value?.disposition??'unknown',
      requiredPermissions:value?.permissions??null,documentedScopes:value?.scopes??null,
      ...(value?.note?{note:value.note}:{}),grantedToThisConnection:'not-proven'};
  };
  const appJwt=detail('app_jwt');
  return {operation:route,sourceVersion:'2026-03-10',
    documentation:reviewed?'operation-reviewed':'unknown',
    ...(reviewed?{officialUrl:reviewed.officialUrl,checked:reviewed.reviewed}:{}),
    I:detail(mainType),U:detail('app_user'),
    otherCredential:appJwt.documentation==='supported'?appJwt:null,
    restrictedKinds:{K:'notifications-only; never an API fallback',
      P:'package-only; never an API fallback'},
    matchingToolDispatch:'not-verified',effectiveProviderExecution:'not-verified',
    note:'Official token compatibility is not proof of this user\'s grant, target scope, user policy or actual provider readback.'};
}

/**
 * A refusal recovery recipe is an ordered set of *explicit user/provider*
 * actions, never a token resolution strategy. The server does not click consent,
 * reissue a grant, select a larger permission or retry a provider write.
 */
export function accessRecovery({connection,account,tool,missingPermissions=[],operation=null}){
  const effective=effectiveToolAccess({connection,account,tool});
  const requested=Array.isArray(missingPermissions)?missingPermissions:[];
  const actions=[];
  const add=(layer,action,instruction,extra={})=>actions.push({layer,action,instruction,...extra});
  if(effective.refusedBy.includes('profile'))
    add('connection-profile','explicit-client-reauthorization',
      'In the connected MCP client choose Reconnect and select Full on the normal server-owned consent form. Your existing connection retains its current profile until separate consent succeeds.');
  if(effective.credential.state==='missing'){
    if(effective.credential.kind==='I')
      add('github-installation','authorize-account',
        'Install or reconnect the exact GitHub App for this account. The account owner must approve installation repository and permission changes in GitHub.');
    else if(effective.credential.kind==='U')
      add('github-user','explicit-github-user-authorization',
        'Reauthorize the same GitHub user inside the MCP client GitHub flow; the verified user and current installation must still match.');
    else if(['K','P'].includes(effective.credential.kind))
      add('optional-credential','protected-setup-only',
        'Use the existing protected server setup page only for this restricted credential. Do not send tokens in chat or tool arguments.');
  }
  if(requested.length && account.credential_kind==='app'){
    // Only a recorded deficiency in the selected installation qualifies
    // for this prompt. Changing App permissions and approving that change
    // are separate explicit GitHub-owner actions.
    add('github-installation-permissions','owner-approves-updated-permissions',
      'Ask the GitHub App owner to request these permissions, then have the installation owner approve the updated permissions on GitHub. Existing grants remain in force until acceptance; reconnect and read back.',
      {missing:requested.map(x=>({permission:x.permission,needed:x.needed,granted:x.granted})),
        documentation:'https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app'});
  }
  if(effective.production.state==='denied')
    add('production-mode','explicit-account-approval',
      'Full is not production authorization. An authorized owner must independently enable production for the exact account and explicitly issue a production-mode connection.');
  if(account.repository_selection==='selected')
    add('repository-selection','verify-exact-repository',
      'Confirm that the target repository belongs to the selected GitHub App installation repositories; do not assume a matching owner name grants access.');
  if(operation?.I?.documentation==='unsupported' && operation?.U?.documentation==='supported')
    add('documented-credential','user-authorization-may-be-required',
      'The pinned endpoint documentation excludes the main installation credential but lists GitHub App user authorization. Verify the precise route and approved user before calling it; never silently swap tokens.');
  if(operation?.I?.documentation==='unsupported' && operation?.U?.documentation==='unsupported')
    add('documented-credential','no-supported-standard-token-proven',
      'Neither ordinary credential kind is documented for this exact route. A separate documented credential does not authorize this connection or this tool.');
  const verified=false;
  return {verified,capability:'not-tested',requiresUserConsent:actions.some(a=>
    ['explicit-client-reauthorization','explicit-github-user-authorization','owner-approves-updated-permissions','explicit-account-approval'].includes(a.action)),
    actions,unverified:[
      'Exact tenant membership, account ownership and selected resource',
      'Effective provider permissions, GitHub plan/SSO and latest consent',
      'Protected-resource, spend, confirmation and restricted-pass gates',
      'Actual guarded operation dispatch and independent provider readback'
    ],
    recheck:{tool:'github_check_permissions',account:account.login,
      operation:operation?.operation??null,registeredTool:tool.name},
    note:'Recovery is guidance only: no OAuth consent, permission escalation or provider operation has run.'};
}
