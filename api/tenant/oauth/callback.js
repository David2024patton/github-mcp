import { createPrivateGitHubConsent } from '../../../src/tenancy/github-consent.js';
import { send } from '../../../src/core/http.js';

const stateCookie=req=>
  /(?:^|;\\s*)gh_tenant_pilot_state=([A-Za-z0-9_-]{32,256})(?:;|$)/
    .exec(String(req.headers?.cookie||''))?.[1]||null;

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return send(res,405,{error:'method_not_allowed'});
  }
  // The browser flow is one-time: the cookie is invalidated on success and
  // refusal. State cannot be replayed in a second tab or forged callback.
  res.setHeader('Set-Cookie','gh_tenant_pilot_state=; Max-Age=0; Path=/api/tenant/oauth; HttpOnly; Secure; SameSite=Lax');
  try{
    const consent=createPrivateGitHubConsent();
    const target=await consent.finish({
      state:req.query?.state,code:req.query?.code,browserCsrf:stateCookie(req)
    });
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Location',target);
    return res.status(302).end();
  }catch{
    return send(res,403,{error:'authorization_denied',
      error_description:'GitHub could not verify this private authorization. Start a fresh sign-in.'});
  }
}
