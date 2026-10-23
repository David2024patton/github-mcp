# 2026-10-23 — Real accounts connected; everything possible in PREVIEW checked

`Robinson-AI-Systems` (organization) and `christcr2012` (personal) are now installed and listed beside the scratch organization (connection mode PREVIEW, production off for both new accounts). Live commit 0d268b4.

Read-only results on the real accounts (no changes made):
- Account list and overview: Robinson-AI-Systems plan reads "free"; 15 repositories listed; 4 organization budgets, all $0 with usage prevented; installed apps counted; personal reads say "not signed in" until Authorize as me. christcr2012: 6 public repositories; plan not readable without personal sign-in.
- github-mcp main branch: classic protection read correctly with real data (required checks ci and release-policy, admins enforced). Rulesets and webhooks: none. Branches: 13 listed (old merged ones identified).
- Private repository robinson-ai-systems: branch protection read refused with GitHub's "Upgrade to GitHub Pro" plan message (free organization), stated plainly.
- Preview guard on a real account: budget delete, Codespaces access and repository-settings dry runs are all refused with "production change ... connection is in preview mode"; nothing sent.
- Pull-request status read works on christcr2012/appliance-desk.

Waiting on the owner (see OWNER-CHECKLIST.md): production switch per account and reconnect in Production; "Authorize as me" for personal reads; a plan decision for organization-paid features.
