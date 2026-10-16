// Public, deliberately non-certified RTC adoption metadata. No credential or live-call side effects.
import { areaOf } from '../core/meta.js';
import {rtcHttpCapabilities,rtcIdentity} from './scope.js';

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
    service_identity:rtcIdentity(),https_subset:rtcHttpCapabilities(registry),
    standalone_mcp:{authentication:'oauth',independent:true},
    note:'Service passes with owner-chosen scope (read-only by default) over HTTPS. RTC 1 conformance and real D-4 acceptance are not certified.'
  };
}
export {rtcOpenApi} from './openapi.js';
