# Phase 2 plan: split `server.js` into `lib/` + `routes/` (behavior-preserving)

Worktree: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\refactor-manageable-1`
Branch: `refactor/manageable-1`. Phase 1 base commit: `195d6c5`. Phase 2 review range: `195d6c5..HEAD`.
Shell: PowerShell (`;` not `&&`). Retry any "cloud file provider exited unexpectedly" error.

This is a PURE MOVE. No renames, no behavior fixes, no dependency changes, no reformatting.
Anything that looks like a bug goes in section 9 ("noted, not fixed") and stays as is.

Out of scope (do not touch): inline JS/CSS in HTML, `public/recipients.js`, CSS consolidation,
test splitting, any file under `tests/` (comments included), `public/`.

Decision on workflow shape: NOT restructured. The work is one concern (move code out of one file),
strictly sequential, and every step edits `server.js`. The existing Phase 2 implement-and-review loop
(stop contract: `.agents/tasks/phase2-review.json`, jsonPath `verdict` == `APPROVED`, implementer
first, reviewer writes the verdict last) implements this plan unchanged. Milestones M1/M2 below are
internal commit checkpoints, not separate workflow steps.

---------------------------------------------------------------------------------------------------

## 1. Facts from reading all of `server.js` (4,381 lines) that drive the design

Line numbers are the CURRENT `server.js` numbering (approximate; use the function/route name as anchor).

### 1.1 External interface (must not change)
- `package.json`: `"main": "server.js"`, `"start": "node server.js"`, `"dev": "nodemon server.js"`.
- `Dockerfile`: `COPY . .` then `CMD ["node","server.js"]`; HEALTHCHECK hits `/health`. `.dockerignore`
  does not exclude `lib/` or `routes/`. `.gitignore` does not ignore them either (checked with `git check-ignore`).
- `render.yaml`: `startCommand: npm start`, `healthCheckPath: /health`.
- `vercel.json`: builds `server.js` with `@vercel/node`, routes everything to `/server.js`. The tracer
  follows static string `require()`s, so every new `require` MUST be a literal relative path (no
  `fs.readdirSync` auto-loading, no computed paths).
- `tests/helpers/start-demo-server.js` spawns `node server.js` with cwd = repo root and env
  `OFFLINE_MODE=true NODE_ENV=development HOST=127.0.0.1 PORT=<free> SESSION_SECRET=...`, then polls
  `/health` until `mode === 'DEMO'`. Nothing `require`s `server.js` and `server.js` has NO
  `module.exports` and NO `require.main` guard. Keep it that way: `startServer()` runs at require time.
- `express.static('public')` is cwd-relative; `res.sendFile(path.join(__dirname,'public',...))` is
  `__dirname`-relative. Both keep working only if `server.js` stays in the repo root.
- `public/notification-text.js`, `public/pluralize-pl.js`, `public/chat-reactions.js` are shared with the
  browser and are `require`d by the server. They stay where they are. New requires are
  `require('../public/...')` from `lib/` and `routes/`.

### 1.2 Mutable / shared state (this is what makes the split non-trivial)
| Name | Declared | Mutation | Read by |
|---|---|---|---|
| `DEMO_MODE` | `let` L83 | never reassigned (only the declaration) | nearly every route, push, cron |
| `MAINTENANCE_MODE` | `let` L90 | `startServer()` sets true L4212, false inside retry interval L4220 | warm-keeper L147, maintenance mw L491, `/health` L563-566, nudge cron L4344 |
| `dbConfig`, `pool` | `let` L93-94 | assigned once inside `if (!DEMO_MODE)` L97-150 | session store, startServer log, all DB code |
| `webpush` | `let` L40 | assigned once in try/catch L69-80 | push, subscribe/debug/test routes, cron |
| `cache`, `combinedDataCache`, `updateTracker` | const objects | methods mutate internal Maps/arrays (use `this`) | presents, auth, recipients, formularz, archive |
| `userLastSeen` | const Map | presence middleware writes | `isUserOnline` / `withPresence` |
| `anonTablesEnsured`, `notificationsTableEnsured`, `createdByNullableEnsured` | `let` flags | set once true | their own ensure-function only |
| `reactionRateBuckets`, `linkPreviewCache` | const Maps | mutated by their own helpers/route | chat only |
| `demoData`, `demoChat`, `demoNotifications`, `demoLeaderboard` | const objects | routes mutate (`push`, `splice`, and PROPERTY reassignment like `demoData.presents = demoData.presents.filter(...)`, `demoChat.messages = ...filter(...)`) | demo branches |

Consequences:
- Only `MAINTENANCE_MODE` needs an accessor. Everything else is either assigned exactly once at module load
  (so exporting the value is equivalent to a live binding) or is an object whose identity never changes.
- NEVER destructure a property of the demo objects or of `cache`/`updateTracker` at require time
  (`const { presents } = demoData` or `const { get } = cache` would break; `cache` methods use `this`).
  Importing the object itself (`const { demoData } = require(...)`) is fine because the routes mutate the
  object, and property reassignment on the same object stays visible to every importer.

### 1.3 Registration order facts
- Middleware order today: `compression`, `cors`, `bodyParser.json`, `bodyParser.urlencoded`,
  `express.static`, (trust proxy is a setting, not a layer), maintenance mw, `session`, presence mw, then routes.
- Routes are NOT grouped by domain in the file. `DELETE /api/presents/:id/reserve` (L3327) sits after the
  link-preview route; `POST /api/register` (L3641) and `POST /api/user/identify` (L3694) are at the very end.
- The global error handler `app.use((err, req, res, next) => ...)` (L3755, 4-arity) sits BETWEEN
  `POST /api/user/identify` and the three `/api/archive/*` routes. So the archive routes are registered
  AFTER the error handler (errors in them bypass it and reach Express's default handler). This is observable
  and must be preserved: the archive router is mounted after the error handler.
- There is NO 404 / catch-all handler and no static fallback route. Do not add one.
- Only DB-free helper functions use hoisting across the file. `startServer()` is called at L4295 BEFORE the
  `sendPushToUser` / `setupChristmasNudgeCron` declarations (hoisted function declarations) and before the
  trailing `setTimeout(..., 5000)`. In DEMO mode `app.listen` is reached synchronously inside that call. Keep
  the same call order at the end of `server.js`: `startServer();` then `setTimeout(...)`.
- No two routes with the same HTTP method have overlapping path patterns (checked by hand for all 66; the
  checker in section 7 re-verifies it mechanically). So reordering routes between routers is unobservable
  as long as (a) middleware/error-handler positions relative to route SETS stay the same and (b) all methods of
  one path stay in the same router (Express builds OPTIONS/Allow per router; `cors()` answers OPTIONS earlier
  anyway, but keep the rule).

### 1.4 Startup side effects and log order (preserve)
Order of load-time logs today: `[VAPID] ...` lines, then `Database configuration:` (non-demo only), then
`Session configuration:`, then `startServer()` logs. Side effects at load: VAPID self-check, `webpush.setVapidDetails`,
`mysql.createPool`, 4-minute warm-keeper `setInterval` (non-demo), `startServer()`, 5 s `setTimeout` that arms
the keep-alive and Christmas-nudge crons. `.env` is loaded by the `dotenv` block (L29-32) BEFORE any
`process.env` read; every new module that reads env at load must therefore be required AFTER that block.

---------------------------------------------------------------------------------------------------

## 2. Target layout

```
server.js                  entry point, ~230 lines: app, middleware, session, mounts, error handler, startServer, timers
lib/
  webpush-config.js        VAPID keys + self-check + webpush init (load-time logs live here)
  db.js                    DEMO_MODE, dbConfig, pool, warm-keeper, maintenance accessors, testDatabaseConnection
  http-errors.js           handleDbError, notFound, forbidden, conflict, badRequest
  auth.js                  requireAuth
  cache.js                 cache, combinedDataCache, COMBINED_CACHE_TTL, clearCombinedDataCache
  update-tracker.js        updateTracker
  queries.js               getUserIdentification, getRecipientById, getAllPresents
  presence.js              userLastSeen, ONLINE_WINDOW_MS, presenceMiddleware, isUserOnline, withPresence
  push.js                  sendNotificationToUsers, sendPushToUser
  notifications.js         createNotification, ensureNotificationsTable, isUserIdentifiedAsRecipient
  leaderboard.js           getLeaderboardLeader, notifyLeaderboardChange   (leaderboard change detection)
  chat.js                  ensureAnonMessageTables, notifyAnonMessage, reactionRateAllows (+ constants/buckets)
  link-preview.js          linkPreviewCache, LINK_PREVIEW_TTL, isSafePreviewUrl, extractMeta
  demo-data.js             demoData, demoChat, demoLeaderboard, demoNotifications + all demo* helpers
  cron.js                  setupKeepAliveCron, setupChristmasNudgeCron
routes/
  system.js                /health, /api/version, /api/updates
  pages.js                 12 HTML page routes
  auth.js                  login, account rename/delete, logout, auth status, register
  recipients.js            recipients CRUD, identification, profile pictures, POST /api/user/identify
  presents.js              presents CRUD/reserve, combined data, hash, abandoned
  notifications.js         push subscribe/vapid/debug/test + notification centre
  leaderboard.js           /api/leaderboard
  chat.js                  wiadomosci threads/messages, reactions, link-preview route
  formularz.js             public form API (3 routes)
  archive.js               /api/archive/* (3 routes)
```
Presence has no routes of its own (it is a middleware), and there are no demo-only routes; "demo" lives in
`lib/demo-data.js`. `routes/system.js` and `routes/pages.js` are extra groups because the file has them.

### 2.1 How shared state is passed
- No factories, no DI container, no new globals. Each `lib/*.js` module is a plain CommonJS singleton (the
  Node module cache gives exactly one instance, equal to the single module-level instance in `server.js` today).
- Values assigned once at load are exported by value: `DEMO_MODE`, `dbConfig`, `pool`, `webpush`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. `pool` is `undefined` in demo mode, exactly as today (handlers
  without a `DEMO_MODE` guard still hit `TypeError ... reading 'execute'` and are turned into a 500 by
  `handleDbError`, same message).
- `MAINTENANCE_MODE` becomes a private `let` in `lib/db.js` with two exports: `isMaintenanceMode()` and
  `setMaintenanceMode(value)`. This is the ONLY identifier that changes spelling at its use sites:
  | Site (current line) | New spelling |
  |---|---|
  | warm-keeper L147 (`if (MAINTENANCE_MODE) return;`) | stays inside `lib/db.js`, reads the private `let` |
  | maintenance mw L491 (server.js) | `if (!isMaintenanceMode()) return next();` |
  | `/health` L563, 565, 566 (routes/system.js) | `isMaintenanceMode()` (called inside the handler, per request) |
  | `startServer` L4212, L4220 | `setMaintenanceMode(true)` / `setMaintenanceMode(false)` |
  | nudge cron L4344 (lib/cron.js) | `isMaintenanceMode()` |
- Router modules `require` lib singletons directly and export an `express.Router()`
  (`module.exports = router`). `app` is never passed around; handlers do not use `app` (grep `\bapp\b` in moved
  code to prove it).
- `demoData` etc. are imported as objects (see 1.2).

### 2.2 Dependency layers (no cycles allowed)
```
L0  webpush-config, db, http-errors, auth, cache, update-tracker, link-preview, demo-data   (demo-data -> ../public/chat-reactions only)
L1  queries(db,cache)  presence  push(db,webpush-config)  notifications(db)
L2  leaderboard(db,notifications,push)  chat(db,push)  cron(db,push,webpush-config,../public/pluralize-pl)
L3  routes/*   (may require any lib/*, never another routes/* and never server.js)
L4  server.js
```
`lib/*` never requires `routes/*` or `server.js`. Check at the end with a one-liner that every
`require('./` / `require('../` in `lib/` points to a lower layer (list the requires with Select-String).

---------------------------------------------------------------------------------------------------

## 3. What moves where (source = current `server.js`)

"Verbatim" means: cut the text, paste into the new file, change only what section 4 allows.

### 3.1 lib/
| New file | Content (current line anchors) | Imports it needs |
|---|---|---|
| `lib/webpush-config.js` | L34-80: VAPID consts, key self-check (inline `require('crypto')`), source log, `try { webpush = require('web-push') ... }`. `VAPID_EMAIL` stays private. Exports `{ webpush, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY }` | none |
| `lib/db.js` | L83-87 `DEMO_MODE`; L89-90 `MAINTENANCE_MODE` (private); L93-150 `dbConfig`/`pool`/`mysql.createPool`/warm-keeper `setInterval`; L3916-3929 `testDatabaseConnection`. Exports `{ DEMO_MODE, dbConfig, pool, isMaintenanceMode, setMaintenanceMode, testDatabaseConnection }` | `mysql2/promise` |
| `lib/http-errors.js` | L153-173 five helpers | none |
| `lib/auth.js` | L549-558 `requireAuth` (keep the console.logs) | none |
| `lib/cache.js` | L305-343 `cache`; L1493-1500 `combinedDataCache`, `COMBINED_CACHE_TTL`, `clearCombinedDataCache` | none |
| `lib/update-tracker.js` | L346-375 `updateTracker` | none |
| `lib/queries.js` | L175-183 `getUserIdentification`; L185-198 `getRecipientById`; L378-401 `getAllPresents` | `./db` (pool), `./cache` |
| `lib/presence.js` | L504-528: `userLastSeen`, `ONLINE_WINDOW_MS`, the presence middleware as an exported `presenceMiddleware` (body verbatim), `isUserOnline`, `withPresence` | none |
| `lib/push.js` | L3160-3257 `sendNotificationToUsers`; L4297-4333 `sendPushToUser` | `./db` (pool, DEMO_MODE), `./webpush-config` (webpush) |
| `lib/notifications.js` | L200-253 `createNotification` (with its leading comment); L3259-3307 `ensureNotificationsTable` + `notificationsTableEnsured`; L3309-3323 `isUserIdentifiedAsRecipient` (unused today, moved as is) | `./db` |
| `lib/leaderboard.js` | L255-302 `getLeaderboardLeader`, `notifyLeaderboardChange` | `./db`, `./notifications` (createNotification), `./push` (sendNotificationToUsers) |
| `lib/chat.js` | L2571-2629 comment + `anonTablesEnsured` + `ensureAnonMessageTables`; L2631-2643 `notifyAnonMessage`; L2928-2956 reaction throttle constants, `reactionRateBuckets`, `reactionRateAllows` | `./db`, `./push` (sendPushToUser), `../public/chat-reactions` (reactionThrottleStep) |
| `lib/link-preview.js` | L3047-3073: `linkPreviewCache`, `LINK_PREVIEW_TTL`, `isSafePreviewUrl`, `extractMeta`. Exports all four | none |
| `lib/demo-data.js` | L3931-4180: `demoData`; banner comment L3966-3977; `DEMO_LONG_URL`; `demoChat`; `demoLeaderboard`; `demoNotificationRows` + `demoNotifications`; `demoThreadMessages`, `demoIsParticipant`, `demoOtherLabel`, `demoThreadList`, `demoUnreadCount`, `demoReactionRows`, `demoThreadReactionRows`, `demoReactionToggle`. Exports every one of those names except `DEMO_LONG_URL` and `demoNotificationRows`, which stay private | `../public/chat-reactions` (toggleAction as `reactionToggleAction`) |
| `lib/cron.js` | L4268-4293 `setupKeepAliveCron`; L4335-4375 `setupChristmasNudgeCron` | `cron`, `https`, `./db` (pool, DEMO_MODE, isMaintenanceMode), `./webpush-config` (webpush), `./push` (sendPushToUser), `../public/pluralize-pl` (plPlural, plCount) |

Note the same `chat-reactions` import in `lib/demo-data.js` and `routes/chat.js` is by design: the file is the
shared pure module and `require` caches it.

### 3.2 routes/ (route order inside each router = original relative order)

Every router: `const express = require('express'); const router = express.Router(); ... module.exports = router;`
Handlers keep their FULL absolute paths (`router.get('/api/presents/:id', ...)`). Mount with `app.use(router)` at
root, never with a prefix, so `req.url`, `req.baseUrl` and `req.params` are what they are today.

1. `routes/system.js` (3): `GET /health`, `GET /api/version`, `GET /api/updates`.
   `require('./package.json')` inside `/api/version` becomes `require('../package.json')` (keep it inside the handler).
2. `routes/pages.js` (12): `GET /`, `/home`, `/statystyki`, `/recipients`, `/register`, `/formularz`, `/activity`,
   `/osoby`, `/ustawienia`, `/rezerwacje`, `/archiwum`, `/wiadomosci`. `const ROOT_DIR = path.join(__dirname, '..');`
   and every `path.join(__dirname, 'public', X)` becomes `path.join(ROOT_DIR, 'public', X)` (same absolute path).
3. `routes/auth.js` (6): `POST /api/login`, `PUT /api/account/username`, `DELETE /api/account`, `POST /api/logout`,
   `GET /api/auth`, `POST /api/register` (moved up from L3641). Needs `bcryptjs`, `DEMO_MODE`, `pool`,
   http-errors (handleDbError, notFound, conflict, badRequest), `requireAuth`, `cache`, `clearCombinedDataCache`.
4. `routes/recipients.js` (10): `GET /api/recipients`, `POST /api/recipients`, `POST /api/recipients/:id/identify`,
   `GET /api/user/identification`, `DELETE /api/recipients/:id/identify`, `DELETE /api/recipients/:id`,
   `handleBase64Upload` (private function), `POST /api/recipients/:id/profile-picture`,
   `GET /api/recipients/:id/profile-picture`, `GET /api/recipients/:id`, then `POST /api/user/identify` (moved up
   from L3694). The `multer` `storage`/`upload` block (L530-546) moves here as module-private (its only user is
   the profile-picture route). Needs `multer`, `sharp`, `DEMO_MODE`, `pool`, `demoData`, http-errors (all five),
   `requireAuth`, `clearCombinedDataCache`, `withPresence`, `getUserIdentification`, `getRecipientById`,
   `createNotification`.
5. `routes/presents.js` (11): `GET /api/presents`, `GET /api/presents/all`, `GET /api/recipients-with-presents`,
   `GET /api/recipients-hash` (keeps its inline `require('crypto')`), `POST /api/presents`,
   `PUT /api/presents/:id/check`, `PUT /api/presents/:id`, `DELETE /api/presents/:id`, `GET /api/presents/abandoned`,
   `POST /api/presents/:id/reserve`, then `DELETE /api/presents/:id/reserve` (moved up from L3327, so both
   methods of that path share a router). Needs `DEMO_MODE`, `pool`, `demoData`, http-errors, `requireAuth`, `cache`,
   `combinedDataCache`, `COMBINED_CACHE_TTL`, `clearCombinedDataCache`, `withPresence`, `getAllPresents`,
   `getUserIdentification`, `getLeaderboardLeader`, `notifyLeaderboardChange`, `createNotification`,
   `sendNotificationToUsers`, `updateTracker`, `../public/notification-text` (notificationText).
6. `routes/notifications.js` (8): `POST /api/notifications/subscribe`, `GET /api/vapid-public-key`,
   `GET /api/notifications/debug`, [the `/* ... */` DEPRECATED comment block L2164-2305 moves verbatim, still a
   comment], `POST /api/notifications/read-all`, `POST /api/test-notification`, `GET /api/notifications`,
   `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`. Needs `DEMO_MODE`, `pool`,
   `webpush`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `demoNotifications`, `requireAuth`, `handleDbError`,
   `ensureNotificationsTable`, `getUserIdentification`, `sendNotificationToUsers`.
7. `routes/leaderboard.js` (1): `GET /api/leaderboard`. Needs `DEMO_MODE`, `pool`, `demoLeaderboard`.
8. `routes/chat.js` (9): `GET /api/wiadomosci/users`, `GET /api/wiadomosci/threads`, `GET /api/wiadomosci/unread-count`,
   `POST /api/wiadomosci/threads`, `GET /api/wiadomosci/threads/:id`, `DELETE /api/wiadomosci/threads/:id`,
   `POST /api/wiadomosci/threads/:id/messages`, `POST /api/wiadomosci/messages/:messageId/reactions`,
   `GET /api/link-preview`. Needs `DEMO_MODE`, `pool`, http-errors (handleDbError, notFound, forbidden, badRequest),
   `requireAuth`, `lib/chat` (ensureAnonMessageTables, notifyAnonMessage, reactionRateAllows), `lib/link-preview`
   (all four), `lib/demo-data` (demoChat + the 7 demo helpers it calls), and from `../public/chat-reactions`:
   `isAllowedReactionEmoji, buildReactionList, groupReactionsByMessage, parseMessageId as parseReactionMessageId,
   toggleAction as reactionToggleAction`. (`reactionThrottleStep` is used only in lib/chat.js.) Keep the
   section comments ("Anonymous messages (wiadomości)", "Emoji reactions on a message", "Link previews").
9. `routes/formularz.js` (3): `GET /api/formularz/recipients`, `POST /api/formularz/present`,
   `GET /api/formularz/my-presents`. `createdByNullableEnsured` + `ensureCreatedByNullable` (L3431-3444) move here
   as module-private (only used by `POST /api/formularz/present`). Needs `DEMO_MODE`, `pool`, `demoData`,
   http-errors, `requireAuth`, `cache`, `clearCombinedDataCache`, `getLeaderboardLeader`, `notifyLeaderboardChange`,
   `createNotification`, `sendNotificationToUsers`, `../public/notification-text`.
10. `routes/archive.js` (3): `POST /api/archive/run`, `GET /api/archive/years`, `GET /api/archive/presents`;
    `ensureArchiveTable` (L3773-3793) module-private. Needs `DEMO_MODE`, `pool`, `badRequest`, `handleDbError`,
    `requireAuth`, `cache`, `clearCombinedDataCache`, `getUserIdentification`.

Route totals: 3 + 12 + 6 + 10 + 11 + 8 + 1 + 9 + 3 + 3 = 66, equal to `server-split-routes-before.txt`.

### 3.3 What `server.js` RETAINS (in this order)
1. Requires it still needs: `express`, `express-session`, `body-parser`, `path`, `cors`, `express-mysql-session`
   (`MySQLStore = require(...)(session)`). `compression` stays required mid-file exactly where it is today.
   Dropped from `server.js` because they moved or are unused: `bcryptjs`, `multer`, `mysql2/promise`, `cron`,
   `https`, `sharp`, `pluralize-pl`, `notification-text`, `chat-reactions`; `fs` is imported today but never used,
   so it is simply not carried over (noted in section 9).
2. The `dotenv` block (L29-32) verbatim, BEFORE any `lib/` require.
3. `require('./lib/webpush-config');` (side effect only: VAPID logs/boot). Then
   `const { DEMO_MODE, dbConfig, pool, isMaintenanceMode, setMaintenanceMode, testDatabaseConnection } = require('./lib/db');`
   This keeps today's log order (VAPID logs, then "Database configuration:").
4. Remaining lib/route requires (any order; none log at load time).
5. `const app = express(); PORT; HOST;` then compression, cors, bodyParser x2, `express.static(... setHeaders ...)`,
   `app.set('trust proxy', 1)`, `isProduction`, the "Session configuration" log, `sessionConfig`, the
   `if (!DEMO_MODE && dbConfig) { new MySQLStore({}, pool) ... }` block, the maintenance middleware (with
   `isMaintenanceMode()`; it keeps `path.join(__dirname,'public','maintenance.html')`), `app.use(session(sessionConfig))`,
   `app.use(presenceMiddleware)`.
6. Mounts, in exactly this order (see section 5):
   ```js
   app.use(systemRoutes);
   app.use(pageRoutes);
   app.use(authRoutes);
   app.use(recipientRoutes);
   app.use(presentRoutes);
   app.use(notificationRoutes);
   app.use(leaderboardRoutes);
   app.use(chatRoutes);
   app.use(formularzRoutes);
   // Error handling middleware  (verbatim, 4 arguments, stays inline)
   app.use((err, req, res, next) => { ... });
   app.use(archiveRoutes);          // deliberately AFTER the error handler, as today
   ```
7. `async function startServer()` verbatim (uses `setMaintenanceMode`, `testDatabaseConnection`, `dbConfig`, `DEMO_MODE`).
8. `startServer();` then `setTimeout(() => { setupKeepAliveCron(); setupChristmasNudgeCron(); }, 5000);` with the
   original comments ("Setup keep-alive after server starts", "Wait 5 seconds ...").

---------------------------------------------------------------------------------------------------

## 4. The only edits allowed to moved code

1. `require` paths (`./public/x` -> `../public/x`, `./package.json` -> `../package.json`).
2. `app.get/post/put/delete(` -> `router.get/post/put/delete(` and the router export.
3. `__dirname` in `routes/pages.js` -> `ROOT_DIR` (section 3.2 item 2).
4. `MAINTENANCE_MODE` -> accessor calls (table in 2.1).
5. `module.exports = { ... }` / destructured `require(...)` lines; one short header comment per new file
   ("Moved verbatim from server.js (Phase 2 split)").
6. The presence middleware becomes a named export `presenceMiddleware` (same body).
Everything else stays byte-for-byte: strings, emoji in logs, SQL, comments, blank-line style, status codes.
Do not "fix" `catch (err) { throw err; }`, unused vars, or inconsistent naming.
Line endings: the working tree is CRLF via `core.autocrlf=true`; new files written with LF are normalized by git.

---------------------------------------------------------------------------------------------------

## 5. Route order: what is identical and the three deliberate position changes

The flat order of `server-split-routes-before.txt` is NOT reproduced literally. Literal identity would need
`presents`, `auth` and `recipients` each split into two routers just to park three routes at their historical
positions. Instead the order is preserved in every way that Express can observe:

- Middleware layers: same 10 layers before the first route, same single 4-arity error layer, same position
  relative to route SETS (everything except `/api/archive/*` before it, the three archive routes after it).
- Relative order of every pair of routes whose method and path pattern can match the same request:
  there are none today (no overlapping same-method patterns), and the checker proves it.
- Only three routes change their position in the flat list, all to sit next to their siblings:
  | Route | Was | Now |
  |---|---|---|
  | `POST /api/register` | after `/api/formularz/*` (L3641) | in `routes/auth.js`, after `GET /api/auth` |
  | `POST /api/user/identify` | after `POST /api/register` (L3694) | in `routes/recipients.js`, after `GET /api/recipients/:id` |
  | `DELETE /api/presents/:id/reserve` | after `GET /api/link-preview` (L3327) | in `routes/presents.js`, right after `POST /api/presents/:id/reserve` |
  The routers' mount order (system, pages, auth, recipients, presents, notifications, leaderboard, chat, formularz,
  error handler, archive) otherwise equals the original sequence of groups.

Expected flat walk after the split (66 routes, `MW`/`ERRMW` are middleware tokens produced by the walk script):
`MW x10`, system(3), pages(12), auth(6), recipients(10), presents(11), notifications(8), leaderboard(1),
chat(9), formularz(3), `ERRMW`, archive(3).

If a reviewer insists on a literal diff, the fallback is to keep these three routes in tiny extra routers
mounted at their old positions. That is NOT planned because it adds files whose only job is to preserve an
unobservable order.

---------------------------------------------------------------------------------------------------

## 6. Implementation steps (ordered by dependency; each leaves the app bootable)

Use these exact commands from the worktree root. Stage explicit paths only (never `git add .`, never `.agents/`),
never push. Commit messages follow Conventional Commits (see the git rules); body explains what/why.

- [ ] 0. Preflight and tooling (no product code touched).
      Create `.agents/tasks/phase2-tmp/` (temporary, deleted in step 5) and write the three tools from section 7:
      `walk-routes.js`, `check-route-order.js`, and the differential harness `diff-harness.js`.
      Run `git show 195d6c5:server.js > server.orig.js` at the repo root (temporary, untracked, deleted in step 5).
      Capture baselines: `node .agents\tasks\phase2-tmp\walk-routes.js server.js .agents\tasks\phase2-tmp\walk-before.txt`;
      `node .agents\tasks\phase2-tmp\diff-harness.js server.orig.js universal .agents\tasks\phase2-tmp\h-orig-universal.ndjson`
      and the same with `empty`.
      Verify: (a) the route lines of `walk-before.txt` (drop `MW`/`ERRMW`) equal `server-split-routes-before.txt`
      exactly (`Compare-Object`, no output) and the file has 10 `MW` tokens before the first route plus 1 `ERRMW`;
      (b) running the harness a second time on `server.orig.js` produces byte-identical output (determinism;
      if not, fix the normalization in the harness before continuing).
      Files: `.agents/tasks/phase2-tmp/*`, `server.orig.js`.

- [ ] 1. M1: extract `lib/` and rewire `server.js` (routes still inline in `server.js`).
      Create the `lib/` files from section 3.1 in layer order (L0 -> L2), then edit `server.js`: delete the moved
      blocks, add the requires (section 3.3 steps 1-4), switch `MAINTENANCE_MODE` sites to accessors, keep every
      route handler in place. In this milestone `server.js` handlers import the same names they used before
      (`cache`, `pool`, `demoData`, ...), so route text is untouched.
      Files: `lib/*.js`, `server.js`.
      Verify: `node --check` on `server.js` and every `lib\*.js`; walk after: `walk-routes.js server.js walk-m1.txt`
      then `node .agents\tasks\phase2-tmp\check-route-order.js walk-before.txt walk-m1.txt` prints PASS (here the
      lists must even be literally identical: `Compare-Object` empty); harness `universal` and `empty` on `server.js`
      are byte-identical to the orig outputs; quick demo boot: `$env:OFFLINE_MODE='true'; $env:PORT='3917'; node server.js`
      (background) then `Invoke-WebRequest http://127.0.0.1:3917/health` returns 200 with `"mode":"DEMO"`; stop it.
      Commit: `refactor(server): extract shared logic into lib/ modules`.

- [ ] 2. M2: move routes into `routes/` and slim `server.js`.
      One router at a time in the order system, pages, auth, recipients, presents, notifications, leaderboard,
      chat, formularz, archive. For each: create the file (section 3.2), delete the handlers from `server.js`, add
      the require and the `app.use(...)` line at the position given in 3.3 step 6. After each router run
      `node --check` and the harness (`universal`) so a missing import is caught at the router that caused it.
      Finish with the final `server.js` skeleton (section 3.3). Prove no leftovers: `Select-String -Path server.js
      -Pattern "^app\.(get|post|put|delete)\("` returns nothing, and `Select-String -Path routes\*.js -Pattern "\bapp\b"`
      returns nothing (excluding comments).
      Files: `routes/*.js`, `server.js`.
      Verify: `node --check` everything; walk + checker PASS against `walk-before.txt`; harness `universal`
      and `empty` byte-identical to the orig outputs; demo boot + `/health`.
      Commit: `refactor(server): move routes into routers under routes/`.

- [ ] 3. Docs and comment pointers only.
      `README.md` "Project layout": replace the `server.js - Express app and API routes` line with the new
      layout (server.js entry; lib/ shared logic; routes/ routers). `tests/README.md` "Where the demo data lives":
      change "All of it is in `server.js`" to `lib/demo-data.js`. `scripts/init-db.js` line 87 comment
      ("MIRROR of ensureAnonMessageTables() in server.js") -> `lib/chat.js`. Comment-only; no code.
      Do not edit any `tests/**/*.js` (their comments mentioning server.js stay).
      Verify: `node --check scripts\init-db.js`; `git diff --stat` shows only those three docs/comment files.
      Commit together with step 4's tracking-doc edit or as `docs: point docs at the new server layout`.

- [ ] 4. Full end-to-end verification (exit criteria).
      a. `npx playwright test --reporter=list` from the worktree root (about 6.5 min; use a 1,800,000 ms timeout,
         run in the background and poll). Expected exactly: exit code 0, **121 passed, 0 failed, 11 skipped (132)**,
         per `refactor-manageable-1-verification.md`. Any other number is a regression to investigate, not to explain away.
      b. Walk + checker PASS (step 2 command) and the harness diffs empty (re-run both modes on the final tree).
      c. `Select-String` audit: every `require('./` / `require('../` in `lib/` targets a lower layer (section 2.2);
         no `routes/*` requires another `routes/*`; nothing requires `server.js`.
      d. Identifier audit: for each moved top-level name in section 3 grep every new file; each file that uses a name
         must import or define it (the demo-mode suite does not execute production branches, so this is the guard
         that backs up the harness).
      e. Append a "Phase 2" section to `.agents/tasks/refactor-manageable-1-verification.md`: files created, line counts,
         the three moved routes, checker output, harness result, Playwright totals, and section 9 verbatim.

- [ ] 5. Cleanup and final state.
      Delete `.agents/tasks/phase2-tmp/` and `server.orig.js`. `git status --short` must list only intended changes
      (the untracked `.agents/tasks/*` review/plan files from the workflow are fine and are NOT staged).
      Final `git -P log --oneline -n 6` shows Phase 1 (`195d6c5`) followed by the Phase 2 commit(s), separate from it.
      Never `git push`.

Exit criteria summary: 66 routes, same methods/paths; same middleware stack and error-handler position; 121/0/11 in
Playwright; harness diff empty in both fake-DB modes; `server.js` still the entry point with no export changes.

---------------------------------------------------------------------------------------------------

## 7. Verification tooling to write in step 0 (temporary; never committed)

The Playwright suite only runs DEMO mode, so it never executes the `pool.execute` branches. A moved handler that
forgot an import would still pass it. The differential harness closes that gap by running the ORIGINAL and the NEW
server in non-demo mode against a fake database and diffing everything observable.

### 7.1 `walk-routes.js <entry> <outfile>` (run from anywhere; chdirs to repo root)
```js
'use strict';
const path = require('path'); const fs = require('fs');
const root = path.resolve(__dirname, '..', '..', '..');
process.chdir(root);
const entry = path.resolve(root, process.argv[2] || 'server.js');
const out = path.resolve(process.argv[3]);
process.env.OFFLINE_MODE = 'true'; process.env.NODE_ENV = 'development'; process.env.PORT = '0';
delete process.env.DB_PASSWORD;
const express = require(path.join(root, 'node_modules', 'express'));
let captured = null;
// Patch BEFORE require(entry): express() mixes application methods in at creation time.
express.application.listen = function () { captured = this; return { on() { return this; } }; };
require(entry);
const lines = [];
(function walk(stack) {
    for (const l of stack) {
        if (l.route) for (const m of Object.keys(l.route.methods)) lines.push(m.toUpperCase() + ' ' + l.route.path);
        else if (l.name === 'router') walk(l.handle.stack);
        else lines.push(l.handle.length === 4 ? 'ERRMW' : 'MW');
    }
})(captured._router.stack);
fs.writeFileSync(out, lines.join('\n') + '\n');
process.exit(0);
```
`query` and `expressInit` count as `MW` tokens, so the first route is preceded by 10 `MW` (query, expressInit,
compression, cors, json, urlencoded, static, maintenance, session, presence). Router layers are descended into,
so mounted routers flatten into the same list.

### 7.2 `check-route-order.js <before> <after>`
Parse both files into items: each `MW`/`ERRMW` token is its own item; consecutive route lines form one `ROUTES` group.
Fail unless:
1. same number of items, same type at every index (so the error layer sits at the same place);
2. each `ROUTES` group has the same SET of lines in both files (no route lost, duplicated or moved across a middleware);
3. inside each group, every pair of lines with the same method and overlapping patterns keeps its relative order.
   Overlap = same method, same segment count, and each segment equal or at least one starts with `:`.
   Also print how many overlapping pairs exist (expected 0).
Print `PASS` plus the list of routes whose index inside their group changed (expected: the three in section 5,
plus the routes shifted by them). Exit non-zero on any failure.

### 7.3 `diff-harness.js <entry> <universal|empty> <outfile>` (one process per run, no sockets to other processes)
- Chdir to repo root. Env: `DB_PASSWORD=fake`, `DB_HOST=127.0.0.1`, `NODE_ENV=development`, `SESSION_SECRET=x`,
  `HOST=127.0.0.1`; delete `OFFLINE_MODE` and `DEMO_MODE` so `DEMO_MODE` is false.
- Install a `Module._load` hook BEFORE requiring the entry:
  - `mysql2/promise` -> `{ createPool: () => fakePool }`. `fakePool` has `execute`, `query`, `getConnection`
    (returns `{ ping, release, execute, beginTransaction, commit, rollback }`). Every call appends
    `{ case: currentCase, sql: collapsed whitespace, params }` to a log and returns by SQL pattern:
    `universal` -> a single row with many fields (`id:1, name:'N', username:'u', password:<bcryptjs hash of 'pw'>,
    title:'T', count:1, cnt:1, mine:1, identified_by:1, recipient_id:1, reserved_by:1, created_by:1, thread_id:1,
    initiator_id:1, target_id:2, sender_id:2, is_checked:0, body:'b', total_presents:1, ...` plus `affectedRows:1`,
    `insertId:7` on the OkPacket-style second element); `empty` -> `[[], {affectedRows:0, insertId:0}]` shaped
    consistently for both array-destructuring styles used in the file (`[rows]` and `[result]`).
  - `express-mysql-session` -> `function (session) { return class FakeStore extends session.Store { ...in-memory
    get/set/destroy/touch... } }` (server.js does `require('express-mysql-session')(session)` then `new MySQLStore({}, pool)`).
  - `web-push` -> `{ setVapidDetails(){}, sendNotification: async (sub, payload) => { log push } }`.
  - `globalThis.fetch = async () => { throw new Error('offline'); }` (link-preview takes its graceful-miss path).
- Patch `express.application.listen` like the walker to capture `app`, `require(entry)`, wait ~400 ms (async
  `startServer` -> `testDatabaseConnection` -> fake `getConnection().ping()`), then
  `http.createServer(captured).listen(0, '127.0.0.1')`.
- Drive every one of the 66 routes sequentially with `fetch` and a manual cookie jar: unauthenticated probes first
  (expect 401 / redirects with `redirect:'manual'`), `POST /api/login` with `{username:'u', password:'pw'}`, then every
  route with plausible params (ids `1`, bodies that pass validation, plus one invalid-body probe for the
  validating routes, and `X-Test-Case` is not needed because `currentCase` is set in-process). Put destructive
  session routes (`DELETE /api/account`, `POST /api/logout`) last; re-login before anything that follows them.
  For `POST /api/recipients/:id/profile-picture` send both a JSON `{profile_picture:'data:image/png;base64,...'}`
  body and a tiny multipart PNG so sharp and multer paths run.
- Record per case: `status`, normalized body (replace ISO dates and 13-digit epoch numbers with placeholders,
  drop `timestamp` keys, replace the session id), `location` header for redirects, the list of fake-DB calls
  (sql + params) and pushes. Write NDJSON to `<outfile>`; also write all captured `console.error` text to
  `<outfile>.err` and fail loudly if it contains `ReferenceError` or `is not defined` or `is not a function`
  (the original is expected to have none).
- Compare with `Compare-Object (Get-Content a) (Get-Content b)` or `fc.exe`; the result must be empty for
  `universal` and for `empty`. The harness may need small normalization tweaks to be deterministic on the ORIGINAL
  first (step 0b); do not tweak it to hide a difference on the new tree.

---------------------------------------------------------------------------------------------------

## 8. Reviewer checklist (verdict file contract)

Write `.agents/tasks/phase2-review.json` EVERY iteration, last, shaped
`{"verdict": "APPROVED" | "CHANGES_REQUESTED", "summary": "...", "findings": [...]}`; the loop stops on
`verdict == "APPROVED"`. Approve only if all of these hold on `git diff 195d6c5..HEAD`:
- `server.js` is the entry point, still has no exports, still calls `startServer()` then the 5 s `setTimeout`,
  and `package.json`, `Dockerfile`, `render.yaml`, `vercel.json`, `.dockerignore`, `playwright.config.js`, `tests/**`
  and `public/**` are unchanged (`git diff --stat 195d6c5..HEAD -- <those>` is empty). Only `README.md`, `tests/README.md`
  and the `scripts/init-db.js` comment may change outside `server.js`, `lib/`, `routes/`.
- Moved code is verbatim apart from the edits listed in section 4 (spot-check with `git diff --color-moved` or by diffing
  function bodies against `git show 195d6c5:server.js`). No behavior fix slipped in.
- Walk + checker PASS; exactly three routes changed flat position (section 5); error layer between formularz and archive.
- No `lib/` -> `routes/` or `routes/` -> `routes/` requires; no cycles; no new dependency in `package.json`.
- Playwright 121 passed / 0 failed / 11 skipped is recorded with evidence; harness diffs empty.
- Phase 2 is in its own commit(s) after `195d6c5`; temp files (`server.orig.js`, `phase2-tmp/`) are gone; nothing pushed.

---------------------------------------------------------------------------------------------------

## 9. Noted, not fixed (observed while reading; leave as is)

1. `/api/archive/*` is registered after the global error handler, so thrown errors there skip it (handlers have try/catch, so it works today).
2. `GET /api/recipients/:id` and `POST /api/user/identify` have no `DEMO_MODE` branch; in demo mode they hit `pool.execute` on `undefined` and return the 500 error JSON.
3. The error handler's 413 message says "Maksymalny rozmiar to 10MB" while body parsers allow 50mb.
4. `fs` is required but unused; `getRecipientById` is only used by `GET /api/recipients/:id`; `isUserIdentifiedAsRecipient` is never called; `createNotification` has a stray "Create notification for relevant users" comment above the cancel-reservation route (L3325).
5. A large dead `/* ... */` block of old notification routes (L2164-2305) is kept as a comment.
6. `GET /api/notifications/unread-count` excludes `anon_message` rows but `POST /api/notifications/:id/read` recounts without that filter (inconsistent badge after mark-as-read).
7. Security smells left untouched: VAPID private-key and `SESSION_SECRET` fallbacks are hard-coded; `GET /api/auth` and several routes log `req.headers.cookie` / full `req.session`; `GET /api/leaderboard`, `GET /api/recipients/:id/profile-picture`, `POST /api/register` and the formularz routes are unauthenticated by design; any logged-in user can call `/api/test-notification` and `/api/notifications/debug`; the link-preview SSRF guard is hostname-string based (no DNS resolution, IPv6 only `[::1]`).
8. `POST /api/formularz/present` runs `ALTER TABLE` lazily at request time; schema is also created lazily for notifications, anon chat and archive.
9. In-memory state (presence, link-preview cache, reaction throttle, update tracker, caches) is per process and resets on deploy.
10. `package.json` lists the npm `path` package although Node's built-in `path` always wins.
