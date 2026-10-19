import { createPrivateGitHubConsent } from '../../../src/tenancy/github-consent.js';
import { send } from '../../../src/core/http.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return send(res,405,{error:'method_not_allowed'});
  }
  try{
    const consent=createPrivateGitHubConsent();
    const {url,csrfState}=await consent.start(req.query||{});
    res.setHeader('Set-Cookie',`gh_tenant_pilot_state=${csrfState}; Max-Age=600; Path=/api/tenant/oauth; HttpOnly; Secure; SameSite=Lax`);
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Location',url);
    return res.status(302).end();
  }catch{
    return send(res,403,{error:'authorization_unavailable',
      error_description:'This GitHub tenant authorization is not available.'});
  }
}
