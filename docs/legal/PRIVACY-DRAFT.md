# Privacy notice — DRAFT for the owner to approve (not legal advice, not published)

Status: draft written 2026-10-23 from what the server actually does. A lawyer should review it before the public sign-in opens. Items in [brackets] need the owner's choice.

**Who we are.** Robinson AI Systems LLC runs Robinson GitHub MCP, a service that lets an AI assistant you choose work on your GitHub accounts at your direction. Contact: [support email].

## What we store about you
- **Your GitHub identity:** your numeric GitHub user ID and the account names you connect. We never see or store your GitHub password.
- **Sign-in grants:** the GitHub authorization that lets the service act for you, stored encrypted. Optional extra keys you add (package or notification tokens) are stored encrypted too and are typed only on a protected page, never into a chat.
- **Connection settings:** which accounts you connected, whether the connection is read-only, your time zone.
- **A record of changes:** each change your assistant makes is logged with who, where, what, the before/after of what changed, whether it was confirmed, and GitHub's request reference, so it can be explained and, where possible, undone. This can include text of the thing that was changed (for example a file, issue or setting).
- **Short-lived results:** large answers are kept for 24 hours behind a private handle so your assistant can page through them, then removed.
- **Usage counts:** hourly totals of calls by result and speed. They contain no content and no names.
- **Hosting logs:** our hosting provider keeps ordinary request logs (time, address, route, status) for operating and securing the service.

## What your assistant receives
Whatever it asks GitHub for through the service (repository data, issues, files and so on) goes to the AI app you connected, under that app's own terms and privacy policy. We do not control what that app does with it.

## What we do not do
We do not sell your data, show ads, or use your repositories to train models. [Owner to confirm.] We do not read your private repositories except to carry out the request your assistant makes.

## Who else handles data
GitHub (the source of your data and your authorization), our hosting provider (Vercel) and our database provider (Neon). [Owner to list any others added later.]

## How long we keep it
Sign-in grants until they expire or you disconnect; settings and the change record until you ask us to delete them; short-lived results 24 hours; usage counts in aggregate. When you ask to be deleted, we remove your sign-in, grants, settings, change record and saved results for good, and your tokens stop working immediately.

## Your choices
Disconnect any time from your AI app or by revoking the GitHub App's access in your GitHub settings. Delete everything yourself, any time, at the "Delete my data" link on the sign-in page (you sign in with GitHub, confirm once, and it is removed for good), or ask us at [support email]. Choose a read-only connection when you sign in if you want your assistant to only look and preview.

## Children
The service is not for anyone under the age GitHub allows for an account.

## Changes
We will say here, with a date, if this notice changes.
