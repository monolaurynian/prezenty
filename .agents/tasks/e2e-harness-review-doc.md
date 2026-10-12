# Committed Playwright e2e harness that boots the real server in demo mode

The change replaces the throwaway `%TEMP%` static harnesses and eyeballed screenshots with
a committed Playwright suite. `tests/global-setup.js` picks a free ephemeral port, spawns
the **real `server.js`** as a child process with `OFFLINE_MODE=true`, polls `/health` until
`mode === 'DEMO'`, logs in once and stores the session, then returns a teardown that kills
the process tree. Nine spec files assert measured geometry, computed style, response-body
key sets and Polish plural wording; screenshots and traces are produced only on failure.
`server.js` grows ~340 lines, all of it inside `if (DEMO_MODE)` branches and new demo
fixture objects, so demo mode can serve realistic chat / leaderboard / notification data.

Watch for: the suite's `forbidOnly` is gated on `process.env.CI` rather than always on, so
a stray `test.only` committed locally shrinks the run to one test and still exits 0
(confirmed, `playwright.config.js:25`). Four overflow assertions match a *formatted failure
string* instead of the structured report, so a reword of `describeOverflow` would make them
permanently green (confirmed). Reaction specs mutate shared in-memory demo state and
restore it inline, so a mid-test failure can cascade into later specs (likely). None of
these block.

**Verdict**: APPROVED

## High-level view

Requirement 1 holds on the code, not just on the claim. `tests/helpers/start-demo-server.js`
spawns `process.execPath server.js` with `cwd` = repo root (needed because
`express.static('public')` is relative), deletes `DB_PASSWORD`, sets
`NODE_ENV=development` so the session cookie stays non-`Secure`, and refuses to proceed
unless `/health` answers `mode === 'DEMO'` — a reachable-but-wrong-mode answer is a hard
error with the child's stdout embedded. Nothing is stubbed, no fetch layer is mocked, and
no static fixture page is served; every spec drives pages off the booted server. Teardown
is wired three ways (returned teardown, `try/finally` around login, `process.on('exit')`)
into one idempotent `stop()` that uses `taskkill /T /F` on Windows.

Requirement 2 holds: `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`,
`video: 'off'`, reporters `list` + HTML. Nothing in the suite produces an image for a human
to compare, and failure messages carry the measured numbers (`describeOverflow` prints
`scrollWidth / clientWidth (+Npx)` and the element path).

Requirement 3 is satisfied twice over. The verification doc records two deliberate breaks
appended to `public/chat-reactions.css` — flattening the pressed-state border, and
reintroducing the historical `::after` overhang — each producing exit 1 with the measured
signature or the per-viewport `scrollWidth 323 / clientWidth 317 (+6px)` numbers that match
the historical `chat-noscroll-verification.md` record. Both were reverted (`chat-reactions.css`
is absent from `git status`). On top of the one-off proof, `tests/e2e/helpers.spec.js` is a
permanent self-test: each detector is run against a deliberately broken DOM where it must
report and a clean one where it must not.

Requirement 4 holds on the diff. Every removed line is an old demo early-return
(`return res.json({ users: [] })`, four `503` stubs) or a trailing comma on the last element
of a `demoData` array. Three routes have the `if (DEMO_MODE)` guard moved *below* the shared
validation (new thread, reply, reaction toggle) so demo mode exercises the same check order
— the production statements around them are byte-identical. `requireAuth` is untouched and
still on every route it was on; `smoke.spec.js:39` proves an anonymous context still gets
401 from three API routes. `node --check server.js` passes.

Requirement 5 holds and is stronger than "no identity rendered":
`chat-reactions.spec.js:289-320` fetches `/api/wiadomosci/threads/1` and the toggle endpoint,
walks both payloads recursively for any key matching `/user|sender|reactor|identit|author|owner/i`
(must be empty), asserts each message's key set is exactly
`{body, createdAt, fromMe, id, reactions}` and each reaction's exactly `{count, emoji, mine}`.
The demo branch builds that shape through the **shipped** `buildReactionList` /
`groupReactionsByMessage`, so the aggregation under test is the production one.

Requirement 6: three of the seven forbidden files (`public/sw.js`, `public/app-theme.css`,
`public/bottom-tab-bar-snippet.html`) are untouched by anyone — confirmed with
`git status --porcelain` on those paths. The other four (`formularz.html`, `formularz.js`,
`tab-bar-functions.js`, `bottom-tab-bar.css`) *are* modified in the working tree, by the
concurrent composer workflow. Independently confirmed: grepping the added/removed lines of
all four for `e2e|playwright|test|data-e2e` returns nothing, and the content is dock/composer
CSS and cache-bust bumps. Not attributable to this task.

Requirements 7–9 hold. No `waitForTimeout` anywhere; the only `setTimeout` calls are the
health-poll sleep in the launcher and the deliberate frame-sampling marks in
`helpers/scroll.js`. Waits are web-first assertions, `waitForResponse`, `waitForFunction`,
or the app's own signals (`shown.bs.modal`, `loadThreadMessages()`). `@playwright/test` is
`"1.61.0"` exact, no caret. The limitations section in `tests/README.md` is honest and
specific: no SQL at all, so no migration, no `init-db.js`, no `anon_message_reactions` DDL
(`utf8mb4_bin` collation and `uniq_message_user_emoji` named explicitly), one account only,
and "a real two-account MySQL smoke test is still owed before relying on chat reactions in
production".

Requirement 10 holds. `no-horizontal-overflow.spec.js` walks all six widths
(`320/360/375/414/768/1024` in `helpers/pages.js`) twice per page, once with the
`html, body { overflow-x: hidden }` guard neutralised. `wrapping.spec.js` asserts
space-only breaks and `word-break: normal` on the prose containers while explicitly
allowing a URL to break anywhere. `pluralization.spec.js` covers 0/1/2/5/12/22/112 plus
1.5 against the helpers and against the rendered leaderboard and activity feed, including
the separate-lines-at-320px / shared-line-at-768px behaviour. `chat-reactions.spec.js`
covers chip order, counts, `aria-pressed`, focus survival across a toggle, a programmatic
poll and the real 8-second poll, the non-colour pressed cue, contrast, and privacy.
`escaping.spec.js` covers four sinks plus a guard-on-the-guard. `a11y.spec.js` is a
mechanical smoke check across ten pages at two widths.
`composer.placeholder.spec.js` asserts nothing — all eleven entries are `test.fixme` with
empty bodies naming the owning file and the helper each will need. All 23 skips are
`test.fixme` and each names a product bug (leaderboard XSS sink, three unnamed dock
controls, edit-sheet focus not returned) or the concurrent-rewrite rationale.

<details>
<summary>Issues (5)</summary>

1. **`forbidOnly` gated on CI** — `playwright.config.js:25` uses `forbidOnly: !!process.env.CI`;
   the plan specified `forbidOnly: true`. A committed `test.only` would silently reduce the
   suite to one test and still exit 0. Set it unconditionally.
2. **Overflow assertions match a message string** — `wrapping.spec.js:90,128,139` and
   `chat-reactions.spec.js:371` assert `describeOverflow(...)` does not match `/overflows by/`.
   Rewording that formatter in `helpers/overflow.js` makes them permanently green. Assert
   `report.offenders` / `report.scrollers` directly, as `no-horizontal-overflow.spec.js` does.
3. **Shared demo state restored inline** — reaction specs toggle seeded reactions and undo
   them at the end of the test body. A mid-test failure skips the undo, so one real failure
   can cascade into later specs and obscure the original cause. Move the restore into an
   `afterEach` or re-seed per test.
4. **Tautological assertion** — `chat-reactions.spec.js:309`
   `expect(threadResponse === null || threadResponse.ok()).toBeTruthy()` cannot fail. Drop it
   or assert the response was actually observed.
5. **First run needs network** — the CDN cache under `tests/.cache/cdn/` is gitignored, so a
   fresh CI checkout's first run must reach `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`.
   Documented in `tests/README.md`, but worth a CI note.

</details>

<details>
<summary>Details</summary>

### Server boot: the failure path is the hard part

The free port comes from `net.createServer().listen(0,'127.0.0.1')` then release,
with up to three retries, and the retry only happens when the captured child logs contain
`EADDRINUSE` — any other failure is rethrown rather than silently retried on a new port.
The health loop distinguishes three outcomes: child exited early (error carries exit code,
signal, port and both log streams), reachable but `mode !== 'DEMO'` (hard error naming a
leaking `DB_PASSWORD` as the likely cause, not a retry), and timeout. That last distinction
matters — a `DEMO_MODE` that silently fell back to `PRODUCTION` would otherwise produce a
suite that passes against a different code path.

`npm run offline` was broken before this change (it called `cross-env`, which is not in
`devDependencies`). It now points at the same launcher with `--foreground`, fixing the
script with no new dependency.

### server.js stays inside the demo branch

Worth calling out explicitly because it is the easiest requirement to violate by accident:
the only lines removed from production reach are the old demo early-returns themselves. The
three guards that moved below validation now make demo mode run `parseReactionMessageId`,
`isAllowedReactionEmoji` and the 30-toggles-per-10s `reactionRateAllows` throttle in the
same order production does, which is what lets a spec exercise the real check order instead
of a shortcut. `/api/link-preview` gained a new demo guard that returns a stub, so the suite
makes no outbound HTTP request — the alternative (real fetches to whatever URL a demo
message contains) would be both slow and non-hermetic.

The demo fixtures are append-only: `demoData.recipients` ids 4–5 and `demoData.presents`
ids 4–9 are added, ids 1–3 keep their shape, so nothing that already read the demo data
changes behaviour.

### The detectors can fire

`helpers/overflow.js` makes three measurements, each self-tested in
`helpers.spec.js`: root `scrollWidth` vs `clientWidth`, every element whose computed
`overflow-x` is `auto|scroll` (deliberately *not* `overflow-y`, because a vertical scroller
with `overflow-x: hidden` reports a width delta while clipping rather than scrolling), and
a DOM walk of right edges with clipping ancestors skipped and off-canvas boxes
(`rect.left >= limit`) excluded. `::before`/`::after` boxes are reconstructed from computed
style because pseudo-elements have no client rect — an approximation, but the break-2 proof
shows it fires on the real overhang case.

The `ignoreGuard` path neutralises `html, body { overflow-x: hidden }` by removing the
property from the owning `CSSStyleRule.style` (and inline styles), re-measures, then
restores in reverse order. `helpers.spec.js` asserts the guarded measurement is clean and
the unguarded one reports >400px on the same injected element, which proves the
neutralisation actually takes effect rather than silently no-op'ing.

### Layout settling instead of sleeping

`helpers/pages.js:waitForLayoutSettled` is the mechanism that keeps the suite honest without
sleeps: a narrow signature (root scroll/client width, `body.clientWidth`, every `.container`
width, and every scroll container's `clientWidth:scrollWidth`) must hold steady across two
polls. The narrowness is deliberate and documented — sampling every element never
stabilises because spinners and the countdown keep resizing. `home.html`'s one-shot
self-reload is handled by navigating twice plus a retry that redoes the wait on the new
document, which is the right fix for app behaviour rather than a timing hack.

</details>

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `server.js` | +341/-13, all inside `if (DEMO_MODE)` branches plus new `demoChat` / `demoLeaderboard` / `demoNotifications` fixtures and read helpers |
| `package.json` | `@playwright/test` `1.61.0` exact; `test`/`test:e2e*` scripts; `offline` repointed at the launcher |
| `package-lock.json` | `npm install` of the above |
| `.gitignore` | `tests/.auth/ .report/ .results/ .cache/`, `playwright-report/`, `test-results/` |
| `README.md` | 5-line Testing section |
| `playwright.config.js` | new — `msedge`, `workers: 1`, failure-only artifacts, `serviceWorkers: 'block'` |
| `tests/global-setup.js`, `tests/fixtures.js` | new — server boot + login + teardown; `baseURL` option, page-error collector, CDN cache |
| `tests/helpers/*.js` (10 files) | new — server launcher, overflow, line-breaks, contrast, non-colour cue, focus, a11y, scroll, pages, CDN cache |
| `tests/e2e/*.spec.js` (9 files) | new — smoke, helpers self-test, overflow, wrapping, pluralization, chat reactions, escaping, a11y, edit sheet, composer placeholder |
| `tests/README.md` | new — how to run, how the boot works, helper table, honest limits, known product bugs |
| `public/formularz.{html,js}`, `public/tab-bar-functions.js`, `public/bottom-tab-bar.css`, seven `?v=` bumps, `public/notification-text.js`, deleted `styles-*.css`, staged `*.backup` deletions | **not this task** — concurrent composer workflow and orchestrator; verified free of any harness reference |

Full diff: `git -P diff` plus the untracked `tests/` tree and `playwright.config.js`.

</details>
