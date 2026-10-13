# harden-server-1: integration verification (iteration 1)

Worktree `.worktrees/harden-server-1`, branch `fix/harden-server-1`, HEAD `ceb255d`.
Commits on top of base `91e02a6`: `88fe42b` (FEAT-001), `5b179cb` (FEAT-002), `ceb255d` (FEAT-003). Nothing pushed.
Seam review: FEAT-001 and FEAT-002 both touch `server.js` and `routes/notifications.js`; the edits are in disjoint hunks
(warning/error-log vs. archive mount; L28/L48-51 vs. `debugOnly` + two route definitions). No conflicts, no runtime fix was needed,
so this iteration made no code changes.

## (a) `node --check`
`server.js`, all 11 `routes/*.js`, all 14 `lib/*.js`: 26 files, 26 exit 0, 0 failures.

## (b) Ordered route list vs baseline
Walker (temp `tmp-routes.js`, wraps `express.application.listen`, demo/development, walks `app._router.stack` into routers)
-> `%TEMP%\harden-routes-final.txt`.
- 66 routes; `Compare-Object -SyncWindow 0` against `.agents/tasks/server-split-routes-before.txt` (parent workspace): no difference.
- SHA-256 of both files identical (`03FD6D91...E5A5`).
- Last three entries are `POST /api/archive/run`, `GET /api/archive/years`, `GET /api/archive/presents`.
- The 4-arity error handler is the LAST layer of `app._router.stack` (index 23); before FEAT-002 it was second to last.

## (c) F1 sentinel log check and F4 boot matrix (temp harness + fake-DB preload, 47 PASS / 0 FAIL)
Sentinels: the real session cookie value (encoded, decoded, session id, signature), `prezenty.sid=`, `SENTINEL_ENDPOINT_TOKEN`,
`SENTINEL_P256`, `SENTINEL_AUTH`, `SENTINEL_PW`. Requests: login, `GET /`, `GET /api/auth`, subscribe, `POST /api/recipients`,
`POST /api/user/identify`, malformed-JSON login, and (fake DB) `POST /api/test-notification` to drive the `lib/push.js` failure branch.
- Demo (`OFFLINE_MODE=true NODE_ENV=development`): login 200, recipients 200, identify 500 (known out-of-scope demo bug), malformed JSON 400.
  Captured stdout+stderr contains none of the sentinels; still prints `Auth successful for user: tester` and `Server error:` lines; no `[SECURITY]` line.
- Fake DB (non-demo, `DB_PASSWORD=x`, mocked mysql2 / express-mysql-session / web-push): subscribe 200, recipients 200; none of the sentinels
  in output; `fcm.googleapis.com` host IS logged; `[SUBSCRIPTION] Saving subscription` and `Failed to send to user` (lib/push.js) branches executed.
- Static grep over `server.js routes lib` for `sessionID`, `req.headers.cookie`, `session.cookie`, `session: req.session`, `'Session:'`, `req.session)`,
  endpoint `substring`: 0 hits.
- F4 boot matrix (`[SECURITY]` lines): demo+development 0; demo+production, no secrets 1 (names SESSION_SECRET and VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY);
  demo+production with SESSION_SECRET and a freshly generated VAPID pair 0; fake-DB non-demo+development no secrets 1; demo+production with
  SESSION_SECRET only 1 (names VAPID only). In every scenario the output contains neither `prezenty_secret`, nor the fallback VAPID private key,
  nor the generated private key, nor `e2e-fixed-secret`.
- F2 status matrix (authed / unauth, `GET /api/notifications/debug` and `POST /api/test-notification`):
  demo+production 200,200 / 401,401; non-demo+development 200,200 / 401,401; non-demo+production 404,404 / 404,404, and the 404 body matches the
  default Express 404 for an unknown path (identical apart from the echoed path).

## (d) Full Playwright suite
`npx playwright test --reporter=list` from the worktree root: **121 passed, 0 failed, 11 skipped** (9.4 min; another worktree's suite was running
concurrently on its own ephemeral port). Matches the expected counts exactly. Demo server stopped by the harness teardown.

## Cleanup
All `tmp-*.js` (tmp-routes, tmp-verify, tmp-fakedb) deleted. No node process from this worktree left running. `git status`: only untracked
`.agents/` files; no tracked changes. Out-of-scope items untouched (secret values, 413 message, demo 500s, unread-count, formularz ALTER, dead code, CSP/helmet/rate-limit, `public/`).

## Final state

Branch `fix/harden-server-1`, tip `ceb255d`, base `91e02a6`. Nothing pushed, nothing merged. Review verdict: APPROVED (3 minor, non-blocking notes).

### Commits
- `88fe42b` fix(security): Redact session and push data from logs (F1, F4, F5)
- `5b179cb` fix(security): 404 debug endpoints in production (F2)
- `ceb255d` fix(security): Harden link preview against SSRF (F3)

### Files changed (10, +290/-61)
DEPLOYMENT.md, README.md, lib/link-preview.js, lib/push.js, routes/auth.js, routes/chat.js, routes/notifications.js, routes/pages.js, routes/recipients.js, server.js.
No changes under `public/`, none to package.json or package-lock.json. Working tree clean apart from untracked `.agents/` files; no tmp-*.js.

### Findings
| # | Finding | Status |
|---|---|---|
| F1 | Cookie / session / push-endpoint logging | Fixed: no cookie, session id, session object or endpoint/key logged; endpoint reduced to push-service host |
| F2 | Debug endpoints open to any logged-in user | Fixed: `GET /api/notifications/debug` and `POST /api/test-notification` return default 404 when !demo and NODE_ENV=production |
| F3 | Link-preview SSRF | Fixed: private/loopback/link-local/reserved addresses rejected, DNS-pinned lookup, redirect hops re-validated (max 3) |
| F4 | Secret fallbacks | Mitigated by design: values unchanged, one `[SECURITY]` warning (names only), rotation documented in DEPLOYMENT.md |
| F5 | Archive routes after error handler | Fixed: archive router mounted before error handler; 66 routes, identical to baseline |

### Deploy-config facts (SESSION_SECRET / VAPID)
- render.yaml: SESSION_SECRET `generateValue: true` (only applies when the Blueprint creates it; check the live service); VAPID_* not set.
- vercel.json and Dockerfile: neither is set.
- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL must be set by the owner. Fallback values are committed to git, so they are public; rotate, do not just delete.
- New SESSION_SECRET logs everyone out once. New VAPID pair invalidates existing push subscriptions (403, auto-deleted, devices resubscribe).

### Out of scope, untouched
Secret values, 413 message, demo-mode 500s (e.g. identify), unread-count, formularz ALTER, dead code, CSP/helmet/rate-limit, `public/`, `.worktrees/extract-inline-1`.

### User-visible behavior changes
- Production (non-demo) returns 404 on the two debug endpoints.
- Link-preview hosts resolving to private addresses return an empty preview; single-label and *.localhost hosts get the existing 400.
- One new startup `[SECURITY]` warning line when running on fallback secrets in production/DB mode.
- Existing users stay logged in: secrets are unchanged.

### Verification
Route list identical (66, SHA-256 match); node --check 26/26; Playwright 121 passed / 0 failed / 11 skipped; sentinel log checks clean; boot matrix and F2 status matrix as in sections above.
