// Public, deliberately non-certified RTC adoption metadata. No credential or live-call side effects.
import { areaOf } from '../core/meta.js';

const AUDIENCES={B:'builder',O:'owner',Op:'operator'};
export function rtcMetadata(tool) {
  const writes=tool.writes===true;
  const money=Boolean(tool.declarations?.spend);
  const destructive=writes&&(tool.declarations?.confirm==='always'||
    tool.declarations?.accessWidening===true||tool.annotations?.destructiveHint===true);
  const description=(money?'MOVES MONEY: ':'')+String(tool.description??'');
  return {
    name:tool.name,description:description.slice(0,160),inputSchema:tool.inputSchema,
    area:areaOf(tool),profiles:writes?(tool.profiles??['everyday','full']):['read_only','everyday','full'],
    writes,money,destructive,
    audience:(tool.audience??['B','O','Op']).map(a=>AUDIENCES[a]??a),
    annotations:{readOnlyHint:!writes,destructiveHint:destructive,
      idempotentHint:tool.annotations?.idempotentHint===true,
      openWorldHint:tool.annotations?.openWorldHint===true}
  };
}
export function rtcManifest(registry) {
  const tools=registry.tools;
  return {
    rtc:0,server:'robinson-github-mcp',prefix:'github',version:'0.1.0',apiVersion:'2026-03-10',
    areas:[...new Set(tools.map(areaOf))].sort(),
    counts:{tools:tools.length,writes:tools.filter(t=>t.writes===true).length,
      money:tools.filter(t=>t.declarations?.spend).length},
    profiles:['read_only','everyday','full'],listingModes:['catalog','compact'],
    modes:['preview','production'],devTools:true,adoption:'in_progress',
    note:'Safe read-only HTTP integration in progress. RTC 1 conformance and real D-4 acceptance are not certified.'
  };
}
export function rtcOpenApi(){
  const r=(summary)=>({summary,security:[{rtcPass:[]}],responses:{200:{description:'RTC envelope'}}});
  return {openapi:'3.1.0',info:{title:'Robinson GitHub RTC preview HTTPS API',version:'0.1.0'},
    paths:{
      '/api/contract':{get:{summary:'Public contract status',responses:{200:{description:'Manifest'}}}},
      '/api/openapi.json':{get:{summary:'Public API description',responses:{200:{description:'OpenAPI'}}}},
      '/api/whoami':{get:r('View read-only pass scope')},
      '/api/tools':{get:r('Search available scoped tools')},
      '/api/tools/{name}':{get:r('Describe a tool'),post:r('Call one authorized read')},
      '/api/tools/_batch':{post:r('Call up to ten authorized reads')},
      '/api/results/{handle}':{get:r('Retrieve a connection-owned result')}
    },
    components:{securitySchemes:{rtcPass:{type:'http',scheme:'bearer'}}}
  };
}
