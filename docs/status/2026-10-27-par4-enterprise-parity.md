# 2026-10-27 — PAR-4 enterprise universal REST permission-parity repair

## Finding
Current pinned GitHub REST offers enterprise Copilot coding-agent policy mutations without a matching GET readback. The enterprise write module documented universal REST as the fallback, but the universal authority layer categorically refused all enterprise routes before the connected user's actual GitHub permissions could be checked. This is a concrete unnecessary MCP-only veto, not a GitHub provider refusal.

## Change on feature branch
The enterprise universal path is constrained to pinned `/enterprises/{enterprise}/...`, valid slug, connected default account and explicit `cred:M`. The existing `requireEnterprise` checks the master token, scope and current GitHub ADMIN membership via GraphQL; write preflight enforces `admin:enterprise`, read uses `read:enterprise`. Curated tool boundaries, user-selected protected list, full/PRODUCTION, spend and single-attempt confirmation remain intact. No same-path GET produces an `unconfirmed` receipt rather than a fake success.

## Evidence and release status
Source plan precommitted at abdceb2 before feature code. Synthetic tests added in `tests/unit/universal.test.js` for credential/membership/scope denial, permission-checked preview, non-repeat journal, and no fabricated readback. Required exact-head CI and review remain to be verified. No live enterprise policy mutation, financial change, repository visibility change, owner connection change or direct `live` update was made. Production continues from verified READY `12d108dc507a2ebf093fa5bbb94d812ea2d72993` until the separately controlled scheduled release.
