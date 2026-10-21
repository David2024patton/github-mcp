# A-3/PUB-2 native Bearer identity routing correction

Owner universal identity/permissions directive, 2026-10-21. Existing A-3/PUB-2 correction;
zero new whole subsections or bundle credit.

Frozen outcome: HTTP Bearer authentication scheme names are case insensitive and accept legal
horizontal whitespace. Preserve token bytes, signed tenant markers, HMAC purpose/revisions,
principal membership, exact tenant SQL namespace, client binding and legacy isolation. Never
send a malformed or revoked tenant-marked bearer through the legacy owner credential store.

Three actual seams: core/mcp-auth legacy authentication; tenancy/mcp-route classification and
extraction. Fix all together so native clients do not lose tenant routing from scheme spelling.
Prove actual legacy token lookup sees exact original bytes; signed private bearer reaches only
root tenant verification, and invalid tenant/revoked/disabled grants remain refused. Full checks,
unit, disposable PostgreSQL/request-shape/RTC CI, exact-head review and release policy required.

This correction does not finish CAP-2/CAP-3/CAP-5, enable pilot/customer production, change grants
or release software. Organizational context remains explicit developer/operator, scoped product
administrator and ordinary customer; email/domain membership grants neither admin nor developer
restrictions. Preserve PUB-4 draft and original real client/provider acceptance.
