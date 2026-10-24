# 2026-10-24 — PUB-5 part C: security review before advertising

**What changed (plain words):** I checked the 12 ways the free public sign-in could be attacked (plus the new "Act as me"
feature) against the code and found a test for each; where a test was missing I added one, and fixed the five real gaps:
(1) an old login refresh token shown a second time now ends the whole sign-in; (2) text from strangers in search results and
commit messages is always marked untrusted; (3) the service's own login tokens can never leave in a result; (4) the
"is this person really an admin of that organization" check is now tested on its edge cases; (5) the sign-in cannot be
downgraded on PKCE and deleting a person leaves nothing in any per-person table. Four vulnerable packages (two high) were
updated; the audit now reports zero. Every public page is tested to forbid framing and scripts.

**Report:** `docs/audits/PUBLIC-LAUNCH-SECURITY-2026-10.md`.

**Not done / waits for part B:** rows for the daily and hourly per-person limits, the global limit and the inactive clean-up
(PUB-5 part B was not merged when this was written). Default spend cap for free users is a decision for Chris, not a blocker.

**Next:** when part B merges, add its rows to the report; then PUB-5 part D belongs to the other agent.
