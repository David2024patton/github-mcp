# Implementation detail — prepare once, build without rediscovery

Use this page when writing a JIT card; during implementation read only the card and the recipe it names.
This is execution guidance for Sol 5.6, not a new design or a permission grant. AGENTS, approved designs,
PLAN and the drift protocol retain their authority. No model change, reduced test gate or fixed speed claim.

Throughput and grouping rules live in [THROUGHPUT](THROUGHPUT.md). For a fast, narrow start run `npm run task:brief -- <card-id>`; the generated brief does not replace the actual card, design or approval gates.

## 1. What the extra layer supplies

The design answers **what must be true**. A card also answers **where to edit, which existing contract to reuse,
how arguments become requests, which observations prove success, and what to do next**. Do the bounded discovery
once and record it; do not repeat it in every slice or every resumed session.

Start with the card row in [REMAINING-WORK](REMAINING-WORK.md), then the relevant section of
[TOOL-RECIPES](TOOL-RECIPES.md). Those are navigation aids, not an alternative queue. The
[G-4 worked packet](G-4-PACKET.md) demonstrates the expected specificity without reserving an in-flight card.

## 2. Ready-to-build packet inside each JIT card

Keep the normal card short (usually 40–100 lines); put large request/test tables in a companion packet and link
only its relevant heading. Do not copy this entire document into every card.

| Card field | Record this concrete information | Avoid this recurring delay |
|---|---|---|
| Baseline | Actual main SHA; predecessor PR/head; affected paths; dependency still pending | Coding against an imagined helper or unmerged feature |
| Read only these | Design decision IDs/headings; helper export names; nearest passing test | Reading a whole batch again |
| Edit map | Existing/new file; export to add/change; registry, summary and profile integration | A correct handler that users cannot call |
| Request map | Tool argument → path/query/body field; route; response selector; credential | Guessing camelCase vs snake_case or endpoint scope |
| Before/after | Required reads, explicit missing state, intent comparison, inverse or reason none | Reporting a 204 or returned ID as verified success |
| Safety | Catalog declarations; dynamic classification inputs; guards; owner input IDs | Treating a copied tool's safety marks as applicable |
| Tests | Fixture arrangement; action; observable result and forbidden side effect | Tests that only check a helper's own output |
| Slices | Ordered coherent edits plus exact focused command for each | Repeatedly deciding how to split the same card |
| Finish | Acceptance → test name/result; unchanged gates; successor's inherited exports | Passing CI with acceptance still missing |

Use this compact shape (replace all slots before coding; never ship slot text as implementation):

```text
Baseline inspected: <actual SHA>; predecessor: <PR/head>; risk: <one area>
Read only: <design headings>; <file: export>; <passing test: describe block>
Edit map: <file/export> -> <registry/summary/guard or db integration>
Requests: <tool arg -> route parameter/body; response selector; I/U/K>
State contract: before=<reads>; apply=<write>; after=<read>; verify=<intent>; inverse=<opposite/none>
Safety: <catalog declarations + dynamic reasons + IN-xx gates>
Tests: <arrange -> act -> assert + must not happen>; contract fixture=<ok/mismatch>
Slice 1: <files/functions>; run <focused command>
Slice 2: <files/functions>; run <focused command>
Finish: <acceptance/test table>; full gates per SESSION-START; successor inherits <exports>
```

## 3. Request discovery once per operation

1. Find the operation using the vendored finder, then `--show` its exact route. Record required path/query/body
   names in the card. Finder output summarizes the top level; nested enums/objects still need a bounded schema
   lookup using the description helpers (`test/helpers/github-descriptions.js`). Do not open the vendor whole.
2. Verify credential support and semantics in GitHub's official reference, as AGENTS requires, and cite the
   source in the PR. A method/path existing does not prove App-token support, plan availability or replacement semantics.
3. Resolve API IDs via a read where the input is a user-facing name. Do not substitute an issue number for
   an issue ID, a repository slug for a repository ID, or a REST ID for a GraphQL node ID.
4. Whitelist request fields. Never send all tool arguments: `confirm`, `dryRun`, `requestKey`, `fields`,
   `detail`, `outsideProject` and local convenience options are not GitHub request fields.
5. Arrange realistic before and after responses, run through the real client with the fake transport, and
   assert `gh.invalid` is empty. A stub of `octokit.request` skips the shape evidence this repo requires.

## 4. Implementation order within a card

| Slice | Deliverable | Focused verification |
|---|---|---|
| 1 | Smallest read/normalizer plus registered tool and one behavior test | Targeted unit file + lint changed JS |
| 2 | One complete write with before/classify/apply/after/verify/inverse | Shared contract for that write + domain regressions |
| 3 | Remaining tools using the proven pattern; semantic variants get distinct fixtures | Targeted files; db when SQL changes; shapes when GitHub calls change |
| 4 | Acceptance evidence and drift checklist B | Full `check`, unit and applicable db/shapes before the single push |

Internal implementation steps are checkpoints, not PR boundaries or countable batch subsections.
Use AGENTS' current rolling 400–800 production-line and 2–5 whole-subsection planning averages, with
evidence-backed exceptions; 800 lines is not a hard cap.
Use the existing shared contract instead of copying its nine checks. Do not refactor unrelated helpers to make
a new tool look elegant. When two callers need the same behavior, extract the smallest tested shared function.

## 5. Fast diagnosis without lowering standards

| Failure | Inspect first | Concrete correction |
|---|---|---|
| Tool absent/duplicate | Module `tools`/`handlers`, `src/tools/index.js` | Register exactly once; names match catalog |
| Schema rejects valid tool input | Dispatch schema and required list | Separate omitted/empty; remove GitHub-only requirements from unrelated modes |
| `gh.invalid` nonempty | First invalid request + exact vendored operation | Correct field location/type; whitelist body/query |
| Refused as production unexpectedly | `target`, before-read failures, `productionReason` | Repair missing fixture/read; never weaken fail-closed behavior |
| Read-back unconfirmed | Before/after sequence and `verify` | Arrange real post-state; compare requested intent rather than HTTP status |
| Shared contract expects one write | Actual mutation trace | Use one-operation fixture plus separate compound-operation tests; do not weaken shared assertions |
| Check-writes mismatch | Tool declarations vs TOOL-CATALOG | Correct semantic declaration or record reviewed design amendment |
| Budget failure | `listedDescription`, schema and default result | Short description; guidance for detail; summaries/handles for data |
| DB-only failure | Shared db contract + real Postgres output | Correct SQL/atomicity and fake together; fake success is insufficient |

## 6. Keeping packets useful as main advances

Mechanical drift: update paths/signatures in the current card before coding. Semantic drift: follow
DRIFT-PROTOCOL; the recipe never authorizes a new security decision. At each PR boundary record the newly built
helper and nearest passing regression in the successor card (or CHANGES-SINCE-DESIGN when still JIT).

Planning PRs do not change someone else's in-flight card or index status. A future path in REMAINING-WORK is
explicitly a proposal until it exists. Packets never mark an owner input answered or a feature implemented.
Once an immediate card exists, prefer it over reading the broad map again.
