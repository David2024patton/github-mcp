// CAP-3 private member optional credentials. Only server-issued, short-lived
// browser states can lead to a token-entry POST. Signed tcl client IDs select a
// tenant; active membership and GitHub numeric user proof authorize the action.
import {createHash,randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {createTenantDirectory,openAuthorizedTenantDb} from './directory.js';
import {verifyTenantCredential} from './routed-credential.js';
import {verifyGithubBearerIdentity} from './github-identity.js';
import {enrollVerifiedPilotOptionalCredential,currentPilotOptionalReadback}
  from './optional-credentials.js';
import {publicOrigin} from '../core/http.js';
import {validRedirectUri} from '../core/oauth.js';

const digest=s=>createHash('sha256').update(s).digest('hex');
const randomState=()=>randomBytes(32).toString('base64url');
const LOGIN=/^[a-z0-9][a-z0-9-]{0,38}$/;
const OPERATIONS=Object.freeze({
  K:'GET /notifications',P:'GET /orgs/{org}/packages'
});
const denied=()=>new Error('Additional GitHub credential setup was not verified. Restart from your connected client.');
const isAccount=(row,login,env)=>row?.login?.toLowerCase()===login &&
  row.credential_kind==='app' && row.installation_status==='active' &&
  Number.isSafeInteger(row.account_id) && row.account_id>0 &&
  Number.isSafeInteger(row.installation_id) && row.installation_id>0 &&
  row.app_id===Number(env.GITHUB_PILOT_APP_ID);

export function createPrivateOptionalEnrollment({
  env=process.env,fetchImpl=fetch,
  directoryFactory=()=>createTenantDirectory(neon(env.DATABASE_URL)),
  tenantAccess=(directory,claim)=>openAuthorizedTenantDb({
    directory,tenantId:claim.tenantId,verifiedIdentityId:claim.identityId,
    connectionString:env.DATABASE_URL,sqlFactory:neon})
}={}){
  function origin(){
    if(env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled' ||
      env.VERCEL_ENV!=='production' || !env.DATABASE_URL ||
      !/^[1-9][0-9]{0,18}$/.test(String(env.GITHUB_PILOT_APP_ID||'')))
      throw denied();
    return publicOrigin(env);
  }
  async function scoped(clientId){
    origin();
    const claim=verifyTenantCredential(clientId,'tcl',env);
    if(!claim)throw denied();
    const directory=directoryFactory();
    const active=await directory.authorizedPilotIdentity(claim.tenantId,claim.identityId);
    if(!active || active.tenantId!==claim.tenantId ||
      active.identityId!==claim.identityId ||
      active.membershipRevision!==claim.membershipRevision ||
      active.pilotRevision!==claim.pilotRevision)throw denied();
    const scope=await tenantAccess(directory,claim);
    if(scope.tenant.namespace!==active.namespace ||
      scope.tenant.membershipRevision!==active.membershipRevision)throw denied();
    const client=await scope.db.getOAuthClient(clientId);
    if(!client || !Array.isArray(client.redirect_uris))throw denied();
    return {claim,directory,tenant:active,db:scope.db,client};
  }
  async function start({client_id,account,kind,redirect_uri}={}){
    if(typeof account!=='string'||!LOGIN.test(account)||
      !Object.hasOwn(OPERATIONS,kind) ||
      typeof redirect_uri!=='string'||!validRedirectUri(redirect_uri))
      throw denied();
    const scope=await scoped(client_id);
    if(!scope.client.redirect_uris.includes(redirect_uri))throw denied();
    const row=await scope.db.getAccount(account);
    if(!isAccount(row,account,env))throw denied();
    const subject=await scope.directory.getPilotVerifiedSubject(
      scope.claim.tenantId,scope.claim.identityId);
    if(!/^[1-9][0-9]{0,18}$/.test(String(subject)) ||
      !Number.isSafeInteger(Number(subject)))throw denied();
    const prior=await scope.directory.pilotOptionalFingerprint({
      tenantId:scope.claim.tenantId,identityId:scope.claim.identityId,
      accountLogin:account,kind});
    const state=randomState();
    const stored=await scope.directory.createPilotOptionalSetupState({
      stateHash:digest(state),tenantId:scope.claim.tenantId,
      identityId:scope.claim.identityId,clientId:client_id,
      membershipRevision:scope.tenant.membershipRevision,
      pilotRevision:scope.tenant.pilotRevision,
      accountLogin:account,kind,redirectUri:redirect_uri,
      expectedFingerprint:prior?.cipher_fingerprint??null});
    if(!stored)throw denied();
    return Object.freeze({state,kind,account,operation:OPERATIONS[kind]});
  }
  async function finish({state,action,value}={}){
    origin();
    if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||
      !['save','revoke'].includes(action)||
      typeof value!=='string'||value.length<8||value.length>4096||
      /[^\x21-\x7e]/.test(value))throw denied();
    const directory=directoryFactory();
    // Atomic DELETE before provider traffic: no replay after failure.
    const flow=await directory.consumePilotOptionalSetupState(digest(state));
    if(!flow)throw denied();
    const scope=await scoped(flow.clientId);
    if(flow.tenantId!==scope.claim.tenantId||
      flow.identityId!==scope.claim.identityId||
      flow.membershipRevision!==scope.tenant.membershipRevision||
      flow.pilotRevision!==scope.tenant.pilotRevision||
      !scope.client.redirect_uris.includes(flow.redirectUri))throw denied();
    const row=await scope.db.getAccount(flow.accountLogin);
    if(!isAccount(row,flow.accountLogin,env) ||
      !Object.hasOwn(OPERATIONS,flow.kind))throw denied();
    const subject=await scope.directory.getPilotVerifiedSubject(
      flow.tenantId,flow.identityId);
    if(!/^[1-9][0-9]{0,18}$/.test(String(subject)) ||
      !Number.isSafeInteger(Number(subject)))throw denied();
    let status;
    if(action==='save'){
      await enrollVerifiedPilotOptionalCredential({
        directory:scope.directory,db:scope.db,tenant:scope.tenant,
        accountLogin:flow.accountLogin,kind:flow.kind,bearer:value,
        expectedFingerprint:flow.expectedFingerprint,env,fetchImpl});
      const saved=await scope.directory.getPilotOptionalCredential({
        tenantId:flow.tenantId,identityId:flow.identityId,
        accountLogin:flow.accountLogin,kind:flow.kind});
      const resource=flow.kind==='K'?'user/'+subject:'org/'+row.account_id;
      if(!currentPilotOptionalReadback({
        row:saved,tenant:scope.tenant,account:row,subject,kind:flow.kind,
        operation:OPERATIONS[flow.kind],resource}))throw denied();
      status='read-observed-at-enrollment';
    }else{
      // A stolen client selector is never enough to erase another person's
      // grant. Revoke requires independent same-person GitHub identity proof.
      const principal=await verifyGithubBearerIdentity(value,{fetchImpl});
      if(principal.subject!==subject || !flow.expectedFingerprint)throw denied();
      const changed=await scope.directory.revokePilotOptionalCredential({
        tenantId:flow.tenantId,identityId:flow.identityId,
        accountLogin:flow.accountLogin,kind:flow.kind,
        expectedFingerprint:flow.expectedFingerprint});
      if(!changed)throw denied();
      status='revoked-on-this-service';
    }
    const destination=new URL(flow.redirectUri);
    destination.searchParams.set('github_mcp_optional',status);
    destination.searchParams.set('github_mcp_operation',OPERATIONS[flow.kind]);
    return Object.freeze({status,kind:flow.kind,
      operation:OPERATIONS[flow.kind],destination:destination.toString()});
  }
  return {start,finish};
}
