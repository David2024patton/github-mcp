import {describe,expect,it} from 'vitest';
import {planDevCleanup} from '../../src/dev/cleanup.js';
const run={id:'run-clean-004',account:'example-org',connection:'client-a',status:'active'};
const item=(type,id,rest={})=>({run_id:run.id,object_type:type,owner:run.account,repo:'fixture',object_id:id,cleaned:false,...rest});
describe('V-2 exact run cleanup planning',()=>{
  it('sorts only recorded IDs, without deleting or inventing matches',()=>{
    const output=planDevCleanup({run,objects:[item('repo','example-org/fixture'),item('branch','rtc/run-clean-004/one'),item('pr','12'),item('label','rtc-run-run-clean-004')],intents:[{status:'recorded'}]});
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
  it('excludes completed objects on safe resume',()=>{
    expect(planDevCleanup({run:{...run,status:'cleaning'},objects:[item('repo','example-org/fixture',{cleaned:true})],intents:[]}).count).toBe(0);
  });
});
