import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDispatch} from '../../src/tools/dispatch.js';
import {redact,containsCredential} from '../../src/tools/util.js';
import {scanText} from '../../scripts/check-secrets.mjs';

const pass=()=> 'rtc_pass_'+randomBytes(32).toString('base64url');
const tool={name:'github_fixture_read',annotations:{readOnlyHint:true},
  inputSchema:{type:'object',properties:{}}};
async function dispatch(handler,extra={}){
  const kept=[];
  const output=await createDispatch()({registry:{tools:[{...tool,...extra}],
    handlers:{[tool.name]:handler}},name:tool.name,args:{},
    connection:{client_id:'fixture',profile:'read_only',mode:'preview'},
    db:{putResult:async value=>kept.push(value)}});
  return {output,kept};
}
describe('RTC pass values cannot leave the service through results or errors',()=>{
  it('redacts embedded passes repeatedly, even beside non-word delimiters or text',()=>{
    const value=pass();
    for(let i=0;i<3;i++){
      expect(redact('prefix'+value+' tail '+value)).toBe('prefix[hidden] tail [hidden]');
      expect(containsCredential(value)).toBe(true);
      expect(containsCredential('ordinary text')).toBe(false);
    }
  });
  it('scrubs both wire copies and retained large results before storing',async()=>{
    const value=pass();
    const {output,kept}=await dispatch(async()=>({items:Array.from({length:200},
      (_,i)=>({n:i,body:'x'.repeat(100)+' '+value}))}));
    expect(output.isError).not.toBe(true);
    expect(kept).toHaveLength(1);
    expect(JSON.stringify({output,kept})).not.toContain(value);
    expect(kept[0].body.items[0].body).toContain('[hidden]');
  });
  it('withholds credentials below the shaping depth limit or in property names before retention',async()=>{
    const value=pass();
    let deep={body:value};
    for(let i=0;i<20;i++)deep={nested:deep};
    for(const raw of [deep,{[value]:'public value'}]){
      const {output,kept}=await dispatch(async()=>raw);
      expect(output.isError).toBe(true);
      expect(JSON.stringify(output)).not.toContain(value);
      expect(kept).toEqual([]);
    }
  });
  it('redacts handler and validation errors, and rejects unshaped registry-wrapper replies',async()=>{
    const value=pass();
    const failed=await dispatch(async()=>{throw new TypeError('Bad value '+value);});
    expect(failed.output.isError).toBe(true);
    expect(failed.output.content[0].text).toBe('Bad value [hidden]');
    const wrapped=await dispatch(async()=>({content:[{type:'text',text:value}],
      structuredContent:{body:value}}),{passthrough:true,usesRegistry:true});
    expect(wrapped.output.isError).toBe(true);
    expect(JSON.stringify(wrapped.output)).not.toContain(value);
    const invalid=await createDispatch()({registry:{tools:[tool],handlers:{[tool.name]:()=>{}}},
      name:tool.name,args:{[value]:true},connection:{profile:'read_only'}});
    expect(JSON.stringify(invalid)).not.toContain(value.slice(0,40));
  });
  it('rejects literal RTC values in source without printing payloads or allowing FAKE exemption',()=>{
    for(const value of [pass(),'rtc_pass_'+'FAKE'+'A'.repeat(39)]){
      const findings=scanText('example '+value);
      expect(findings).toEqual([{label:'RTC pass',line:1,preview:'rtc_pa'}]);
      expect(JSON.stringify(findings)).not.toContain(value);
    }
    expect(scanText('rtc_pass_'+'x'.repeat(42))).toEqual([]);
  });
});
