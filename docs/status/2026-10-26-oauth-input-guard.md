# 2026-10-26 CONTRIB-3 — owner-integrated OAuth input validation

The maintainer evaluated David2024patton's #399. The existing parser applies 16KB to raw strings but accepts unbounded parsed request objects; public registration also maps malformed body errors to a misleading 503. This branch adds consistent UTF-8 body limits to raw and parsed POST request data, rejects cyclic or impossible serializations, classifies malformed public registration as 400, and tests exact boundaries, multibyte data, forged content length, token/authorize and no-side-effect public registration.

The external PR's in-memory per-IP limiter and new 64KB threshold are not adopted. Neither would prove cross-instance protection, and the present 16KB contract should stay consistent. A bounded, centrally stored ingress quota belongs in separately approved security work with pricing, amplification and privacy review.

No database migration, credentials, production release, GitHub permissions, protected list, cost or API output disclosure. No local full suite in connector-only environment; CI/required release-policy remain the acceptance evidence. David's PR is closed as modified acceptance only after verified green merge.
