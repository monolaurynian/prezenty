# Verification: refactor-manageable-1 (server.js split)

## Baseline (before refactor)

Captured at worktree HEAD `4d06241`, before any product code was touched
(Node v24.11.0, Windows / PowerShell).

### Test baseline

Command (from the worktree root, as configured in `playwright.config.js`):

```
npx playwright test --reporter=list
```

Exit code: **0**. Duration: ~6.5 min (`workers: 1`, Edge channel, demo-mode server).

| Result | Count |
|---|---|
| passed | **121** |
| failed | **0** |
| flaky | 0 |
| skipped | **11** |
| total | 132 |

Pre-existing failures: **none**.

The 11 skipped tests are intentional `test.fixme` entries, not breakage:

- `a11y.spec.js:68` "a11y smoke > <page>: EVERY icon-only control including the dock has a name"
  for home, recipients, osoby, activity, leaderboard, wiadomosci-list, wiadomosci-thread,
  rezerwacje, archiwum, ustawienia (10 tests)
- `edit-sheet.spec.js:179` "edit present bottom sheet > closing the sheet returns focus to its trigger" (1 test)

After the refactor the expected result is exactly: 121 passed, 0 failed, 11 skipped.

### Route baseline

The authoritative ordered list of every route registered by the original
`server.js` is in `.agents/tasks/server-split-routes-before.txt`
(one `METHOD /path` per line, in registration order).

- **66 routes.**
- Produced by booting the real `server.js` in demo mode (`OFFLINE_MODE=true`), intercepting
  `app.listen`, and walking `app._router.stack` (temporary script, since deleted).
  The app also has 11 non-route middleware layers, which are not in the file.
- Cross-check: a source grep of top-level `app.<verb>('...')` finds 69 lines, but the unique
  `METHOD path` set is identical to the walked set. The 3 extra grep hits
  (`GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/:id/read`) are older duplicates inside a `/* ... */` comment block
  (server.js lines 2165-2305), so they are not registered. The 66-route walk is the truth.
- Compare after the refactor with the same method (walk `app._router.stack`, descending into
  mounted routers) and diff against that file. Order matters.

## Phase 1 - Archive root clutter

Behavior-preserving. Nothing deleted; all moves via `git mv` (history preserved, 41 renames).

### Reference audit (git grep over the whole worktree)
- Live references found only in `package.json` (`init-db`, `test-db`, `optimize-db` npm scripts), plus prose in `README.md`, `DEPLOYMENT.md`, `tests/README.md` and a comment in `server.js` (line ~2607).
- Dockerfile, render.yaml, vercel.json, .dockerignore and server.js logic reference none of the moved files (Dockerfile runs `node server.js`; render.yaml runs `npm start`). `.vscode` does not exist.
- `init-db.js`, `test-db.js` and `optimize-db.js` are reached only through npm scripts, so they were moved and `package.json` was updated.

### What moved where
- `docs/archive/formularz/` (15): all `FORMULARZ_*.md`.
- `docs/archive/cache/` (6): `CACHE_BUSTING_GUIDE.md`, `CACHE_DISABLED_FIX.md`, `CACHE_ERROR_FIX.md`, `CACHE_FIX.md`, `QUOTA_FIX.md`, `UPDATE_CHECKLIST.md`.
- `docs/archive/performance/` (8): `PERFORMANCE_OPTIMIZATION.md`, `QUICK_FIX_SLOW_LOADING.md`, `FAST_LOADING_GUIDE.md`, `LOADING_OPTIMIZATION_SUMMARY.md`, `INSTANT_LOAD_OPTIMIZATION.md`, `EXECUTION_ORDER_OPTIMIZATION.md`, `INCREMENTAL_UPDATES_SUMMARY.md`, `REALTIME_UPDATES_GUIDE.md`.
- `docs/archive/profile-picture/` (2): `PROFILE_PICTURE_FIX.md`, `PROFILE_PICTURE_ROOT_CAUSE.md`.
- `docs/archive/misc/` (3): `CRONJOB_STATUS.md`, `PRIVACY_FEATURES.md`, `test-notifications.md`.
- `scripts/` (8): `init-db.js`, `test-db.js`, `optimize-db.js`, `db-diagnose.js`, `check-ip.js`, `apply-optimizations.bat`, `apply-optimizations.sh`, `run-demo.bat`.
- `scripts/archive/` (1): `tmp-emoji-click.js`.
- Root now keeps: README.md, DEPLOYMENT.md, package.json, package-lock.json, server.js, playwright.config.js, postcss.config.js, Dockerfile, render.yaml, vercel.json, .dockerignore, .gitignore.

### Edits to keep things resolving
- `package.json`: `init-db`, `test-db`, `optimize-db` now `node scripts/<name>.js`.
- `scripts/run-demo.bat`, `scripts/apply-optimizations.bat`, `scripts/apply-optimizations.sh`: `cd` to the repo root first; PERFORMANCE_OPTIMIZATION.md hint points at its archive path.
- `scripts/db-diagnose.js`: usage text shows `node scripts/db-diagnose.js`.
- `scripts/archive/tmp-emoji-click.js`: `public/home.html` path now `__dirname`-based; header marks it archived.
- The other moved JS scripts have no relative requires or `__dirname` paths (only `mysql2`/`dotenv`/`https`); `dotenv` reads `.env` from the cwd, so run them from the repo root (`npm run` does).
- Path references updated in `DEPLOYMENT.md`, `tests/README.md`, the `server.js` comment (comment only, no logic) and three lines of `docs/archive/performance/QUICK_FIX_SLOW_LOADING.md`.
- Added `docs/archive/README.md`, `scripts/README.md` and a "Project layout" section in `README.md`.
- Not touched: `public/`, `sw.js`, `?v=` params, server.js logic. `.agents/tasks/*` history docs still mention root `init-db.js`/`tmp-emoji-click.js` as they were true when written.

### Verification results
- `node --check` on `scripts/init-db.js`, `test-db.js`, `optimize-db.js`, `db-diagnose.js`, `check-ip.js`, `scripts/archive/tmp-emoji-click.js`: all exit 0. `node --check server.js`: exit 0.
- `node -e "require('./package.json')"`: OK; the three scripts resolve to `node scripts/...`.
- `git grep` for old root paths of moved scripts (outside `.agents/` history and the two archive/scripts READMEs): no hits. Remaining bare `.md` names are same-folder sibling mentions inside `docs/archive/*`.
- App start: `DEMO_MODE=true PORT=3917 node server.js` from the worktree root started in demo mode; `GET /health` returned 200; process stopped afterwards.
- Not run: `npm run init-db`, `test-db`, `optimize-db` (need a real `DB_PASSWORD` and the remote database); `.bat`/`.sh` wrappers not executed.

## Phase 2 - Split `server.js` into `lib/` and `routes/`

Behavior-preserving pure move. `server.js` stays the entry point (no exports, same `startServer()` at require
time, same 5 s timer). `package.json`, `Dockerfile`, `render.yaml`, `vercel.json`, `.dockerignore`,
`playwright.config.js`, `tests/**` (except the one `tests/README.md` sentence) and `public/**` are untouched.
Phase 2 review range: `195d6c5..HEAD` (Phase 1 commit `195d6c5` is separate).

### Files created and line counts
`server.js` 4381 -> 261 lines.

| `lib/` | lines | `routes/` | lines |
|---|---|---|---|
| webpush-config.js | 51 | system.js | 40 |
| db.js | 97 | pages.js | 113 |
| http-errors.js | 25 | auth.js | 255 |
| auth.js | 15 | recipients.js | 601 |
| cache.js | 54 | presents.js | 737 |
| update-tracker.js | 35 | notifications.js | 493 |
| queries.js | 56 | leaderboard.js | 65 |
| presence.js | 28 | chat.js | 486 |
| push.js | 142 | formularz.js | 244 |
| notifications.js | 126 | archive.js | 153 |
| leaderboard.js | 55 | | |
| chat.js | 103 | | |
| link-preview.js | 28 | | |
| demo-data.js | 255 | | |
| cron.js | 78 | | |

Docs/comment pointers only: `README.md` (Project layout), `tests/README.md` ("Where the demo data lives" now says
`lib/demo-data.js`), `scripts/init-db.js` (comment now says `lib/chat.js`).

### How the code was moved
Line ranges were cut out of the Phase 1 `server.js` by a temporary generator script (deleted afterwards), not retyped.
A multiset comparison of all non-blank lines (original vs. `server.js` + `lib/*` + `routes/*`) showed the only
differences are the permitted edits: new `require`/`module.exports`/header-comment lines, `app.<verb>(` ->
`router.<verb>(`, `require('./package.json')` -> `'../package.json'`, `__dirname` -> `ROOT_DIR` in `routes/pages.js`,
`MAINTENANCE_MODE` -> `isMaintenanceMode()` / `setMaintenanceMode(...)`, and the presence middleware becoming the
named `presenceMiddleware`. `MAINTENANCE_MODE` is the only shared mutable binding; it is a private `let` in
`lib/db.js` behind `isMaintenanceMode()` / `setMaintenanceMode()`.

### Route order: literally identical
Three routes (`DELETE /api/presents/:id/reserve`, `POST /api/register`, `POST /api/user/identify`) sat far from
their siblings in the original file. To keep the registered order byte-for-byte identical (as required), each of
`routes/presents.js`, `routes/auth.js` and `routes/recipients.js` exports `{ router, lateRouter }`, and `server.js`
mounts `lateRouter` at the original position (after chat / after formularz). This replaces the "three routes change
position" option in the plan (section 5). Archive routes are mounted after the 4-arity error handler, as before.

### Verification results
1. `node --check`: `server.js` and all 15 `lib/*.js` + 10 `routes/*.js` exit 0 (also `scripts/init-db.js`).
   Also ran ESLint (temp install outside the repo, not a dependency) with `no-undef`/`no-unused-vars`/`no-redeclare`
   on `server.js lib routes`: no undefined identifiers and no unused imports (only globals missing from my ad-hoc
   config: `clearTimeout`, `TextDecoder`; and the pre-existing unused `recipient_id` in the archive handler).
2. Startup, the way the tests do it (`OFFLINE_MODE=true NODE_ENV=development HOST=127.0.0.1 PORT=3917`,
   `node server.js`): `/health` -> 200 `{"status":"OK",...,"mode":"DEMO","database":"disabled"}`, no crash. The
   stdout of the new `server.js` is identical to the Phase 1 `server.js` (dotenv line, three VAPID lines,
   `Session configuration:`, the DEMO banner, listening lines): diff of the two boot logs is empty, stderr empty.
3. Registered routes: walked `app._router.stack` (descending into routers) for the Phase 1 `server.js` and the new
   one. Output regenerated into `.agents/tasks/server-split-routes-after.txt`: **byte-identical** to
   `server-split-routes-before.txt` (`fc /b`: no differences; 66 routes, same order). The full walk including
   middleware layers is also identical (10 layers before the first route, the single 4-arity error layer at the
   same index 74). Temp scripts deleted.
4. Differential run in NON-demo mode (the Playwright suite only runs DEMO mode, so it never executes the
   `pool.execute` branches): the Phase 1 `server.js` and the new `server.js` were each booted against a fake
   mysql2 pool / session store / web-push (two fake-data modes: rows present, rows empty), then 153 requests were
   issued per mode (every one of the 66 routes unauthenticated and authenticated, invalid-body probes, multipart and
   base64 profile pictures, a 413, OPTIONS, a 404, static file, logout/delete-account last). Recorded status, headers
   (location, cache-control, content-type), normalized bodies, every SQL statement + params, push payloads, startup
   logs and all `console.error` output. The harness is deterministic on the original (two runs identical) and the
   new tree's output is **byte-identical** in both modes (statuses seen: 200 x78, 401 x42, 302 x10, 400 x16,
   409 x4, 204, 404, 413; 135 fake-DB calls and 5 pushes in the "rows present" mode), with no ReferenceError /
   "is not defined" / "is not a function". Harness deleted afterwards.
5. Full Playwright suite in the worktree (`npx playwright test --reporter=list`): **121 passed, 0 failed,
   11 skipped (132)**, 8.0 min. Matches the baseline exactly; the 11 skips are the pre-existing intentional
   `test.fixme` entries (10 a11y icon-only-control tests, 1 edit-sheet focus-return test). Pre-existing failures: none.
6. Dependency audit: every `require('./...')` in `lib/` points to a lower layer (db, webpush-config, cache,
   push, notifications, chat helpers; no cycles); no `lib/` -> `routes/`, no `routes/` -> `routes/`, nothing
   requires `server.js`; `server.js` has no leftover `app.<verb>(` route and routers do not use `app`. Every
   `require` is a literal relative path (so `@vercel/node` tracing still finds them). No `package.json` change.
Not run: a real MySQL database (none available); the harness above stands in for it.

### Noted, not fixed (observed while reading; left as is)
1. `/api/archive/*` is registered after the global error handler, so thrown errors there skip it (handlers have try/catch, so it works today).
2. `GET /api/recipients/:id` and `POST /api/user/identify` have no `DEMO_MODE` branch; in demo mode they hit `pool.execute` on `undefined` and return the 500 error JSON.
3. The error handler's 413 message says "Maksymalny rozmiar to 10MB" while body parsers allow 50mb.
4. `fs` is required but unused (not carried over into the new `server.js`); `getRecipientById` is only used by `GET /api/recipients/:id`; `isUserIdentifiedAsRecipient` is never called; `createNotification` has a stray "Create notification for relevant users" comment above the cancel-reservation route.
5. A large dead `/* ... */` block of old notification routes is kept as a comment (now in `routes/notifications.js`).
6. `GET /api/notifications/unread-count` excludes `anon_message` rows but `POST /api/notifications/:id/read` recounts without that filter (inconsistent badge after mark-as-read).
7. Security smells left untouched: VAPID private-key and `SESSION_SECRET` fallbacks are hard-coded; `GET /api/auth` and several routes log `req.headers.cookie` / full `req.session`; `GET /api/leaderboard`, `GET /api/recipients/:id/profile-picture`, `POST /api/register` and the formularz routes are unauthenticated by design; any logged-in user can call `/api/test-notification` and `/api/notifications/debug`; the link-preview SSRF guard is hostname-string based (no DNS resolution, IPv6 only `[::1]`).
8. `POST /api/formularz/present` runs `ALTER TABLE` lazily at request time; schema is also created lazily for notifications, anon chat and archive.
9. In-memory state (presence, link-preview cache, reaction throttle, update tracker, caches) is per process and resets on deploy.
10. `package.json` lists the npm `path` package although Node's built-in `path` always wins.