# 2026-10-23 — per-person time zones

Built: times shown to a person follow their saved time zone, UTC (labelled) when none is saved. Chosen on the public connect page or the owner setup page; the owner's own connection follows the same rule. Display-only; the spend guard's Denver month and the release schedule are untouched.
Verified: unit tests (zone engine, rate-limit message, shaped results, digest, setup page) and the real-PostgreSQL public-connect suite.
In progress: branch `ai/claude/time-zones-20261023`; PR and CI state recorded in the PR.
Next: production confirmation step for connections without changes ticked; slow-tool time limits and a usage counter.
