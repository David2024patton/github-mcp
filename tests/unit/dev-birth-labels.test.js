import {describe,it,expect} from 'vitest';
import {captureScratchBirthLabels} from '../../src/dev/scratch-origin.js';

const owner='example-org',repo='scratch-one';
const observed={id:7,name:'question',color:'cfd3d7',description:null};
const source=(pages)=>({paginate:{iterator:async function*(){
  for(const page of pages)yield page;
}}});

describe('first-create scratch label observation',()=>{
  it('preserves exact IDs and metadata without conferring ownership or cleanup permission',async()=>{
    await expect(captureScratchBirthLabels(source([{data:[observed],headers:{}}]),{owner,repo}))
      .resolves.toEqual([observed]);
  });
  it('fails closed on duplicate names, IDs or missing labels',async()=>{
    for(const data of [
      [observed,{...observed,id:8}],
      [observed,{...observed,name:'help'}],
      [{id:9,name:'oops',color:'invalid'}],
      [{name:'bug',color:'aabbcc'}]
    ]){
      await expect(captureScratchBirthLabels(source([{data,headers:{}}]),{owner,repo}))
        .rejects.toThrow();
    }
  });
  it('refuses any unconsumed linked page when bounded at 100, without trusting a partial inventory',async()=>{
    const data=Array.from({length:100},(_,i)=>({...observed,id:i+1,name:`label-${i}`}));
    await expect(captureScratchBirthLabels(source([{
      data,headers:{link:'<https://api.github.com/next>; rel="next"'}
    }]),{owner,repo})).rejects.toThrow(/incomplete/i);
  });
  it('rejects unreadable inventories without treating a failed request as zero labels',async()=>{
    await expect(captureScratchBirthLabels({
      paginate:{iterator:async function*(){throw new Error('403 permission denied');}}
    },{owner,repo})).rejects.toThrow(/403/);
  });
});
