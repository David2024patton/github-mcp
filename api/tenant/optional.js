// Protected private tenant optional-token form. Never ask for or echo a bearer
// through MCP, query strings, cookies, rendered HTML or error descriptions.
import {timingSafeEqual} from 'node:crypto';
import {createPrivateOptionalEnrollment} from '../../src/tenancy/optional-setup.js';
import {TenantCapacityError} from '../../src/tenancy/runtime-limits.js';
import {escapeHtml,paramsOf,publicOrigin,send} from '../../src/core/http.js';
import {masterTokenLink} from '../../src/tenancy/master-credential.js';
import {BRAND_CSS,brandHeader,brandFooter} from '../../src/brand/brand.js';

// Same Robinson look as the sign-in pages. Every field and button fits the screen width on a phone.
const PAGE_CSS=BRAND_CSS+'input,select,button{width:100%;max-width:100%}'+
  'a.big{display:block;text-align:center;font-weight:600;color:#fff;background:var(--grad);border-radius:50px;padding:13px 20px;text-decoration:none}';
const NAME='gh_tenant_optional_state';
const CLEAR=NAME+'=; Max-Age=0; Path=/api/tenant/optional; HttpOnly; Secure; SameSite=Strict';
const cookie=req=>/(?:^|;\s*)gh_tenant_optional_state=([A-Za-z0-9_-]{43})(?:;|$)/
  .exec(String(req.headers?.cookie||''))?.[1]||null;
const masterMarkup=details=>'<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Master token</title><style>'+PAGE_CSS+'</style></head><body><main>'+brandHeader()+
  '<h1>Add your master token</h1>'+
  '<p>This is optional. It lets your assistant do things the normal sign-in cannot, such as notifications, packages, gists and organization settings. '+
  'It has the power of your whole GitHub login, so only add it if you want that. You can remove it any time.</p>'+
  '<ol><li>Tap the button below. GitHub opens a page with every permission already ticked. Sign in to GitHub if it asks.</li>'+
  '<li>Scroll down and tap <strong>Generate token</strong>.</li>'+
  '<li>Copy the long code GitHub shows you. GitHub only shows it once.</li>'+
  '<li>Come back to this page, paste the code in the box and tap Continue.</li></ol><p><small>Tip: on GitHub you pick how long the token lasts. We use whatever you choose.</small></p>'+
  '<p><a class="big" href="'+escapeHtml(masterTokenLink())+'" target="_blank" rel="noopener noreferrer">Create my master token on GitHub</a></p>'+
  '<form method="post" action="/api/tenant/optional">'+
  '<input type="hidden" name="csrf" value="'+escapeHtml(details.state)+'">'+
  '<label>Paste the token here<input type="password" name="value" required minlength="8" maxlength="4096" autocomplete="off"></label>'+
  '<label>Action<select name="action"><option value="save">Verify and save my master token</option>'+
  (details.oauth?'':'<option value="revoke">Remove my stored master token (paste the token to prove it is you)</option>')+
  '</select></label><button type="submit">Continue</button></form>'+
  '<p>Paste it here only, never into a chat. We check it belongs to your own GitHub login and store it encrypted. '+
  'It is never shown again. It lasts as long as you set it to last on GitHub (30 days, a year, or never). '+
  'Removing it here does not delete it at GitHub; do that in your GitHub settings too.</p>'+brandFooter()+'</main></body></html>';
const markup=details=>details.kind==='M'?masterMarkup(details):standardMarkup(details);
const standardMarkup=details=>'<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>Additional GitHub authority</title><style>'+PAGE_CSS+'</style></head><body><main>'+brandHeader()+
  '<h1>Additional GitHub authority</h1>'+
  '<p>Workspace account: <strong>'+escapeHtml(details.account)+'</strong>.</p>'+
  '<p>Requested read: <strong>'+escapeHtml(details.operation)+'</strong>.</p>'+
  '<p>Create an appropriately scoped token on GitHub for your own account. '+
  'Paste it here only, never into an AI chat. This verifies one harmless read, not write access.</p>'+
  '<form method="post" action="/api/tenant/optional">'+
  '<input type="hidden" name="csrf" value="'+escapeHtml(details.state)+'">'+
  '<label>GitHub personal access token'+
  '<input type="password" name="value" required minlength="8" maxlength="4096" autocomplete="off"></label>'+
  '<label>Action<select name="action">'+
  '<option value="save">Verify and save (or renew) my credential</option>'+
  (details.oauth?'':'<option value="revoke">Revoke my stored credential (same-person verification)</option>')+
  '</select></label><button type="submit">Continue and return to my connection</button></form>'+
  '<p>Interrupted? Restart from the connection permission check. A failed or expired '+ 
  'form leaves your previous credential unchanged. Removing a token from this service '+
  'does not revoke it at GitHub; do that separately in GitHub settings.</p>'+brandFooter()+'</main></body></html>';

export function renderOptionalForm(res,details,clearCookies=[]){
  // Same-origin POST must retain Origin. Completion responses remain no-referrer.
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  const fresh=NAME+'='+details.state+
    '; Max-Age=600; Path=/api/tenant/optional; HttpOnly; Secure; SameSite=Strict';
  res.setHeader('Set-Cookie',clearCookies.length?[...clearCookies,fresh]:fresh);
  return send(res,200,markup(details),'text/html; charset=utf-8');
}

export function makePrivateOptionalPage({
  env=process.env,enrollment=createPrivateOptionalEnrollment({env})
}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if(!['GET','POST'].includes(req.method)){
      res.setHeader('Allow','GET, POST');
      return send(res,405,{error:'method_not_allowed'});
    }
    try{
      if(req.method==='GET'){
        if(['read-observed-at-enrollment','revoked-on-this-service'].includes(req.query?.github_mcp_optional))
          return send(res,200,'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitHub setup</title><style>'+PAGE_CSS+'</style><main>'+brandHeader()+'<h1 id="optional-done">'+(req.query.github_mcp_optional==='revoked-on-this-service'?'Removed':'Saved')+'</h1><p>'+(req.query.github_mcp_optional==='revoked-on-this-service'?'It is no longer stored here. Also delete it in your GitHub settings if you will not use it again.':'Your assistant can use it straight away; no reconnecting needed.')+'</p><p><a href="/connection">Back to My connection</a></p></main></html>','text/html; charset=utf-8');
        // GOD-1: a one-use link from github_master_token_link (add the master token any time, no reconnecting).
        if(typeof req.query?.master_link==='string')
          return renderOptionalForm(res,await enrollment.startMasterLink(req.query.master_link));
        const result=await enrollment.start(paramsOf(req));
        return renderOptionalForm(res,result);
      }
      const p=paramsOf(req),observed=cookie(req);
      // The one-use state inside the form is the guard: it exists only in the page this person was given. The cookie is
      // optional (some in-app browsers keep none); when one is present it must match. A form naming another site is refused.
      const origin=String(req.headers?.origin||'');
      if(!(origin===''||origin==='null'||origin===publicOrigin(env)) ||
        typeof p.csrf!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(p.csrf) ||
        (observed && (p.csrf.length!==observed.length ||
        !timingSafeEqual(Buffer.from(p.csrf),Buffer.from(observed)))))
        return send(res,403,{error:'credential_setup_denied',
          description:'This private browser step expired. Restart from your connection.'});
      res.setHeader('Set-Cookie',CLEAR);
      const result=await enrollment.finish({
        state:p.csrf,action:p.action,value:p.value});
      res.setHeader('Location',result.destination);
      return res.status(303).end();
    }catch(error){
      if(error instanceof TenantCapacityError){
        res.setHeader('Retry-After',String(error.retryAfterSeconds));
        return send(res,429,{error:'rate_limited',description:'This private connection is temporarily busy.'});
      }
      if(req.method==='POST')res.setHeader('Set-Cookie',CLEAR);
      return send(res,403,{error:'credential_setup_denied',
        description:'This setup was not verified. Restart from your connection.'});
    }
  };
}
export default makePrivateOptionalPage();
