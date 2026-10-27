# Design — SKILLS-1: Skills catalog (David Patton's skills library)

Status: **PROPOSED — awaiting Chris's approval.** Written 2026-10-27 by David Patton (via pull request) against `main` `e2f9d541a634ec77baceca125bbd48ab9c3bf06c`. Scope and acceptance: [SKILLS-1 card](../pr-cards/SKILLS-1.md).

In plain English: this adds a small new section to the server that knows about David Patton's library of "skills" (written playbooks an AI follows to do a job well). The server learns the names and purposes of the skills, can say which skill fits a job, and can run the GitHub family of skills using this server's own guarded GitHub tools. The skill texts themselves never come here: not into this repository, not into the database, not into any result. The whole section ships switched off, and production stays exactly as it is until Chris turns it on.

## The shape, in three steps

1. **Recognition.** The server knows the catalog: which skills exist, what each one is for, how risky each one is, and which skill fits a job someone describes. This step is useful on its own and changes nothing about how GitHub work is done.
2. **GitHub-family execution.** Skills whose work is GitHub work (repositories, files, pull requests, reviews, Actions, and the rest of what this server already does) can actually be run here, because this server already does that work through its own guarded tools. Every step of a skill runs as an ordinary call to one of those tools, with the same previews, confirmations and read-backs as any other call.
3. **Everything else, later, somewhere else.** Skills that are not GitHub work cannot honestly be run inside this server (see "Risks" below). Those execute on David's own host and reach users through Robinson's Toolkit Hub, alongside this server, the way the Hub already combines servers. That step needs no code change in this repository and is not part of this design.

## 0. Verify before starting

| # | Assumption about the code | How to check |
|---|---|---|
| A1 | Tools are a closed, static, code-only registry: a tool exists only if code in this repo defines it; nothing can be added at runtime | Read `src/tools/index.js` and `src/core/registry.js` |
| A2 | Reads are built with `defineRead` and writes with `defineWrite` (GitHub wrapper `defineGithubWrite`), and every write passes the fixed lifecycle: read current state, classify, preview, confirm where classified, claim the request key, send once, read back, journal | Read `src/tools/define-read.js`, `src/core/write.js`, `src/tools/define-github-write.js` |
| A3 | Every tool needs exactly one row in [TOOL-CATALOG](../TOOL-CATALOG.md), and the Card cell must name a card that exists in `docs/pr-cards/work-index.json` | Run `python3 scripts/count-catalog.py` on the untouched tree; it passes |
| A4 | Optional features in this repo ship behind an environment switch that defaults to off and refuses calls until the owner enables it | Search for the existing enable checks (for example the marketplace and tenant pilot switches) |
| A5 | Stored results and route-like state are bound to the connection that created them, with an expiry | Read how the result store rows are keyed and expire |
| A6 | David's registry ships blank descriptions for skills, so a description cannot be taken from the registry alone | Inspect the pinned registry snapshot used by the generator (see Decision S4) |

If any row is false, stop and report; the design may need amending.

## 1. Decisions (made — do not re-open)

**S1. Seam C is the chassis, Seam A is the surface.** The server ingests a generated catalog (Seam C: it consumes a versioned catalog built from David's registry) and presents it as an ordinary new section of tools in this server's own taxonomy (Seam A: prefix `github_skills_*`, area `skills`). There is no outbound MCP client and no proxying to an outside skills server inside this repository (that was "Seam B"; in this ecosystem it belongs at the Hub, step 3 above). Reason: this is the server's most-practised change shape, it keeps custody of all skill bodies on David's side permanently, and it does not bend this server's rule that it is a provider, never a client.

**S2. Three tools only.** `github_skills_search` and `github_skills_route` are reads. `github_skills_execute` is a write built with `defineWrite`. No other skills tools are added, and no MCP resources or prompts are added (this server implements neither primitive today, and this design changes neither).

**S3. Skill text never enters this repository or its database.** The catalog carries metadata only. The one place skill-derived content appears as code is the plan templates for the GitHub family: ordered lists of this server's own tool names with argument templates, reviewed in the pull request like any other code. Every other skill contributes metadata and nothing else.

**S4. The catalog is generated, never hand-edited.** A generator script, `scripts/build-skills-catalog.mjs`, builds the catalog data module (`src/data/skills-catalog.js`, header marked generated, do-not-edit) from David Patton's `registry.json` at a pinned snapshot (a named registry version and commit, recorded in the generated file's header). Nobody tracks a moving branch; updating the catalog means re-running the generator against a new pinned snapshot in a reviewed pull request.

**S5. Only cleared skills are in the catalog, by construction.** David's registry marks each record with a license status. Only MIT-cleared records enter the generator's output. Records marked `not-cleared` (the registry's Section C) are excluded by the generator itself, not filtered out later by hand, so a not-cleared record cannot slip in through a later edit of the data file.

**S6. The section ships switched off.** The three tools are registered and listed (so the catalog checks stay consistent), and every handler refuses with the server's standard structured refusal until the environment switch `SKILLS_CATALOG_ENABLED` is set to `enabled`. Merging changes no live behaviour. Rollback is the switch, not a revert. Turning it on is Chris's decision, made when he is ready.

**S7. Entitlement, version 1, is deliberately narrow.** Owner connections see the catalog. Tenant and public connections see it only when their tenant is listed in `SKILLS_CATALOG_TENANTS`. RTC passes get nothing: `skills` is not added to any pass grant in this work. Anyone else calling the tools gets the standard refusal.

**S8. Route decisions are stored, per connection, for 30 minutes.** `github_skills_route` saves its decision (see Section 2) bound to the connection that asked, with a 30-minute expiry. `github_skills_execute` takes a decision id, loads that stored decision, and refuses a decision that belongs to another connection, has expired, or has already been used. A decision is consumed once.

**S9. Execution confirmation is bound to the exact plan.** See Section 3.3. In short: route returns a confirmation object carrying `payload_sha256`, and execute requires `confirm: true` **plus** the matching `payloadHash`. That is stronger than this server's usual confirmation, which is the boolean alone, and it is stronger on purpose, because the thing being confirmed is a multi-step plan rather than one tool call.

**S10. No new credential storage, ever.** See Section 3.4. Delegated steps use the calling connection's own credentials, resolved exactly as they are today. There is no fallback to another user's credential and no fallback to an operator credential.

**S11. Results carry ids and step names only.** Route decisions, execution results and logs name skill ids and plan step names. They never contain skill text, and execution results pass an overlap check before they are returned (Section 3.5).

## 2. Schema changes (additive only)

One new table, created with `IF NOT EXISTS` in the same places the server creates its other per-connection tables, including per-tenant provisioning:

```sql
-- Route decisions for the skills catalog (Decision S8).
-- Bound to the issuing connection, exactly like result-store rows.
-- plan holds skill ids, step names and argument templates only: no skill text.
CREATE TABLE IF NOT EXISTS skills_route_decisions (
  id          TEXT PRIMARY KEY,
  connection  TEXT NOT NULL,
  skill_id    TEXT NOT NULL,
  plan        JSONB NOT NULL,
  risk_class  TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
```

No other tables. No change to any existing table. The catalog itself is a generated data module in code, not a database table.

## 3. The three tools

All three are area `skills`. Listed descriptions stay inside this server's normal budgets. Full detail is in [TOOL-CATALOG](../TOOL-CATALOG.md), section "Skills catalog".

### 3.1 `github_skills_search` (read)

Input: task words, plus an optional category and an optional maximum risk class.
Returns: the matching catalog records the caller is entitled to see — skill id, name, kind, category, a one-line description, keywords and risk class. Never skill text, never a file path from David's repository.
Refuses, like all three tools, while the section is switched off or the caller is not entitled.

### 3.2 `github_skills_route` (read)

Input: a job described in plain words, plus optional context.
Returns: a route decision and nothing is executed. The decision names the selected skill id, why it fits, a confidence score, the skill's risk class, and — for GitHub work — the plan: the ordered step names (this server's own tool names) it would run. When confidence is under the routing threshold, the decision is `ask`: it says no skill fits well enough and asks the person, rather than guessing.
Side effect, by design: the decision is stored (Section 2) for the calling connection with a 30-minute expiry, and the reply carries the confirmation object described in Section 3.3, including `payload_sha256`.

### 3.3 Confirmation mapping (Decision S9)

This follows the confirmation-object design in David's packaging research (C05, Section 6.4): a confirmation is an object bound to the exact payload, never a bare boolean and never model prose.

- Route returns a confirmation object: a confirmation id, the surface (the execute tool and the skill id), the target in plain words, `payload_sha256` (the hash of the exact plan and arguments to be executed), when it was issued, and when it expires (the decision's 30 minutes).
- Execute requires both `confirm: true` **and** a `payloadHash` argument equal to that stored `payload_sha256`. If any part of the plan changed after routing, the hash no longer matches and execute refuses; the person routes again and confirms the new plan. One confirmation authorises one plan, once: the decision is consumed by a successful execute.
- This plan-level binding sits **on top of**, never instead of, the per-step lifecycle. Every delegated step still runs through the existing `defineWrite` lifecycle with its own preview, its own confirmation where its classification requires one, its own request key, its own read-back and its own journal entry with an undo inverse. A step the lifecycle refuses stops the plan at that step, and the result says which steps completed and which did not.

### 3.4 Credential binding (Decision S10)

- Search and route need no GitHub credential at all.
- Execute adds no credential storage: no new tables, no new stored secrets, no credential argument on any tool.
- Each delegated step is an ordinary call to one of this server's existing tools, so it resolves the **calling connection's own** credentials through the existing credential resolution, exactly as a direct call by that connection does today: the owner's connections use the owner's enrolled credentials, a tenant's calls use that tenant identity's own grants.
- There is no fallback: if the caller's connection has not connected the account a step needs, the step returns this server's existing structured refusal naming what is missing. It never borrows another user's credential and never borrows an operator credential.
- A registry note that a skill needs a GitHub connection binds to the calling connection itself. It is a reference to "your connection", never a stored value.

### 3.5 Anti-extraction

The catalog is metadata only, and that is the main protection: there is no skill text in this repository to extract. On top of that:

- Generated metadata is checked at build time: the generator fails if catalog text overlaps the packaged skill corpus beyond a short common-phrase allowance, so descriptions cannot quietly carry skill wording.
- Execution results pass an overlap check in the execute handler, comparing returned text against the packaged corpus (exact and normalised substring). A hit is blocked and logged, and the caller gets a plain refusal instead of the text.
- That check is proven by a planted-canary test: a unique dummy string planted in a test fixture representing skill text must be caught by the check and must never appear in a result. The test exists because this server stores full results behind per-connection handles for a time; text that leaked into a result would persist there.
- Route decisions, results and audit entries carry skill ids and step names only (Decision S11).

### 3.6 The generated catalog (Decision S4, detail)

`scripts/build-skills-catalog.mjs` reads David's `registry.json` at the pinned snapshot and writes `src/data/skills-catalog.js`. Each record carries exactly these fields and no others:

- `id`, `name`, `kind`, `category`
- `description` (one line)
- `keywords`
- `risk class`
- `license status`
- `checksum`

One honest wrinkle: David's registry ships **blank** descriptions for skills, so the generator cannot take descriptions from the registry alone. At build time only, it reads each cleared skill's frontmatter description from the pinned source tree and puts that one line into the record. That read happens on the machine running the generator; what travels into this repository is still metadata only.

The generated file's header records the pinned registry version and commit, states that the file is generated (do not edit by hand), and carries the attribution: the catalog data is David Patton's MIT-cleared skill metadata, contributed for use in this server.

**No skill bodies. No reference text. No file paths from David's repository** — not in the generated module, not anywhere else in this work.

## 4. What is deliberately NOT included

- **No skill bodies anywhere**: not in this repository, not in the database, not in the result store, not in logs.
- **No MCP resources or prompts added.** The server implements tools only today; this design adds no new primitive.
- **No outbound MCP client.** This server does not start calling other servers. Federation for non-GitHub skills happens at the Hub (step 3), outside this repository.
- **No change to the authentication doors.** Owner, tenant, public and RTC pass sign-in all work exactly as before, and no pass gains the `skills` area.
- **Production stays as-is.** The section ships off (Decision S6); enabling it is a separate owner action, and nothing here changes any account's production setting.

## 5. Work units (in order)

### WU-S1 — The card and this design (docs only)

Files: `docs/designs/SKILLS-1.md` (new), `docs/pr-cards/SKILLS-1.md` (new), `docs/pr-cards/work-index.json`, `docs/pr-cards/validate-index.py` (the new batch and unit added to the reviewed lists, as that file's own docstring sanctions).
Done when: `python3 docs/pr-cards/validate-index.py` passes and Chris has approved the card.

### WU-S2 — The generator and the catalog data

Files: `scripts/build-skills-catalog.mjs` (new), `src/data/skills-catalog.js` (new, generated).
Tests: the generator excludes every `not-cleared` record; the output contains only the fields in Section 3.6; the build-time overlap check fails on a planted overlap.
Done when: the generated catalog validates and contains zero not-cleared records.

### WU-S3 — Search and route (reads, inert by default)

Files: `src/tools/skills.js` (new), `src/tools/index.js` (one import, one registry entry), the `skills_route_decisions` table (Section 2).
Tests: search filters by entitlement and risk class; route returns a decision with a payload hash for a GitHub job and an `ask` decision under threshold; both tools refuse while the switch is off and for callers who are not entitled.
Done when: the two reads are registered, catalogued, and refuse by default.

### WU-S4 — Execute (the write)

Files: `src/tools/skills-execute.js` (new), the GitHub-family plan templates as reviewed data in the same module family.
Tests: execute refuses with no stored decision, an expired decision, another connection's decision, a missing confirmation, and a mismatched `payloadHash`; a confirmed plan runs its steps only through the guarded tools; the decision is consumed once; the planted-canary result is blocked.
Done when: the full acceptance list on the card passes.

### WU-S5 — Docs and status

Files: `docs/TOOL-CATALOG.md` (new section, totals and summary updated), `docs/status/2026-10-27-skills-integration.md` (new).
Done when: `python3 scripts/count-catalog.py` passes and `npm run check` is green.

## 6. Stop-and-ask points

1. Any Section 0 assumption false.
2. Chris has not approved the SKILLS-1 card: no code beyond WU-S1.
3. Anything that would put skill text, a file path from David's repository, or a new stored credential into this repository: stop; the design forbids it, it is not a detail to negotiate inside a pull request.
4. Any change to an authentication door, a pass grant, or a production setting: stop; all three are outside this design.

## 7. Risks, stated honestly

- **The execution ceiling is real.** A skill is prose written for a thinking reader. This server has no model of its own, so a prose skill cannot be executed server-side in general. What this design honestly delivers is recognition and routing for every cleared skill, and real execution only for the GitHub family, whose steps map onto this server's own tools. Anything beyond that runs on David's host through the Hub (step 3). Nobody should describe this work as "the server runs the skills" without those qualifiers.
- **This repository is public, forever.** Everything committed here is public writing, including in forks and clones. That is why the catalog is metadata only and why the generated data must be treated as publishable from the start.
- **Licensing, in two parts.** This repository's own `LICENSE` is proprietary (all rights reserved). Code contributed in this pull request therefore lands under Chris's terms when he merges it; that is his right as the repository owner, and merging is his acceptance of the contribution on those terms. The catalog **data** is different: it remains David Patton's MIT-cleared skill metadata, and the generated file's header says so (attribution in Section 3.6). The skill bodies are not contributed at all, under any terms, because they never arrive here.
- **Stored results persist for a while.** This server keeps full results behind per-connection handles for a period. If skill text ever reached a result, it would persist there too. The overlap check and its planted-canary test (Section 3.5) exist for exactly this reason and must not be treated as optional polish.
- **Catalog discipline cuts both ways.** This server's checks reject a tool whose catalog row, description length, safety mark or card reference does not line up. The generator must emit this server's shapes rather than asking the checks to bend.

## 8. Acceptance mapping

| Card acceptance line | Evidence |
|---|---|
| Catalog generated from the pinned registry with zero not-cleared records | Generator test in WU-S2; generated file header naming the pinned snapshot |
| Search and route refuse while disabled or unentitled | Unit tests in WU-S3 |
| Route returns a decision plus payload hash; `ask` under threshold | Unit tests in WU-S3 |
| Execute refuses without a matching hash; steps run only through guarded tools; decision consumed once | Unit tests in WU-S4, including the write-contract checks every write tool passes |
| Overlap check blocks a planted canary | Unit test in WU-S4 |
| Catalog counts and docs line up; full checks green | `python3 scripts/count-catalog.py`; `npm run check` |

## Amendments

(Dated entries only. Never edit a decision silently.)
