import {describe,expect,it} from 'vitest';
import {matchesRunDescription,matchesRunFooter} from '../../src/dev/run-marker.js';

describe('exact development-run marker ownership',()=>{
  it('accepts generated repository, release and PR marker formats',()=>{
    expect(matchesRunDescription('Developer fixture for rtc_run=run-foo (repo-basic)','run-foo')).toBe(true);
    expect(matchesRunDescription('Draft-only release fixture rtc_run=run-foo','run-foo')).toBe(true);
    expect(matchesRunDescription('rtc_run=run-foo','run-foo')).toBe(true);
    expect(matchesRunFooter('Run-owned fixture.\n\n<!-- rtc_run=run-foo -->','run-foo')).toBe(true);
  });
  it('refuses longer run IDs and substring lookalikes',()=>{
    for(const text of ['rtc_run=run-foobar','Developer fixture rtc_run=run-foo-other (scenario)',
      'prefixrtc_run=run-foo','rtc_run=run-foo_more','rtc_run=run-foo/foreign']) {
      expect(matchesRunDescription(text,'run-foo')).toBe(false);
    }
    expect(matchesRunFooter('<!-- rtc_run=run-foo-other -->','run-foo')).toBe(false);
    expect(matchesRunFooter('rtc_run=run-foo','run-foo')).toBe(false);
    expect(matchesRunFooter('<!-- rtc_run=run-foo-extra -->','run-foo')).toBe(false);
  });
  it('refuses malformed run IDs and non-string GitHub responses',()=>{
    for(const run of ['','ALL-RUNS','run_foo','x']) {
      expect(matchesRunDescription('rtc_run='+run,run)).toBe(false);
      expect(matchesRunFooter('<!-- rtc_run='+run+' -->',run)).toBe(false);
    }
    expect(matchesRunDescription(null,'run-foo')).toBe(false);
    expect(matchesRunFooter({body:'<!-- rtc_run=run-foo -->'},'run-foo')).toBe(false);
  });
  it('accepts the full footer but rejects partial HTML comments',()=>{
    expect(matchesRunFooter('<!-- rtc_run=run-foo -->','run-foo')).toBe(true);
    expect(matchesRunFooter('<!-- rtc_run=run-foo --> extra','run-foo')).toBe(true);
    expect(matchesRunFooter('<!-- rtc_run=run-foo-->','run-foo')).toBe(false);
    expect(matchesRunFooter('<!-- rtc_run=run-foo-1 -->','run-foo')).toBe(false);
  });
});
