Fourth and fifth defects found by real-account acceptance (classic protection write on the public scratch fixture):
- Creating protection on a branch with none was applied by GitHub but reported "unconfirmed": GitHub's readback omits the unconfigured groups and lists every flag
  at its default, while the check demanded exact equality with only the flags that were sent. Verification now accepts omitted groups as "not configured" and extra
  flags only when they are at their default (off); any difference in a sent field or any extra flag turned on still fails.
- A refusal written by this service (for example "a new protection requires explicit required_status_checks...") was shown to the person as "the current state could not be read".
  Service-authored refusals from a preflight read now show their own wording.
- github_protection_get called a plain "Branch not protected" 404 unreadable; with the branch itself reporting protected:false it now says "no classic protection set" (and points to
  rulesets, which are separate).
Tests: tests/unit/h1-classic-protection.test.js, h1-protection-absent-keys.test.js, h1-governance-read.test.js.
