Real-account acceptance (CAP-5 item 2 and the 56-row queue): owner approved using the saved developer connection, but the
tool environment's safety classifier denied reading the Hub's Vercel project variables (credential exploration). Not worked
around. Owner checklist row B2 now says exactly what to approve. Development, merges and the capability report are unaffected.

Follow-up: the shell also cannot reach the deployed origin (proxy 403), so `rtool developer-connect` fails with developer_connection_network_unavailable. Needs a runner with internet access (private tester repo workflow or the owner's linked computer).

Resolution path chosen with the owner: add the server as a Claude custom connector (preview mode); a new session then runs the acceptance checks through it. The agent cannot create repositories from its session, so the private tester-repo idea is parked.
