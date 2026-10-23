Acceptance wave on the newly released deployment (main/live 31f490e), through the owner's connected custom server in PRODUCTION mode, scratch organization only.
These are observations recorded for the queue rows named; none is written to docs/developer-evidence.json yet because that file needs an independently verified deployed
revision and this agent shell cannot verify one beyond the Vercel READY check recorded in the release note.

Rows with a real observation (read/denial/guard behavior seen on the deployed code):
- W5-ACCESS-REVIEW: members, teams, installed apps, fine-grained tokens and requests, collaborators and deploy keys for all five fixtures; one finding (App can reach all repositories) flagged for review, no change made.
- W5-SECURITY-REVIEW / W5-REPO-HEALTH / H4 reads: Dependabot alerts readable on the public fixture (0); on private fixtures GitHub refuses the App credential (free plan) and code/secret scanning answers 404; the workflow reports these as "not readable", marks the result partial, and does not call them zero. Security feature settings read on the public fixture (secret scanning, push protection, Dependabot updates all disabled; flagged, nothing changed).
- W7-DIGEST: seven complete billing days, all observed, $0 Actions and $0 Copilot, Denver dates shown, partial status because of the private-repo alert gaps.
- W7-FIND: scoped search found the fixture repo and its three draft PRs, issues/commits/runs/releases empty and complete.
- W1-PR-STATUS: head SHA, base, draft state, "no checks reported", unreadable rules (403) and a next-action line for two stacked drafts.
- W3-THREADS (read half): three fixture threads, all resolved with answered/answered/superseded replies, each verified against the exact head.
- W2-EXACT-MERGE (refusal half): merge dry run on a draft with no CI refused with blockers (draft; checks not proven green); head SHA matched.
- U1-REST-READ and U2-GRAPHQL-READ: pinned-operation search, organization read via REST, scoped GraphQL organization query (points estimate and node bounds shown); GraphQL for a foreign organization refused as outside the enrolled connection.
- U1-REST-WRITE (zero-spend scratch write, full gates): replace-topics on a private fixture: dry run preview with cost-unknown disclosure, confirmed apply with independent readback, same request key replayed without a second write, restore to the original (no topics) with readback, foreign-account write refused.
- Y9D reads: Copilot agent repositories and billing read, Codespaces list, Marketplace list succeeded; Copilot content exclusions returned 404 (not available on this plan) and is reported as such.
- App JWT reads (previous note) and org/billing reads (earlier notes).
Observed honest limits: GraphQL write of a reaction was refused because that mutation has no independent readback (the specialized-tool rule), consistent with the 234 GraphQL mutations still without write specs (docs/pr-cards/CAP-4.md).
Not run, with the exact prerequisite (all owner or paid-plan dependent, none blocking):
- H2 webhook signer lifecycle and delivery control: needs a receiver endpoint the owner approves to prove signatures.
- G6 package auth: needs the owner's package-only token.
- Y9D sponsors/owner writes, O4 budget delete, Codespaces access write, Y7 private paid write, U1 metered write: spend or access-widening; cost unknown; owner approval per item.
- SCRATCH-CLEANUP, H1-PUBLIC-OWNER-CLEANUP, W6 cleanup/release, W2 merge/stack, W4 retry, W1 open-PR: need scratch branches with CI; the scratch fixtures have no workflows, so no CI evidence exists; recreate a fixture with a trivial workflow in a later wave.
- NATIVE-REVOCATION and RTC-DIRECT: owner disconnect/reconnect and a one-time pass from the setup page.
