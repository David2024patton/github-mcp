// One real HTTP process and one independent PostgreSQL connection. Disposable
// local test DB only; no provider credential, application runtime or secret log.
import {createServer} from 'node:http';
import pg from 'pg';
import {createDb} from '../../src/db.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
const url=process.env.TEST_DATABASE_URL,schema=process.env.RTC_RATE_TEST_SCHEMA;
if(!url||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname)||
  !/^github_mcp_test_[a-f0-9]+$/.test(schema??''))throw new Error('Local isolated test DB required.');
const client=new pg.Client({connectionString:url});
await client.connect();await client.query(`SET search_path TO "${schema}"`);
const db=createDb(async(strings,...values)=>{
  let text=strings[0];for(let i=0;i<values.length;i++)text+=`$${i+1}${strings[i+1]}`;
  return (await client.query(text,values)).rows;
});
const handler=createRtcHttpHandler({db,registry:{tools:[]},dispatch:async()=>{throw new Error('Whoami never dispatches');}});
const server=createServer(async(req,res)=>{
  const response={setHeader:(key,value)=>res.setHeader(key,value),
    status(code){res.statusCode=code;return this;},json(value){res.end(JSON.stringify(value));return this;}};
  await handler({method:req.method,headers:req.headers,query:{}},response,'whoami');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
process.send({url:`http://127.0.0.1:${server.address().port}/api/whoami`,pid:process.pid});
process.on('message',async message=>{
  if(message!=='close')return;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await client.end();process.disconnect();
});
