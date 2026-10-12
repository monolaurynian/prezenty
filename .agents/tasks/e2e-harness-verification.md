# Verification: reusable end-to-end test harness

First iteration (`.agents/tasks/e2e-harness-review.json` did not exist, so this was
implemented from scratch against `.agents/tasks/e2e-harness-plan.md`).

Nothing is committed. All changes are left uncommitted in the working tree.

---

## 1. What was built

| Thing | Choice | Why |
|---|---|---|
| Runner | `@playwright/test` **1.61.0** (exact, no caret) | newest release still declaring `engines.node >= 18`; 1.62+ demands `>= 20`, further from this repo's `engines: node >= 16` |
| Browser | `channel: 'msedge'` — the installed Edge | **no browser download needed**; `npx playwright install` is never run. It worked first try, so no fallback to downloading Chromium was needed |
| Server | real `node server.js` as a child process, booted **once per suite** by `globalSetup` | same boot path the user runs; `globalSetup` can pick a free port at runtime, which Playwright's `webServer` cannot |
| Concurrency | `workers: 1`, `fullyParallel: false` | one server, one shared in-memory demo dataset, one demo user (id 1) |
| Artifacts | `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`, `video: 'off'` | assertion-first: no pile of images to eyeball |

### devDependency added

```
"@playwright/test": "1.61.0"
```

Confirmed installed:

```
> npx playwright --version
Version 1.61.0

> node -e "console.log(require('@playwright/test/package.json').version, require('@playwright/test/package.json').engines)"
1.61.0 { node: '>=18' }
```

`npm install` added 311 packages, exit 0. (`node_modules/` was absent from the tree.)

### npm scripts added / fixed

```json
"offline": "node tests/helpers/start-demo-server.js --foreground",
"test": "npm run test:e2e",
"test:e2e": "playwright test",
"test:e2e:headed": "playwright test --headed",
"test:e2e:ui": "playwright test --ui",
"test:e2e:report": "playwright show-report tests/.report"
```

`offline` was **broken before this change** — it called `cross-env`, which is not in
`devDependencies`, so it failed on a clean install. It is fixed with **no new
dependency**: the launcher sets the environment in-process when it spawns the server.

### How the server boot works (`tests/helpers/start-demo-server.js`)

- free ephemeral port via `net.createServer().listen(0)` → read `address().port` → close
  → spawn, so the suite never collides with a dev server on 3002 (retries up to 3 times
  on `EADDRINUSE`);
- `spawn(process.execPath, ['server.js'], { cwd: <repo root> })` — cwd matters, because
  `express.static('public')` is a relative path;
- env: `OFFLINE_MODE=true` (beats a developer `.env` with `DB_PASSWORD`),
  `NODE_ENV=development` (keeps the session cookie non-`Secure`, otherwise login over
  plain HTTP silently fails), `HOST=127.0.0.1`, `PORT=<free>`,
  `SESSION_SECRET=e2e-fixed-secret`, and `DB_PASSWORD` deleted;
- polls `GET /health` every 150ms for up to 30s until `mode === 'DEMO'`; on timeout, on a
  wrong mode, or if the child exits early it kills the child and throws an error whose
  **message embeds the exit code, the port and the captured stdout + stderr**;
- teardown is unconditional — the returned `globalSetup` teardown, a `try/finally` around
  the login step, and a `process.on('exit')` net all funnel into one idempotent `stop()`
  that runs `taskkill /PID <pid> /T /F` on Windows (process **tree**, not just the direct
  child).

Auth is handled once: `globalSetup` logs in with `request.newContext()` (demo login
accepts any username/password) and writes `tests/.auth/demo.json`, which every test
reuses via `use.storageState`. No spec repeats the login.

---

## 2. Real suite output

### Clean-state run A (`tests/.auth`, `tests/.report`, `tests/.results`, `tests/.cache` all deleted first)

```
clean state: auth=False cache=False results=False
EXIT_A=0
WALL_A=00:05:51.3419228
[e2e] demo server ready at http://127.0.0.1:50434 (pid 34280) in 3487ms
[e2e] demo server on port 50434 stopped
  23 skipped
  77 passed (5.7m)
```

### Run B, immediately after, same state (proves no cross-run state leakage)

```
EXIT_B=0
WALL_B=00:06:04.8530830
[e2e] demo server ready at http://127.0.0.1:56975 (pid 63372) in 2992ms
[e2e] demo server on port 56975 stopped
  23 skipped
  77 passed (5.9m)
```

**77 passed, 0 failed, 23 skipped, twice in a row.** Every skip is a `test.fixme`
permitted by requirement 3 and justified in §5 below.

### Per-spec timings (run B)

```
no-horizontal-overflow.spec.js          10 tests     77.8s
chat-reactions.spec.js                  11 tests     54.5s
a11y.spec.js                            10 tests     50.3s
edit-sheet.spec.js                       4 tests     32.9s
helpers.spec.js                          8 tests     26.6s
smoke.spec.js                           13 tests     25.2s
wrapping.spec.js                         6 tests     24.7s
pluralization.spec.js                   10 tests     22.4s
escaping.spec.js                         5 tests     18.6s
```

Total wall clock ≈ **5.7–6.0 min** for 100 tests. The server is booted once (~3s). There
are no `waitForTimeout` calls anywhere in the suite; the only deliberate wait is the one
spec that waits for the app's own 8-second chat poll (marked `test.slow()`).

### The npm scripts were each executed

`npm test -- smoke` (proves the script wiring, not just `npx playwright test`):

```
EXIT=0
[e2e] demo server ready at http://127.0.0.1:52935 (pid 40220) in 5727ms
[e2e] demo server on port 52935 stopped
  13 passed (1.3m)
```

`npm run offline` (same launcher, `--foreground`):

```
🎭 Starting in OFFLINE/DEMO MODE - OFFLINE_MODE enabled
🎄 Serwer Prezenty działa na porcie 3002
📱 OFFLINE MODE: Using sample data

/health -> 200 {"status":"OK","timestamp":"2026-10-12T13:11:16.703Z","mode":"DEMO","database":"disabled"}
... after Ctrl+C equivalent: stopped cleanly
```

A representative excerpt of the list reporter from run 1 (full log retained during the
session):

```
  ok  82 tests\e2e\smoke.spec.js:23:5 › harness smoke › health endpoint reports demo mode (58ms)
  ok  83 tests\e2e\smoke.spec.js:31:5 › harness smoke › shared session is authenticated (35ms)
  ok  84 tests\e2e\smoke.spec.js:39:5 › harness smoke › requireAuth still rejects an anonymous request (155ms)
  ok  62 ... no horizontal overflow › home does not scroll sideways at any width (7.7s)
  ok  68 ... no horizontal overflow › wiadomosci-thread does not scroll sideways at any width (5.5s)
  ok  72 ... pluralize-pl › plForm picks the CLDR category at every boundary (14ms)
  ok  77 ... pluralization in the real UI › leaderboard renders every bought/reserved boundary (3.1s)
  ok  31 ... chat reactions › a six-chip strip does not push the message list sideways at 320px (5.4s)
  ok  46 ... edit present bottom sheet › Tab stays inside the sheet and Escape closes it (7.7s)
  ok  53 ... escaping › the leaderboard XSS sink is still exactly where the fixme says it is (3.2s)
```

---

## 3. Proof the runner is sound

### (a) A deliberately broken assertion fails with a useful message and the measured numbers

**Break 1 — remove the non-colour pressed cue.** Appended to `public/chat-reactions.css`:

```css
.chat-reaction-chip[aria-pressed="true"] { border-width: 1px; padding: 4px 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
```

```
EXIT=1
  x  1 tests\e2e\chat-reactions.spec.js:214:5 › chat reactions › pressed state is distinguishable without colour and does not change the box size (5.2s)

    Error: pressed must differ from unpressed WITHOUT relying on colour:
    pressed  : border-width [1px 1px 1px 1px] border-style [solid solid solid solid] outline [3px none] box-shadow [0px 1px 3px 0px] weight 400 bg-image false box 53.45x32
    unpressed: border-width [1px 1px 1px 1px] border-style [solid solid solid solid] outline [3px none] box-shadow [0px 1px 3px 0px] weight 400 bg-image false box 53.45x32
    expect(received).not.toBe(expected)
    Expected: not "1px 1px 1px 1px | solid solid solid solid | 3px none | 0px 1px 3px 0px | none | 400 | normal | false"
```

**Break 2 — reintroduce the historical +6px overhang.** Appended to the same file:

```css
.chat-reactions .chat-reaction-add::after { left: 50%; right: auto; width: 56px; transform: translate(-50%, -50%); }
```

```
EXIT=1
    Error: horizontal overflow detected
    Received: "wiadomosci-thread @320px: viewport 320x740, root scrollWidth 320 / clientWidth 320 (delta 0)
      scroller div#chatMessages: scrollWidth 268 / clientWidth 262 (+6px, overflow-x: auto)
    wiadomosci-thread @360px: viewport 360x740, ...
      scroller div#chatMessages: scrollWidth 308 / clientWidth 302 (+6px, overflow-x: auto)
    wiadomosci-thread @375px: viewport 375x740, ...
      scroller div#chatMessages: scrollWidth 323 / clientWidth 317 (+6px, overflow-x: auto)
    wiadomosci-thread @414px: viewport 414x740, ...
      scroller div#chatMessages: scrollWidth 362 / clientWidth 356 (+6px, overflow-x: auto)
    wiadomosci-thread @768px: viewport 768x740, ...
      scroller div#chatMessages: scrollWidth 692 / clientWidth 686 (+6px, overflow-x: auto)
```

That reproduces **exactly** the historical numbers from
`chat-noscroll-verification.md` — `scrollWidth 323 / clientWidth 317` at 375px — which is
strong evidence the detector measures the right thing.

**Both breaks restored.** `git -P diff --stat -- public/chat-reactions.css` is empty, and
`public/chat-reactions.css` does not appear in `git status --short`.

Beyond these two manual breaks, `tests/e2e/helpers.spec.js` (8 tests) is a permanent
self-test: every detector is run against a deliberately broken DOM where it **must**
report, then against a clean one where it must not — overflowing element, overflowing
`::after`, sideways inner scroller, the `ignoreGuard` neutralisation, a mid-word break vs
a space break, colour-only vs border-width difference, surviving vs destroyed focus, and
an unnamed icon button / focusable inside `aria-hidden`.

### (b) The server is torn down; the suite passes twice from a clean state

Both runs in §2 were green back to back. After run B:

```
=== listeners on the two suite ports used (50434, 56975) ===
PORT 50434 free
PORT 56975 free
```

No orphan from either run; neither suite server process (pid 34280, 63372) exists
afterwards. The remaining `node.exe` processes on the machine belong to the Adobe helper
and to the concurrent composer workflow (`serve.js`, its own `server.js`, its own
Playwright invocation) — none of them are mine.

### (c) It does not interfere with a dev server on the default port

A dev server was started on the default port before the runs:

```
BEFORE SUITE: 3002 /health -> 200 {"status":"OK","timestamp":"2026-10-12T12:49:06.137Z","mode":"DEMO","database":"disabled"}
LocalPort OwningProcess
--------- -------------
     3002         16804
```

Both full suite runs then executed (on ports 50434 and 56975), after which:

```
AFTER SUITE: 3002 /health -> 200 {"status":"OK","timestamp":"2026-10-12T13:01:31.313Z","mode":"DEMO","database":"disabled"}
```

The dev server was untouched and still healthy. It was stopped afterwards (it was started
only for this check).

### `node --check`

```
ok   node --check server.js
ok   node --check playwright.config.js
ok   node --check tests/global-setup.js
ok   node --check tests/fixtures.js
ok   node --check tests/helpers/start-demo-server.js
ok   node --check tests/helpers/cdn-cache.js
ok   node --check tests/helpers/overflow.js
ok   node --check tests/helpers/line-breaks.js
ok   node --check tests/helpers/contrast.js
ok   node --check tests/helpers/non-color-cue.js
ok   node --check tests/helpers/focus.js
ok   node --check tests/helpers/a11y.js
ok   node --check tests/helpers/scroll.js
ok   node --check tests/helpers/pages.js
ok   node --check tests/e2e/a11y.spec.js
ok   node --check tests/e2e/chat-reactions.spec.js
ok   node --check tests/e2e/composer.placeholder.spec.js
ok   node --check tests/e2e/edit-sheet.spec.js
ok   node --check tests/e2e/escaping.spec.js
ok   node --check tests/e2e/helpers.spec.js
ok   node --check tests/e2e/no-horizontal-overflow.spec.js
ok   node --check tests/e2e/pluralization.spec.js
ok   node --check tests/e2e/smoke.spec.js
ok   node --check tests/e2e/wrapping.spec.js
```

---

## 4. `server.js` — every DEMO_MODE route touched

**All changes are inside `if (DEMO_MODE)` branches or in the demo fixture objects.** The
complete set of lines **removed** by this change is:

```
-            return res.json({ notifications: [], unreadCount: 0, hasMore: false });
-            return res.json({ count: 0 });
-            return res.json({ success: true, unreadCount: 0 });
-            return res.json({ users: [], cumulativeStats: { totalPresents: 0, boughtPresents: 0, reservedPresents: 0 } });
-    if (DEMO_MODE) return res.json({ users: [] });
-    if (DEMO_MODE) return res.json({ threads: [] });
-    if (DEMO_MODE) return res.json({ count: 0 });
-    if (DEMO_MODE) return res.status(503).json({ error: 'Niedostępne w trybie demo' });   (x4)
-    if (DEMO_MODE) return res.json({ messages: [] });
-        { id: 3, name: 'Maria Wiśniewska', ... }        (trailing comma only)
-        { id: 3, title: 'Roślina doniczkowa', ... }     (trailing comma only)
```

Every one is an old demo early-return or a trailing comma on the last element of a
`demoData` array. **Not one line of a production code path was removed or changed.**
`requireAuth` is on every route it was on before, and the smoke suite asserts an
anonymous context still gets 401 from `/api/recipients`, `/api/presents` and
`/api/wiadomosci/threads`.

Three routes needed the `if (DEMO_MODE)` guard **moved below** the shared validation so
demo mode validates input the same way production does. In those three the production
statements are byte-identical; only the guard's position and body changed:

- `POST /api/wiadomosci/threads` — guard now after the empty-body and self-target 400s
- `POST /api/wiadomosci/threads/:id/messages` — guard now after the empty-body 400
- `POST /api/wiadomosci/messages/:messageId/reactions` — guard now after
  `parseReactionMessageId` → 400, `isAllowedReactionEmoji` → 400 and the
  `reactionRateAllows` → 429 throttle, so demo exercises the same order of checks

| Route | Line | What the demo branch now returns |
|---|---|---|
| `GET /api/wiadomosci/users` | 2647 | `demoChat.users` minus the session user |
| `GET /api/wiadomosci/threads` | 2661 | `demoThreadList(userId)` — the same projection production builds (`id, role, otherLabel, targetUserId, lastBody, lastAt, unreadCount`), newest first |
| `GET /api/wiadomosci/unread-count` | 2698 | sum of unread incoming across the user's threads |
| `POST /api/wiadomosci/threads` | 2727 | creates an in-memory thread + first message, `{ success, threadId }`; 404 for an unknown target |
| `GET /api/wiadomosci/threads/:id` | 2772 | full thread view, marks incoming read, 404 / 403 as production; reactions built through the **shipped** `groupReactionsByMessage` / `buildReactionList` |
| `DELETE /api/wiadomosci/threads/:id` | 2854 | removes thread + its messages + their reactions, 404 / 403 as production |
| `POST /api/wiadomosci/threads/:id/messages` | 2889 | appends a message with `sender_id = session user`, 404 / 403 as production |
| `POST /api/wiadomosci/messages/:messageId/reactions` | 2977 | toggles the in-memory `Set`, responds `{ success, action, messageId, emoji, reactions: buildReactionList(...) }` — aggregate only, no notification / push / activity write |
| `GET /api/link-preview` | 3090 | **new guard**: returns a stub so demo mode never makes an outbound HTTP request (the suite stays hermetic and fast) |
| `GET /api/notifications` | 2372 | 20 seeded rows with production's limit/offset/hasMore semantics |
| `GET /api/notifications/unread-count` | 2452 | unread count excluding `anon_message`, as production does |
| `POST /api/notifications/:id/read` | 2480 | **mutates** the in-memory row and returns the recomputed unread count |
| `POST /api/notifications/read-all` | 2314 | **mutates** all rows to read |
| `GET /api/leaderboard` | 2518 | `demoLeaderboard.users` + `cumulativeStats` |

### Demo fixtures added (in-memory only, no new tables, no file writes)

- **`demoData.recipients`** — appended ids 4–5 (ids 1–3 untouched): a 41-character
  unbreakable name `Konstantynopolitańczykowianeczkaniezwykła`, and
  `Zuzia & "Zuza" <mała> 'Z'` for escaping.
- **`demoData.presents`** — appended ids 4–9 (ids 1–3 untouched): a 64-character
  single-word title, a long URL title, a long multi-word Polish title (the
  no-mid-word-break target), a present with `comments: null` (so the
  `+ Dodaj szczegóły` path has data), a title containing
  `<script>alert(1)</script> & "mega" 'mini'`, and one that is both `is_checked` and
  `reserved_by`.
- **`demoChat`** — 3 users, 3 threads (demo user as initiator, as target with
  `unreadCount: 2`, and one with an unbreakable last message), 10 messages including
  **7 in thread 1 alternating both directions** with a long URL, a 58-character
  unbroken word, HTML special characters and a long Polish sentence; reactions seeded so
  message 2 carries three emoji with counts **1 / 2 / 9** (two of them `mine`) and
  message 4 carries none.
- **`demoLeaderboard`** — 8 rows using the **exact production column names**, with
  bought/reserved pairs covering every Polish plural boundary:
  `112/1, 22/112, 12/22, 5/12, 2/5, 0/2, 1/0, 0/0`, plus the long single-word name and
  the HTML-special name.
- **`demoNotifications`** — 20 rows (exactly one page) covering **every** type the
  renderers know: `recipient_added` (with and without a name), `present_added`,
  `present_reserved`, `present_unreserved`, `present_checked`, `present_unchecked`,
  `present_added_batch` (counts 1, 2, 12, 22, 112), `leaderboard_leader`, `anon_message`,
  plus `something_new` for the `coś zmienia` default; a 5-item consecutive
  `present_added` burst that the activity page collapses into "dodaje 5 prezentów"; one
  row where `recipientName === actor` (the `dla:` suppression branch); and one with
  HTML special characters in the title.

The demo feed deliberately **includes** `anon_message` (production's SQL excludes it) so
the renderer `activity.html` ships for it is actually exercised; the unread badge still
excludes it, matching production. This is noted in `tests/README.md`.

### Privacy contract, verified

Direct check against the running demo server:

```
t1 msgs 7 reactions m2 [{"emoji":"❤️","count":1,"mine":true},{"emoji":"😂","count":2,"mine":true},{"emoji":"👍","count":9,"mine":false}]
identity leak t1: null
toggle  {"success":true,"action":"removed","messageId":2,"emoji":"❤️","reactions":[...]}
toggle2 {"success":true,"action":"added","messageId":2,"emoji":"❤️","reactions":[...]}
identity leak toggle: null
```

and asserted in the suite (`chat-reactions.spec.js` → "no response ever carries a reactor
identity"): the thread payload and the toggle payload are walked recursively for any key
matching `/user|sender|reactor|identit|author|owner/i` (none allowed), each message's key
set must be exactly `{body, createdAt, fromMe, id, reactions}`, and each reaction's key
set exactly `{count, emoji, mine}`.

---

## 5. Spec list — what each file asserts

| Spec | Tests | Asserts |
|---|---|---|
| `smoke.spec.js` | 13 | `/health` reports `mode: DEMO`; the shared session is authenticated as user 1; an **anonymous** context still gets 401 from three API routes (proves `requireAuth` was not weakened); all 10 pages load with a visible non-empty heading and no uncaught page error |
| `helpers.spec.js` | 8 | the measurement helpers' **self-test** — every detector proven to fire on a broken DOM and stay quiet on a clean one |
| `no-horizontal-overflow.spec.js` | 10 | per page, at **320 / 360 / 375 / 414 / 768 / 1024px**, twice (as shipped and with `html, body { overflow-x: hidden }` neutralised): root `scrollWidth <= clientWidth`, no sideways scroll container, and no element or `::before`/`::after` box reaching past its container's content right edge. Failures print the element path and the px delta |
| `wrapping.spec.js` | 6 | at 320px: a multi-word Polish present title and a long Polish chat message break **only at spaces** (the old "Murph / y" bug); `word-break` is `normal` on `.present-title`/`.present-name`, `.chat-bubble` and `.activity-name`; the 64-char single token and the long URL may wrap/ellipsize but must not overflow; the URL keeps its full address in `href` while its display text is shortened |
| `pluralization.spec.js` | 10 | Node-side: `plForm`/`plCount` at 0, 1, 2, 5, 12, 22, 112 and 1.5 across `prezent`, `kupiony`, `zarezerwowany`, `osoba`; `notification-text` wording for all 7 explicit types + default, the `Ktoś` fallback, `html:false`, `showActor:false`, `& < > " '` escaping, `dla:` suppression — **and that no wording contains an emoji** (they were just removed). In the real UI: the leaderboard renders `1 kupiony`/`2 kupione`/`5 kupionych`/`12 kupionych`/`22 kupione`/`112 kupionych` and the matching `zarezerwowan*`, the agreeing hidden noun (`5 kupionych prezentów`), `1 aktywność` / `2 aktywności` / 5+ `aktywności`, `1 prezent`…`112 prezentów` in the ranking list, the two stats on **separate lines at 320px** with the `•` hidden and `white-space: nowrap`, sharing one line at 768px with the `•` visible, the hidden noun costing ≤1px of layout, and the activity feed rendering `dodaje 5 prezentów` for the collapsed burst |
| `chat-reactions.spec.js` | 11 | chips render in allowlist order with counts 1/2/9 and pluralised Polish labels, add button last; clicking flips `aria-pressed` and the count optimistically and still matches after the server response; **keyboard focus survives a toggle**, survives a programmatic poll, and survives the **real 8-second poll**; un-reacting the last holder removes the chip and moves focus to that message's add button (never `<body>`); pressed state differs **without colour** (2px vs 1px border + inset ring) and the box does not resize on toggle; chip text ≥4.5:1 and border ≥3:1 measured contrast; **no response carries a reactor identity**; the picker opens on the add button, lands on the first emoji, traps 9 Tabs, and Escape returns focus to the add button; a six-chip strip does not push `#chatMessages` sideways at 320px |
| `escaping.spec.js` | 5 (+1 fixme) | a present title, a recipient name, a chat message and a notification title containing `<script>alert(1)</script> & " '` all render as literal text with **zero** elements created and `&lt;` in the markup; plus a guard-on-the-guard test that fails if someone fixes the leaderboard sink so the fixme can be re-enabled |
| `a11y.spec.js` | 10 (+10 fixme) | per page at 375 and 1024px: every icon-only control outside the dock has an accessible name; **nothing rendered** is both `aria-hidden` and focusable; no positive `tabindex` |
| `edit-sheet.spec.js` | 4 (+1 fixme) | at 320 and 375px the dialog is `position: fixed` with its bottom edge **on** the viewport bottom (±1px), full width, `max-height` ≈ 90% of the viewport, rounded top / square bottom; at 1024px it is **not** bottom-pinned (the mobile rule does not leak); `#editPresentComments` is ≥120px tall at 375px, ≥132px at 1024px, `resize: vertical`; 12 Tabs all stay inside the dialog and Escape closes it |
| `composer.placeholder.spec.js` | 11 fixme | **placeholder only** — nothing asserted. Lists the 11 composer/dock behaviours to cover and which helper each needs, with the owning files named |

---

## 6. Every skipped test, and the product bug it waits on

23 skips, all `test.fixme`, in three groups.

### 1. `escaping.spec.js` — 1 skip: **stored XSS sink in the leaderboard**

`a leaderboard name containing markup renders as literal text`

`public/leaderboard.html:1209` interpolates `user.username` straight into `innerHTML`:
`<div class="activity-name">${user.username}</div>`. The same file repeats it at `:1319`
(`.podium-name`) and `:1355` (`.user-name`), and the surrounding
`onclick="navigateToUserInRecipients('${user.username}')"` attributes take the raw name
too. Names are user-controlled through `POST /api/recipients`, so this is a stored-XSS
sink. Every other renderer in the codebase escapes (`public/recipients.js:1130`,
`:1855`, `public/activity.html` via `escapeHtmlText`).

Written as a real assertion first; it fails. **Confirmed still present** by the companion
test `the leaderboard XSS sink is still exactly where the fixme says it is`, which asserts
the raw `<mała>` appears in `.activity-name`'s `innerHTML` — so if anyone fixes
`leaderboard.html`, that test fails and tells you to re-enable the fixme.

Not fixed here: escaping it changes what is rendered, and `leaderboard.html` is outside
this task's scope. **This one is worth fixing soon.**

### 2. `a11y.spec.js` — 10 skips: **three dock controls have no accessible name**

`<page>: EVERY icon-only control including the dock has a name` (one per page)

- `button.tab-bar-menu-close` — the menu panel's X, on every page
- `button.tab-bar-notifications-close` — the notifications panel's X, on every page
- `a.tab-item.messages-tab` — on `/rezerwacje` and `/ustawienia` the link renders
  **completely empty**: no icon, no label, no accessible name, yet still in the tab order.
  Measured: `outerHTML` is `<a href="wiadomosci.html" class="tab-item messages-tab"></a>`.
  The markup in those two files has an **unclosed `<div class="tab-icon-wrapper">`` and
  two duplicate labels (`Czat` and `Wiadomości`).

The first two live in `public/bottom-tab-bar-snippet.html`, which this task may not write
to. The assertion is **not weakened**: the full, unexcluded check is kept as the fixme
above, and a second test runs the identical check with the dock scoped out so there is
real coverage of page content today.

### 3. `edit-sheet.spec.js` — 1 skip: **closing the edit sheet drops focus to `<body>`**

`closing the sheet returns focus to its trigger`

Measured after Escape: `{"isTrigger":false,"tag":"body"}`. Cause: the modal is opened
programmatically — `new bootstrap.Modal(...).show()` at `public/recipients.js:3604` — and
Bootstrap only restores focus to the trigger for modals opened through its
`data-bs-toggle="modal"` data-api. A keyboard user who closes the sheet is dumped at the
top of the page (WCAG 2.4.3). The focus-trap and Escape halves of requirement 3 **do**
pass; only the focus-return half is blocked.

### 4. `composer.placeholder.spec.js` — 11 skips: **not a bug, a deliberate placeholder**

The add-present composer and dock are being rewritten by a concurrent workflow (its
in-flight edits to `public/formularz.html`, `formularz.js`, `tab-bar-functions.js` and
`bottom-tab-bar.css` are visible in `git status` right now). Per the task instruction,
no assertion is made on composer internals; the file records the 11 behaviours to cover
and the helper each needs.

### Two harness bugs found and fixed along the way (not product bugs)

Worth recording, because both would have produced confident false results:

1. **Measuring before layout settles.** For ~500ms after a viewport change the chat page
   lays `.container` out at **28px inside a 320px body** and `#chatMessages` reports
   `clientWidth 0`. The first overflow run "found" a 428px overflow that does not exist.
   Fixed with `waitForLayoutSettled()` — a narrow signature (root `scrollWidth`/
   `clientWidth`, `body.clientWidth`, every `.container` width, and every scroll
   container's `clientWidth:scrollWidth`) that must hold steady across polls. Sampling
   *every* div never stabilises, because spinners and the Christmas countdown keep
   resizing forever.
2. **`home.html` reloads itself once on a fresh profile** (`home.html:12-43`: if
   `localStorage.homePageVersion` is unset it stores it and reloads 500ms later). Every
   Playwright context is a fresh profile, so this fired mid-test and produced an
   intermittent `Execution context was destroyed`. Fixed by navigating to `/` twice (the
   second visit finds the version stored and skips the block) plus a retry that redoes the
   wait on the new document. This is app behaviour, not a bug.

Three detector refinements were also needed, each of which removed a whole class of false
positive:

- only `overflow-x: auto|scroll` counts as a sideways scroller — an element with
  `overflow-y: auto` and `overflow-x: hidden` reports `scrollWidth > clientWidth` but
  clips rather than scrolling;
- an element whose box starts **at or past** the limit is parked off-canvas (a closed
  slide-in menu), not overflowing — this alone removed ~10 bogus `#sidebarMenu` findings
  per page;
- a focusable with **no client rects** (closed Bootstrap modal, `display:none` ancestor)
  is not reachable, so `aria-hidden` over it is not a finding.

---

## 7. Files changed, and the concurrent workflow's changes

```
=== git status --short ===
 M .gitignore                      <- mine
 M README.md                       <- mine (5-line Testing section)
 M package-lock.json               <- mine (@playwright/test)
 M package.json                    <- mine (devDependency + scripts)
D  package.json.backup             <- NOT mine (staged deletion)
 M public/activity.html            <- NOT mine (cache-bust ?v= bump)
 M public/bottom-tab-bar.css       <- NOT mine (composer workflow)
 M public/formularz.html           <- NOT mine (composer workflow)
 M public/formularz.js             <- NOT mine (composer workflow)
 M public/home.html                <- NOT mine (cache-bust ?v= bump)
 M public/leaderboard.html         <- NOT mine (cache-bust ?v= bump)
 M public/notification-text.js     <- NOT mine (orchestrator removed the emoji)
 M public/recipients.html          <- NOT mine (cache-bust ?v= bump)
 M public/rezerwacje.html          <- NOT mine (cache-bust ?v= bump)
 D public/styles-clean.css         <- NOT mine (orchestrator deleted, unreferenced)
 D public/styles.purged.css        <- NOT mine (orchestrator deleted, unreferenced)
 M public/tab-bar-functions.js     <- NOT mine (composer workflow)
 M public/ustawienia.html          <- NOT mine (cache-bust ?v= bump)
 M public/wiadomosci.html          <- NOT mine (cache-bust ?v= bump)
D  server-backup.js                <- NOT mine (staged deletion)
D  server-mysql.js                 <- NOT mine (staged deletion)
 M server.js                       <- mine (DEMO_MODE only)
D  server.js.backup                <- NOT mine (staged deletion)
?? .agents/tasks/composer-v2-plan.md        <- NOT mine
?? .agents/tasks/e2e-harness-plan.md        <- the plan for this task
?? .agents/tasks/screenshots/composer*.png  <- NOT mine
?? playwright.config.js            <- mine
?? tests/                          <- mine
```

```
=== git diff --stat ===
 .gitignore                  |     7 +
 README.md                   |     5 +
 package-lock.json           |    64 +
 package.json                |     9 +-
 public/activity.html        |     4 +-
 public/bottom-tab-bar.css   |    18 +-
 public/formularz.html       |   113 +-
 public/formularz.js         |   135 +-
 public/home.html            |     4 +-
 public/leaderboard.html     |     4 +-
 public/notification-text.js |    19 +-
 public/recipients.html      |     4 +-
 public/rezerwacje.html      |     4 +-
 public/styles-clean.css     |   336 -
 public/styles.purged.css    | 15471 -------------------------------------------
 public/tab-bar-functions.js |    94 +-
 public/ustawienia.html      |     4 +-
 public/wiadomosci.html      |     4 +-
 server.js                   |   341 +-
 19 files changed, 739 insertions(+), 15901 deletions(-)
```

### I edited exactly these files

`package.json`, `package-lock.json` (by `npm install`), `.gitignore`, `README.md`,
`server.js`, `playwright.config.js`, and the new `tests/` tree.

### Forbidden files — attribution

`git -P diff` is **not** empty for four of the seven forbidden files:

```
 public/bottom-tab-bar.css   |  18 +++++-
 public/formularz.html       | 113 +++++++++++++++++++++++++++++++++---
 public/formularz.js         | 135 +++++++++++++++++++++++++++++++++-----------
 public/tab-bar-functions.js |  94 +++++++++++++++++++++++++-----
```

**None of those are mine.** Evidence:

- `git status --short` at the very start of this task showed the tree otherwise **clean** —
  only six untracked `.agents/` entries. Every `M`/`D` entry above appeared during the
  session, made by the concurrent composer-v2 workflow and by the orchestrator.
- The content is unmistakably composer work. Sample from `public/formularz.html`:

  ```
  -    <link href="bottom-tab-bar.css?v=41" rel="stylesheet">
  +    <link href="bottom-tab-bar.css?v=42" rel="stylesheet">
  +                /* `bottom` handles the add-mode / on-screen-keyboard moves;
  +                   `transform` handles hide-on-scroll. Disjoint triggers, and
  +                   the one overlap (entering add mode while the dock is
  +                   scroll-hidden) is made instant below.
  ```

  and `.agents/tasks/composer-v2-plan.md` plus seven `composer-v2-*.png` screenshots
  arrived untracked in the same window.
- The seven 4-line page diffs (`activity.html`, `home.html`, `leaderboard.html`,
  `recipients.html`, `rezerwacje.html`, `ustawienia.html`, `wiadomosci.html`) are all the
  same two lines — `bottom-tab-bar.css?v=41 → 42` and `tab-bar-functions.js?v=17 → 18` —
  i.e. that workflow's cache-bust bump.
- `public/notification-text.js` is the orchestrator's emoji removal, announced mid-task;
  this task only **aligned its assertions** to the new emoji-free wording.
- `public/styles-clean.css` and `public/styles.purged.css` were deleted by the
  orchestrator, also announced; nothing here referenced them.

`public/sw.js` and `public/bottom-tab-bar-snippet.html` are untouched by anyone — no cache
bump was needed, and this task ships nothing the service worker precaches.

### `.gitignore` additions

```
tests/.auth/
tests/.report/
tests/.results/
tests/.cache/
playwright-report/
test-results/
```

No generated artifact (session state, CDN cache, traces, HTML report) can be committed.

---

## 8. Documentation

- **`tests/README.md`** — how to run (`npm test`, `--grep`, headed/UI/debug, report), how
  the suite boots the server in demo mode (free port, env, `/health` polling, process-tree
  teardown), how `npm run offline` relates to it, how to add a test (import from
  `../fixtures`, use `openPage`/`setViewport`, never `waitForTimeout`, assert measured
  numbers, restore mutated demo state), the helper table, where the demo fixtures live,
  the CDN cache and its first-run internet requirement, the honest-limits section, and a
  table of the three product bugs the suite records but does not fix.
- **`README.md`** — a 3-line Testing subsection under "Local Development" pointing at
  `tests/README.md`. Non-invasive, no restructuring.

---

## 9. What this harness still cannot verify

- **No database at all.** `DEMO_MODE` never creates the MySQL pool, so **no SQL runs**.
  The suite cannot verify any query, `init-db.js`, a migration, or the real
  `anon_message_reactions` DDL — in particular
  `emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin` and the
  `uniq_message_user_emoji` unique key, which exist precisely because the `*_ci`
  collations compare different emoji as equal. The demo reaction store is a
  `Map<messageId, Map<emoji, Set<userId>>>`; a JS `Map` key compares by code point, so it
  cannot reproduce a collation bug.
- **One account.** Demo login always yields user id 1
  (`server.js` login demo branch), so genuinely multi-account behaviour — someone else's
  reaction, the cross-session anonymity guarantee, unread badges between two real
  accounts — is represented by **seeded data**, not exercised. **A real two-account MySQL
  smoke test is still owed before relying on chat reactions in production.**
- **One engine.** Edge/Chromium only. No WebKit, no Firefox, no real iOS/Android device,
  no on-screen keyboard — so `visualViewport` behaviour and real touch/thumb reach stay
  unverified, exactly as in the previous throwaway harnesses.
- **No visual regression baselines.** Two font CDNs make pixel diffs flaky; everything is
  asserted on measured geometry and computed style instead. A purely cosmetic change
  (a colour, a shadow) can pass unnoticed.
- **Contrast is computed, not perceived.** The ratios come from measured computed colours.
  Full WCAG conformance still requires manual testing with assistive technology and expert
  review; the a11y spec is a mechanical smoke check, not an audit.
- **The add-present composer and the dock are not covered** — mid-rewrite by another
  workflow. `composer.placeholder.spec.js` lists the 11 behaviours owed.
- **The dock itself is only partially covered.** The icon-only-name check currently
  excludes the dock subtree (see §6.2); the full check is the fixme.
- **Pseudo-element geometry is reconstructed**, not measured — `::before`/`::after` have
  no client rect, so their boxes are rebuilt from computed `width`/`left`/`right` and
  `position`. It provably fires on the real overhang case (§3a break 2) but it is an
  approximation, and a pseudo positioned by some other mechanism could slip past.
- **No server-side unit tests.** The shared pure modules (`pluralize-pl`,
  `notification-text`, `chat-reactions` core) are asserted directly from the Playwright
  suite, which is convenient but means they only run when a browser suite runs.
- **Only the happy demo path.** No error-state coverage: no 500s, no network failure, no
  maintenance mode (`MAINTENANCE_MODE` is a separate flag and is always false here).
