import {describe,it,expect} from 'vitest';
import {compareObservedScratchLabels} from '../../src/dev/label-drift.js';
const bug={id:11,name:'bug',color:'D73A4A',description:'First observed'};
const question={id:12,name:'question',color:'cfd3d7',description:null};
describe('V-2 first-observed labels and numeric-ID drift',()=>{
  it('detects later additions by ID even when a missing name was recreated',()=>{
    const found=compareObservedScratchLabels([bug,question],[
      question,{...bug,id:22},{id:25,name:'foreign',color:'aabbcc',description:null}]);
    expect(found).toMatchObject({initial_count:2,live_count:3,unchanged_count:1,
      exact_observation_unchanged:false,creator_provenance_verified:false,
      deletion_authorized:false});
    expect(found.added_after_observation.map(x=>x.id)).toEqual([22,25]);
    expect(found.missing_since_observation.map(x=>x.id)).toEqual([11]);
  });
  it('detects a repurposed label retaining the old numeric ID',()=>{
    const found=compareObservedScratchLabels([bug],[{...bug,name:'urgent',color:'ffffff'}]);
    expect(found.changed_since_observation[0]).toMatchObject({
      id:11,before:{name:'bug',color:'d73a4a'},after:{name:'urgent',color:'ffffff'}});
    expect(found.deletion_authorized).toBe(false);
  });
  it('never treats even fully unchanged default-looking labels as creator proof',()=>{
    expect(compareObservedScratchLabels([bug,question],[bug,question])).toMatchObject({
      exact_observation_unchanged:true,creator_provenance_verified:false,
      default_labels_owned_by_run:false,deletion_authorized:false,snapshot_atomic:false});
  });
  it('rejects duplicate ID, duplicate name and missing immutable identity',()=>{
    for(const data of [
      [bug,{...bug,id:40}],[bug,{...bug,name:'another'}],
      [{id:0,name:'invalid',color:'123456'}]
    ])expect(()=>compareObservedScratchLabels([bug],data)).toThrow();
  });
});
