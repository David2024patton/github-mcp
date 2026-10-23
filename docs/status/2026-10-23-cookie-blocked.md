# 2026-10-23 — Sign-in button: the phone browser returned no cookies at all

Live log: "form-check origin=ok cookie=missing anyCookies=none". The server sends the page's safety cookie correctly (checked its real response headers); the browser did not send anything back. Added: the refusal log line now records the browser's fetch hints and a short user-agent, and a person whose browser returns no cookie sees a plain "Your browser blocked a cookie" page instead of "Could not connect". Next: release, Chris retries, read the log to learn which browser/app it is, then fix properly (possibly a cookie-free form step).

Correction (same day): the live records show the sign-in WORKED on the first press (callback, then a person account created at 21:24 UTC). The "Could not connect" only appeared on a second press of the same page, whose one-time safety cookie the first press had already used. So the cookie was never blocked; the extra message now says "This page was already used ... you are probably connected" instead of blaming cookies.

Also: the records show the sign-in and code issue worked (account created, 6 codes) but no access token was ever issued, so Claude's collect-the-code step is failing or not arriving. The token step now logs what kind of request arrived (grant, whether a secret / Basic header / resource / verifier came) and how it ended, without any secret values.
