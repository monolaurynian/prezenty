# Phase 2: server.js split into lib/ and routes/

Phase 2 (`91e02a6`, a single commit on top of Phase 1 `195d6c5`) moves the 4,381-line `server.js` into 15 `lib/` modules and 10 `routes/` routers, leaving a 261-line entry point that owns middleware, sessions, router mounting, the error handler and `startServer()`. The reviewer re-ran the registered-route walk, a line-multiset comparison against the Phase 1 `server.js`, a require-graph check and the full Playwright suite instead of relying on the coder's report. The registered route list is byte-identical to the baseline, the middleware chain is unchanged, there are no cycles, and the suite is at baseline (121 passed, 0 failed, 11 skipped) on a clean run.

Watch for: one failure in the first suite run (`no-horizontal-overflow` > home, `page.goto: net::ERR_ABORTED`) that did not reproduce (confirmed flake, already documented once in `xss-fix-verification.md`). Three comment-only losses and one unplanned `tests/README.md` edit are minor (see Issues).

**Verdict**: APPROVED

## High-level view

The route registration is literally unchanged: the same 66 `METHOD path` lines in the same order as `server-split-routes-before.txt`, the same 10 middleware layers before the first route, and the single 4-arity error layer followed by exactly the three `/api/archive/*` routes. To keep that order the coder deviated from the plan's "three routes change position" option and instead exports `{ router, lateRouter }` from `presents`, `auth` and `recipients`, mounting each `lateRouter` where its routes always sat. That is stricter than the plan required and costs only three small extra `app.use` lines.

The move is mechanical. A multiset diff of all non-blank lines (original vs. `server.js` + `lib/*` + `routes/*`) leaves only require/export lines, `app.` to `router.` renames, `__dirname` to `ROOT_DIR` in `routes/pages.js`, `MAINTENANCE_MODE` to `isMaintenanceMode()`/`setMaintenanceMode()`, the presence middleware becoming the named `presenceMiddleware`, and header comments. `MAINTENANCE_MODE` is the only shared mutable binding and lives behind accessors in `lib/db.js`; every other shared value is assigned once at load or is an object whose identity never changes.

The dependency graph is layered with no cycles: `lib/*` never requires `routes/*` or `server.js`, no router requires another router, and all requires are literal relative paths, so `@vercel/node` tracing is unaffected. The external interface (`package.json` main/start/dev, Dockerfile, render.yaml, vercel.json, `.dockerignore`, `playwright.config.js`, `public/**`, tests) is untouched, and `server.js` still has no exports and calls `startServer()` at require time.

<details>
<summary>Issues (3)</summary>

1. **Dropped import-block comments (confirmed, non-blocking)** — three comment lines above the `chat-reactions` import ("Chat reaction logic lives next to its client script ... unit-testable without a DB") and `// const webpush = require('web-push'); // Now enabled below` were not carried into the new files. Comment-only; optionally restore the chat-reactions note in `lib/chat.js` or `routes/chat.js`.
2. **`tests/README.md` edited despite the plan's out-of-scope list (confirmed, non-blocking)** — the one-sentence change ("All of it is defined in `lib/demo-data.js`...") is needed to keep the doc true after the move, but the plan said not to touch `tests/` at all. Acceptable; keep and mention in the commit.
3. **`tests/e2e/no-horizontal-overflow` home flake (confirmed pre-existing, non-blocking)** — `page.goto` can fail with `net::ERR_ABORTED` on `/` (same signature recorded in `xss-fix-verification.md` Run A). Not caused by this change; consider adding `ERR_ABORTED` to the retry list in `tests/helpers/pages.js` `openPage` in a separate test-hardening task.

</details>

<details>
<summary>Details</summary>

### Route order and middleware chain

The reviewer booted `server.js` in demo mode (`OFFLINE_MODE=true`) with `express.application.listen` intercepted and walked `app._router.stack`, descending into mounted routers. The result is 66 routes and a strict, case-sensitive string comparison of the joined list against `server-split-routes-before.txt` is equal. The reviewer also walked the Phase 1 `server.js` (`git show 195d6c5:server.js`) the same way and got the same 66 routes. Ignoring the router-mount tokens and normalizing the presence layer name (`<anonymous>` to `presenceMiddleware`), the full layer sequence is identical to the original: `query, expressInit, compression, corsMiddleware, jsonParser, urlencodedParser, serveStatic, <maintenance>, session, <presence>`, then the routes, then one 4-arity error layer, then the three archive routes. Temp scripts and the temporary `server.orig.js` were deleted; the worktree has no stray files.

The mount order in `server.js` shows the late routers placed after chat (`DELETE /api/presents/:id/reserve`) and after formularz (`POST /api/register`, `POST /api/user/identify`), and `archiveRoutes` is mounted after the error handler, preserving the observable behaviour that errors thrown inside archive handlers skip the app error handler.

### Pure-move check

The multiset comparison (3,796 non-blank original lines vs. 3,981 in the new tree; the surplus is the new require/export/header lines) shows every original line is present except: route declarations (`app.x(` now `router.x(`), the 20-odd `res.sendFile(path.join(__dirname, ...))` lines (now `ROOT_DIR`), `MAINTENANCE_MODE` reads and writes, `require('./public/...')` and `require('./package.json')` paths, the unused `const fs = require('fs')`, and the three-line plus one-line comment set listed in Issue 1. Nothing else changed: strings, SQL, status codes and log text are present verbatim. `MAINTENANCE_MODE` read in `/health`, the maintenance middleware, the warm-keeper (still inside `lib/db.js`), the nudge cron and both `startServer` writes all go through the accessors, so the value is read per call and never captured at require time.

A name-resolution pass over every top-level identifier of the original (functions, consts, destructured imports) found no identifier used in a new file without a declaration or import. A negative control (removing the `createNotification` import from a temp copy of `routes/presents.js`) was flagged by the same script, so the check does bite. Non-demo branches are not exercised by the Playwright suite; the coder's fake-MySQL differential run covers them and could not be repeated here, but the name-resolution pass plus the line-multiset result give independent evidence that no moved branch lost a binding.

### Dependency graph and entry point

The require graph over `server.js`, `lib/*` and `routes/*` has no cycles. The deepest chain is `routes/*` to `lib/leaderboard` to `lib/push` to `lib/db` / `lib/webpush-config`. `lib/` requires only other `lib/` modules and `public/chat-reactions`, `public/pluralize-pl`; `routes/` requires `lib/`, `public/notification-text`, `public/chat-reactions` and `package.json` (the last in `routes/system.js`); no router requires another router or `server.js`. No non-literal `require(...)` exists. `public/notification-text` is still resolved through `require('../public/notification-text')` in `routes/presents.js` and `routes/formularz.js` and is loaded in the suite run (presents and formularz flows pass).

Load order is preserved where it is observable: `dotenv` runs first, then `require('./lib/webpush-config')` (VAPID logs), then `lib/db` ("Database configuration:"), then the session log. `startServer()` is still invoked at require time followed by the 5 s timer for the crons.

### External interface and git history

`git diff 195d6c5 HEAD` touches only `server.js`, the 25 new `lib/` and `routes/` files, `README.md` (Project layout), `scripts/init-db.js` (comment), `tests/README.md` (one sentence) and the Phase 2 section of the verification doc. `package.json`, `Dockerfile`, `render.yaml`, `vercel.json`, `.dockerignore`, `playwright.config.js` and `public/**` have no diff. `lib/` and `routes/` are not git-ignored or docker-ignored. Phase 1 is a separate earlier commit (`195d6c5`, 43 renames plus edits against `4d06241`) and the Phase 2 diff against it contains no deletions or reverts of those moves.

### Test run

First full run: 120 passed, 1 failed, 11 skipped (7.9 m). The failure was `no-horizontal-overflow.spec.js:22` "home does not scroll sideways at any width" with `page.goto: net::ERR_ABORTED` on `/`; the reviewer was running CPU-heavy route-walk and diff scripts concurrently. The same spec passed 30/30 in isolation (`--repeat-each=3`, 3.6 m). A second full run on an idle machine: 121 passed, 0 failed, 11 skipped, exit 0 (7.6 m), exactly the baseline. The same test and error text appear as a one-off in `xss-fix-verification.md` (Run A 119 passed, 1 failed; Run B clean), so it is a known timing flake in the test helper, not a regression. Not run here: the coder's fake-MySQL differential harness (deleted by the coder) and a real database; neither is available.

</details>

<details>
<summary>File map</summary>

- `server.js`: entry point only (middleware, sessions, router mounts, error handler, `startServer`, timers).
- `lib/webpush-config.js`, `db.js`, `http-errors.js`, `auth.js`, `cache.js`, `update-tracker.js`, `queries.js`, `presence.js`, `push.js`, `notifications.js`, `leaderboard.js`, `chat.js`, `link-preview.js`, `demo-data.js`, `cron.js`: moved shared logic.
- `routes/system.js`, `pages.js`, `auth.js`, `recipients.js`, `presents.js`, `notifications.js`, `leaderboard.js`, `chat.js`, `formularz.js`, `archive.js`: moved route handlers (three export an extra `lateRouter`).
- `README.md`, `tests/README.md`, `scripts/init-db.js`: doc and comment pointers to the new locations.
- `.agents/tasks/refactor-manageable-1-verification.md`: Phase 2 section added.

Full diff: `git diff 195d6c5 HEAD`.

</details>
