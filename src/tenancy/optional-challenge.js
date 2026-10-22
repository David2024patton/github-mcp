import {publicOrigin} from '../core/http.js';

export class OptionalConsentRequired extends Error{
  constructor(reply){super('Optional credential consent is required.');this.reply=reply;}
}

// Initiate the client's own OAuth transaction. Never construct its callback URL
// from a tool call, invent client state, or turn a delegated pass into consent.
export async function optionalConsentChallenge({name,args,connection,credentials,env}){
  if(name!=='github_notify_list'||args.repo||connection?.pass===true||
    !connection?.client_id?.startsWith('tcl_')||
    typeof credentials?.operationAuthority!=='function')return null;
  const account=args.owner??connection.default_account;
  if(!connection.accounts?.includes(account))return null;
  const authority=await credentials.operationAuthority({
    account,operation:'GET /notifications'});
  if(authority.status!=='needs-consent')return null;
  return {isError:true,content:[{type:'text',text:
    'Authorize the optional notifications read through your connected client. Enter the token only on the protected service page, never in chat.'}],
  _meta:{'mcp/www_authenticate':[
    'Bearer resource_metadata="'+publicOrigin(env)+
      '/.well-known/oauth-protected-resource", scope="github.notifications.read", '+
      'error="insufficient_scope", error_description="Authorize the optional notifications read"'
  ]}};
}
