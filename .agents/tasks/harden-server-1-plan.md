# Plan: harden-server-1 (conservative security hardening)

Worktree: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\harden-server-1`
(branch `fix/harden-server-1`, base `91e02a6`, the server.js split into `routes/` + `lib/`).
All paths below are relative to that worktree. Use absolute paths when editing. PowerShell: use `;`, not `&&`.
OneDrive: retry any "cloud file provider exited unexpectedly" error.

Note: `.agents/tasks/phase2-plan.md` and `server-split-routes-{before,after}.txt` are NOT in the worktree
(untracked in the parent workspace: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\`).
`refactor-manageable-1-verification.md` IS in the worktree and was read. The coder must regenerate the route baseline
itself from the unmodified worktree HEAD (see "Verification toolkit").

## Findings status (all 5 CONFIRMED, none SKIP)

| # | Finding | Exists as described? | Where |
|---|---|---|---|
| 1 | Cookie / session / push-endpoint logging | YES (and a bit wider than described) | see F1 table |
| 2 | Debug endpoints open to any logged-in user | YES | `routes/notifications.js` L100 and L316 |
| 3 | Hostname-string-only SSRF guard | YES | `lib/link-preview.js` L7-15, `routes/chat.js` L401-484 |
| 4 | Hard-coded secret fallbacks | YES | `server.js` L90, `lib/webpush-config.js` L10-12 |
| 5 | Archive router mounted after error handler | YES | `server.js` L167-168 |

---------------------------------------------------------------------------------------------------

## F1. Logging of cookies / sessions / push endpoints  (CONFIRMED)

Exact offenders (line numbers at base `91e02a6`):

| File | Lines | What leaks | Fix |
|---|---|---|---|
| `routes/auth.js` | 184-190 (`GET /api/auth`) | `sessionID`, full `req.session.cookie`, and **raw `req.headers.cookie`** (the signed session cookie) on EVERY auth check | Log only `{ userId, username }` |
| `routes/auth.js` | 30-34 and 64-68 (login "Session saved successfully") | `sessionID` | Drop the `sessionID` field |
| `routes/pages.js` | 10-15 (`GET /`) | `sessionID`, `req.session.cookie` | Log only `{ userId, username }` |
| `routes/recipients.js` | 75, 94, 105 (POST /api/recipients), 545, 596 (POST /api/user/identify) | whole `req.session` object (contains cookie settings and any session data) | Replace `session: req.session` / `'Session:', req.session` with `userId: req.session && req.session.userId`. Keep `body` (it only holds `{ name }`) so log volume is unchanged |
| `routes/notifications.js` | 28 (demo subscribe) | whole `subscription` (endpoint + `keys.p256dh` + `keys.auth`) | Log `{ userId, hasEndpoint: !!(subscription && subscription.endpoint) }` |
| `routes/notifications.js` | 48-51 | first 50 chars of the push endpoint. For FCM that is the 36-char URL prefix plus ~14 chars of the device token | Log the push-service host only (helper below) |
| `lib/push.js` | 69 and 84 | same 50-char endpoint prefix | Same helper |
| `server.js` | L149-151 error handler `console.error('Server error:', err)` | For malformed JSON, body-parser's `SyntaxError` carries `err.body` (the raw request text, could include a password or subscription). `util.inspect` prints it | For `err.type === 'entity.parse.failed'` log `err.message` only; leave every other error as is |

Helper: add and export `pushServiceHost(endpoint)` in `lib/push.js`
(`try { return new URL(endpoint).host } catch { return 'unknown' }`), and require it in `routes/notifications.js`
(that file already requires `../lib/push`). Log text becomes e.g. `(push service: fcm.googleapis.com)`.

Not changed (already safe, keep as is): `lib/auth.js` (userId/username only), `routes/auth.js` L14/L206 (username +
`hasPassword` flag), `server.js` L81 "Session configuration", `lib/db.js` L33 (`hasPassword`), `routes/recipients.js`
L371 (header content-type and body keys only), `lib/webpush-config.js` (never prints a key), `lib/push.js` L62 payload
(notification title/body). Do not add, remove or reword any other log line.

Verification (F1):
1. Static: `Select-String` over `server.js routes lib` for `sessionID|req\.headers\.cookie|\.cookie\b|session:|'Session:'|req\.session\)|req\.session\s*\}` inside `console.*` calls (multi-line calls too, e.g. L30, L184, L10, L48 start a call that spans lines). Expect no hit except the `cookie:` options object in `server.js` L93-99 (session config, not a log).
2. Runtime, demo mode (the Playwright way: `OFFLINE_MODE=true NODE_ENV=development HOST=127.0.0.1 PORT=<free> SESSION_SECRET=e2e-fixed-secret`, no `DB_PASSWORD`): boot `node server.js`, capture stdout+stderr, `POST /api/login` (keep the `Set-Cookie` value), then `GET /` and `GET /api/auth` with the cookie, `POST /api/notifications/subscribe` with sentinel `endpoint: https://fcm.googleapis.com/fcm/send/SENTINEL_ENDPOINT_TOKEN`, `keys: { p256dh: 'SENTINEL_P256', auth: 'SENTINEL_AUTH' }`, `POST /api/recipients {name}`, `POST /api/user/identify {name}` (500 in demo is the pre-existing out-of-scope bug; it still exercises L545/L596), and a malformed-JSON POST (e.g. body `{"password":"SENTINEL_PW"` to `/api/login`). Assert captured output contains NONE of: the cookie value (the part after `prezenty.sid=`), the session id, `SENTINEL_ENDPOINT_TOKEN`, `SENTINEL_P256`, `SENTINEL_AUTH`, `SENTINEL_PW`, `prezenty.sid=`. Assert it still contains the user id/username lines (e.g. `Auth check: User IS authenticated`).
3. Runtime, fake DB (non-demo; same preload technique as F2) to execute the `pool.execute` branches: L94/L105 (recipients), L48-51 (subscribe), `lib/push.js` L69/L84 (make the fake `web-push` `sendNotification` reject once with `{statusCode: 500}` and have the fake pool return one subscription row with the SENTINEL endpoint). Same assertions.
4. `node --check` on every edited file.

---------------------------------------------------------------------------------------------------

## F2. Debug endpoints open to any logged-in user  (CONFIRMED)

- `GET /api/notifications/debug`: `routes/notifications.js` L100 `router.get('/api/notifications/debug', requireAuth, ...)`.
- `POST /api/test-notification`: `routes/notifications.js` L316 `router.post('/api/test-notification', requireAuth, ...)`.
- Both only use `requireAuth`. The debug endpoint reveals subscription counts and all user IDs that have subscriptions; the test endpoint pushes a notification to every subscribed user (with `includeCurrentUser` false it spams everyone else).

Usage grep (tests/ and public/): NO test references either endpoint. `public/recipients.html` L2214 has a
`testNotification()` function that POSTs `/api/test-notification`; there is no element with
`id="testNotificationButton"` in any `public/*.html` markup (only JS lookups at L2207 and L2248), so no rendered UI
calls it today. `docs/archive/misc/test-notifications.md` and `.kiro/specs/...` mention them in prose only.
=> gating cannot break tests or UI. Demo/dev behavior must still be 200 (still reachable by hand).

Fix design (`routes/notifications.js` only):
```js
// Debug/test endpoints: answer only in demo mode or outside production; otherwise 404 as if they did not exist.
function debugOnly(req, res, next) {
    if (DEMO_MODE || process.env.NODE_ENV !== 'production') return next();
    return next('route'); // skip this route; falls through to Express's default 404
}
router.get('/api/notifications/debug', debugOnly, requireAuth, async ...
router.post('/api/test-notification', debugOnly, requireAuth, async ...
```
- `debugOnly` goes BEFORE `requireAuth` so unauthenticated callers also see 404 in production (no existence leak).
- Routes stay registered at the same positions (the ordered route list must stay byte-identical).
- `next('route')` reaches the default finalhandler: no later route matches `GET /api/notifications/debug` or `POST /api/test-notification` (the only `/api/notifications/*` GETs are the exact `/api/notifications` and `/api/notifications/unread-count`), so the response is the same 404 as any unknown path. There is no custom 404 handler in the app (confirmed by grep).
- `NODE_ENV` is read per request (cheap, testable). Add the one-line comment above `debugOnly`.

Verification (F2): boot the real `server.js` three ways with the fake-DB preload (see toolkit), log in, then for each mode record status of `GET /api/notifications/debug` and `POST /api/test-notification` (authed and unauthed):
- demo + NODE_ENV=production (`OFFLINE_MODE=true NODE_ENV=production`, add `X-Forwarded-Proto: https` because the session cookie is `secure` in production and `trust proxy` is 1): expect 200/200 authed (demo debug JSON; test-notification returns 200 or 503 only if web-push is missing), 401 unauthed.
- non-demo + NODE_ENV=development (fake DB, `DB_PASSWORD=x`): expect not 404 (200), unauthed 401.
- non-demo + NODE_ENV=production (fake DB): expect 404 for all four requests, and body identical to the 404 for `GET /api/this-does-not-exist`.
Plus the route-list diff in F5 (routes remain registered).

---------------------------------------------------------------------------------------------------

## F3. Link-preview SSRF guard  (CONFIRMED)

Current state:
- `lib/link-preview.js` L7-15 `isSafePreviewUrl(parsed)`: protocol http/https; then regexes on the hostname string only: `localhost`, `0.0.0.0`, the literal `[::1]`, `^127\.|^10\.|^192\.168\.|^169\.254\.`, and 172.16-31. No DNS resolution, so any public hostname that resolves to 127.0.0.1 / 10.x / 169.254.169.254 passes. Missing entirely: CGNAT 100.64/10, IPv6 ULA/link-local, IPv4-mapped IPv6 (`[::ffff:7f00:1]`), `0.x`, multicast, `*.localhost`. (WHATWG `new URL` already normalizes `0x7f.0.0.1` and `2130706433` to `127.0.0.1`, so those are caught today only because the regexes then match; they must remain caught.)
- `routes/chat.js` L401-484 `GET /api/link-preview`: `new URL(raw)` -> `isSafePreviewUrl` (400 `Ten adres nie jest obsługiwany`) -> demo-mode early return (no outbound request) -> cache -> `fetch(parsed.href, { redirect: 'follow', signal: 6 s timer cleared after headers })` -> non-HTML branch -> read up to 300000 chars -> `extractMeta`. `redirect: 'follow'` means a public URL can 302 to `http://169.254.169.254/...` and the guard never sees it. Nothing else in `routes/` or `lib/` performs outbound fetches (`lib/cron.js` pings a fixed constant URL).

Design (`lib/link-preview.js` rewritten internally; routes/chat.js changed only at the fetch block):

Keep as-is (public contract): exports `linkPreviewCache`, `LINK_PREVIEW_TTL`, `extractMeta`, and
`isSafePreviewUrl(parsedUrl) -> boolean` (sync, same argument, same boolean result; the route's 400 path unchanged).
Add exports `isBlockedAddress`, `createPreviewFetcher`, `fetchPreview`.

1. `isBlockedAddress(ip)`: fail closed (`net.isIP(ip) === 0` => true). Use `net.BlockList` with: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`; IPv6 `::/128`, `::1/128`, `::ffff:0:0/96` (IPv4-mapped, blocked wholesale), `64:ff9b::/96` (NAT64), `100::/64`, `2001:db8::/32`, `2002::/16` (6to4), `fc00::/7`, `fe80::/10`, `ff00::/8`. Strip a `%zone` suffix first. (Node 18+ in Dockerfile and engines `>=16`; `net.BlockList` exists since v15.)
2. `isSafePreviewUrl(parsed)` (sync): protocol must be `http:`/`https:`; host = `parsed.hostname` lowercased, brackets and trailing dot stripped; reject empty host, `localhost`, `*.localhost`, and single-label hosts (no `.`, no `:`); if `net.isIP(host)` then `!isBlockedAddress(host)`. Because `new URL` canonicalizes numeric/octal/hex/decimal IPv4 forms to dotted decimal, this closes the literal tricks.
3. `createSafeLookup(dnsLookup = dns.lookup, isBlocked = isBlockedAddress)` returns a `lookup(hostname, options, cb)` for `http(s).request({ lookup })`: calls `dnsLookup(hostname, { all: true, verbatim: true }, ...)`; if it returns no addresses, or ANY address `isBlocked`, call back with an error (`code: 'ESSRF_BLOCKED'`); otherwise hand the validated list back. Honour BOTH call styles: `options.all` true => `cb(null, [{address,family},...])` (Node 20+ `autoSelectFamily` uses this), else `cb(null, address, family)`. Call `dns.lookup` via the module object (`dns.lookup(...)`, or the injected function), never a destructured copy, so a unit test can stub it. This pins the connection: the socket connects to exactly the addresses that were validated (single resolution, so no check-then-connect gap = DNS-rebinding defence).
4. `createPreviewFetcher({ lookup, isBlockedAddress })` returns `fetchPreview(rawUrl, { timeoutMs = 6000, maxChars = 300000, maxRedirects = 3 })`, default instance exported as `fetchPreview`:
   - Loop up to `maxRedirects + 1` hops. Each hop: `new URL(next, current)`; require `isSafePreviewUrl`; pick `http`/`https`; `mod.request(url, { method: 'GET', agent: false, lookup, headers })` with the existing headers (`User-Agent: Mozilla/5.0 (compatible; PrezentyBot/1.0; link preview)`, `Accept: text/html,application/xhtml+xml`) plus `Accept-Encoding: gzip, deflate, br`; `agent: false` so no socket is reused across hops and every hop re-resolves and re-validates. Belt and braces: on response, also check `res.socket.remoteAddress` with `isBlockedAddress` (covers IP-literal hosts, which skip `lookup`) and abort if blocked.
   - Redirect statuses 301/302/303/307/308 with `Location`: drain (`res.resume()`), loop to next hop; more than `maxRedirects` hops => reject.
   - One overall timer (`timeoutMs`, default 6000) started at the beginning, cleared when the final response headers arrive; this is the same coverage as the old `AbortController` timer (redirects + headers). On expiry destroy the request and reject.
   - Final response: decode `content-encoding` (gzip/deflate/br via `zlib`), read at most `maxChars` characters (decoded with `TextDecoder`, `{ stream: true }`, same as now) and then destroy the stream. For non-`text/html` content types do NOT read the body (as now). Resolve `{ finalUrl, contentType, html }` (`html` is `''` for non-HTML). Do not reject on non-2xx (old `fetch` code did not check `ok`).
   - The factory arguments are the test seam (no production bypass flag exists).
5. `routes/chat.js` L426-455: replace the `AbortController`/`fetch`/reader block with `const page = await fetchPreview(parsed.href);` and use `page.contentType`, `page.html`, `page.finalUrl` (where the code used `response.url || parsed.href`). Everything else is untouched: cache keys, the non-HTML `data` object (`image: contentType.startsWith('image/') ? parsed.href : null`), `extractMeta`, the 500-entry cache cap, the demo-mode early return, and the catch block that caches an empty `{ url, title: null, image: null, siteName }` and answers 200. Consequence to document in a code comment: a hostname that resolves to a private address, or a redirect into one, yields that same graceful empty preview (HTTP 200), not a 400; literal private IPs still get the existing 400 from `isSafePreviewUrl`. Update the require line at L15 to also import `fetchPreview`.

Verification (F3): a temporary script `tmp-ssrf-check.js` in the worktree root (delete afterward, never commit) that requires `./lib/link-preview` and asserts, with `isSafePreviewUrl(new URL(x))` for literals and `fetchPreview` (built via `createPreviewFetcher` with stubbed `dns.lookup`) for hostnames:
- REJECT: `http://127.0.0.1`, `http://localhost`, `http://[::1]`, `http://0x7f.0.0.1`, `http://2130706433`, `http://017700000001`, `http://169.254.169.254/latest/meta-data`, `http://10.0.0.5`, `http://172.16.0.1`, `http://192.168.1.1`, `http://100.64.0.1`, `http://0.0.0.0`, `http://[::ffff:127.0.0.1]`, `http://[::ffff:7f00:1]`, `http://[fc00::1]`, `http://[fe80::1]`, `http://224.0.0.1`, `file:///etc/passwd`, `ftp://example.com/x`.
- REJECT via DNS: `http://evil.test/` with `dns.lookup` stubbed to return `127.0.0.1`; a stub returning TWO addresses `[93.184.216.34, 10.0.0.5]` (one public + one private) must also be rejected; stub returning `::ffff:10.0.0.5`.
- REJECT on redirect: a local `http` test server on 127.0.0.1 that answers 302 `Location: http://169.254.169.254/` (and another hop to `http://evil2.test/` stubbed to 127.0.0.1). The fetcher is created with an injected `isBlockedAddress` that exempts `127.0.0.1` for the FIRST hop's lookup only (stateful closure) so the test server is reachable on hop 1 and the redirect target is rejected; separately check a >3-redirect chain rejects.
- ACCEPT: `https://example.com/` with `dns.lookup` stubbed to `93.184.216.34` passes `isSafePreviewUrl` and the lookup validator (assert the validator returns the address list; no real network call is made; a real fetch is not needed). Also a local test server run as an ACCEPT case for the full fetch+HTML read path using the same hop-1 exemption: returns `<title>T</title><meta property="og:image" content="/i.png">` and the script asserts `{ finalUrl, contentType: 'text/html...', html }` and that `extractMeta` still works; also gzip body decodes.
- All private cases rejected, allowed cases accepted; then `Remove-Item tmp-ssrf-check.js`.
- Route-level: boot with the fake-DB preload (non-demo) and `GET /api/link-preview?url=http://127.0.0.1/` => 400 `Ten adres nie jest obsługiwany` (unchanged), `?url=http://169.254.169.254/` => 400, and an unauthenticated call => 401. Demo-mode `GET /api/link-preview?url=https://example.com` still returns the empty-preview JSON with no outbound request (Playwright covers the chat UI).

---------------------------------------------------------------------------------------------------

## F4. Secret fallbacks (design only; do NOT remove or change them)  (CONFIRMED)

Where:
- `server.js` L90: `secret: process.env.SESSION_SECRET || 'prezenty_secret'`.
- `lib/webpush-config.js` L10-12: `VAPID_PRIVATE_KEY` (and the matching public key) default to committed literals; `VAPID_EMAIL` defaults to `mailto:prezenty@example.com`. The module already logs (not warns) at L31-35 when the pair falls back; keep that untouched.

Deploy-config facts:
| File | SESSION_SECRET | VAPID_* |
|---|---|---|
| `render.yaml` | `generateValue: true` (Render generates one; note that only takes effect when the Blueprint creates the var, so the live service could still differ) | NOT set (no `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_EMAIL`) |
| `vercel.json` | NOT set (`env` has only `NODE_ENV` and a `DATABASE_URL` placeholder the app never reads; it uses `DB_*`) | NOT set |
| `Dockerfile` | NOT set (`ENV NODE_ENV=production`, `ENV PORT=3000` only) | NOT set |
| `DEPLOYMENT.md` | L27-28 lists `SESSION_SECRET (auto-generated)` for Render | NOT mentioned anywhere |
| `README.md` | L28 sample `.env` has `SESSION_SECRET=your_session_secret` | NOT mentioned |
So VAPID almost certainly runs on the committed fallback key in production. SESSION_SECRET is secure only on a Render Blueprint deploy (and any other host where the operator set it).

Design:
(a) Startup warning, `server.js`, immediately after the existing `Session configuration:` log (L81-85), runs once at boot, never prints a value:
```js
// Warn (names only, never values) when production/non-demo runs on the committed fallback secrets
const fallbackSecrets = [];
if (!process.env.SESSION_SECRET) fallbackSecrets.push('SESSION_SECRET');
if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) fallbackSecrets.push('VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY');
if ((process.env.NODE_ENV === 'production' || !DEMO_MODE) && fallbackSecrets.length) {
    console.warn(`⚠️ [SECURITY] Using the committed fallback value for: ${fallbackSecrets.join(', ')}. ` +
        'Set these env vars and rotate them (see DEPLOYMENT.md "Rotating secrets").');
}
```
  One `console.warn` line total. `DEMO_MODE` is already imported in `server.js`. Demo+development (the Playwright server) prints nothing, so its boot log stays identical. It goes to stderr via `console.warn`: that is fine, but note the e2e harness captures stderr only for diagnostics (`start-demo-server.js`), not asserted.
(b) Docs: append a "Rotating secrets" section to `DEPLOYMENT.md` (and add the missing `VAPID_*` vars to its env var list near L27) with:
  - generate a session secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - generate VAPID keys: `npx web-push generate-vapid-keys`
  - set `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (and `VAPID_EMAIL=mailto:you@yourdomain`) in the host's env settings (Render dashboard / Docker `-e` / Vercel env), redeploy.
  - consequences: changing `SESSION_SECRET` invalidates every existing session cookie, so everyone is logged out once (session rows in the MySQL store just expire); changing the VAPID pair makes existing push subscriptions fail with 403, the server deletes them automatically (`lib/push.js` L90), and each device re-subscribes on its next visit; set both VAPID values together (the boot check in `lib/webpush-config.js` reports a mismatch).
  - rotate both because the fallback values are public in git history; after rotating, they are still in history, which is why rotation (not deletion) matters.
  - add a one-line pointer in `README.md` env section (L28) to that DEPLOYMENT.md section.
Verification (F4): boot demo+development: no `[SECURITY]` line and boot log identical to before; boot with `OFFLINE_MODE=true NODE_ENV=production`: exactly one `[SECURITY]` line naming both vars; with `SESSION_SECRET` and both `VAPID_*` set: no line; with fake-DB non-demo: line appears. Grep captured output to prove neither `prezenty_secret` nor any part of the VAPID private key is printed. `node --check server.js`.

---------------------------------------------------------------------------------------------------

## F5. Archive routes mounted after the error handler  (CONFIRMED)

- `server.js` L167-168: `// Registered after the error handler, exactly as before the split` + `app.use(archiveRoutes);`, placed after the 4-arity error middleware (L148-165). The three archive routes (`POST /api/archive/run`, `GET /api/archive/years`, `GET /api/archive/presents`, `routes/archive.js` L34/L103/L120) are the LAST three entries of the 66-route baseline. Errors that reach `next(err)` from them (e.g. a synchronous throw or a `next(err)` call) skip the JSON handler and get Express's default HTML 500.
- `routes/archive.js` is a plain router with no `router.use`; the `lateRouter` mechanism is only in `presents`/`auth`/`recipients` and is not affected.

Fix: delete the 2 lines at L167-168 and add `app.use(archiveRoutes);` directly after `app.use(recipientRoutes.lateRouter); // POST /api/user/identify` (L146), BEFORE the `// Error handling middleware` block. No other mount moves. Because archive was already the last router, the flattened ordered route list is unchanged by construction; only the error layer moves from before the archive router to after it.

Verification (F5):
1. Before editing, regenerate the baseline from the untouched worktree: temp script `tmp-routes.js` (root of the worktree, deleted afterward) that patches `express.application.listen` (and `http.Server.prototype.listen` is not needed) to capture the `app`, sets `OFFLINE_MODE=true NODE_ENV=development`, requires `./server.js`, then walks `app._router.stack`, descending into `layer.handle.stack` for routers, printing `METHOD /path` for each `layer.route` (all methods). Save to `%TEMP%\harden-routes-before.txt`. Compare with `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.agents\tasks\server-split-routes-before.txt` (66 lines; expect identical). Also print a layer summary and the index of the 4-arity layer.
2. After the edit and after F2 (which adds middleware only inside route definitions, so it cannot change the list), regenerate to `%TEMP%\harden-routes-after.txt` and run `fc` (or `Compare-Object -SyncWindow 0`) - expect NO difference, 66 routes, same order. Expect the error layer to be the LAST entry of `app._router.stack` (it used to be second to last).
3. Behavioural proof: temp harness that, BEFORE requiring `server.js`, requires `./routes/archive` and appends `router.get('/api/archive/__boom', (req, res) => { throw new Error('boom'); })`, boots demo mode, logs in and `GET /api/archive/__boom`. At the unmodified HEAD this returns Express's default HTML 500; after the fix it returns the JSON error from the global handler (`handleDbError` body). Record both. Delete the harness (the `__boom` route never reaches the repo).

---------------------------------------------------------------------------------------------------

## Verification toolkit (shared)

- Node v24.11.0. The server entry is `server.js`; it does not export `app` and calls `startServer()` at require time, so harnesses capture the app by wrapping `express.application.listen` before requiring `server.js`.
- Demo server env (as `tests/helpers/start-demo-server.js` does): `OFFLINE_MODE=true NODE_ENV=development HOST=127.0.0.1 PORT=<free port> SESSION_SECRET=e2e-fixed-secret`, `DB_PASSWORD` deleted.
- Fake-DB (non-demo) run, like the refactor's differential: a preload file (e.g. `node -r ./tmp-fakedb.js server.js`) that hooks `Module._load` for `mysql2/promise` (fake `createPool` returning `{ execute, query, getConnection }` with canned rows: a `users` row whose `password` is `bcrypt.hashSync('pw', 4)` using whichever bcrypt package `routes/auth.js` requires; `getConnection` -> `{ ping, release, beginTransaction, commit, rollback, execute }`), `express-mysql-session` (returns a class extending `session.MemoryStore`), and `web-push` (`setVapidDetails` no-op, `sendNotification` records/rejects as the test needs). Set `DB_PASSWORD=x` (and not `DEMO_MODE`/`OFFLINE_MODE`) so `DEMO_MODE` is false. With `NODE_ENV=production` the session cookie is `secure`, so send `X-Forwarded-Proto: https` (`trust proxy` is 1). Delete all `tmp-*.js` files after use; never stage them.
- Full suite once, at the integration step: `npx playwright test --reporter=list` from the worktree root (~8 min, `workers: 1`, Edge channel, demo-mode server on a free port). Expected EXACTLY: **121 passed, 0 failed, 11 skipped**. Do not run it per feature.
- Build step: there is no compile step; `node --check` each edited file, then boot the app (demo) and `GET /health` -> 200.
- Commits: Conventional Commits, `sim:` footer only if a SIM URL exists (none given - omit the trailer), one commit per FEAT, **never push**, stage files by name (do NOT stage anything under `.agents/`, nor `tmp-*.js`). The `git` rules also say build before commit; here "build" = `node --check` + demo boot + the FEAT's verification.

## Explicitly NOT touched (out of scope)

Secret VALUES and the fallbacks themselves; the 413 message/limit mismatch (10MB text vs 50mb parsers); demo-mode 500s on `GET /api/recipients/:id` and `POST /api/user/identify`; the unread-count inconsistency; formularz lazy `ALTER TABLE`; dead code and the unused `path` dependency; CSP / helmet / rate-limit additions; anything in `public/` (including the dead `testNotification()` caller in `recipients.html`); the sibling worktree `.worktrees/extract-inline-1`; `package.json` / lockfile (no new dependencies - `dns`, `net`, `http`, `https`, `zlib` are built in); the order of every other registered route; `lib/auth.js` logging; cron keep-alive; session cookie options.

## Decomposition (restructured workflow tail)

Three independent FEATs, executed sequentially in the shared worktree, then the convergence loop, then finalize:
- FEAT-001 `fix`: F1 log redaction + F4 startup warning and "Rotating secrets" docs. Files: `routes/auth.js`, `routes/pages.js`, `routes/recipients.js`, `routes/notifications.js` (L28, L48-51 only), `lib/push.js`, `server.js` (warning + error-log redaction), `DEPLOYMENT.md`, `README.md`.
- FEAT-002 `fix`: F2 debug gating + F5 archive mount order. Files: `routes/notifications.js` (route definitions L100/L316 only), `server.js` (mount line only).
- FEAT-003 `fix`: F3 SSRF. Files: `lib/link-preview.js`, `routes/chat.js` (require + fetch block).
Machine-readable artifacts: `.agents/tasks/task-harden-server-1/{task.json,context.json,features/FEAT-00{1,2,3}.json}`.
Loop gate: `.agents/tasks/harden-server-1-review.json`, `verdict` == `APPROVED`.

## Ordered checklist (fallback if the tail is not replaced)

- [ ] 1. Regenerate the route baseline from the untouched worktree and diff vs the parent workspace's `server-split-routes-before.txt` (F5.1). Verify: identical, 66 routes.
- [ ] 2. F1 log redaction in the files above plus the `pushServiceHost` helper and the parse-error log change. Verify: F1 static grep, demo runtime sentinel run, `node --check`.
- [ ] 3. F4 startup warning in `server.js` plus the DEPLOYMENT.md/README.md docs. Verify: the four boot scenarios in F4. Commit steps 2-3 together as FEAT-001.
- [ ] 4. F2 `debugOnly` gating. Verify: three-mode status table with the fake DB.
- [ ] 5. F5 move `app.use(archiveRoutes)` before the error handler. Verify: route list identical, `__boom` JSON proof. Commit 4-5 as FEAT-002.
- [ ] 6. F3 SSRF hardening in `lib/link-preview.js` and `routes/chat.js`. Verify: temp unit script (all private rejected, allowed accepted), route-level 400/401 checks, then delete the script. Commit as FEAT-003.
- [ ] 7. Integration: full Playwright suite = 121 passed / 0 failed / 11 skipped; final route list diff; final log grep; `git status` clean apart from untracked `.agents/`.
