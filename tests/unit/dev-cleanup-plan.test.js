import {describe,expect,it} from 'vitest';
import {planDevCleanup} from '../../src/dev/cleanup.js';
const run={id:'run-clean-004',account:'example-org',connection:'client-a',status:'active'};
const item=(type,id,rest={})=>({run_id:run.id,object_type:type,owner:run.account,repo:'fixture',object_id:id,cleaned:false,...rest});
describe('V-2 exact run cleanup planning',()=>{
  it('sorts only recorded IDs, without deleting or inventing matches',()=>{
    const output=planDevCleanup({run,objects:[item('repo','example-org/fixture'),item('branch','rtc/run-clean-004/one'),item('pr','12'),item('label','rtc-run-run-clean-004')],intents:[{run_id:run.id,step_id:'seed',status:'recorded',object_type:'repo',owner:run.account,repo:'fixture',object_id:'example-org/fixture',created_sha:null}]});
    expect(output.entries.map(e=>e.type)).toEqual(['pr','branch','label','repo']);
    expect(output.requires_confirmation).toBe(true);expect(output.remote_verified).toBe(false);
  });
  it('refuses foreign, unknown, duplicate and truncated inventory',()=>{
    const root=item('repo','example-org/fixture');
    for(const objects of [
      [root,item('branch','other',{owner:'foreign'})],
      [root,item('branch','other',{run_id:'foreign'})],
      [root,item('branch','other',{repo:'different'})],
      [root,item('nonsense','other')],
      [root,item('repo','example-org/new',{repo:'new'})],
      [root,item('branch','one'),item('branch','one')]
    ]) expect(()=>planDevCleanup({run,objects,intents:[]})).toThrow();
    expect(()=>planDevCleanup({run,objects:[root],intents:[{status:'uncertain'}]})).toThrow(/reconciled/);
    expect(()=>planDevCleanup({run,objects:[root],intents:[],moreMayExist:true})).toThrow(/truncated/);
  });
  it('refuses orphaned, duplicate or mismatched journal intent records',()=>{
    const branch=item('branch','rtc/run-clean-004/a',{created_sha:'a'.repeat(40)});
    const step={run_id:run.id,step_id:'create-branch',status:'recorded',object_type:'branch',
      owner:run.account,repo:'fixture',object_id:branch.object_id,created_sha:'a'.repeat(40)};
    expect(planDevCleanup({run,objects:[branch],intents:[step]}).count).toBe(1);
    for(const bad of [
      {...step,run_id:'other-run'}, {...step,object_id:'rtc/run-clean-004/b'},
      {...step,created_sha:'b'.repeat(40)}, {...step,repo:'foreign'}
    ])expect(()=>planDevCleanup({run,objects:[branch],intents:[bad]})).toThrow();
    expect(()=>planDevCleanup({run,objects:[branch],intents:[step,step]})).toThrow();
    expect(()=>planDevCleanup({run,objects:[branch],intents:[{
      ...step,object_type:'repo',object_id:'missing'
    }]})).toThrow();
  });
  it('excludes completed objects on safe resume',()=>{
    expect(planDevCleanup({run:{...run,status:'cleaning'},objects:[item('repo','example-org/fixture',{cleaned:true})],intents:[]}).count).toBe(0);
  });
});
