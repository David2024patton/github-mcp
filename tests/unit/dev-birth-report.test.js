import {describe,it,expect} from 'vitest';
import {summarizeScratchBirth} from '../../src/dev/birth-report.js';

const id='run-birth-report',owner='example-org',repo='scratch';
const sha='e'.repeat(40),full=`${owner}/${repo}`;
const run={id,account:owner,connection:'client-1'};
const root={run_id:id,object_type:'repo',owner,repo,object_id:full,created_sha:sha};
const intent={run_id:id,step_id:'seed-repo',object_type:'repo',owner,repo,
  object_id:full,created_sha:sha,status:'recorded'};
const birth={owner,repo,source_sha:sha,labels:[{id:3,name:'bug',color:'ff0000',description:null}]};
const args={run,objects:[root],intents:[intent],birth,listingComplete:true};

describe('read-only first-create evidence report: no deletion authority',()=>{
  it('reports only intact scoped journal binding and optional exact metadata',()=>{
    expect(summarizeScratchBirth(args)).toMatchObject({
      state:'recorded_observation',journal_binding_verified:true,
      observed_label_count:1,delete_authority:false,
      origin_provenance_verified:false,remote_readback_verified:false
    });
    expect(summarizeScratchBirth(args).observed_labels).toBeUndefined();
    expect(summarizeScratchBirth({...args,includeLabels:true}).observed_labels).toEqual(birth.labels);
  });
  it('refuses to claim a verified binding on missing, capped, changed or foreign records',()=>{
    const cases=[
      {...args,birth:null},
      {...args,listingComplete:false},
      {...args,objects:[{...root,created_sha:'f'.repeat(40)}]},
      {...args,objects:[{...root,owner:'other-org'}]},
      {...args,intents:[{...intent,status:'uncertain'}]},
      {...args,objects:[root,{...root,object_id:'example-org/other'}]},
      {...args,birth:{...birth,owner:'other-org'}},
      {...args,birth:{...birth,source_sha:'c'.repeat(40)}}
    ];
    for(const input of cases){
      const result=summarizeScratchBirth(input);
      expect(result.journal_binding_verified??false).toBe(false);
      expect(result.delete_authority).toBe(false);
      expect(result.origin_provenance_verified).toBe(false);
    }
  });
  it('does not return malformed or duplicate label IDs as if proven',()=>{
    expect(()=>summarizeScratchBirth({...args,birth:{...birth,labels:[
      birth.labels[0],birth.labels[0]]}})).toThrow();
  });
});
