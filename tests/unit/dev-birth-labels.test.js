import {describe,it,expect} from 'vitest';
import {captureScratchBirthLabels} from '../../src/dev/scratch-origin.js';

const owner='example-org',repo='scratch-one';
const observed={id:7,name:'question',color:'cfd3d7',description:null};
const source=(pages)=>({paginate:{iterator:async function*(){
  for(const page of pages)yield page;
}}});

describe('first-create scratch label observation',()=>{
  it('preserves exact IDs and metadata without conferring ownership or cleanup permission',async()=>{
    await expect(captureScratchBirthLabels(source([{data:[observed],headers:{}}]),{owner,repo,sleep:async()=>{}}))
      .resolves.toEqual([observed]);
  });
  it('fails closed on duplicate names, IDs or missing labels',async()=>{
    for(const data of [
      [observed,{...observed,id:8}],
      [observed,{...observed,name:'help'}],
      [{id:9,name:'oops',color:'invalid'}],
      [{name:'bug',color:'aabbcc'}]
    ]){
      await expect(captureScratchBirthLabels(source([{data,headers:{}}]),{owner,repo,sleep:async()=>{}}))
        .rejects.toThrow();
    }
  });
  it('refuses any unconsumed linked page when bounded at 100, without trusting a partial inventory',async()=>{
    const data=Array.from({length:100},(_,i)=>({...observed,id:i+1,name:`label-${i}`}));
    await expect(captureScratchBirthLabels(source([{
      data,headers:{link:'<https://api.github.com/next>; rel="next"'}
    }]),{owner,repo,sleep:async()=>{}})).rejects.toThrow(/incomplete/i);
  });
  it('rejects unreadable inventories without treating a failed request as zero labels',async()=>{
    await expect(captureScratchBirthLabels({
      paginate:{iterator:async function*(){throw new Error('403 permission denied');}}
    },{owner,repo,sleep:async()=>{}})).rejects.toThrow(/403/);
  });

  it('waits out delayed default-label seeding instead of recording GitHub’s first empty page',async()=>{
    const labels=[
      {...observed,id:7,name:'bug'},
      {...observed,id:8,name:'enhancement'}
    ];
    let calls=0,pauses=0;
    const gh={paginate:{iterator:async function*(){
      calls+=1;
      yield {data:calls===1?[]:calls===2?labels.slice(0,1):labels,headers:{}};
    }}};
    const captured=await captureScratchBirthLabels(gh,{owner,repo,sleep:async()=>{pauses+=1;}});
    expect(captured).toEqual(labels);
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(pauses).toBe(calls-1);
  });
  it('accepts an intentionally empty custom organization only after the entire unchanged observation window',async()=>{
    let reads=0;
    const gh={paginate:{iterator:async function*(){
      reads+=1;
      yield {data:[],headers:{}};
    }}};
    await expect(captureScratchBirthLabels(gh,{owner,repo,sleep:async()=>{}}))
      .resolves.toEqual([]);
    expect(reads).toBe(9);
  });
  it('refuses repeatedly changing first-create label inventories',async()=>{
    let reads=0;
    const gh={paginate:{iterator:async function*(){
      reads+=1;
      yield {data:[{...observed,id:reads}],headers:{}};
    }}};
    await expect(captureScratchBirthLabels(gh,{owner,repo,sleep:async()=>{}}))
      .rejects.toThrow(/stabilize/i);
    expect(reads).toBe(9);
  });
});
