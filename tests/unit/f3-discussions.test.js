import {describe,it,expect} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as discussions from '../../src/tools/discussions.js';
const ID='D_test_7',CAT='CAT_q',REP='R_a',COMMENT='DC_comment_9';
const D=(extra={})=>({id:ID,number:7,title:'Welcome',body:'Hello',url:'https://github.com/example-org/hello/discussions/7',
  repository:{nameWithOwner:'example-org/hello'},category:{name:'General',isAnswerable:true},
  author:{login:'example-owner'},answer:null,comments:{totalCount:0,pageInfo:{hasNextPage:false,endCursor:null},nodes:[]},...extra});
const repo=()=>({id:REP,nameWithOwner:'example-org/hello',discussionCategories:{
  totalCount:1,pageInfo:{hasNextPage:false},nodes:[{id:CAT,name:'General',isAnswerable:true}]}});
const list=(items)=>({repository:{discussions:{totalCount:items.length,
  pageInfo:{hasNextPage:false,endCursor:null},nodes:items}}});
const create={category:'General',title:'Welcome',body:'Hello',repo:'hello'};
const def=name=>({tool:discussions.tools.find(t=>t.name===name),handler:discussions.handlers[name]});
const ghResponse=(gh,outcome,action)=>{
  let written=false;
  gh.when('POST /graphql').reply(200,req=>{
    const q=req.body.query;
    if(q.includes('mutation')){
      written=true;
      if(action==='create')return {data:{createDiscussion:{discussion:D()}}};
      if(action==='comment')return {data:{addDiscussionComment:{comment:{
        id:COMMENT,body:'Hello reply',discussion:{id:ID}}}}};
      return {data:{markDiscussionCommentAsAnswer:{discussion:{
        id:ID,answer:{id:COMMENT}}}}};
    }
    if(q.includes('discussionCategories'))return {data:{repository:repo()}};
    if(q.includes('node(id:'))return {data:{node:{
      id:COMMENT,body:outcome==='ok'?'Hello reply':'Mismatch',author:{login:'example-owner'},
      discussion:{id:ID},url:'u'}}};
    if(q.includes('discussion(number:'))return {data:{repository:{discussion:
      D(action==='answer'&&written?{answer:outcome==='ok'?{id:COMMENT}:null}:outcome==='mismatch'&&action==='create'?{title:'Wrong'}:{})}}};
    return {data:list([D()])};
  });
};
runWriteContract({label:'github_discussion_create',definition:def('github_discussion_create'),
  args:create,needsConfirm:false,arrange:(gh,outcome)=>ghResponse(gh,outcome,'create')});
runWriteContract({label:'github_discussion_comment',definition:def('github_discussion_comment'),
  args:{repo:'hello',number:7,action:'comment',body:'Hello reply'},
  needsConfirm:true,arrange:(gh,outcome)=>ghResponse(gh,outcome,'comment')});
runWriteContract({label:'github_discussion_comment choose answer',definition:def('github_discussion_comment'),
  args:{repo:'hello',number:7,action:'answer',commentId:COMMENT},
  needsConfirm:true,arrange:(gh,outcome)=>ghResponse(gh,outcome,'answer')});
async function call(w,name,args){
  const run=createDispatch({credentials:w.credentials,gates:[],fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep});
  const result=await run({registry,name,args,connection:w.connection,db:w.db});
  return result.structuredContent??parse(result);
}
describe('F-3 discussions and verified relationships',()=>{
  it('lists discussions with actual GraphQL cursor metadata',async()=>{
    const w=await makeWorld();
    ghResponse(w.gh,'ok','create');
    const result=await call(w,'github_discussion_list',{repo:'hello',max:10});
    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({count:1,total_count:1,has_next_page:false});
    expect(w.gh.invalid).toEqual([]);
  });
  it('gets one discussion and reports its exact answer/comment count',async()=>{
    const w=await makeWorld();ghResponse(w.gh,'ok','comment');
    const result=await call(w,'github_discussion_get',{repo:'hello',number:7});
    expect(result).toMatchObject({number:7,id:ID,answer_id:null,comment_count:0});
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses an answer comment that belongs to a different discussion',async()=>{
    const w=await makeWorld();
    w.gh.when('POST /graphql').reply(200,request=>request.body.query.includes('node(id:')
      ?{data:{node:{id:COMMENT,body:'Hello reply',discussion:{id:'OTHER'},author:{login:'example-owner'}}}}
      :{data:{repository:{discussion:D()}}});
    const result=await call(w,'github_discussion_comment',{
      repo:'hello',number:7,action:'answer',commentId:COMMENT,confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.graphql.filter(x=>/^\s*mutation/.test(x.query))).toHaveLength(0);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a category that GitHub did not independently list',async()=>{
    const w=await makeWorld();ghResponse(w.gh,'ok','create');
    const result=await call(w,'github_discussion_create',{
      ...create,category:'Not available',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.graphql.filter(x=>/^\s*mutation/.test(x.query))).toHaveLength(0);
  });
});
