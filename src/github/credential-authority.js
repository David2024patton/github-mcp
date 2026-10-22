// CAP-3: typed, operation-aware authorization selection. This module only
// decides which *verified metadata* is eligible; it cannot read/decrypt a token,
// make a GitHub request, promote an account role or try a fallback credential.
import {reviewedRestEvidence} from './capability-evidence.js';

export const GRANT_KINDS=Object.freeze(['app_installation','app_user','fine_grained_pat',
  'classic_pat','oauth_app','app_jwt','git_ssh','workflow_token']);
const PRIMARY=Object.freeze({
  app:'app_installation',fine_grained:'fine_grained_pat'
});
const ALTERNATIVES=Object.freeze({
  app_installation:'I',app_user:'U',fine_grained_pat:'F',
  classic_pat:'classic',oauth_app:'OAuth App',app_jwt:'App JWT'
});
const hostPattern=/^(?:github\.com|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/;
const same=(x,y)=>String(x??'').toLowerCase()===String(y??'');
const validId=id=>Number.isSafeInteger(id)&&id>0;
const hasEveryPermission=(required,granted)=>!required?.length ||
  (Array.isArray(granted)&&required.every(value=>granted.includes(value)));
// The CAP-1 official OAuth scope array is a set of documented alternatives,
// not an instruction to accumulate ALL scopes. Never infer missing scopes.
const hasDocumentedScope=(alternatives,granted)=>!alternatives?.length ||
  (Array.isArray(granted)&&alternatives.some(value=>granted.includes(value)));
const refusal=(code,explanation)=>({status:'denied',code,explanation});
const unknown=(code,explanation)=>({status:'unknown',code,explanation});

/**
 * @param {object} p Only server-derived identity/session/account data.
 * p.grants[] contains metadata and a ciphertext fingerprint, never a token.
 * A reported match is a candidate for an explicitly chosen operation, not
 * an authorization to bypass native write guards or GitHub's live check.
 */
export function resolveDocumentedCredential({
  operation,host='github.com',account,principal,grants=[],
  requestedKind=null,resource=null,now=Date.now()
}={}){
  if(typeof operation!=='string'||
      !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[^\s]*$/.test(operation))
    throw new TypeError('Use a pinned REST METHOD /path.');
  if(typeof host!=='string'||!hostPattern.test(host)||host.includes('..')||
      host.includes(':')||host.includes('/')) return refusal('invalid_host','The selected provider host is invalid.');
  if(!account||!validId(account.accountId)||typeof account.login!=='string')
    return refusal('account_unverified','A server-verified connected GitHub account is required.');
  if(!principal||!validId(principal.githubUserId)||
      typeof principal.tenantId!=='string'||!principal.tenantId||
      typeof principal.identityId!=='string'||!principal.identityId)
    return refusal('principal_unverified','Verify the current numeric GitHub user and active workspace membership.');
  if(typeof resource!=='string'||!resource||resource.length>240)
    return refusal('resource_unverified','A selected authorized resource is required.');
  if(!same(principal.host,host)) return refusal('wrong_host','The current user is not verified for this GitHub host.');
  if(!Array.isArray(grants)) return refusal('grant_registry_unavailable','Credential metadata is unavailable.');
  const official=host==='github.com'?reviewedRestEvidence(operation):null;
  if(!official) return unknown('provider_documentation_unreviewed',
    'No operation-specific reviewed credential contract for this host/version; do not try credentials.');
  const kinds=requestedKind?[requestedKind]:GRANT_KINDS;
  if(kinds.some(kind=>!GRANT_KINDS.includes(kind)))
    return refusal('unsupported_credential_kind','Use a documented typed credential kind.');
  const applicable=kinds.filter(kind=>official.decisions[kind]?.disposition==='supported');
  const disallowed=kinds.filter(kind=>official.decisions[kind]?.disposition==='unsupported');
  if(!applicable.length)return {
    ...unknown(disallowed.length?'documented_credential_unsupported':'no_reviewed_credential_match',
      'The selected credential is not documented for this endpoint; no broader fallback is attempted.'),
    operation,host,requestedKind,unsupported:disallowed
  };
  const eligible=[];
  const blocked=[];
  for(const kind of applicable){
    const doc=official.decisions[kind];
    const possible=grants.filter(g=>g?.kind===kind);
    if(!possible.length){blocked.push({kind,reason:'not_enrolled'});continue;}
    for(const grant of possible){
      // A service-owner App JWT is not a product-user bearer, and classic P/K
      // tokens are never freely interchangeable.
      if(kind==='app_jwt'&&!grant.explicitServiceAuthority){
        blocked.push({kind,reason:'service_ownership_not_proven'});continue;
      }
      if(grant.revokedAt){blocked.push({kind,reason:'revoked'});continue;}
      if(grant.expiresAt!=null && (!(new Date(grant.expiresAt).getTime()>now))){
        blocked.push({kind,reason:'expired'});continue;
      }
      if(!grant.fingerprint||!grant.currentCipherFingerprint||
          grant.fingerprint!==grant.currentCipherFingerprint){
        blocked.push({kind,reason:'stale_or_replaced'});continue;
      }
      if(!same(grant.host,host)||!same(grant.login,account.login)||
          grant.accountId!==account.accountId||
          grant.tenantId!==principal.tenantId||
          grant.identityId!==principal.identityId||
          grant.githubUserId!==principal.githubUserId){
        blocked.push({kind,reason:'foreign_principal_host_or_account'});continue;
      }
      if(!Array.isArray(grant.resources)||!grant.resources.some(x=>same(x,resource))){
        blocked.push({kind,reason:'resource_not_granted'});continue;
      }
      if(grant.verification!=='identity-and-capability-readback'){
        blocked.push({kind,reason:'capability_not_verified'});continue;
      }
      if(!hasEveryPermission(doc.permissions,grant.permissions)||
          !hasDocumentedScope(doc.scopes,grant.scopes)){
        blocked.push({kind,reason:'permission_or_scope_missing'});continue;
      }
      eligible.push({kind,alias:ALTERNATIVES[kind]??kind,host,operation,resource,
        requirementSource:official.officialUrl,verification:'metadata-only'});
    }
  }
  if(eligible.length===1){
    return {status:'verified-for-scope',operation,host,
      selected:eligible[0],requiresExplicitCall:true,providerExecution:'not-tested',
      note:'This is a verified enrollment candidate; the original dispatch, user policy and provider checks are still mandatory.'};
  }
  if(eligible.length>1){
    return {status:'needs-explicit-credential-selection',operation,host,
      candidates:eligible,providerExecution:'not-tested',
      note:'Multiple eligible grants exist. Never silently choose a broader one.'};
  }
  return {status:'needs-consent',operation,host,requiredKinds:applicable,
    missing:blocked,source:official.officialUrl,
    providerExecution:'not-tested',
    note:'No eligible exact scoped grant. Reauthorize/verify explicitly; do not trial-and-error or retry a write under another credential.'};
}

export function credentialTypeForAccount(account){
  return PRIMARY[account?.credential_kind]??null;
}
