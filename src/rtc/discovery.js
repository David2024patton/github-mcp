// Restricted RTC catalog pages have a fixed wire budget. Keep every complete
// metadata entry; a large page stays available as one connection-owned result.
import {randomBytes} from 'node:crypto';
import {RULES,sizeOf} from '../core/result-rules.js';
import {containsCredential} from '../tools/util.js';

export async function rtcDiscoveryReply({tools,count,next,connection,db}){
  const full={ok:true,result:{tools,count,next}};
  const serialized=JSON.stringify(full);
  if(containsCredential(serialized))throw new Error('Unsafe RTC discovery');
  if(sizeOf(full)<=RULES.maxBytes)return full;
  if(!connection?.client_id||typeof db?.putResult!=='function')
    throw new Error('Result storage unavailable');
  const handle='res_'+randomBytes(16).toString('base64url');
  const summary=tools.length+' tool metadata entries retained';
  const reply={ok:true,result:{
    tools:[],count,next,shown:0,requested:tools.length,
    note:'Complete page retained: use the handle for missing entries.'
  },handle,summary,mode:connection.mode};
  for(const tool of tools){
    reply.result.tools.push(tool);
    reply.result.shown++;
    if(sizeOf(reply)>RULES.maxBytes){
      reply.result.tools.pop();
      reply.result.shown--;
      break;
    }
  }
  // Retention failure is a sanitized 503, never a truncated catalog success.
  await db.putResult({handle,connection:connection.client_id,summary,
    body:{tools,count,next}});
  return reply;
}
