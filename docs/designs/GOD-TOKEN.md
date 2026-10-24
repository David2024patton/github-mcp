# God token — one master credential (owner decision 2026-10-23)

**Owner request (Chris, plain words):** God mode should not be a menu of separate extra keys. It should be **one master token**
that unlocks everything the normal GitHub sign-in cannot, and the server should offer tools for everything buildable on top of it.
This **replaces** the "choose a notifications key or a packages key" page as the way to get extra power. Existing K and P
credentials keep working. This is owner-requested scope; END-USER-AUTHORITY applies (honest notices, user-chosen controls, no
developer spending or live mutation implied).

## What the token is
A **classic** GitHub token (the only kind that can carry notifications, packages, gists, org admin, hooks, keys and more at once),
created by the person on GitHub from a link that pre-ticks every scope. New credential kind **`M`** ("master"). It is the person's
own: it must belong to the same numeric GitHub user who signed in. It is typed once on a one-time page, never passed through a
tool, never returned, encrypted at rest with a context that binds it to tenant, person and account.

## What it is used for (and not)
- Only when the normal credentials (`I`, `U`) cannot do the job: K-type (notifications) and P-type (packages) tools fall back to `M`
  when no K/P is enrolled; the universal tools accept `cred:"M"`.
- Always through the existing guarded lifecycle: classification, preview, confirmation, spend and production gates, journal, readback.
  A `read_only` connection never writes with `M`. The App token is still preferred whenever it can do the same thing.
- Honest notice on the page: this token has the power of the person's whole GitHub login; remove it from GitHub or here at any time.

## Exact seams (found 2026-10-23)
- `src/tenancy/directory.js`: `gh_tenant_optional_credentials` and `gh_tenant_optional_setup_states` have `CHECK (kind IN ('K','P'))`;
  `putPilotOptionalCredential` / `getPilotOptionalCredential` / `revokePilotOptionalCredential` / `pilotOptionalFingerprint` and the
  operation permit matrix list only K and P.
- `src/tenancy/optional-credentials.js`: `spec[kind]` (probe endpoint, required scope, resource) and a fixed 24-hour readback life.
- `src/tenancy/optional-setup.js`: `OPERATIONS` and begin/finish for K/P only.
- `src/github/client.js`: `authorizeOptionalRequest({account,kind,method,url})` allows only the exact read for K and P.
- `src/github/credentials.js` + `src/tools/universal.js`: `cred` accepts `I`, `U`, `P`.
- God page: `src/tenancy/public-http.js` (`godPage`) and `src/tenancy/public-connect.js` (`godChoose`).

## Pieces (each a whole, usable outcome)
1. **GOD-1:** enroll `M` (link with all scopes pre-ticked, one-time page, same-person proof, scopes recorded), store/revoke,
   `github_whoami` shows it and its scopes, K/P tools fall back to it, `github_api_call` / `github_graphql_*` accept `cred:"M"`
   under the full guards, God page rewritten, tests (real Postgres, fake GitHub), docs.
2. **GOD-2:** purpose-built tools for the families that only `M` can reach, from the capability inventory (gists, personal keys,
   hooks, org admin extras), each with the nine write-contract checks.
3. **GOD-3:** expiry reminders and an owner-visible "what the God token can do right now" summary.

Not decided / not done: how long a stored master token may live without a re-confirm (default proposed: follow GitHub's own
expiry, with no limit of our own; decided 2026-10-23: the person sets it).
