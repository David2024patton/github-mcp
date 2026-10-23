import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {curatedTool} from '../../src/github/hand-built-map.js';
import {buildCapabilityInventory,validateCapabilityInventory}
  from '../../src/github/capability-inventory.js';

// CAP-4 reconciliation: exact App-owner JWT routes and the one native tool
// that serves each. Source files are checked so a renamed route or tool cannot
// leave the inventory claiming dispatch that no longer exists.
const SERVED=[
  ['GET /app/hook/config','github_app_webhook_configuration','app-jwt-read.js'],
  ['PATCH /app/hook/config','github_app_webhook_configuration_set','app-jwt-write.js'],
  ['GET /app/hook/deliveries','github_app_webhook_deliveries','app-jwt-read.js'],
  ['GET /app/hook/deliveries/{delivery_id}','github_app_webhook_deliveries','app-jwt-read.js'],
  ['POST /app/hook/deliveries/{delivery_id}/attempts','github_app_webhook_redeliver','app-jwt-write.js'],
  ['GET /app/installations/{installation_id}','github_app_owner_installation_grants','app-jwt-installation-governance.js'],
  ['GET /app/installation-requests','github_app_owner_installation_requests','app-jwt-installation-governance.js']
];

const inventory=buildCapabilityInventory({registryTools:registry.tools});
const row=route=>inventory.operations.find(o=>
  o.interface==='rest'&&o.operation.method+' '+o.operation.path===route);

describe('CAP-4 App-owner JWT route reconciliation',()=>{
  it.each(SERVED)('%s is served by exactly %s',(route,tool,file)=>{
    expect(curatedTool({route})).toBe(tool);
    expect(registry.tools.map(t=>t.name)).toContain(tool);
    const source=readFileSync(new URL('../../src/tools/'+file,import.meta.url),'utf8');
    expect(source).toContain("'"+route+"'");
    expect(source).toMatch(new RegExp("name:\\s*'"+tool+"'"));
  });

  it('records each served route as implemented but never verified or universal',()=>{
    for(const [route,tool] of SERVED){
      const r=row(route);
      expect(r,route).toBeTruthy();
      expect(r.state).toBe('implemented-unverified');
      expect(r.implementation).toMatchObject({status:'implemented-unverified',
        route:'curated',tool,source:'src/github/hand-built-map.js',
        universalCandidate:false});
      expect(r.delivery.externalAcceptance).toBe('pending');
    }
  });

  it('keeps GET /app unmapped because the identity tool is only a projection',()=>{
    expect(curatedTool({route:'GET /app'})).toBeNull();
    expect(row('GET /app').state).toBe('unresolved');
  });

  it('does not extend a mapping to sibling routes, methods or token minting',()=>{
    for(const route of ['PUT /app/hook/config','DELETE /app/hook/deliveries/{delivery_id}',
      'GET /app/installations','DELETE /app/installations/{installation_id}',
      'PUT /app/installations/{installation_id}/suspended',
      'DELETE /app/installations/{installation_id}/suspended',
      'POST /app/installations/{installation_id}/access_tokens']){
      expect(curatedTool({route}),route).toBeNull();
      const r=row(route);
      if(r) expect(r.state,route).toBe('unresolved');
    }
  });

  it('leaves the whole inventory valid with no orphan curated mapping',()=>{
    expect(()=>validateCapabilityInventory(inventory)).not.toThrow();
    expect(inventory.operations.filter(o=>
      /^Orphan curated tool mapping/.test(o.implementation.reason))).toEqual([]);
  });
});
