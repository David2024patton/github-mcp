# 2026-10-26 — CONTRIB-1: David's safe contributor fixes

Owner requested that the assistant—not the outside contributor—evaluate, correct, integrate or reject every proposed PR. This owned branch consolidates useful ideas from #402 (honest preview/read-only copy), #403 (Windows portability and LF checkout), and safe parts of #404 (nosniff, RFC 9116 security.txt). Unverified HSTS includeSubDomains is intentionally omitted. All original source credit is retained in PR description.

Acceptance: exact-head ci and release-policy both green, no review threads, no production changes, and old PRs not closed until the resulting work is merged. No authorization to change private repo, spending, GitHub branch protections, or production deployment. Existing #409 remains its own independent merge-conflict repair. #399/#400/#401/#405 still need security corrections and real behavior tests.

This branch is written through GitHub; local npm test runner was unavailable in this session; CI evidence is pending.
