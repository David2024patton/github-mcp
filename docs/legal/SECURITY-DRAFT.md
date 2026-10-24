# Security — DRAFT for owner review

Status: proposed 2026-10-24. Not approved for publication as a final statement.

## Reporting a problem
Email [support email] with a description and safe reproduction steps. Do not include passwords, tokens or private keys. Do not test against another person's accounts or data. We review reports and prioritize fixes according to their impact; no guaranteed response time or paid bug bounty is offered.

## Controls implemented by the service
- GitHub handles your GitHub sign-in; we do not collect your GitHub password.
- Stored provider access credentials are encrypted and are kept out of assistant tool results.
- Customer connection data is isolated. An authenticated connection is checked against its permitted accounts and current authorization.
- Read-only options, scoped permissions, previews, confirmation controls and change records help users control operations.
- Usage limits and burst controls help protect service capacity.
- Marketplace connections have separate enrollment and cancellation state so cancellation does not erase independent direct connections.

## Limits and user responsibilities
These controls reduce risk; they do not guarantee that an assistant's instructions or changes are safe. Broad permissions can allow consequential or destructive actions. Choose permissions deliberately, review important operations, maintain backups, keep your GitHub account secure and use two-factor authentication.

No independent security audit, SOC 2, ISO 27001 or regulatory compliance certification is claimed. This service is a hosted integration; users choose their own assistant, and its separate security and data practices also apply.
