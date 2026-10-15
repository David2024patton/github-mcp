import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {APP_READINESS_IDS,DEFAULT_PROJECTS,validateProjectProfile,
  containsRepo} from '../../src/data/profile-schema.js';
import {productionReason} from '../../src/tools/production-guard.js';
import {protectedResourceGate} from '../../src/tools/protect-guard.js';
import {registry} from '../../src/tools/index.js';
import * as profiles from '../../src/tools/profiles.js';

const app=DEFAULT_PROJECTS.find(x=>x.id==='appliance-desk');
const servers=DEFAULT_PROJECTS.find(x=>x.id==='robinson-servers');
const appliance={owner:'christcr2012',repo:'appliance-desk',scope:'repo'};
const policy=()=>createFakeDb();

describe('P-1 project policy persistence and version contract',()=>{
  it('validates both seeds and links each G1-G20 existing audit row',()=>{
    expect(DEFAULT_PROJECTS.map(p=>validateProjectProfile(p).id)).toEqual([
      'appliance-desk','robinson-servers']);
    expect(app.repos).toContain('christcr2012/appliance-desk');
    expect(servers.repos).toHaveLength(6);
    const document=readFileSync(new URL('../../docs/APP-NEEDS-APPLIANCE-DESK.md',
      import.meta.url),'utf8');
    for(const id of APP_READINESS_IDS){
      expect(app.readiness.find(x=>x.id===id)?.tool).toMatch(/^github_/);
      expect(document).toContain('| '+id+' |');
    }
    expect(app.ownedRefs.find(x=>x.pattern==='live').managedBy).toBe('daily-live.yml');
    expect(app.ownedRefs.find(x=>x.pattern==='transfer/**').agentMay)
      .toEqual(['create-from-default','commit-files']);
  });
  it('rejects unversioned or permissive/malformed policies',()=>{
    for(const patch of [
      {schemaVersion:99}, {ownedRefs:[{pattern:'live',managedBy:'workflow.yml',agentMay:['delete']}]},
      {repos:['other/repo']},{productionBranches:['bad pattern']},
      {readiness:[]},{source:{...app.source,verifiedMainSha:'abc'}}
    ])expect(()=>validateProjectProfile({...app,...patch})).toThrow();
    expect(()=>validateProjectProfile({...app,completelyUnknown:true})).toThrow();
  });
  it('creates both rows exactly once, preserving checked owner revision across initSchema',async()=>{
    const db=policy();
    await db.initSchema();
    expect(await db.listTables()).toContain('known_projects');
    expect((await db.listKnownProjects()).map(x=>x.version)).toEqual([1,1]);
    const old=await db.getKnownProject('appliance-desk');
    const edited={...old.profile,notes:'Owner-approved synthetic policy note'};
    const changed=await db.saveKnownProject(edited,old.version);
    expect(changed.version).toBe(2);
    await db.initSchema();
    expect((await db.getKnownProject('appliance-desk')).profile.notes).toBe(edited.notes);
    expect(await db.saveKnownProject(edited,old.version)).toBeNull();
    expect((await db.listKnownProjects())).toHaveLength(2);
  });
  it('rejects overlapping active policies but ignores unrelated or retired profiles',async()=>{
    const db=policy();await db.initSchema();
    expect(await db.profileForRepository('somebody','untracked')).toBeNull();
    expect(await db.profileForRepository('christcr2012','appliance-desk'))
      .toMatchObject({id:'appliance-desk'});
    const row=await db.getKnownProject('robinson-servers');
    await db.saveKnownProject({...row.profile,repos:[...row.profile.repos,
      'christcr2012/appliance-desk']},row.version);
    await expect(db.profileForRepository('christcr2012','appliance-desk'))
      .rejects.toThrow(/Overlapping/);
  });
});
describe('P-1 live production / project ownership integration',()=>{
  it('treats Appliance Desk live as production from stored profile without any GitHub calls',async()=>{
    const w=await makeWorld();await w.db.initSchema();
    const reason=await productionReason(w.ctx,{...appliance,ref:'live'});
    expect(reason).toMatch(/production/);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('blocks direct writes to the daily-live workflow ref and names its owner',async()=>{
    const w=await makeWorld();await w.db.initSchema();
    const gate=protectedResourceGate();
    const args={name:'github_git_update_ref',args:{},ctx:w.ctx,
      target:{...appliance,ref:'live'},classification:{}};
    expect((await gate(args)).refuse).toContain('daily-live.yml');
    expect((await gate({...args,args:{outsideProject:true}})).confirm)
      .toContain('daily-live.yml');
  });
  it('allows only the two approved transfer agent operations',async()=>{
    const w=await makeWorld();await w.db.initSchema();
    const gate=protectedResourceGate();
    const context={args:{},ctx:w.ctx,target:{...appliance,ref:'transfer/123'},
      classification:{}};
    for(const name of ['github_branch_create','github_content_push_files'])
      expect(await gate({...context,name})).toBeNull();
    for(const name of ['github_branch_delete','github_git_update_ref'])
      expect((await gate({...context,name})).refuse).toContain('sandbox-publish.yml');
  });
  it('leaves unrelated repositories without extra profile restrictions',async()=>{
    const w=await makeWorld();await w.db.initSchema();
    expect(containsRepo(app,'someone','other')).toBe(false);
    const gate=protectedResourceGate();
    expect(await gate({name:'github_git_update_ref',args:{},ctx:w.ctx,
      target:{owner:'external',repo:'untracked',ref:'feature',scope:'repo'},
      classification:{}})).toBeNull();
  });
  it('does not silently bypass a failed policy lookup',async()=>{
    const w=await makeWorld();
    w.ctx.db.profileForRepository=async()=>{throw Error('db unavailable');};
    expect(await productionReason(w.ctx,{...appliance,ref:'feature'}))
      .toContain('treated as production');
    await expect(protectedResourceGate()({name:'github_git_update_ref',
      args:{},ctx:w.ctx,target:{...appliance,ref:'live'},classification:{}}))
      .rejects.toThrow('db unavailable');
  });
});
describe('P-1 profile read tools',()=>{
  it('registers only the two predefined reads',()=>{
    expect(profiles.tools.map(x=>x.name)).toEqual(['github_profile_list','github_profile_get']);
    for(const x of profiles.tools)expect(registry.tools.map(y=>y.name)).toContain(x.name);
  });
  it('returns distinct source revisions, scoped get and a bounded listing',async()=>{
    const w=await makeWorld();await w.db.initSchema();
    const l=await profiles.handlers.github_profile_list({max:1},w.ctx);
    expect(l.profiles).toHaveLength(1);expect(l.complete).toBe(false);
    const g=await profiles.handlers.github_profile_get({project:'appliance-desk'},w.ctx);
    expect(g.profile.readiness).toHaveLength(20);
    expect(g.read_only).toBe(true);expect(g.version).toBe(1);
    await expect(profiles.handlers.github_profile_get({project:'missing'},w.ctx))
      .rejects.toThrow();
  });
});
