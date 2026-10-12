import {describe,it,expect} from 'vitest';
import {createDb,SCHEMA_TABLES} from '../../src/db.js';
import {renderSetup} from '../../src/github/setup-html.js';
describe('RTC pass issuance metadata and setup isolation',()=>{
  it('provides an owner form with one-time read-only pass issuance and revocation',()=>{
    const html=renderSetup({csrf:'x'.repeat(43)});
    expect(html).toContain('create-rtc-pass');
    expect(html).toContain('revoke-rtc-pass');
    expect(html).toContain('read-only');
    expect(html).not.toContain('rtc_pass_');
  });
  it('requires the atomic rate table in the initialized schema',()=>{
    expect(SCHEMA_TABLES).toContain('rtc_pass_rate');
    expect(typeof createDb).toBe('function');
  });
});
