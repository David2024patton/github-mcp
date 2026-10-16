// U-2: validate GraphQL against the pinned official SDL before any provider request.
// Never use text matching to decide whether a document reads or writes.
import {readFileSync} from 'node:fs';
import {buildSchema,parse,validate,getVariableValues,getNamedType,isListType,isNonNullType,Kind,valueFromASTUntyped} from 'graphql';

const SOURCE=new URL('../../vendor/github-graphql/schema.docs.graphql',import.meta.url);
let pinned=null;
export function githubGraphqlSchema(){
  if(!pinned)pinned=buildSchema(readFileSync(SOURCE,'utf8'),{assumeValidSDL:true,assumeValid:true});
  return pinned;
}
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const MAX_BYTES=24_000,MAX_VARS=48,MAX_DEPTH=14;
const refuse=message=>{throw new TypeError('Pinned GitHub GraphQL: '+message);};

function documentFor(source,variables,kind){
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source,'utf8')>MAX_BYTES)
    refuse('document must be nonempty and at most '+MAX_BYTES+' bytes.');
  if(!object(variables)||Object.keys(variables).length>MAX_VARS)
    refuse('variables must be a bounded object.');
  let ast;
  try{ast=parse(source,{noLocation:true,maxTokens:8000});}
  catch(error){refuse('syntax: '+error.message);}
  const schema=githubGraphqlSchema();
  const problems=validate(schema,ast);
  if(problems.length)refuse(problems.slice(0,4).map(x=>x.message).join('; '));
  const ops=ast.definitions.filter(x=>x.kind===Kind.OPERATION_DEFINITION);
  if(ops.length!==1)refuse('exactly one operation is required; no batched or hidden operations.');
  if(ast.definitions.some(x=>x.kind===Kind.OPERATION_DEFINITION&&x.operation!==kind))
    refuse('a '+kind+' tool cannot contain another operation type.');
  const operation=ops[0];
  if(operation.operation!==kind)refuse(kind+' document required.');
  const names=new Set(operation.variableDefinitions?.map(x=>x.variable.name.value));
  if(Object.keys(variables).some(x=>!names.has(x)))refuse('variables contain undeclared names.');
  const values=getVariableValues(schema,operation.variableDefinitions??[],variables,{maxErrors:4});
  if(values.errors?.length)refuse(values.errors.map(x=>x.message).join('; '));
  const fragments=new Map(ast.definitions.filter(x=>x.kind===Kind.FRAGMENT_DEFINITION).map(x=>[x.name.value,x]));
  if(!values.variableValues?.coerced)refuse('typed variable coercion failed closed.');
  return {source,variables:values.variableValues.coerced,schema,ast,operation,fragments};
}
function evaluate(value,variables){
  return valueFromASTUntyped(value,variables);
}
function collectSelections(selectionSet,fragments,stack=new Set()){
  const fields=[];
  for(const item of selectionSet?.selections??[]){
    if(item.kind===Kind.FIELD){fields.push(item);continue;}
    if(item.kind===Kind.INLINE_FRAGMENT){
      fields.push(...collectSelections(item.selectionSet,fragments,stack));
      continue;
    }
    if(item.kind===Kind.FRAGMENT_SPREAD){
      const name=item.name.value;
      const fragment=fragments.get(name);
      if(!fragment)refuse('unknown fragment '+name);
      if(stack.has(name))refuse('recursive fragment '+name);
      const next=new Set(stack);next.add(name);
      fields.push(...collectSelections(fragment.selectionSet,fragments,next));
    }
  }
  return fields;
}
export function inspectGraphql(source,variables={},kind='query'){
  if(!['query','mutation'].includes(kind))refuse('unsupported operation type.');
  const entry=documentFor(source,variables,kind);
  const roots=collectSelections(entry.operation.selectionSet,entry.fragments);
  if(kind==='mutation' && roots.length!==1)
    refuse('exactly one root mutation field is allowed, including aliases and fragments.');
  if(kind==='mutation'&&roots[0]?.name.value.startsWith('__'))
    refuse('introspection cannot change resources.');
  const {points,nodes,connections}=estimateGraphql(entry);
  if(kind==='query'&&(points>500||nodes>500000))
    refuse('query exceeds 500 points or 500,000 nodes; use smaller first/last pages.');
  const mutation=kind==='mutation'?roots[0].name.value:null;
  const input=kind==='mutation'?
    Object.fromEntries(roots[0].arguments.map(a=>[a.name.value,evaluate(a.value,entry.variables)])):null;
  return {...entry,mutation,input,points,nodes,connections};
}
// Fail closed on unbounded connection, unknown pagination, unsafe nesting or integer overflow.
// A conservative overestimate may reject large queries; it cannot understate an
// explicitly paginated nested connection merely because it lives in a fragment.
export function estimateGraphql(entry){
  const {schema,operation,variables,fragments}=entry;
  const rootType=operation.operation==='mutation'?schema.getMutationType():schema.getQueryType();
  let nodes=0,points=1,connections=0,fieldsVisited=0;
  const safe=(n,why)=>{
    if(!Number.isSafeInteger(n)||n<0||n>1e9)refuse('unbounded '+why+'.');
    return n;
  };
  // Follow each fragment with its schema type condition, not the interface's
  // fields. This includes aliases and inline fragments nested in connections.
  function visitSelection(set,type,parentCount,depth,trail){
    if(depth>MAX_DEPTH)refuse('selection nesting exceeds '+MAX_DEPTH+'.');
    for(const item of set?.selections??[]){
      if(item.kind===Kind.FRAGMENT_SPREAD){
        const name=item.name.value,fragment=fragments.get(name);
        if(!fragment||trail.has(name))refuse('unknown or recursive fragment '+name);
        const next=new Set(trail);next.add(name);
        visitSelection(fragment.selectionSet,schema.getType(fragment.typeCondition.name.value),parentCount,depth+1,next);
        continue;
      }
      if(item.kind===Kind.INLINE_FRAGMENT){
        const branch=item.typeCondition?schema.getType(item.typeCondition.name.value):type;
        visitSelection(item.selectionSet,branch,parentCount,depth+1,trail);
        continue;
      }
      if(item.kind!==Kind.FIELD)refuse('unexpected GraphQL selection.');
      if(++fieldsVisited>1500)refuse('too many expanded fields.');
      if(item.name.value==='__typename')continue;
      const def=type?.getFields?.()?.[item.name.value];
      if(!def)refuse('field unavailable in pinned schema: '+item.name.value);
      const named=getNamedType(def.type);
      const conn=/Connection$/.test(named.name);
      let t=def.type;while(isNonNullType(t))t=t.ofType;
      const list=isListType(t);
      const args=Object.fromEntries(item.arguments?.map(a=>[a.name.value,evaluate(a.value,variables)])??[]);
      let multiplier=parentCount;
      if(conn||list){
        const first=args.first,last=args.last;
        if(conn && ((first===undefined)===(last===undefined)))
          refuse('connections require exactly one first or last page bound.');
        const page=conn?(first??last):100;
        if(!Number.isInteger(page)||page<1||page>100)
          refuse('page size must be from 1 to 100.');
        multiplier=safe(parentCount*page,'nested list');
        if(conn){connections++;points=safe(points+Math.ceil(multiplier/100),'query points');}
      }
      nodes=safe(nodes+multiplier,'response nodes');
      if(nodes>500000||points>500)
        refuse('query exceeds 500 points or 500,000 nodes; use smaller pages.');
      if(item.selectionSet)visitSelection(item.selectionSet,named,multiplier,depth+1,trail);
    }
  }
  visitSelection(operation.selectionSet,rootType,1,0,new Set());
  return {points,nodes,connections};
}
export function graphqlRootSelections(entry){
  return collectSelections(entry.operation.selectionSet,entry.fragments);
}
export function graphqlSelectionFields(entry){
  return graphqlRootSelections(entry).map(x=>({name:x.name.value,alias:x.alias?.value??null}));
}
