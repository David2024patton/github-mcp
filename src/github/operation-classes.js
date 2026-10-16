import { isReviewedFree } from './spend-classes.js';
// U-1: reviewed conservative policy for non-curated universal operations.
// A miss cannot become a non-production, non-access-widening, or free operation.
const productionWords=/(create|delete|transfer|invite|enable|assign|approve|revoke|purchase|upgrade|grant|publish|set|change|update settings|remove)/i;
const accessWords=/(collaborat|member|team|role|permission|visibility|public|invitation|access|token|key|secret|bypass|rule|organization|security)/i;
const spendWords=/(copilot|codespace|runner|billing|budget|licen[cs]e|paid.feature|secret.protection|code.security|advanced.security|marketplace|package|pages|artifact|cache|deployment|actions.workflows|storage|build.minutes)/i;
const protectedPaths=/(^\/orgs\/|^\/enterprises\/|\/(rulesets|branches\/\{branch\}\/protection|actions\/permissions|hooks|keys|environments|pages|releases|git\/refs|settings|security-and-analysis))/i;
export function classifyUniversal(op) {
  if (!op || !op.method || op.method==='GET') return Object.freeze({production:false,accessWidening:false,notifies:false,spendRisk:false});
  const s=op.summary+' '+op.path+' '+(op.operationId??'');
  const suspectedSpend=spendWords.test(s);
  // Unknown writes remain both production and access changes until individually classified.
  const classification={
    production:protectedPaths.test(op.path)||productionWords.test(s)||!['GET','HEAD'].includes(op.method),
    accessWidening:accessWords.test(s)||productionWords.test(s)||!['GET','HEAD'].includes(op.method),
    notifies:op.notifies===true,
    spendRisk:suspectedSpend && !isReviewedFree(op)
  };
  return Object.freeze(classification);
}
export function assertUniversalAuthority(op,params,body) {
  const path=op.path.toLowerCase();
  if (path.startsWith('/app/') || path==='/app' || path.startsWith('/applications/'))
    throw new TypeError('App-JWT/application management endpoints are not available through universal tools.');
  if (path.startsWith('/enterprises/') || path.startsWith('/enterprise/'))
    throw new TypeError('Enterprise endpoints require verified enterprise account authority; no such route is enrolled.');
  if (op.method==='HEAD' || op.method==='OPTIONS')
    throw new TypeError('Use a documented GET operation for a readable result.');
  if (/\/(dependabot|actions|codespaces)\/secrets(\/|$)/i.test(path) && op.method!=='GET')
    throw new TypeError('Secret writes must use the curated sealed-secret tool.');
  if (/\/(private-vulnerability-reporting|secret-scanning)\/(.*\/)?(secrets|secret)/i.test(path) && op.method!=='GET')
    throw new TypeError('Secret material cannot be submitted through universal tools.');
  const all={params,body};
  const visit=(value,key='',depth=0)=>{
    if(depth>16)throw new TypeError('Request nesting is too deep.');
    if(key===['bypass','rules'].join('_') && value===true)throw new TypeError('Rule bypass is never permitted.');
    if(typeof value==='string'){
      if(/(password|(^|_)access_token|private_key|client_secret|(^|_)secret_value|refresh_token)/i.test(key))
        throw new TypeError('Credential or private key arguments are not permitted.');
      if(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{18,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(value))
        throw new TypeError('Credential or private key material is not permitted.');
    } else if(Array.isArray(value))value.forEach(x=>visit(x,key,depth+1));
    else if(value && typeof value==='object')for(const [k,v]of Object.entries(value))visit(v,k,depth+1);
  };
  visit(all);
}
export function universalPrice(op) {
  // A universal tool cannot reconstruct licensed seat/usage cost safely from arbitrary input.
  // Such operations are deliberately routed to the existing priced tools or refused.
  if (classifyUniversal(op).spendRisk)
    throw new TypeError('Cost or licensing cannot be verified through the universal route; use the priced curated tool or request a reviewed operation-class amendment.');
  return 0;
}
