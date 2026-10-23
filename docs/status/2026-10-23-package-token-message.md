# 2026-10-23 — Package token form refused a correct token

- Chris created a classic token with write:packages and delete:packages ticked (screenshot) and the setup page refused it. Cause: GitHub reports only the ticked boxes and includes read:packages automatically under write:packages, but the page required the literal text read:packages. Fixed: write:packages implies read:packages. Test fails without the fix.
- Also: the refusal now says exactly what is wrong (not classic / missing read / extra permissions).
- Next: release, Chris retries pasting the token, agent tests package read and, on a throwaway package, delete/restore.
