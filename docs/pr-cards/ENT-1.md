# ENT-1 — enterprise tools (time-boxed: Enterprise trial on robinson-ai-scratch ends about 2026-11-22)

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4 · **Prerequisites:** GOD-2, GOD-3 (needs `personalCred`,
`scopeCovered`, `masterTokenLink({enterprise:true})`) · **Effort:** medium · **Deadline:** merged and released by
**2026-11-10** (Chris's instruction 2026-10-23: merged, released and accepted before about 2026-11-15) so ACC-1 can test before the trial ends. If it slips, ship the read tools first (split PR).

## Outcome
A person who administers a GitHub Enterprise and has a master token with `admin:enterprise` (or `read:enterprise` for
reads) can list their enterprises and read/manage the enterprise settings GitHub exposes in the pinned REST description,
plus enterprise members/admins/organizations through GraphQL. All writes go through the normal guarded lifecycle.

## Read only these
- `src/tools/billing-read.js` (an org-level read pattern) and `src/tools/security-write*.js` or the H-4 security tools
  (`grep -ln "code-security" src/tools/*.js`) for code-security configuration shapes at org level — copy them.
- `src/tools/graphql-read*.js` or the GraphQL read helper (`grep -rn "graphql(" src/tools/*.js | head`) for a query pattern.
- `src/github/personal-cred.js`, `src/github/master-areas.js`.
- `node scripts/openapi-find.mjs "enterprise"`; `node scripts/graphql-find.mjs Enterprise`.

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| no tool name contains `enterprise` (`node -e "import('./src/tools/index.js')…"`) | | |
| `masterTokenLink({enterprise:true})` exists (GOD-3) | | |
| 29 REST operations under `/enterprises/{enterprise}/` in the pinned description | | |

## Who may act on which enterprise
- New helper `src/github/enterprise-access.js`:
  `async function adminEnterprises(ctx)` → GraphQL with `cred:'M'`:
  `query { viewer { enterprises(first: 20, membershipType: ADMIN) { nodes { slug name } } } }` → `[{slug,name}]`.
  `async function requireEnterprise(ctx, slug)` → throws a plain refusal unless `slug` is in that list.
  Every enterprise tool calls `requireEnterprise` first. No master token → refusal "Add your master token with
  enterprise permissions (My connection → Add or replace → include enterprise permissions)".
- Enterprise tools take `{ enterprise: <slug> }` (pattern `^[a-z0-9][a-z0-9-]{0,59}$`), never an `owner`. Because
  `resolveAccount` only accepts connected accounts, build the client with `githubFor(ctx, { owner: ctx.connection.default_account, cred: 'M' })`
  (the master token is the person's, not the account's) — the `owner` only picks the write-slot key.

## Tools (new file `src/tools/enterprise.js`, register in `src/tools/index.js`)
| Tool | Kind | GitHub | Notes |
|---|---|---|---|
| `github_enterprise_list` | read | GraphQL above | returns slugs and names |
| `github_enterprise_overview` | read | GraphQL `enterprise(slug:){ name slug createdAt billingEmail ownerInfo { admins(first:50){nodes{login}} members(first:100){totalCount} organizations: ... } organizations(first:100){nodes{login}} }` | check exact fields with `graphql-find`; cap lists, handle `totalCount` |
| `github_enterprise_security_configs` | read | `GET …/code-security/configurations`, `…/defaults`, `…/{configuration_id}`, `…/{configuration_id}/repositories` | |
| `github_enterprise_security_config_save` | write `production:'always'`, `confirm:'always'` | `POST …/code-security/configurations`, `PATCH …/{configuration_id}` | read-back: GET the configuration and compare every field sent |
| `github_enterprise_security_config_delete` | write, confirm | `DELETE …/{configuration_id}` | read-back 404 |
| `github_enterprise_security_config_apply` | write, confirm | `POST …/{configuration_id}/attach`, `PUT …/{configuration_id}/defaults` | summary names the scope (`all`, `all_without_configurations`) |
| `github_enterprise_dependabot` | read | `GET …/dependabot/alerts` (paged, `state`, `severity`), `GET …/dependabot/repository-access` | alert text is `untrusted:true` |
| `github_enterprise_dependabot_access_set` | write, confirm | `PATCH …/dependabot/repository-access`, `PUT …/repository-access/default-level` | |
| `github_enterprise_copilot_agent_policy_set` | write, confirm, `production:'always'` | `PUT …/copilot/policies/coding_agent`, `POST|DELETE …/coding_agent/organizations` | |
| `github_enterprise_copilot_metrics` | read | the six `GET …/copilot/metrics/reports/*` | returns report download URLs/rows as GitHub gives |
| `github_enterprise_actions_settings` | read | `GET …/actions/cache/retention-limit`, `…/storage-limit`, `GET …/actions/oidc/customization/properties/repo` | |
| `github_enterprise_actions_settings_set` | write, confirm | the matching `PUT`/`POST`/`DELETE` | read-merge-write: send only the named field, compare on read-back (TOOL-RECIPES §5) |
Add all tools to `MASTER_AREAS` row "Enterprise (ENT-1)" (GOD-3 file) and to `docs/TOOL-CATALOG.md` (credential `M`).
Membership changes (invite/remove admins or members, create organizations) are **not** in ENT-1 (access widening at
enterprise scale; GQL-1 may add them later with Chris's say-so).

## Tests (named)
- `tests/unit/ent-1-access.test.js`: no master token → refusal; slug not in admin list → refusal (no REST call made);
  slug in list → request goes out with the master token.
- Request-shape test per operation (fake GitHub); GraphQL query shape test (the fake GraphQL validates against the
  vendored schema — copy an existing GraphQL tool test).
- `runWriteContract` for every write tool (production target: enterprise settings are always production).

## Owner step (on `docs/OWNER-CHECKLIST.md`)
Chris replaces his master token once with the "include enterprise permissions" link on the master-token page. Agents
find the enterprise slug themselves with `github_enterprise_list`.

## Done when
- [ ] Tools merged, released (daily release or an owner-requested manual release), and ACC-1 rows "ENT-1 live" recorded
      before 2026-11-22: list, overview, security configs read, one disposable code-security configuration created and
      deleted, Dependabot access read, Copilot metrics read, Actions cache limits read (no paid changes).
- [ ] If the trial ends first: rows recorded as BLOCKED with "Enterprise trial ended"; tools stay (they work for any
      enterprise admin).
