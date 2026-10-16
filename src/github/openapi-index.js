// U-1: pinned REST description is loaded only when a universal tool is used.
// This is the production counterpart of the vendored request-shape test adapter.
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const LOCATION = new URL('../../vendor/github-openapi/api.github.com.2026-03-10.json', import.meta.url);
const METHODS = ['get','post','put','patch','delete','head','options'];
let source, operations, byRoute, byId, ajv;
const compiled = new Map();
const MAX_PARAMETERS = 60;

function nullable(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(nullable); return; }
  for (const value of Object.values(node)) nullable(value);
  if (node.nullable === true && node.type === undefined && !node.$ref) {
    const { nullable: unused, ...remaining } = node;
    void unused;
    for (const key of Object.keys(node)) delete node[key];
    node.anyOf = [remaining, { type: 'null' }];
  }
}
function document() {
  if (!source) {
    source = JSON.parse(readFileSync(LOCATION,'utf8'));
    if (source.openapi !== '3.0.3' || !source.paths || !source.components)
      throw new TypeError('Pinned REST description is missing or invalid.');
    nullable(source.components);
    for (const path of Object.values(source.paths)) nullable(path);
  }
  return source;
}
function deref(input) {
  let node = input;
  const seen = new Set();
  while (node && typeof node === 'object' && node.$ref) {
    if (!node.$ref.startsWith('#/')) throw new TypeError('External OpenAPI references are not permitted.');
    if (seen.has(node.$ref)) throw new TypeError('Circular OpenAPI reference.');
    seen.add(node.$ref);
    node = node.$ref.slice(2).split('/').reduce((v,p) => v?.[p.replace(/~1/g,'/').replace(/~0/g,'~')], document());
  }
  return node;
}
export function restOperations() {
  if (operations) return operations;
  operations = [];
  for (const [path,item] of Object.entries(document().paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      operations.push(Object.freeze({
        route: method.toUpperCase()+' '+path,
        method: method.toUpperCase(),path,operationId:operation.operationId,
        summary:operation.summary??'',category:operation['x-github']?.category??'',
        notifies:operation['x-github']?.triggersNotification===true,
        deprecated:operation.deprecated===true, operation, pathItem:item
      }));
    }
  }
  byRoute = new Map(operations.map(o=>[o.route,o]));
  byId = new Map(operations.filter(o=>o.operationId).map(o=>[o.operationId,o]));
  return operations;
}
export function restOperation(selector, expectedMethod) {
  if (typeof selector!=='string' || selector.length>240) throw new TypeError('Specify a pinned REST operation ID or METHOD /path.');
  restOperations();
  const op=byRoute.get(selector.trim())??byId.get(selector.trim());
  if (!op || (expectedMethod && !(Array.isArray(expectedMethod)?expectedMethod:[expectedMethod]).includes(op.method)))
    throw new TypeError('That method/operation is not available for this REST tool in the pinned API version.');
  return op;
}
export function restParameters(op) {
  const merged=new Map();
  for (const raw of [...(op.pathItem.parameters??[]),...(op.operation.parameters??[])]) {
    const p=deref(raw);
    if (!p || !p.name || !p.in) throw new TypeError('Malformed pinned operation parameter.');
    merged.set(p.in+':'+p.name,p);
  }
  return [...merged.values()];
}
function schemaAjv() {
  if (!ajv) {
    ajv=new Ajv({strict:false,allErrors:true,allowUnionTypes:true,coerceTypes:false});
    addFormats(ajv);
    ajv.addSchema(document(),'gh');
  }
  return ajv;
}
function compiledValidator(id,schema) {
  if (!compiled.has(id)) compiled.set(id,schemaAjv().compile(schema));
  return compiled.get(id);
}
function pointer(path) { return path.replace(/~/g,'~0').replace(/\//g,'~1'); }
function topProperties(schema,seen=new Set()) {
  const node=deref(schema);
  if (!node || seen.has(node)) return new Set();
  seen.add(node);
  if (node.additionalProperties===true || (node.additionalProperties && typeof node.additionalProperties==='object')) return null;
  const result=new Set(Object.keys(node.properties??{}));
  for (const key of ['allOf','anyOf','oneOf']) {
    for (const child of node[key]??[]) {
      const fields=topProperties(child,seen);
      if (fields===null) return null;
      for (const name of fields) result.add(name);
    }
  }
  return result;
}
const errors=(label,validate)=> (validate.errors??[]).slice(0,6).map(x=>label+(x.instancePath||'')+' '+x.message+(x.params?.additionalProperty?' ('+x.params.additionalProperty+')':'')).join('; ');
function assertSchema(label,validate,value) {
  if (!validate(value)) throw new TypeError('Pinned GitHub '+errors(label,validate));
}
function assertSimpleObject(value,label) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(label+' must be an object.');
}
export function validateRest(op,params={},body) {
  assertSimpleObject(params,'Operation parameters');
  if (Object.keys(params).length>MAX_PARAMETERS) throw new TypeError('Too many operation parameters.');
  const accepted=restParameters(op);
  const allowed=new Set(accepted.filter(p=>p.in==='path'||p.in==='query').map(p=>p.name));
  for(const name of Object.keys(params)) if(!allowed.has(name)) throw new TypeError('Unknown path/query parameter '+name+'.');
  for(const p of accepted.filter(p=>p.in==='path')) {
    if(params[p.name]===undefined || params[p.name]===null || params[p.name]==='')
      throw new TypeError('Missing required path parameter '+p.name+'.');
  }
  for(const area of ['path','query']) {
    const ps=accepted.filter(p=>p.in===area);
    const value=Object.fromEntries(ps.filter(p=>params[p.name]!==undefined).map(p=>[p.name,params[p.name]]));
    const schema={type:'object',properties:Object.fromEntries(ps.map(p=>[p.name,deref(p.schema)??{}])),
      required:ps.filter(p=>p.required).map(p=>p.name),additionalProperties:false};
    assertSchema(area,compiledValidator(area+':'+op.route,schema),value);
  }
  const request=deref(op.operation.requestBody);
  const json=request?.content?.['application/json'];
  if (body===undefined || body===null) {
    if(request?.required) throw new TypeError('This operation requires a JSON body.');
  } else {
    assertSimpleObject(body,'JSON body');
    if(!json?.schema) throw new TypeError('This operation has no supported JSON request body.');
    const allowedFields=topProperties(json.schema);
    if (allowedFields) for(const field of Object.keys(body))
      if (!allowedFields.has(field)) throw new TypeError('Unknown JSON body field '+field+'.');
    const schema={$ref:'gh#/paths/'+pointer(op.path)+'/'+op.method.toLowerCase()+'/requestBody/content/application~1json/schema'};
    assertSchema('body',compiledValidator('body:'+op.route,schema),body);
  }
  return Object.freeze({...params,...(body??{})});
}
export function describeRest(op) {
  const params=restParameters(op).filter(p=>p.in==='path'||p.in==='query').map(p=>({
    name:p.name,in:p.in,required:!!p.required,type:deref(p.schema)?.type??null,
    description:String(p.description??'').slice(0,180)
  }));
  const request=deref(op.operation.requestBody);
  const body=request?.content?.['application/json']?.schema;
  return {operationId:op.operationId,method:op.method,path:op.path,summary:op.summary,
    category:op.category,deprecated:op.deprecated,triggersNotification:op.notifies,
    parameters:params,body:body?{required:!!request.required,fields:[...(topProperties(body)??[])].slice(0,100)}:null,
    responses:Object.keys(op.operation.responses??{}).slice(0,25)};
}
