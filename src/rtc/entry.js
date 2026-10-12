// One composition root for RTC HTTPS routes, independent of the existing OAuth MCP door.
import {getSecretsRuntime} from '../runtime.js';
import {registry} from '../tools/index.js';
import {createDispatch} from '../tools/dispatch.js';
import {createGates} from '../tools/gates.js';
import {createRtcHttpHandler,rtcError} from './http.js';

export async function serveRtc(req,res,route){
  if(route==='contract'||route==='openapi')
    return createRtcHttpHandler({db:{},registry,dispatch:async()=>{throw new Error('No public dispatch');}})(req,res,route);
  try{
    const {db,credentials}=await getSecretsRuntime();
    const dispatch=createDispatch({credentials,gates:createGates({db})});
    return await createRtcHttpHandler({db,registry,dispatch})(req,res,route);
  }catch{
    res.setHeader('Cache-Control','no-store');
    return res.status(503).json(rtcError('service_error'));
  }
}
