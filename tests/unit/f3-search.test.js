import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const R={
  code:'GET /search/code',issue:'GET /search/issues',
  pull_request:'GET /search/issues',commit:'GET /search/commits',
  repository:'GET /search/repositories',user:'GET /search/users'
};
const base={html_url:'https://github.com/example-org/hello',repository:{full_name:'example-org/hello'}};
const records={
  code:{...base,name:'index.js',path:'src/index.js',sha:'a'.repeat(40),
    text_matches:[{fragment:'A'.repeat(1000),matches:[{text:'A'.repeat(500)}]}]},
  issue:{...base,number:7,title:'Bug',state:'open',user:{login:'alice'}},
  pull_request:{...base,number:8,title:'Feature',state:'open',pull_request:{url:'url'},user:{login:'bob'}},
  commit:{...base,sha:'a'.repeat(40),commit:{message:'Commit content'},author:{login:'alice'}},
  repository:{full_name:'example-org/hello',private:true,description:'A repo',stargazers_count:13},
  user:{login:'alice',type:'User',html_url:'https://github.com/alice'}
};
async function call(w,args){
  const dispatch=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,gates:[]});
  const result=await dispatch({registry,name:'github_search_github',args,connection:w.connection,db:w.db});
  return result.structuredContent??parse(result);
}
describe('F-3 genuine GitHub REST search routes',()=>{
  for(const type of Object.keys(R)){
    it(`maps ${type} to the right GitHub route and bounds its projected data`,async()=>{
      const w=await makeWorld({});
      w.gh.when(R[type]).reply(200,{
        total_count:101,incomplete_results:false,items:[records[type]]
      });
      const got=await call(w,{type,query:'needle',max:20});
      expect(got).toMatchObject({type,count:1,total_count:101,page:1,more_possible:true});
      expect(got.items[0]).toBeDefined();
      expect(w.gh.calls.filter(x=>x.route===R[type])).toHaveLength(1);
      const request=w.gh.calls.find(x=>x.route===R[type]);
      expect(request.query).toMatchObject({per_page:'20',page:'1'});
      expect(request.query.q).toContain('needle');
      if(type==='issue')expect(request.query.q).toContain('is:issue');
      if(type==='pull_request')expect(request.query.q).toContain('is:pr');
      if(type==='code'){
        expect(got.items[0].fragments[0].fragment).toHaveLength(220);
        expect(got.items[0].fragments[0].matches[0]).toHaveLength(60);
      }
      expect(w.gh.invalid).toEqual([]);
    });
  }
  it('separates issues from pull requests even if GitHub mixes both kinds',async()=>{
    const w=await makeWorld({});
    w.gh.when(R.issue).reply(200,{total_count:2,incomplete_results:false,
      items:[records.issue,records.pull_request]});
    const result=await call(w,{type:'issue',query:'needle'});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].number).toBe(7);
  });
  it('marks incomplete results and the 1000-result API ceiling',async()=>{
    const w=await makeWorld({});
    w.gh.when(R.user).reply(200,{total_count:3400,incomplete_results:true,items:[records.user]});
    const result=await call(w,{type:'user',query:'needle',max:25});
    expect(result).toMatchObject({incomplete_results:true,github_result_cap:1000,more_possible:true});
  });
  it('rejects searches beyond the 1000-result page window before network',async()=>{
    const w=await makeWorld({});
    const result=await call(w,{type:'code',query:'needle',page:30,max:50});
    expect(result).toBeUndefined();
  });
});
