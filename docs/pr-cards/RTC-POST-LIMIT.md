# RTC-POST-LIMIT — reject inflated declared HTTP body sizes

Status: implementation PR #137; RTC connected acceptance IN_PROGRESS.
Baseline inspected: 62be16c719782f2b2406085b9ff9931d569ebe56 (#136 merged). Restricted server-owned RTC, no DB migration.

## Read only these
AGENTS, SESSION-START, hosting policy, src/rtc/http.js POST paths,
tests/unit/rtc-http.test.js, docs/audits/RTC-HUB-ADOPTION.md.

## Drift check A
| Assumption | Actual at baseline | Correction |
| --- | --- | --- |
| Raw POST size is capped | JSON.stringify(parsed body) can omit wire whitespace/escapes | Reject present oversized or malformed Content-Length first |
| Source exposes raw stream | Current HTTP entry receives parsed request | Preserve decoded guard; absent declared length remains unverified |
| No expanded authority | Only preview/read_only server/meta HTTP pass | Retain all gates, original standalone OAuth MCP |

## Build and acceptance
Both single-tool and batch POST use one declared-size check (strict, safe,
canonical decimal <=32768) plus existing UTF-8 parsed-body bound. Malformed,
ambiguous, enormous headers or excess size deny before dispatch. Regression
unit tests on both POST paths and required exact-head check/unit/db/shapes,
ci plus release-policy and self-review. No new GitHub request or tool.
Deploy/read/denial/revocation/Hub custom OAuth/cleanup remain externally gated.
