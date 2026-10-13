// Batch envelopes have their own budget even when each canonical read is small.
// Keep complete items and all child handles; retain the full ordered aggregate
// in the existing 24-hour, connection-owned store before reporting a preview.
import {randomBytes} from 'node:crypto';
import {RULES,sizeOf} from '../core/result-rules.js';
import {containsCredential} from '../tools/util.js';

export async function rtcBatchReply({results,connection,db}){
  const full={ok:true,result:{results}};
  if(containsCredential(JSON.stringify(full)))throw new Error('Unsafe batch reply');
  if(sizeOf(full)<=RULES.maxBytes)return full;
  const owner=connection?.client_id;
  if(!owner||typeof db?.putResult!=='function')throw new Error('Result storage unavailable');
  const handle='res_'+randomBytes(16).toString('base64url');
  const summary=results.length+' ordered read results';
  const reply={ok:true,result:{results:[],count:results.length,shown:0,
    next:{page:1,pageSize:1}},handle,summary,mode:connection.mode};
  for(const item of results){
    reply.result.results.push(item);
    reply.result.shown++;
    if(sizeOf(reply)>RULES.maxBytes){
      reply.result.results.pop();reply.result.shown--;break;
    }
  }
  // Store exactly the guarded results, including their original retained handles.
  // A failed write is a service failure, never silently lost batch data.
  await db.putResult({handle,connection:owner,summary,
    body:{results,count:results.length}});
  return reply;
}
