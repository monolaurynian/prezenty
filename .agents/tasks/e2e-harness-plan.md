# Plan: reusable end-to-end test harness (real app, headless Edge, assertions)

Goal: replace throwaway `%TEMP%` static harnesses and eyeballed screenshots with a
committed Playwright suite that boots **the real `server.js` in demo mode**, drives the
**real pages**, and **asserts** — so every future change is verified by running the app.

Everything below was verified by reading the code. File + line references are from the
tree as it stood when this plan was written (`server.js` ~3990 lines).

> **Line numbers have since drifted.** Items 1, 6, 7 and 8 are already implemented
> (`package.json` scripts + the pinned `@playwright/test`, and ~340 added lines of
> `DEMO_MODE` branches and `demoData` in `server.js`). Everything in `server.js` after
> ~line 2314 has shifted **+16 to +120 lines**. Anchor on **route paths and symbol names**
> (`app.post('/api/wiadomosci/messages/:messageId/reactions'`, `ensureAnonMessageTables`,
> `const demoData`), not on the line numbers quoted below — those remain accurate as a
> record of what was verified, not as current coordinates.

---

## 0. Concurrency constraint — READ FIRST

**Another workflow is editing the add-present composer and the dock right now.** The
following files are **READ-ONLY for this task**. They may be read and they may be
*measured* by tests, but **no plan item below writes to them**:

- `public/formularz.html`
- `public/formularz.js`
- `public/tab-bar-functions.js`
- `public/bottom-tab-bar.css`
- `public/bottom-tab-bar-snippet.html`
- `public/app-theme.css`
- `public/sw.js` — **do not touch at all**; no cache bump is needed, this task ships no
  change to anything the service worker precaches.

**Writes are confined to:**

1. a new `tests/` directory (specs, helpers, config, README, generated artifacts),
2. `playwright.config.js` at the repo root,
3. `package.json` (devDependency + scripts),
4. `.gitignore` (test artifact paths),
5. **narrowly scoped `DEMO_MODE`-only additions in `server.js`** (new keys on `demoData`
   and new `if (DEMO_MODE)` branches). Production code paths stay byte-identical,
   `requireAuth` is never weakened, nothing persists to disk or a database.

**Policy on bugs found by the new tests:** if a spec fails because of a genuine product
bug — especially in one of the read-only files — mark it `test.fixme(...)` with a comment
naming the bug and the owning file, and list it in the final report. **Do not fix product
bugs in this task and do not weaken an assertion to make it pass.**

---

## 1. Verified findings

### 1.1 `DEMO_MODE` — the whole reason this is possible

`server.js:83-86`:

```js
let DEMO_MODE = process.env.DEMO_MODE === 'true' ||
    process.env.OFFLINE_MODE === 'true' ||
    !process.env.DB_PASSWORD ||
    (process.env.NODE_ENV === 'development' && !process.env.DB_PASSWORD);
```

Confirmed: on when `DEMO_MODE==='true'` **or** `OFFLINE_MODE==='true'` **or** when
`DB_PASSWORD` is unset. `MAINTENANCE_MODE` is a separate flag (`server.js:88-90`), false in
demo.

- The MySQL pool is created **only** when `!DEMO_MODE` (`server.js:96-146`), so in demo mode
  `pool` is `undefined` and every `pool.execute` would throw — which is why each route
  needs its own `if (DEMO_MODE)` branch.
- `dotenv` loads **before** the flag is computed (`server.js:29-31`), so a developer's
  `.env` containing `DB_PASSWORD` would *disable* demo mode. **`OFFLINE_MODE=true` wins
  regardless** — that is the flag the harness must set. (`.env` does not exist in the tree
  today; `Test-Path .env` → False.)
- `demoData` is declared at **`server.js:3832-3846`** — after the routes but before
  `startServer()` (`server.js:3849`, called at `server.js:3957`), so route handlers
  referencing it at request time are fine. It currently holds only `users` (1),
  `recipients` (3), `presents` (3).

### 1.2 Health endpoint = readiness probe

`server.js:561-568` — confirmed shape:

```js
app.get('/health', (req, res) => {
    res.status(200).json({
        status: MAINTENANCE_MODE ? 'MAINTENANCE' : 'OK',
        timestamp: new Date().toISOString(),
        mode: MAINTENANCE_MODE ? 'MAINTENANCE' : (DEMO_MODE ? 'DEMO' : 'PRODUCTION'),
        database: (DEMO_MODE || MAINTENANCE_MODE) ? 'disabled' : 'enabled'
    });
});
```

It is also exempted from the maintenance gate (`server.js:492`), and it is registered
*after* `express.static` but before any auth, so it answers without a session.

### 1.3 Port / host / cwd

- `server.js:404` `const PORT = process.env.PORT || 3002;`
- `server.js:405` `const HOST = process.env.HOST || '0.0.0.0';`
- Demo boot listens with `app.listen(PORT, HOST, …)` at `server.js:3861`, and on listen
  error logs and `process.exit(1)` (`server.js:3868-3871`).
- `express.static('public', …)` at `server.js:430` uses a **relative** path, so the child
  process **must be spawned with `cwd` = repo root**. `HOST=127.0.0.1` keeps the test server
  off the LAN.

### 1.4 Session / auth

- `server.js:452` `isProduction = NODE_ENV === 'production' || HTTPS === 'true'`, and
  `server.js:466` `cookie.secure = isProduction`. **The harness must not set
  `NODE_ENV=production`** or the session cookie becomes `Secure` and login over plain HTTP
  silently fails. Use `NODE_ENV=development`.
- `server.js:463` `secret: process.env.SESSION_SECRET || 'prezenty_secret'` — **not
  required**, there is a fallback. The harness sets a fixed one anyway so the log line at
  `server.js:455-459` is unambiguous.
- `server.js:475-483`: the MySQL session store is attached **only** when `!DEMO_MODE`; in
  demo mode express-session uses its MemoryStore with `resave: true`. Cookie name
  `prezenty.sid` (`server.js:462`), `sameSite: 'lax'`, 30-day maxAge.
- `requireAuth` (`server.js:549-557`) gates on `req.session.userId` only — unchanged.
- **Demo login accepts any username/password**: `server.js:701-740`, demo branch at
  `server.js:705`; it sets `req.session.userId = 1` and `req.session.username = username`
  for *any* non-empty pair, 401 only when either is missing. So one shared login fixture
  works — **but every demo session is user id 1** (see limits, §5).

### 1.5 `DEMO_MODE` branches that need extending

| Area | Route | Line | Demo branch today |
|---|---|---|---|
| chat users | `GET /api/wiadomosci/users` | 2630 | `2631` → `{ users: [] }` |
| chat threads | `GET /api/wiadomosci/threads` | 2644 | `2645` → `{ threads: [] }` |
| chat badge | `GET /api/wiadomosci/unread-count` | 2681 | `2682` → `{ count: 0 }` |
| new thread | `POST /api/wiadomosci/threads` | 2699 | `2700` → 503 |
| thread read | `GET /api/wiadomosci/threads/:id` | 2737 | `2738` → `{ messages: [] }` |
| delete thread | `DELETE /api/wiadomosci/threads/:id` | 2797 | `2798` → 503 |
| reply | `POST /api/wiadomosci/threads/:id/messages` | 2818 | `2819` → 503 |
| **reactions** | `POST /api/wiadomosci/messages/:messageId/reactions` | 2882 | `2883` → 503 |
| leaderboard | `GET /api/leaderboard` | 2498 | `2502` → `users: []`, zeroed `cumulativeStats` |
| notifications | `GET /api/notifications` | 2363 | `2371` → `{ notifications: [], unreadCount: 0, hasMore: false }` |
| unread count | `GET /api/notifications/unread-count` | 2437 | `2441` → `{ count: 0 }` |
| mark read | `POST /api/notifications/:id/read` | 2462 | `2469` → `{ success: true, unreadCount: 0 }` |
| mark all read | `POST /api/notifications/read-all` | 2308 | `2314` → `{ success: true }` |
| link preview | `GET /api/link-preview` | 2980 | **none** — does a real outbound `fetch` |

Already demo-complete (read, no change needed): `/api/recipients` (889, demo at 892),
`/api/recipients` POST (927/938), identify (970/975), `/api/user/identification`
(1021/1025), un-identify (1053/1059), delete recipient (1111/1116), profile picture
(1223/1267, 1332/1335), `/api/presents` (1393/1397), `/api/presents/all` (1461/1464),
`/api/recipients-with-presents` (1502/1513), `/api/recipients-hash` (1585/1588),
`POST /api/presents` (1630/1639), check (1736/1743), update (1815/1826), delete
(1864/1868), reserve (1953/1960), un-reserve (3227/3234), `/api/formularz/recipients`
(3311/3314), `/api/formularz/present` (3347/3356), `/api/formularz/my-presents`
(3498/3503), archive (3766/3767, 3783/3784).

Note the pre-existing demo inconsistency (do **not** "fix" it): `demoData.recipients[1]`
(`Jan Nowak`) has `identified_by: 1`, i.e. the demo user, yet
`/api/user/identification` hard-codes `isIdentified: false` (`server.js:1025-1034`). Tests
must assume **not identified** on the demo user.

### 1.6 Chat / reaction internals the specs will drive

- `public/chat-reactions.js` is **dual-use**: `module.exports` of the pure core
  (`isAllowedReactionEmoji`, `parseMessageId`, `buildReactionList`,
  `groupReactionsByMessage`, `toggleAction`, `reactionThrottleStep`) at lines 116-130, and
  the browser UI as `window.ChatReactions`. `server.js:17-25` requires it. The demo
  reaction endpoint must reuse `buildReactionList` so the demo path exercises the shipped
  aggregation (rows shaped `{ emoji, cnt, mine }`, `mine` compared with `Number(mine)===1`,
  `chat-reactions.js:64-76`).
- Allowlist, in order: `❤` `😂` `👍` `🎁` `😮` `🙏` (`public/chat-reactions.js:31-38`).
- Real production response shape is aggregate-only: `{ emoji, count, mine }`
  (`server.js:2757-2772` for the thread GET, `server.js:2929-2941` for the toggle). The
  reactor's user id exists only in `anon_message_reactions`
  (DDL `server.js:2593-2609`, inside `ensureAnonMessageTables`, `server.js:2561-2612`).
- Server throttle: 30 toggles / 10 s per user (`server.js:2863-2878`), 429 with
  `Zbyt wiele reakcji. Odczekaj chwilę`.
- Client: `public/wiadomosci.html:348` polls `loadThreadMessages()` **every 8 s** while a
  thread is open, and `:349` polls `loadThreads()` every 60 s. `loadThreadMessages()` is a
  page global, so a spec can call it directly instead of waiting 8 s.
- Message DOM (`public/wiadomosci.html:638-648`): `.chat-msg-row.from-me|.from-them` >
  `.chat-bubble` + `.chat-reactions[data-reactions-for="<id>"]`. Chips are
  `button.chat-reaction-chip[data-message-id][data-emoji][aria-pressed]`; the trailing
  control is `button.chat-reaction-add` (`chat-reactions.js:172-188`).
- Picker: `#reactionSheet[role=dialog][aria-modal=true]` + `#reactionSheetOverlay` +
  `#reactionSheetGrid` + `#reactionSheetClose` (`public/wiadomosci.html:259-269`).
- Thread list rows: `.thread-row` > `.thread-who`, `.thread-unread`, `.thread-last`
  (`public/wiadomosci.html:469-480`). Labels: initiator sees the target username, target
  sees `Święty Mikołaj 🎅` (`server.js:2673-2676`).
- `/api/link-preview` is called for the first URL in every message
  (`public/wiadomosci.html:606`) and the route makes a **real outbound HTTP request**
  (`server.js:3002-3010`) — it must get a demo guard or the suite is neither hermetic nor
  fast.

### 1.7 Polish plural helpers (shared, dual-use)

`public/pluralize-pl.js` — `plForm(n)` → `one | few | many | other`; `plPlural(n, one,
few, many, other?)`; `plCount(n, …)` → `"<n> <form>"`. CLDR-correct: `one` iff `n===1`;
`few` iff `n%10 ∈ 2..4` **and** `n%100 ∉ 12..14`; else `many`; non-integers → `other`
(falls back to `few`). Exports via `module.exports` (lines 34-38), so Node-side assertions
are possible. Boundary table the specs must cover:

| n | 0 | 1 | 2 | 5 | 12 | 22 | 112 |
|---|---|---|---|---|---|---|---|
| form | many | one | few | many | many | few | many |
| `prezent…` | prezentów | prezent | prezenty | prezentów | prezentów | prezenty | prezentów |
| `kupion…` | kupionych | kupiony | kupione | kupionych | kupionych | kupione | kupionych |
| `zarezerwowan…` | zarezerwowanych | zarezerwowany | zarezerwowane | zarezerwowanych | zarezerwowanych | zarezerwowane | zarezerwowanych |

### 1.8 `public/notification-text.js` — every activity type it knows

Confirmed by reading the `switch` (lines 70-100). **Exactly 7 explicit cases + a default:**

1. `recipient_added` → `dodaje nową osobę: <name>` (no name → `dodaje nową osobę`)
2. `present_added` → `dodaje prezent „T”[ dla: X]`
3. `present_reserved` → `rezerwuje „T”[ dla: X]`
4. `present_unreserved` → `rezygnuje z rezerwacji „T”[ dla: X]`
5. `present_checked` → `kupuje „T”[ dla: X]`
6. `present_unchecked` → `cofa oznaczenie „kupione” przy „T”[ dla: X]`
7. `present_added_batch` → `dodaje <plCount(count,…)>[ dla: X]`
8. **default** (anything else) → `coś zmienia`

> **The wording is emoji-free as of the orchestrator's edit to
> `public/notification-text.js` (`:73-100`, verified in this tree).** The emoji were
> dropped because the activity UI already shows a per-type icon
> (`notificationConfig[...].icon`, `public/activity.html:491-535`). Every assertion in
> item 11 must expect the **emoji-free** strings above, and **must not re-add emoji**.
> `public/notification-text.js` stays outside this task's write scope — align the
> assertions, never the file. A spec that asserts emoji would also be asserting the
> wording *twice* (text + icon), which is exactly what the change removed.

Other behaviour to assert: output is prefixed with `<strong>actor</strong> ` unless
`showActor: false`; falsy actor → `Ktoś`; `html: false` returns plain text; `escapeHtml`
covers `& < > " '` (lines 29-36); `dla: X` is **omitted when `recipientName` equals the
actor** (case/space-insensitive, lines 58-68).

`public/activity.html:491-535` adds **two more types the renderer knows but
`notification-text.js` does not**: `leaderboard_leader` and `anon_message`; unknown types
fall through to the `coś zmienia` default (`activity.html:731-740`). Server-side,
`/api/notifications` **excludes `type = 'anon_message'`** (`server.js:2387`,
`server.js:2420`). Types actually produced by the server:
`createNotification('leaderboard_leader'|'recipient_added'|'present_added'|
'present_reserved'|'present_unreserved', …)` at `server.js:281, 953, 1688, 2010, 3294,
3451`. The demo notification feed must therefore cover **all 9** renderable types plus one
deliberately unknown type.

### 1.9 Leaderboard rendering (the "kupionych / zarezerwowany" fix to lock in)

`public/leaderboard.html:1206-1227` renders each activity row as
`.user-card.activity-card` > `.activity-rank`, avatar, `.activity-name`,
`.activity-stats` > (`.activity-stat` × 2 with `.activity-stat-sep` between),
`.activity-score` > `.activity-score-value` + `.activity-score-label`.

- `.activity-stats` is `flex-direction: column` by default (`:794-806`) and
  `.activity-stat { white-space: nowrap }` (`:808-813`) so a count can never be split from
  its adjective; `.activity-stat-sep { display: none }` (`:838-840`).
- `@media (min-width: 768px)` (`:891-911`) switches to `flex-direction: row; flex-wrap:
  wrap` and shows the `•` separator.
- `.activity-stat-noun` is visually hidden (`:820-830`) and carries the agreeing noun, so
  the accessible name reads `1 zarezerwowany prezent`.
- Adjectives come from `plCount(boughtCount, 'kupiony','kupione','kupionych')` and
  `plCount(reservedCount, 'zarezerwowany','zarezerwowane','zarezerwowanych')`; the score
  label from `plPlural(total,'aktywność','aktywności','aktywności')` (`:1214-1224`).
- **`.activity-name` interpolates `user.username` unescaped** (`leaderboard.html:1209`) —
  see §4.

### 1.10 Edit bottom sheet (the first delivered feature; regression target)

From `app-theme.css` (read-only) per `.agents/tasks/edit-sheet-verification.md`: at
`max-width: 768px`, `#editPresentModal .modal-dialog` is `position: fixed; bottom: 0;
width:100%`, content `max-height: 90dvh`, `border-radius: 20px 20px 0 0`, grab handle via
`::before` (40×4). `textarea#editPresentComments` / `#presentComments` get
`min-height: 120px` (`132px` ≥769px) and `resize: vertical`. Trigger on the recipients
page: `button.edit-present-btn[data-present-id]` (`public/recipients.js:1134-1136`,
handler `:1303`), modal opened as a Bootstrap modal (`public/recipients.js:3604`), markup
at `public/recipients.html:1053`. Bootstrap 5.3 supplies the focus trap and Escape.

### 1.11 Build / tooling reality

- `package.json`: `"offline": "cross-env OFFLINE_MODE=true NODE_ENV=development node
  server.js"` — **`cross-env` is NOT in `devDependencies`** (which are only
  `@fullhuman/postcss-purgecss`, `cssnano`, `nodemon`, `postcss`, `postcss-cli`). The
  script is broken on a clean install. `"test": "echo 'No tests specified'"`.
- **`node_modules/` does not exist in the tree** (`Test-Path node_modules` → False), so
  `npm install` is a prerequisite for *anything* — including booting the server.
- Local `node v24.11.0`, `npm 11.6.1`. `engines.node` in `package.json` says `>=16`.
- Edge is installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, so
  Playwright `channel: 'msedge'` needs **no browser download**.
- `@playwright/test` latest is `1.64.0` but requires `node >=20`; `1.62.0`/`1.63.0` also
  `>=20`; **`1.61.0` is the newest release with `engines.node >= 18`**.
- Pages fetch CSS/JS from exactly two external hosts: `cdn.jsdelivr.net` (Bootstrap) and
  `cdnjs.cloudflare.com` (Font Awesome / Remix Icon). Service workers are registered only
  by `public/index.html:142` and `public/ustawienia.html:207`.
- `.gitignore` has no entry for test artifacts yet.
- Loose throwaway file at the repo root, unrelated but worth flagging in the report:
  `tmp-emoji-click.js`.

### 1.12 Techniques ported from the prior verification docs

Read: `.agents/tasks/verification.md`, `addmode-verification.md`,
`chat-noscroll-verification.md`, `chat-reactions-verification.md`,
`edit-sheet-verification.md`, `leaderboard-stats-verification.md`.
**`composer-v2-verification.md` does not exist yet** (only
`screenshots/composer2-before-375-*.png` are present) — the concurrent workflow has not
written it. Nothing in this plan depends on it.

Techniques to port as real assertions (not reinvented):

| Technique | Source | Ported into |
|---|---|---|
| Walk the whole DOM comparing `getBoundingClientRect().right` to the viewport's and to a container's content right edge | `chat-noscroll-verification.md:6-14` | `helpers/overflow.js` |
| `scrollWidth` vs `clientWidth` on every element whose computed `overflow-x`/`overflow-y` is `auto`/`scroll`; remember that `overflow-y:auto` makes `visible` compute to `auto` | same, `:27-34` | `helpers/overflow.js` |
| Pseudo-elements have no client rect → measure `::before`/`::after` boxes from `getComputedStyle(el, '::after')` | same, `:11-14` | `helpers/overflow.js` |
| Re-measure with the `html,body{overflow-x:hidden}` guard disabled, to prove the fix is structural | same, "Without the body-level guard" | `helpers/overflow.js` (`ignoreGuard` option) |
| Frame-by-frame `scrollY` sampling at 0/60/150/300/450 ms after an action | `addmode-verification.md:464` | `helpers/scroll.js` |
| `focus` survives an in-place rebuild / a poll: stash the node, act, assert `document.activeElement === stashed` | `chat-reactions-verification.md:43-58` | `helpers/focus.js` |
| Pressed state distinguishable **without colour**: compare non-colour computed properties (`border-width`, `box-shadow` geometry, `outline-width`) | `chat-reactions-verification.md:62-80` | `helpers/non-color-cue.js` |
| Computed-style contrast: resolve the effective background by walking ancestors, then WCAG ratio | `verification.md:47-49`, `chat-reactions-verification.md:289-299` | `helpers/contrast.js` |
| Dialog bottom edge == viewport bottom; measured `max-height`/textarea height | `edit-sheet-verification.md:57-66` | `e2e/edit-sheet.spec.js` |
| True viewports (headless Edge `--window-size` clamps to ~490 px — Playwright `viewport` does not) | `verification.md:15`, `chat-noscroll-verification.md:106-108` | `playwright.config.js` |

---

## 2. Design decisions (made here, with rationale)

1. **Playwright Test, `channel: 'msedge'`, pinned `@playwright/test` `1.61.0` exact (no
   `^`).** Newest release still declaring `engines.node >= 18`; `1.62+` demands `>=20`,
   which drifts further from this repo's `engines: node >= 16`. Edge is already installed,
   so `npx playwright install` is never needed. Rationale for Playwright over bare
   `playwright-core` scripts (what the prior harnesses used): web-first auto-retrying
   assertions, trace/screenshot-on-failure, fixtures, and a real reporter — which is what
   turns a one-off harness into reusable infrastructure.
2. **The server is booted once per suite by `globalSetup`, not by Playwright's
   `webServer`.** `webServer` needs the port baked into the config before anything runs;
   `globalSetup` can pick a free ephemeral port at runtime, poll `/health` for
   `mode === 'DEMO'`, and keep the child handle in a closure for a **returned teardown
   function** (supported by Playwright's `globalSetup`). Cost: `use.baseURL` in the config
   cannot know the port, so it is **overridden by an option fixture** that reads
   `process.env.E2E_BASE_URL` (env set in `globalSetup` is inherited by worker processes).
3. **`workers: 1`, `fullyParallel: false`.** One server, one in-memory demo dataset, one
   demo user (id 1). Parallel workers would race on mutable demo state (reaction toggles,
   added presents). Sequential is also fast enough: there is no DB.
4. **Env passed to the child:** `OFFLINE_MODE=true` (beats any `.env` `DB_PASSWORD`),
   `NODE_ENV=development` (keeps the session cookie non-`Secure`), `HOST=127.0.0.1`,
   `PORT=<free>`, `SESSION_SECRET=e2e-fixed-secret`, `E2E=1` (reserved, unused for now).
   Explicitly **not** `DEMO_MODE=true` — `OFFLINE_MODE` is the documented offline switch
   and produces the clearer boot log (`server.js:3852`).
5. **Free port:** `net.createServer().listen(0,'127.0.0.1')` → read `address().port` →
   close → spawn. The TOCTOU window is tiny; `globalSetup` retries up to 3 times if the
   child dies with `EADDRINUSE`.
6. **Teardown is unconditional.** The returned teardown, a `try/finally` around the health
   poll, and a `process.on('exit')` safety net all funnel into one `stop()` that on
   `win32` runs `taskkill /PID <pid> /T /F` (kills the tree) and falls back to
   `child.kill()`. Failure path included — a failed health poll must not leave an orphan
   `node.exe`.
7. **Login once, reuse `storageState`.** `globalSetup` uses `request.newContext()` to
   `POST /api/login {username:'e2e', password:'e2e'}` and writes
   `tests/.auth/demo.json`. Cookies ignore port, so the state survives a different
   ephemeral port between runs; the config still re-creates it every run. Demo login
   accepts anything (§1.4).
8. **`serviceWorkers: 'block'`.** Only `index.html` and `ustawienia.html` register one, but
   a SW cache would make assertions depend on run order.
9. **Assertion-first.** `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`,
   `video: 'off'`. No committed screenshots, no visual baselines (a 2-CDN, font-dependent
   page would produce flaky pixel diffs).
10. **No arbitrary sleeps.** Web-first `expect(locator)` assertions, `page.waitForFunction`,
    and `page.waitForResponse` only. Where the app's own 8 s poll matters, the spec calls
    the page global `loadThreadMessages()` directly, and **one** spec additionally waits
    for the real poll (that one is marked `test.slow()`).
11. **A CDN response cache under `tests/.cache/cdn/`** (`context.route` handler, write-through
    on first run). Keeps repeat runs offline and fast without blocking the CDN assets —
    blocking them would change layout and invalidate every overflow measurement. First run
    needs internet; a `requestfailed` on either CDN host fails the test with an explicit
    "CDN unreachable" message rather than a confusing layout assertion failure.
12. **Demo additions are append-only.** New `demoData` keys and new rows; existing
    `recipients`/`presents` entries and ids are left untouched so nothing that already reads
    the demo data changes shape.
13. **Specs live in `tests/e2e/*.spec.js`, CommonJS.** `package.json` has no
    `"type": "module"`, so `require` is the native style here; matching it avoids a
    transpile step.

---

## 3. Implementation plan

- [ ] 1. **Dependencies and npm scripts.** Add `"@playwright/test": "1.61.0"` (exact, no
      caret) to `devDependencies`. Replace the placeholder test script and add the e2e
      ones; fix the `offline` script's missing `cross-env` **without adding a dependency**
      by pointing it at the harness launcher from item 2
      (`"offline": "node tests/helpers/start-demo-server.js --foreground"`), since the test
      runner sets env in-process when it spawns the server. Scripts:
      `"test": "npm run test:e2e"`, `"test:e2e": "playwright test"`,
      `"test:e2e:headed": "playwright test --headed"`,
      `"test:e2e:ui": "playwright test --ui"`,
      `"test:e2e:report": "playwright show-report tests/.report"`.
      Add to `.gitignore`: `tests/.auth/`, `tests/.report/`, `tests/.results/`,
      `tests/.cache/`, `playwright-report/`, `test-results/`.
      Files: `package.json`, `.gitignore`
      Verify: `npm install` exits 0; `npx playwright --version` prints
      `Version 1.61.0`; `node -e "require('@playwright/test')"` exits 0.

- [ ] 2. **Demo-server launcher helper.** `tests/helpers/start-demo-server.js` exporting
      `startDemoServer({ portHint } = {})` → `{ baseURL, port, pid, stop(), logs() }`:
      pick a free port (§2.5), `spawn(process.execPath, ['server.js'], { cwd: repoRoot,
      env: {...process.env, OFFLINE_MODE:'true', NODE_ENV:'development',
      HOST:'127.0.0.1', PORT, SESSION_SECRET:'e2e-fixed-secret'}, stdio:['ignore','pipe','pipe'] })`,
      buffer stdout/stderr (cap ~64 KB), poll `GET /health` every 150 ms for up to 30 s
      until `res.ok && body.mode === 'DEMO'`, and on timeout / early child exit **kill the
      child** and throw an `Error` whose message embeds the exit code, the port and the
      captured stdout+stderr. `stop()` is idempotent: `taskkill /PID <pid> /T /F` on
      `win32`, else `child.kill('SIGTERM')` then `SIGKILL` after 3 s; also registered on
      `process.on('exit')`. A `--foreground` CLI flag starts the server and pipes its
      output through (this is what `npm run offline` uses).
      Files: `tests/helpers/start-demo-server.js`
      Verify: `node -e "require('./tests/helpers/start-demo-server').startDemoServer().then(async s=>{const r=await fetch(s.baseURL+'/health');console.log(await r.text());await s.stop();})"`
      prints `"mode":"DEMO"` and exits 0; `Get-Process node -ErrorAction SilentlyContinue`
      afterwards shows no orphan. Then `node tests/helpers/start-demo-server.js --foreground`
      serves the app and Ctrl+C stops it.

- [ ] 3. **Playwright config, global setup, shared fixtures, smoke spec.**
      `playwright.config.js`: `testDir: './tests/e2e'`, `outputDir: './tests/.results'`,
      `globalSetup: './tests/global-setup.js'`, `workers: 1`, `fullyParallel: false`,
      `forbidOnly: true`, `timeout: 30_000`, `expect: { timeout: 5_000 }`,
      `reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/.report' }]]`,
      `use: { channel: 'msedge', headless: true, serviceWorkers: 'block',
      storageState: 'tests/.auth/demo.json', trace: 'retain-on-failure',
      screenshot: 'only-on-failure', video: 'off', actionTimeout: 10_000 }`.
      `tests/global-setup.js`: start the server via item 2, set
      `process.env.E2E_BASE_URL`, log in with `request.newContext()` and
      `storageState({ path: 'tests/.auth/demo.json' })`, return an async teardown that
      calls `stop()`.
      `tests/fixtures.js`: `const test = base.extend({ baseURL: [async ({}, use) =>
      use(process.env.E2E_BASE_URL), { option: true }] })`. Belt and braces: also set
      `use.baseURL = process.env.E2E_BASE_URL` in the config, so that if the option-fixture
      override is rejected by this Playwright version the suite still works whenever the
      env var happens to be set (and the fixture remains the authoritative source). Plus a per-test
      `page.on('pageerror')` / console-error collector exposed as `errors` and asserted
      empty by default, and the CDN guard from item 5. Re-export `expect`.
      `tests/e2e/smoke.spec.js`: `/health` returns `mode DEMO`; logged-in `GET /` serves
      the dashboard; `/recipients`, `/osoby`, `/activity`, `/leaderboard.html`,
      `/wiadomosci`, `/rezerwacje`, `/archiwum`, `/ustawienia`, `/formularz` each load with
      no page errors and a non-empty `<h1>/<h5>` landmark; `GET /api/auth` →
      `authenticated: true`; and an **unauthenticated** context gets 401 from
      `/api/recipients` (proves `requireAuth` was not weakened).
      Files: `playwright.config.js`, `tests/global-setup.js`, `tests/fixtures.js`,
      `tests/e2e/smoke.spec.js`
      Verify: `npm run test:e2e -- smoke` — all smoke tests pass; `Get-Process node` shows
      no orphan afterwards; deliberately breaking `/health` polling (temporarily wrong
      port) produces an error message containing the server's stdout.

- [ ] 4. **Measurement helpers + their self-test.** Pure browser-side functions exposed as
      Node modules returning strings for `page.evaluate`, or installed via
      `page.addInitScript`:
      - `tests/helpers/overflow.js` — `collectOverflow(page, { container, ignoreGuard })`:
        (a) `document.scrollingElement.scrollWidth <= clientWidth`; (b) every element with
        computed `overflow-x`/`overflow-y` in `{auto, scroll}` → `scrollWidth <=
        clientWidth` (records the +px delta); (c) DOM walk comparing
        `getBoundingClientRect().right` to the viewport right edge and to the container's
        content right edge, with a 0.5 px tolerance for sub-pixel layout; (d) `::before`
        and `::after` boxes reconstructed from `getComputedStyle(el, pseudo)` width/left/
        right/transform. `ignoreGuard: true` first empties any rule matching
        `html, body { overflow-x: hidden }` (by neutralising the owning
        `CSSStyleRule.style`) and re-measures. Returns `{ offenders: [{selectorPath, delta,
        pseudo}], scrollers: [...] }`.
      - `tests/helpers/line-breaks.js` — `lineBreakPoints(locator)`: `Range` over the text
        nodes, group client rects by `top`, derive the substring of each visual line, and
        return the characters at each break. Assertion helper
        `expectBreaksAtSpacesOnly(locator)`.
      - `tests/helpers/contrast.js` — `measureContrast(locator)`: resolve the effective
        background by walking ancestors to the first non-transparent `background-color`,
        then WCAG 2.x relative-luminance ratio. Also `fontPx`/`fontWeight` so the
        4.5:1 / 3:1 threshold can be chosen correctly.
      - `tests/helpers/non-color-cue.js` — `nonColorSignature(locator)`: `border-width`,
        `outline-width/style`, `box-shadow` with colour components stripped,
        `text-decoration-line`, `font-weight`, `background-image` presence.
      - `tests/helpers/focus.js` — `stashFocus(page)` / `focusSurvived(page)` comparing
        against a stashed node reference; `activeDescription(page)` for diagnostics.
      - `tests/helpers/scroll.js` — `sampleScrollY(page, action, [0,60,150,300,450])` via
        in-page `requestAnimationFrame` + `performance.now`.
      - `tests/helpers/a11y.js` — `iconOnlyButtonsWithoutName(page)`,
        `focusableInsideAriaHidden(page)`, `tabCycle(page, rootSelector)`.
      - `tests/e2e/helpers.spec.js` — **self-test**: on a page served by the demo server,
        inject a deliberately overflowing element (and a deliberately overflowing
        `::after`) and assert the detector **reports** it; remove it and assert the
        detector reports clean. Same positive/negative pair for
        `expectBreaksAtSpacesOnly`, `nonColorSignature` (two elements differing only in
        colour must have equal signatures; differing in `border-width` must differ) and
        `focusSurvived`. A detector that can never fire is worthless; this item proves each
        one fires.
      Files: `tests/helpers/*.js`, `tests/e2e/helpers.spec.js`
      Verify: `npm run test:e2e -- helpers` passes, including every "detector fires"
      negative case.

- [ ] 5. **CDN response cache + CDN guard.** `tests/helpers/cdn-cache.js` exporting
      `installCdnCache(context)`: `context.route('**://{cdn.jsdelivr.net,cdnjs.cloudflare.com}/**')`
      → serve from `tests/.cache/cdn/<sha1(url)>.{bin,json}` when present, else fetch,
      persist (body + content-type + status) and fulfil. Plus `installCdnGuard(context)`:
      on `requestfailed` for those hosts with an empty cache, throw
      `CDN unreachable and not cached — run once with internet access`. Wire both into the
      `tests/fixtures.js` context fixture from item 3.
      Files: `tests/helpers/cdn-cache.js`, `tests/fixtures.js`
      Verify: `npm run test:e2e -- smoke` populates `tests/.cache/cdn/`; a second run with
      `--grep smoke` passes while the suite makes no outbound CDN requests (assert via a
      `request` event counter in a temporary debug run, then re-run normally).

- [ ] 6. **`server.js` — `DEMO_MODE` chat data + endpoints (in-memory only).** Append to
      `demoData` (`server.js:3832-3846`) a `chat` section and keep all mutation in a
      module-level object next to it, so nothing leaks into the production paths:
      - `chat.users`: `[{id:1,username:'e2e'},{id:2,username:'Mikołaj Testowy'},
        {id:3,username:'Ola'}]` — the demo session is always user 1 (§1.4), so user 1 is
        "me".
      - `chat.threads`: **≥3** — T1 `{id:1, initiator:1, target:2}` (demo user is the
        initiator → label = target username), T2 `{id:2, initiator:3, target:1}` (demo user
        is the target → label `Święty Mikołaj 🎅`, with `unreadCount > 0`), T3 `{id:3,
        initiator:1, target:3}` with a deliberately **very long single-word label/last
        message** (the thread-row shrink case from `chat-noscroll-verification.md:36-48`).
      - `chat.messages`: T1 carries **≥6 messages alternating `senderId` 1 and 2** (both
        directions), including one with a long URL, one with a 60-char unbroken word, one
        with HTML-special characters, and one long multi-word Polish sentence.
      - `chat.reactions`: `Map<messageId, Map<emoji, Set<userId>>>` seeded so one message
        has three emoji with counts 1 / 2 / 9 (two of them `mine`) and another has none.
      Demo branches to add, each replacing only the early-return inside the existing
      `if (DEMO_MODE)` guard:
      - `2631` users → `{ users: chat.users.filter(u => u.id !== req.session.userId) }`
      - `2645` threads → the same projection the production path builds
        (`server.js:2670-2684`): `{ id, role, otherLabel, targetUserId, lastBody, lastAt,
        unreadCount }`, newest activity first
      - `2682` unread-count → sum of unread incoming across threads
      - `2700` new thread → create an in-memory thread + first message, return
        `{ success:true, threadId }`; keep the existing 400s for empty body / self-target
      - `2738` thread GET → `{ threadId, role, otherLabel, messages: [{ id, fromMe, body,
        createdAt, reactions }] }` with `fromMe = senderId === req.session.userId`,
        `reactions` built through **`groupReactionsByMessage`/`buildReactionList`** from
        `public/chat-reactions.js` (already required at `server.js:17-25`); mark incoming
        messages read, and **403** when the session user is in neither role
      - `2798` delete thread → remove from the in-memory arrays, 404/403 as production
      - `2819` reply → append with `senderId = req.session.userId`
      - `2883` **reactions toggle** → validate with `parseReactionMessageId` +
        `isAllowedReactionEmoji` (same order as production: 400 before the throttle), run
        the same `reactionRateAllows(userId)` throttle, verify participation (403
        otherwise), toggle the `Set`, derive `action` via `toggleAction`, and respond
        `{ success, action, messageId, emoji, reactions: buildReactionList(rows) }` —
        **aggregate only, never a reactor identity**, and **no notification/push/activity
        write** (mirrors `server.js:2882-2948`).
      - `2980` `/api/link-preview` → **new** `if (DEMO_MODE)` guard at the top returning
        `{ url: parsed.href, title: null, description: null, image: null, siteName:
        parsed.hostname }` so no outbound request is ever made in demo mode.
      Files: `server.js`
      Verify: `node --check server.js` exits 0; with the demo server running,
      `curl`-equivalent checks via a throwaway `node -e` using the login cookie: thread
      GET returns messages in both directions with `reactions` arrays, the toggle flips
      `mine` and back, and `JSON.stringify` of both responses contains **no** `user_id`,
      `userId`, `username` or `sender` key. Then `npm run test:e2e -- smoke` still passes.

- [ ] 7. **`server.js` — `DEMO_MODE` leaderboard + notifications.** Append
      `demoData.leaderboard` and `demoData.notifications`:
      - Leaderboard (`server.js:2502`) → `{ users, cumulativeStats }` with the **exact
        production column names** (`id, username, recipient_id, profile_picture,
        total_presents, bought_presents, reserved_presents, available_presents,
        user_bought_count, user_reserved_count`, `server.js:2510-2529`). Provide rows whose
        `user_bought_count`/`user_reserved_count` pairs cover every Polish plural boundary:
        `0, 1, 2, 5, 12, 22, 112` across at least 7 rows (≥3 rows with non-zero activity so
        the podium renders, `leaderboard.html:1163`), one row with a **very long
        single-word name**, and one row with a name containing HTML-special characters.
        `cumulativeStats` consistent with the rows.
      - Notifications (`server.js:2371`) → `{ notifications, unreadCount, hasMore }` with
        rows shaped exactly like the production query output (`n.*` + `actor_username`,
        `data` as a **parsed object**, `is_read`, `created_at`, `server.js:2411-2415`),
        covering **all 9 renderable types** — `recipient_added`, `present_added`,
        `present_reserved`, `present_unreserved`, `present_checked`, `present_unchecked`,
        `present_added_batch`, `leaderboard_leader`, `anon_message` — **plus one unknown
        type** (`something_new`) to exercise the `coś zmienia` default. Include a
        `present_added` burst of ≥3 by the same actor for the same recipient (so
        `groupNotificationsForDisplay` collapses it, `activity.html:707`), one where
        `recipientName === actor` (the `dla:` suppression branch,
        `notification-text.js:58-68`), one with a title containing `& < > " '`, and a mix
        of `is_read`. Keep `/api/notifications/unread-count` (`2441`) consistent, and make
        `/api/notifications/:id/read` (`2469`) and `read-all` (`2314`) mutate the in-memory
        rows so the badge actually decreases. Preserve the production exclusion of
        `anon_message` from the feed query only where production does it — the demo feed
        returns it, matching what `activity.html` can render, and the spec asserts the
        *renderer*, not the SQL filter.
      Files: `server.js`
      Verify: `node --check server.js` exits 0; demo server + logged-in fetch of
      `/api/leaderboard` shows the plural-boundary counts and of `/api/notifications` shows
      10 distinct types; `npm run test:e2e -- smoke` still passes.

- [ ] 8. **`server.js` — `DEMO_MODE` presents/recipients fixtures.** Append to
      `demoData.recipients` / `demoData.presents` (never modify ids 1-3):
      a recipient with a **very long name** (≥40 chars, no spaces); a recipient whose name
      contains `& < > " '`; a present with a **very long single-word title** (≥60 chars);
      a present whose title is a **long URL**; a present with a long **multi-word Polish**
      title (for the no-mid-word-break assertion); a present with `comments: null` (so the
      `+ Dodaj szczegóły` chip path renders); a present whose title contains
      `<script>alert(1)</script>` and `&"'`; and a present that is both `is_checked` and
      `reserved_by: 1`. All consumed by the already-complete demo branches at
      `server.js:1397`, `1464`, `1513`, `3314`, `3503` with no code change.
      Files: `server.js`
      Verify: `node --check server.js` exits 0; `/api/recipients-with-presents` returns the
      new rows; the recipients page renders them (`npm run test:e2e -- smoke`).

- [ ] 9. **Spec: no horizontal overflow.** `tests/e2e/no-horizontal-overflow.spec.js` — for
      each of `/` (dashboard), `/recipients`, `/osoby`, `/activity`, `/leaderboard.html`,
      `/wiadomosci` (list view **and** an open thread, incl. the long-URL / long-word /
      many-chip messages from item 6), `/rezerwacje`, `/archiwum`, `/ustawienia`, at
      viewports **320, 360, 375, 414, 768, 1024**: assert `collectOverflow()` reports
      `offenders.length === 0` and every scroll container has `scrollWidth <= clientWidth`
      (explicitly including `#chatMessages`, the +6 px regression from
      `chat-noscroll-verification.md`), and assert the same **with `ignoreGuard: true`** so
      the layout is proven structurally clean rather than clipped by
      `html, body { overflow-x: hidden }`. Failure messages must name the offending element
      path, the delta and whether it was a pseudo-element.
      Files: `tests/e2e/no-horizontal-overflow.spec.js`
      Verify: `npm run test:e2e -- no-horizontal-overflow` — all pass, or any failure is
      triaged per §0 (report, `fixme`, do not fix).

- [ ] 10. **Spec: Polish text wrapping.** `tests/e2e/wrapping.spec.js` at **320 px** —
      the long multi-word Polish present title (item 8) and a long Polish chat message
      (item 6) must break **only at spaces** (`expectBreaksAtSpacesOnly`); the computed
      `word-break` on `.present-name`, `.activity-name` and `.chat-bubble` must be
      `normal`; the long **single-word** title and the long **URL** may wrap or ellipsize
      but must not overflow their container (reuse `collectOverflow` scoped to the card);
      a URL rendered as a link may compute `word-break: break-all` (explicitly allowed,
      per `chat-noscroll-verification.md` "Left alone").
      Files: `tests/e2e/wrapping.spec.js`
      Verify: `npm run test:e2e -- wrapping` passes.

- [ ] 11. **Spec: Polish pluralization, end-to-end + Node-side.**
      `tests/e2e/pluralization.spec.js`:
      (a) **Node-side** `describe` requiring `public/pluralize-pl.js` directly — assert
      `plForm` and `plCount` for `0,1,2,5,12,22,112` (and `1.5` → `other`) across
      `prezent/prezenty/prezentów`, `kupiony/kupione/kupionych`,
      `zarezerwowany/zarezerwowane/zarezerwowanych`, `osoba/osoby/osób`; and requiring
      `public/notification-text.js` — assert the wording for **all 7 explicit types + the
      default**, the `Ktoś` fallback, `html:false` plain text, `showActor:false`, HTML
      escaping of `& < > " '`, and the `dla:` suppression when `recipientName === actor`.
      **Use the emoji-free strings from §1.8 verbatim**, and add one assertion that the
      rendered output matches `/^[^\p{Extended_Pictographic}]*$/u` for every type, so a
      future re-introduction of emoji fails loudly.
      (b) **In the real UI** — `/leaderboard.html` renders `1 kupiony`, `2 kupione`,
      `5 kupionych`, `12 kupionych`, `22 kupione`, `112 kupionych` and the matching
      `zarezerwowany/zarezerwowane/zarezerwowanych` for the item-7 rows, plus
      `1 aktywność` / `2 aktywności` / `5 aktywności`; at **320 px** each
      `.activity-stat` is on its **own line** (distinct `getBoundingClientRect().top`, the
      user's "awkward" complaint) and `.activity-stat-sep` is `display: none`; at **768 px**
      the two stats share a line and the `•` is visible; `.activity-stat-noun` is in the
      accessible name but costs no layout width. `/activity` renders
      `dodaje 5 prezentów` for the collapsed burst and `1 prezent` / `2 prezenty` where
      applicable.
      Files: `tests/e2e/pluralization.spec.js`
      Verify: `npm run test:e2e -- pluralization` passes.

- [ ] 12. **Spec: chat reactions.** `tests/e2e/chat-reactions.spec.js`, on the seeded T1
      thread at 375 px (plus a 320 px repeat of the chip-wrap case):
      - chips render for every seeded aggregate, in **allowlist order**, with the count
        text and a Polish `aria-label`; the `button.chat-reaction-add` is **last**;
      - clicking a chip flips `aria-pressed` and the count (optimistic), and the state
        still matches after the server response (`waitForResponse` on the reactions POST);
      - **keyboard focus survives the toggle**: `stashFocus` → `keyboard.press('Enter')` →
        `focusSurvived()` is true and `document.activeElement` is the same chip node;
      - **focus survives a poll**: with focus on a chip, call `loadThreadMessages()` in the
        page and assert `focusSurvived()`; a second test (`test.slow()`) waits for the real
        8 s poll (`public/wiadomosci.html:348`) and asserts the same;
      - un-reacting the last holder of an emoji removes the chip and focus falls to **the
        add button of the same message**, never `<body>`;
      - **pressed state is distinguishable without colour**: `nonColorSignature` of a
        pressed chip differs from an unpressed one (expected: `border-width` 2px vs 1px
        plus an inset ring), and toggling does **not** change the chip's box size;
      - computed contrast of chip text and of the unpressed chip border clears 4.5:1 /
        3:1 respectively (`measureContrast`);
      - **no reactor identity**: recursively scan the toggle response and the thread GET
        response for any key matching `/user|sender|reactor|identit/i` — none may exist;
        each reaction entry's key set must be exactly `{emoji, count, mine}`;
      - picker: the add button opens `#reactionSheet` (`aria-hidden`/`inert` removed), focus
        lands on the first emoji, `Tab` stays inside, `Escape` closes and returns focus to
        the add button.
      Files: `tests/e2e/chat-reactions.spec.js`
      Verify: `npm run test:e2e -- chat-reactions` passes.

- [ ] 13. **Spec: escaping.** `tests/e2e/escaping.spec.js` — for the HTML-special present
      title and recipient name (item 8), the HTML-special chat message (item 6) and the
      HTML-special notification title (item 7): assert `textContent` contains the literal
      markup string, assert `locator.locator('script, img, iframe, svg')` has count 0
      inside the rendered item, and assert no new element was injected (compare
      `innerHTML` against an expected-escaped form). Include the leaderboard
      `.activity-name` case — **expected to fail** against `leaderboard.html:1209` (see
      §4); write it as a real assertion first, and only if it fails convert it to
      `test.fixme` with a comment naming `public/leaderboard.html:1209` and list it in the
      report.
      Files: `tests/e2e/escaping.spec.js`
      Verify: `npm run test:e2e -- escaping` — passes, with any genuine product bug
      recorded as a `fixme` plus a report line.

- [ ] 14. **Spec: a11y smoke + edit bottom sheet.** `tests/e2e/a11y.spec.js` across the
      pages from item 9 at 375 px and 1024 px:
      - every icon-only control (empty trimmed text once `aria-hidden` descendants are
        excluded) has a non-empty accessible name (`aria-label` / `aria-labelledby` /
        `title`);
      - nothing is simultaneously `aria-hidden="true"` and focusable (natively focusable or
        `tabindex >= 0`, not `disabled`, not `inert`);
      - the page has exactly one `<h1>`-level landmark or an equivalent labelled region, and
        no `tabindex > 0`.
      `tests/e2e/edit-sheet.spec.js` — on `/recipients` only (**not** `/formularz`, §0):
      open `button.edit-present-btn` → `#editPresentModal` is visible; at 375 px and
      320 px the dialog's `getBoundingClientRect().bottom` equals the viewport height
      (±1 px) and `.modal-content` `max-height` resolves to ~90 % of the viewport
      (`edit-sheet-verification.md:57-66`); `#editPresentComments` computed height ≥ 120 px
      at ≤768 px and ≥ 132 px at 1024 px with `resize: vertical`; `Tab` cycles stay inside
      the dialog; `Escape` closes it and focus returns to the triggering button; at 1024 px
      the dialog is **not** bottom-pinned (guards against the mobile rule leaking).
      Files: `tests/e2e/a11y.spec.js`, `tests/e2e/edit-sheet.spec.js`
      Verify: `npm run test:e2e -- a11y edit-sheet` passes (or `fixme` + report per §0).

- [ ] 15. **Spec: PLACEHOLDER for the add-present composer / dock.**
      `tests/e2e/composer.placeholder.spec.js` — every test body is `test.fixme()` with a
      header comment stating: *owned by a concurrent workflow (`public/formularz.html`,
      `formularz.js`, `tab-bar-functions.js`, `bottom-tab-bar.css`); do not assert on
      composer internals until that work lands.* List the behaviours to cover, each with
      the helper it should use, taken from the user's own requests and
      `addmode-verification.md`:
      (a) details open as soon as the form opens, not on first keystroke;
      (b) choosing **Dodaj** from the dock opens the form **and focuses** the name field;
      (c) after a successful add the form collapses and loses focus, and focus lands on
      `#myPresentsHeading`;
      (d) the bottom tab bar hides while add mode is on and returns on exit;
      (e) an explicit close control exists, plus Escape and scrim-tap exits, and **no exit
      clears typed text**;
      (f) the collapsed bar has no redundant `+` button;
      (g) **no scroll jump on entry** — `sampleScrollY` at 0/60/150/300/450 ms shows 0 px
      movement, including when pinned to the very bottom (`addmode-verification.md:464`);
      (h) the composer and the dock do not fight during scroll-hide (frame sampling of
      both boxes, the "jumpy" complaint);
      (i) the scrim tones down the content behind the form (measured opacity / computed
      background, `formularz-scrim-verification.md`);
      (j) the `Dodatkowe informacje` textarea default height ≥ 120 px.
      Files: `tests/e2e/composer.placeholder.spec.js`
      Verify: `npm run test:e2e -- composer` reports all tests as skipped/fixme and exits 0.

- [ ] 16. **Documentation.** `tests/README.md` (short, practical): how to run
      (`npm test`, `npm run test:e2e:headed`, `npm run test:e2e:ui`, `--grep`); how the
      suite boots the server (free port → `node server.js` with `OFFLINE_MODE=true`,
      `NODE_ENV=development`, fixed `SESSION_SECRET`; `/health` polled for `mode: 'DEMO'`;
      process tree killed on success **and** failure); how the shared login fixture works
      (demo login accepts anything, `tests/.auth/demo.json`); how to add a spec (import
      `./fixtures`, use `baseURL`, prefer web-first assertions, never `waitForTimeout`);
      how to debug (`--headed`, `--ui`, `--debug`, `npm run test:e2e:report`, traces in
      `tests/.results`); where demo fixtures live (`demoData` in `server.js`, with the line
      ranges); the CDN cache and its first-run internet requirement; and an **honest
      limits** section: DEMO_MODE is in-memory, so the suite **cannot** verify real SQL,
      migrations, `init-db.js`, the actual `anon_message_reactions` DDL (collation
      `utf8mb4_bin`, the unique key) or any MySQL behaviour; **every demo session is user
      id 1**, so true two-account flows (another person's reaction, cross-user anonymity,
      unread badges between two real accounts) are simulated by seeded data, not exercised;
      **a real two-account MySQL smoke test is still owed before relying on chat
      reactions**; no visual-regression baselines; WCAG conformance needs manual assistive
      technology testing. Add a 3-5 line **Testing** section to the root `README.md`
      pointing at `tests/README.md` (non-invasive, no restructuring).
      Files: `tests/README.md`, `README.md`
      Verify: `npm test` still passes after the edit; every command quoted in
      `tests/README.md` is executed once and exits as documented.

- [ ] 17. **Full-suite run + findings report.** Run the whole suite twice back to back
      (second run proves no cross-run state leakage and the CDN cache path). Confirm: zero
      orphan `node.exe` afterwards, no `tests/.auth` / `tests/.cache` content committed
      (`.gitignore` from item 1), `git status` shows only the intended files, and
      `git -P diff --stat` touches **none** of the §0 read-only files. Write the list of
      `fixme`-d tests and the product bugs they name (at minimum the
      `leaderboard.html:1209` escaping candidate) into the final step report.
      Files: none (verification only)
      Verify: `npm test` green twice in a row;
      `git -P diff --name-only` contains only `package.json`, `.gitignore`,
      `playwright.config.js`, `server.js`, `README.md` and `tests/**`;
      `git -P diff -- public/formularz.html public/formularz.js public/tab-bar-functions.js public/bottom-tab-bar.css public/bottom-tab-bar-snippet.html public/app-theme.css public/sw.js`
      is empty.

---

## 4. Product-bug candidates found while reading (report only — do NOT fix here)

1. **`public/leaderboard.html:1209` interpolates `user.username` into `innerHTML`
   unescaped** (`<div class="activity-name">${user.username}</div>`). Names flow from
   `recipients.name`, which users control via `POST /api/recipients`. Every other renderer
   in the same file escapes or uses text nodes; `public/recipients.js` escapes consistently
   (`:1130`, `:1131`, `:422`). Item 13 asserts this; if it fails it is a genuine XSS bug to
   be reported, not patched by this task.
2. **`package.json` `offline` script depends on `cross-env`, which is not installed** —
   addressed by item 1 without adding a dependency.
3. **Demo mode claims the user is never identified** (`server.js:1025-1034`) while
   `demoData.recipients[1].identified_by === 1` (`server.js:3838`). Pre-existing demo-only
   inconsistency; tests assume "not identified".
4. **`/api/notifications` is registered twice** — the first block (`server.js:2166-2305`)
   is inside a `/* … */` comment, so the live handlers are at `2363`, `2437`, `2462`. Worth
   noting so nobody edits the dead copy.
5. **`tmp-emoji-click.js`** sits in the repo root and looks like leftover scratch.

## 5. Honest limits of this harness

- `DEMO_MODE` runs with **no database**: no SQL is executed, so the suite cannot verify
  queries, `init-db.js`, migrations, the real `anon_message_reactions` DDL (notably
  `emoji VARCHAR(16) … COLLATE utf8mb4_bin` and `uniq_message_user_emoji`,
  `server.js:2593-2609`), or any MySQL-specific behaviour.
- Demo login always yields **user id 1** (`server.js:708`), so multi-account behaviour —
  another person's reaction, the anonymity guarantee across two real sessions, unread
  badges between accounts — is represented by seeded in-memory data, not genuinely
  exercised. **A real two-account MySQL smoke test is still owed before relying on chat
  reactions in production.**
- The in-memory demo state is mutable and shared, which is why `workers: 1` is mandatory.
- Pages load Bootstrap and Font Awesome from two external CDNs, so the **first** run needs
  internet access (then `tests/.cache/cdn/` serves them).
- One browser engine (Edge/Chromium via `channel: 'msedge'`). No WebKit/Firefox, no real
  iOS/Android, no real on-screen keyboard — `visualViewport` behaviour stays unverifiable
  here, as in the prior harnesses.
- Contrast numbers are **computed** from measured colours; full WCAG conformance still
  requires manual testing with assistive technology and expert review.
