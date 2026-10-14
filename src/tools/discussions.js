// F-3: native GitHub Discussions, verified categories, comments and answer links.
import { graphql } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain,readerFor } from './github-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { octo,ownerOf,refusal,slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUM={type:'integer',minimum:1},TITLE={type:'string',minLength:1,maxLength:256};
const BODY={type:'string',minLength:1,maxLength:20000};
const CAT={type:'string',minLength:1,maxLength:100};
const NODE={type:'string',minLength:1,maxLength:256};
const target=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo'});
const vars=t=>({owner:t.owner,repo:t.repo});
const listQuery=`query($owner:String!,$repo:String!,$first:Int!,$after:String,$category:ID){
  repository(owner:$owner,name:$repo){
    discussions(first:$first,after:$after,categoryId:$category){
      totalCount pageInfo{hasNextPage endCursor}
      nodes{id number title url category{name} answer{id} comments{totalCount} author{login}}
    }
  }
}`;
const getQuery=`query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    discussion(number:$number){
      id number title body url repository{nameWithOwner}
      category{name isAnswerable} author{login} answer{id}
      comments(first:20){totalCount pageInfo{hasNextPage endCursor}
        nodes{id body url author{login}}}
    }
  }
}`;
const categoriesQuery=`query($owner:String!,$repo:String!){
  repository(owner:$owner,name:$repo){
    id nameWithOwner discussionCategories(first:100){
      totalCount pageInfo{hasNextPage} nodes{id name isAnswerable}
    }
  }
}`;
const nodeQuery=`query($id:ID!){node(id:$id){
  ... on DiscussionComment{id body author{login} discussion{id} url}
}}`;
const createMutation=`mutation($repository:ID!,$category:ID!,$title:String!,$body:String!){
  createDiscussion(input:{repositoryId:$repository,categoryId:$category,title:$title,body:$body}){
    discussion{id number title body url repository{nameWithOwner}}
  }
}`;
const commentMutation=`mutation($discussion:ID!,$body:String!){
  addDiscussionComment(input:{discussionId:$discussion,body:$body}){
    comment{id body url discussion{id}}
  }
}`;
const answerMutation=`mutation($id:ID!){
  markDiscussionCommentAsAnswer(input:{id:$id}){
    discussion{id answer{id}}
  }
}`;
const getDiscussion=async(ctx,t,number)=>{
  const x=await graphql(await octo(ctx,t.owner),getQuery,{...vars(t),number});
  return x.repository?.discussion??null;
};
const brief=d=>({number:d.number,id:d.id,title:d.title,url:d.url,
  category:d.category?.name,author:d.author?.login,answer_id:d.answer?.id??null,
  comment_count:d.comments?.totalCount??null});
export const discussionList=defineRead({
  name:'github_discussion_list',area:'discussion',audience:['Op'],
  description:'List GitHub discussions with category and cursor pagination.',
  properties:{owner:OWNER,repo:REPO,categoryId:NODE,after:{type:'string',minLength:1,maxLength:512},
    max:{type:'integer',minimum:1,maximum:50}},required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit}=await readerFor(a,ctx);
    const x=await graphql(octokit,listQuery,{owner,repo:a.repo,first:a.max??20,
      after:a.after??null,category:a.categoryId??null});
    const d=x.repository?.discussions;
    if(!d||!Array.isArray(d.nodes)||!d.pageInfo)throw new TypeError('GitHub Discussions are unavailable for this repository.');
    return {total_count:d.totalCount,count:d.nodes.length,items:d.nodes.filter(Boolean).map(brief),
      has_next_page:!!d.pageInfo.hasNextPage,next_cursor:d.pageInfo.hasNextPage?d.pageInfo.endCursor:null};
  })
});
export const discussionGet=defineRead({
  name:'github_discussion_get',area:'discussion',audience:['Op'],
  description:'Read one GitHub discussion, its answer and a bounded page of comments.',
  properties:{owner:OWNER,repo:REPO,number:NUM},required:['repo','number'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit}=await readerFor(a,ctx);
    const x=await graphql(octokit,getQuery,{owner,repo:a.repo,number:a.number});
    const d=x.repository?.discussion;
    if(!d)return {not_found:a.number};
    return {...brief(d),body:d.body,comments:(d.comments?.nodes??[]).filter(Boolean).map(c=>({
      id:c.id,body:c.body,url:c.url,author:c.author?.login})),
      comments_has_next_page:!!d.comments?.pageInfo?.hasNextPage,
      comments_next_cursor:d.comments?.pageInfo?.hasNextPage?d.comments.pageInfo.endCursor:null};
  })
});
export const discussionCreate=defineGithubWrite({
  name:'github_discussion_create',area:'discussion',audience:['Op'],
  description:'Create a discussion in a verified GitHub category and independently read it back.',
  properties:{owner:OWNER,repo:REPO,category:CAT,title:TITLE,body:BODY},
  required:['repo','category','title','body'],
  declarations:{production:'never',notifies:true},target,
  read:async(a,ctx,t)=>{
    const x=await graphql(await octo(ctx,t.owner),categoriesQuery,vars(t));
    const repo=x.repository,cat=repo?.discussionCategories;
    if(!repo?.id||!cat||cat.pageInfo?.hasNextPage||!Array.isArray(cat.nodes)||cat.nodes.length!==cat.totalCount)
      throw refusal('Discussion categories or repository identity could not be completely verified.');
    const named=cat.nodes.filter(c=>c?.name?.toLowerCase()===a.category.toLowerCase());
    if(named.length!==1||!named[0].id)throw refusal('The requested discussion category is absent or ambiguous.');
    return {repoId:repo.id,categoryId:named[0].id};
  },
  classify:({args:a,ctx,target:t})=>notifyOutsiders(ctx,{text:`${a.title}\n${a.body}`,repoOwner:t.owner}),
  summarize:({args:a,target:t})=>`Create discussion "${a.title}" in ${slug(t.owner,t.repo)} category "${a.category}"`,
  apply:async({args:a,ctx,target:t,before:b})=>{
    const x=await graphql(await octo(ctx,t.owner),createMutation,{
      repository:b.repoId,category:b.categoryId,title:a.title,body:a.body});
    return {data:x.createDiscussion?.discussion??null};
  },
  readAfter:({ctx,target:t,response:r})=>r?.data?.number?
    getDiscussion(ctx,t,r.data.number):null,
  verify:({args:a,target:t,after:d,response:r})=>!!d&&d.id===r?.data?.id&&
    d.title===a.title&&d.body===a.body&&
    d.category?.name?.toLowerCase()===a.category.toLowerCase()&&
    d.repository?.nameWithOwner?.toLowerCase()===slug(t.owner,t.repo).toLowerCase(),
  inverse:()=>null,present:({after:d})=>brief(d)
});
export const discussionComment=defineGithubWrite({
  name:'github_discussion_comment',area:'discussion',audience:['Op'],
  description:'Comment on a discussion or mark its verified comment as the chosen answer.',
  properties:{owner:OWNER,repo:REPO,number:NUM,
    action:{type:'string',enum:['comment','answer']},body:BODY,commentId:NODE},
  required:['repo','number','action'],
  declarations:{production:'never',notifies:true,confirm:'always'},
  target:(a,ctx)=>{
    if(a.action==='comment'&&(!a.body||a.commentId))throw new TypeError('Comment requires body and no commentId.');
    if(a.action==='answer'&&(!a.commentId||a.body))throw new TypeError('Answer requires commentId and no body.');
    return target(a,ctx);
  },
  read:async(a,ctx,t)=>{
    const d=await getDiscussion(ctx,t,a.number);
    if(!d||!d.id||d.repository?.nameWithOwner?.toLowerCase()!==slug(t.owner,t.repo).toLowerCase())
      throw refusal('The discussion could not be verified in the target repository.');
    if(a.action==='comment')return {discussion:d};
    if(d.category?.isAnswerable!==true)throw refusal('This discussion category does not accept chosen answers.');
    const response=await graphql(await octo(ctx,t.owner),nodeQuery,{id:a.commentId});
    const c=response.node;
    if(!c||c.id!==a.commentId||c.discussion?.id!==d.id)
      throw refusal('The selected answer comment is not part of this discussion.');
    return {discussion:d,comment:c};
  },
  classify:({args:a,ctx,target:t,before:b})=>notifyOutsiders(ctx,{
    text:a.body??'',logins:b?.comment?.author?.login?[b.comment.author.login]:[],repoOwner:t.owner}),
  summarize:({args:a,target:t})=>a.action==='comment'
    ?`Comment on discussion #${a.number} in ${slug(t.owner,t.repo)}`
    :`Mark comment ${a.commentId} as the chosen answer to discussion #${a.number} in ${slug(t.owner,t.repo)}`,
  apply:async({args:a,ctx,target:t,before:b})=>{
    const gh=await octo(ctx,t.owner);
    const data=a.action==='comment'
      ?(await graphql(gh,commentMutation,{discussion:b.discussion.id,body:a.body})).addDiscussionComment?.comment
      :(await graphql(gh,answerMutation,{id:a.commentId})).markDiscussionCommentAsAnswer?.discussion;
    return {data:data??null};
  },
  readAfter:async({args:a,ctx,target:t,response:r})=>{
    if(a.action==='answer')return getDiscussion(ctx,t,a.number);
    if(!r?.data?.id)return null;
    return (await graphql(await octo(ctx,t.owner),nodeQuery,{id:r.data.id})).node??null;
  },
  verify:({args:a,before:b,after:x,response:r})=>a.action==='answer'
    ?!!x&&x.id===b.discussion.id&&x.answer?.id===a.commentId&&r?.data?.id===b.discussion.id
    :!!x&&x.id===r?.data?.id&&x.body===a.body&&x.discussion?.id===b.discussion.id,
  inverse:()=>null,
  present:({args:a,after:x})=>a.action==='answer'
    ?{discussion_number:a.number,answer_comment_id:x?.answer?.id??null}
    :{comment_id:x?.id??null,url:x?.url??null}
});
export const tools=[discussionList.tool,discussionGet.tool,discussionCreate.tool,discussionComment.tool];
export const handlers=Object.fromEntries([[discussionList.tool,discussionList.handler],
  [discussionGet.tool,discussionGet.handler],[discussionCreate.tool,discussionCreate.handler],
  [discussionComment.tool,discussionComment.handler]].map(([t,h])=>[t.name,h]));
