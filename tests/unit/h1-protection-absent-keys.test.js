import {describe,it,expect} from 'vitest';
import {normalizeProtection} from '../../src/tools/protection-write.js';

// Shape GitHub really returns for a branch whose only protection is "require conversation resolution": the three optional groups are omitted.
const real={url:'u',required_signatures:{enabled:false},enforce_admins:{enabled:false},required_linear_history:{enabled:false},
  allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},block_creations:{enabled:false},
  required_conversation_resolution:{enabled:true},lock_branch:{enabled:false},allow_fork_syncing:{enabled:false}};

describe('classic protection with omitted optional groups',()=>{
  it('treats omitted required checks, reviews and restrictions as not configured',()=>{
    const n=normalizeProtection(real);
    expect(n.required_status_checks).toBeNull();
    expect(n.required_pull_request_reviews).toBeNull();
    expect(n.restrictions).toBeNull();
    expect(n.required_conversation_resolution).toEqual({enabled:true});
  });
  it('keeps configured groups and does not invent anything else',()=>{
    const n=normalizeProtection({...real,required_status_checks:{strict:true,contexts:['ci'],checks:[]}});
    expect(n.required_status_checks).toEqual({strict:true,contexts:['ci'],checks:[]});
    expect(Object.keys(n).sort()).toEqual([...Object.keys(real),'required_status_checks','required_pull_request_reviews','restrictions'].sort());
    expect(normalizeProtection(null)).toBeNull();
  });
});
