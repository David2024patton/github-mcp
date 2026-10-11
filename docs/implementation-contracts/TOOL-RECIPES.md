# Tool recipes — current helpers and failure cases

Baseline: `ed60e19` (2026-10-11). Export names below were inspected in code; recheck only affected paths in
drift checklist A. Proposed later modules live in REMAINING-WORK. Read the one recipe your card names.

## 1. Existing integration map

| Need | Existing file/export | Use / boundary |
|---|---|---|
| Read definition | `src/tools/define-read.js`: `defineRead` | Returns `{ tool, handler }`; adds fields and, with summaryType, detail |
| Write definition | `src/tools/define-github-write.js`: `defineGithubWrite` | Adds request key and rejected/uncertain error handling to `defineWrite` |
| GitHub client | `src/github/client.js`: `githubFor`, `listAll`, `graphql` | Only GitHub transport; cred `I` default, explicitly choose `U`/`K` |
| Write conveniences | `src/tools/github-write.js`: `octo`, `ownerOf`, `slug`, `missing`, `refusal` | `missing` converts only 404 to null; do not hide 403/5xx |
| Read conveniences | `src/tools/github-read.js`: `readerFor`, `plain` | `readerFor` uses I; U/K reads use `githubFor` explicitly, with `plain` |
| Production classification | `src/tools/production-guard.js`: `productionReason` | Target `{ owner, repo?, ref?, environment?, scope, kind? }`; failed check is production |
| Project override schema | `src/tools/protect-guard.js`: `OUTSIDE_PROJECT` | Include where design allows; it does not bypass production/access/spend |
| Dispatch | `src/tools/dispatch.js`: `createDispatch` | Profile/schema checks and shaping; same wrapped handlers via meta-tools |
| Registry | `src/core/registry.js`: `mergeNamespaces`; `src/tools/index.js`: `registry` | Modules export `tools` array + handlers keyed by exact name |
| Result summaries | `src/tools/summaries.js`: `SUMMARY_TYPES` | Add only a needed summary form; generic caps/handles already apply |
| Test world | `test/helpers/write-contract.js`: `makeWorld`, `parse`, `doorsFor`, `runWriteContract` | Fake db + credential/client + validated GitHub; handler/dispatch/github_call today |
| Real SQL | `src/db.js`: `createDb`, `SCHEMA_TABLES` | Additive init schema; paired fake and real-db shared contract |

## 2. New read tool

Nearest examples: `src/tools/checks-read.js`; dispatch-based tests in `tests/unit/variables.test.js`.

1. Define the exact catalog name, area and audience. Keep description short; longer explanations use guidance.
2. Schema contains user inputs only, with `additionalProperties: false` supplied by defineRead. Do not add
   fields/detail manually. Summary type must already exist or be added with a focused summary test.
3. Resolve owner from args/connection, obtain the scoped client, call the exact route, return data to shaping.
   If selecting U/K, do not accidentally use readerFor (its credential defaults to I).
4. Export `tools = definitions.map(d => d.tool)` and
   `handlers = Object.fromEntries(definitions.map(d => [d.tool.name, d.handler]))`; import the module into index.
5. Test through dispatch, not only a raw handler: summary/full/fields where applicable, profile visibility,
   account outside connection, meaningful empty state, API refusal, long result handle, `gh.invalid` empty.

For lists, record response selector (`data`, `data.items`, etc.), paging input and cap. `listAll` follows Link
with a bound; inspect its actual return shape before using it. Never silently filter a page down to fewer
rows and pretend that was the requested count. Carry truncation/completeness evidence into aggregates.

## 3. One GitHub write

Nearest complete example: `github_variable_set` in `src/tools/variables.js`; its test in
`tests/unit/variables.test.js`. Copy the hook structure, not its production or credential choices.

| Hook | Supply | Observable proof |
|---|---|---|
| properties/required | User schema; wrapper owns dryRun/confirm/requestKey | Dispatch rejects unknown/invalid arguments |
| declarations | Catalog production/access/message/spend/confirm/credential/profile | `check-writes` agrees; dynamic dangerous case tested |
| target | Actual owner/repo/ref/environment/scope/kind | Protected resource and production checks address the real object |
| read | Minimal before-state including IDs and settings being preserved | Preview accurate; 403 never converted to absence |
| classify | Real production reason, widening, outsider recipients; price via price hook | Dry-run shows danger; unsafe mode sends no mutation |
| summarize | Plain action and target; before → after when changing settings | Confirmation tells the owner what will happen |
| apply | One whitelisted mutation through the client; concurrency checks where required | Expected method/path/body, no extra write |
| readAfter | Independent read of observable post-state | A write response alone never claims read-back |
| verify | Compare intent to observed state | Mismatch produces unconfirmed warning |
| inverse | Clean opposite with correct prior state, else null + explanation | Undo data excludes wrapper arguments and secrets |
| present | Small result naming outcome/next action | No token/secret bytes; generic result caps still apply |

The wrapper owns replay/change-log/guard order. Do not implement a second request-key cache or manually call
apply through another door. A timeout is uncertain: never retry the mutation blindly.

For DELETE/POST/PUT query parameters, use Octokit's query template (existing anchor: cache delete in
`src/tools/checks-write.js`, route `DELETE /repos/{owner}/{repo}/actions/caches{?key,ref}`). Otherwise non-path
parameters can become a JSON body GitHub ignores. Read the operation's query fields before building the request;
assert the real transport's query and body independently. This is the existing G-2 decision, not a new rule.

## 4. Contract fixture and domain tests

Build `definition = { tool: module.tools.find(t => t.name === name), handler: module.handlers[name] }`.
Call `runWriteContract` with args and real classifications, including production/needsConfirm/accessWidening/
notifies/spendCents/profile as applicable. `arrange(gh, outcome)` receives `ok` or `mismatch`; use
`replySequence([{ status, body }, ...])` for before/after. A write's success fixture must provide a changed
post-state; mismatch supplies a plausible state that does not meet the intent.

Important boundaries:
- The helper currently checks **exactly one GitHub write**. An env save with separate branch-policy requests,
  a sync or a workflow is compound. Cover a one-write case with the shared helper and separately test the
  compound trace, dry-run/no-confirm zero mutations, replay, partial failure, read-back and all existing doors.
  If no one-write case exists, extend the harness deliberately with explicit expected trace and regressions
  for the existing default; do not weaken the one-write assertion to “at least one”.
- Fixture gates stand in for protection/spend; they do not prove integration with every real guard.
  Add dispatcher tests using the real applicable gate(s) and stored settings for new safety behavior.
- `makeWorld` stores a fine-grained credential. An App-only tool needs the App credential fixture pattern from
  `tests/unit/credentials.test.js` and token-kind refusal assertions in `tests/unit/checks-write.test.js`; do not invent a token-kind exemption to make it pass.
- Production environment/ref fixtures must answer the classifier's reads. Defaults are not harmless when
  those reads fail; explicit unknown/error cases must still fail closed.

Domain tests supplement the shared nine checks: stale IDs/heads, missing permissions, omission vs clearing,
plan restrictions, round trips, tampering, concurrent attempts and exact forbidden side effects.

## 5. Read-merge-write settings

1. Normalize the API GET response into **writable fields** (IDs for reviewers, no response-only URLs/objects).
2. Overlay only supplied changes; test `Object.hasOwn(args, key)` semantics so false/0/[]/empty are preserved
   when the API permits them. Never use truthiness to decide whether the owner supplied a change.
3. Send the complete required PUT shape or the documented PATCH shape. Separate endpoints remain separate;
   do not stuff deployment policies, required-check contexts or org access IDs into an unrelated body.
4. Read back and compare every setting the design says must be preserved, including unchanged controls.
5. Test a one-field update using a richly populated before fixture, clearing values, unreadable before-state,
   plan refusal, mismatch, and the correct inverse. Concurrent destructive replacement needs the card's
   concurrency strategy; do not imply that read-merge-write itself is compare-and-swap.

## 6. GraphQL tools

Use the named operation from `scripts/graphql-find.mjs`; distinguish node IDs from REST numbers. Pass
variables separately; never interpolate untrusted text into a document. The fake validates the document
against the schema; fixtures must also test semantics (ownership, mutation input, cursor completion, actor).
Read queries remain reads despite HTTP POST. Writes still use defineGithubWrite. Check null nodes, GraphQL
errors, missing cursor pages and permission denial. Do not interpret an absent node as a verified change.

## 7. SQL, workflows and network-sensitive work

SQL: add method(s) to real db and fake, a shared contract in `test/contract/`, unit runner and real Postgres
runner. Test init twice, expiry, scoped ownership and simultaneous claims using two instances sharing data.
The fake cannot prove atomic SQL; request-key/write-slot and new ledgers need real concurrency evidence.

Workflow: reuse wrapped tools with the caller's same connection/gates, never naked apply hooks. Record which
step owns confirmation/log/replay; an outer workflow preview may not cause inner writes. Test time budget,
pending/resume, failure at step N, no replay of completed mutations and unchanged restrictions through github_call.

Public URL work (assets/forwarders/webhooks): create one reusable policy, verified at its introducing card;
later callers inherit it. Card must specify URL parse, DNS/IP rejection, redirects, destination revalidation,
timeout/stream byte cap and secret-header handling. A hostname checked once is not sufficient proof against
redirects or DNS rebinding. If the approved design cannot be implemented safely, amend before that slice.

## 8. Verification commands

```bash
npx vitest run tests/unit/variables.test.js           # replace with the card's exact existing/new test
npx eslint src/tools/variables.js tests/unit/variables.test.js
npm run test:db -- tests/db/<card-file>.test.js        # SQL changes: real throwaway Postgres
npm run test:shapes -- tests/shapes/<card-file>.test.js
npm run check
npm test
```

The angle-bracket filenames are instructions to substitute, not executable paths. No new per-slice full-suite
requirement: targeted tests/lint between slices, full pre-push checks per SESSION-START, full exact-head CI
before merge. Shape validation inside unit fixtures complements, not replaces, the dedicated shapes suite.
