import {describe,it,expect,vi} from 'vitest';
import {encryptSecret} from '../../src/core/crypto.js';
import {pilotAppClient} from '../../src/tenancy/pilot-app-client.js';

const key=Buffer.alloc(32,7),env={GITHUB_PILOT_APP_ID:'902',TOKEN_ENCRYPTION_KEY:key.toString('base64url')};
const sealed=(id=902)=>encryptSecret('FAKEappclientsecret',{
  key,aad:'github-mcp/app/'+id+'/client_secret'});
describe('private pilot service App configuration',()=>{
  it('opens only the configured service App client secret with its existing AAD',async()=>{
    const db={getApp:vi.fn(async()=>({id:902,client_id:'FAKEappclient',client_secret_enc:sealed()}))};
    expect(await pilotAppClient({env,db})).toEqual({clientId:'FAKEappclient',clientSecret:'FAKEappclientsecret'});
    expect(db.getApp.mock.calls.every(([id])=>id===902)).toBe(true);
  });
  it('preserves explicit settings and refuses partial pairs without trying storage',async()=>{
    const db={getApp:vi.fn()};
    expect(await pilotAppClient({env:{GITHUB_PILOT_APP_CLIENT_ID:'FAKEexplicit',
      GITHUB_PILOT_APP_CLIENT_SECRET:'FAKEexplicitsecret'},db})).toEqual({clientId:'FAKEexplicit',clientSecret:'FAKEexplicitsecret'});
    for(const partial of [{GITHUB_PILOT_APP_CLIENT_ID:'FAKEexplicit'},
      {GITHUB_PILOT_APP_CLIENT_SECRET:'FAKEexplicitsecret'}])
      await expect(pilotAppClient({env:{...env,...partial},db})).rejects.toThrow();
    expect(db.getApp).not.toHaveBeenCalled();
  });
  it('refuses missing, foreign and tampered App records and never selects a different App',async()=>{
    for(const row of [null,{id:903,client_id:'foreign',client_secret_enc:sealed(903)},
      {id:902,client_id:'FAKEappclient',client_secret_enc:sealed(903)},
      {id:902,client_id:'FAKEappclient',client_secret_enc:'v1.invalid'}]){
      const db={getApp:vi.fn(async()=>row)};
      await expect(pilotAppClient({env,db})).rejects.toThrow();
      expect(db.getApp.mock.calls.every(([id])=>id===902)).toBe(true);
    }
  });
});
