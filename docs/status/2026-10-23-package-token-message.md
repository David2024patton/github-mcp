# 2026-10-23 — Package token form: say exactly what is wrong

- Chris's real attempt hit a vague refusal. The setup page now says whether the token is not classic, lacks read:packages (and which permissions GitHub does report), or has extra permissions. Test added in tests/unit/setup-page.test.js.
- Next: release, then Chris retries; agent tests package read (and delete/restore on a throwaway package) once saved.
