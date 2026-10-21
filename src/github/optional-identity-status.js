// CAP-3: status of extra GitHub credentials enrolled on the owner's
// PROTECTED setup page. Hashes compare encrypted values, not raw bearers.
// These records prove an actor identity at setup time, NOT permissions.
import { createHash } from 'node:crypto';
const KINDS=Object.freeze({
  F:'fine_grained_enc',P:'package_enc',K:'classic_enc'
});
export function optionalCredentialIdentityStatus({account,proofs={},now=Date.now()}) {
  const result={};
  for(const [kind,column] of Object.entries(KINDS)){
    const ciphertext=account?.[column];
    const proof=proofs?.[kind];
    const matching=typeof ciphertext==='string'&&
      proof?.version===1&&proof.kind===kind&&
      proof.host==='github.com'&&proof.scope==='legacy-owner'&&
      proof.accountId===account.account_id&&
      Number.isSafeInteger(proof.actorId)&&proof.actorId>0&&
      proof.verification==='identity-only'&&
      proof.fingerprint===createHash('sha256').update(ciphertext).digest('hex')&&
      (!proof.expiresAt||new Date(proof.expiresAt).getTime()>now);
    result[kind]={
      stored:!!ciphertext,identity:matching?'verified-at-enrollment':'unverified',
      operationPermission:'not-proven',
      note:'This kind is confined to its own supported routes; no automatic fallback or proof of effective provider scope.'
    };
  }
  return result;
}
