# End-to-end tests

Playwright suite that boots **the real `server.js`** in demo mode, drives the
**real pages** in headless Edge, and **asserts**. No screenshots to eyeball:
images and traces are produced only when something fails.

## Run it

```powershell
npm install          # once - node_modules is not committed
npm test             # the whole suite, headless
npm run test:e2e     # same thing
npm run test:e2e -- chat-reactions        # one spec
npm run test:e2e -- --grep "pluralis"     # one test by name
```

Debugging a failure:

```powershell
npm run test:e2e:headed                   # watch it happen in a real window
npm run test:e2e:ui                       # Playwright UI mode, time-travel
npm run test:e2e -- --debug chat-reactions
npm run test:e2e:report                   # open the HTML report of the last run
```

Traces and failure screenshots land in `tests/.results/`; open one with
`npx playwright show-trace tests/.results/<test-dir>/trace.zip`.

The browser is the **Edge already installed on the machine**
(`channel: 'msedge'`), so `npx playwright install` is never needed.

## How the server gets started

`tests/global-setup.js` runs once per suite and:

1. asks the OS for a free port, so the suite never collides with a dev server
   on the default 3002;
2. spawns `node server.js` from the repo root with `OFFLINE_MODE=true`,
   `NODE_ENV=development`, `HOST=127.0.0.1`, `PORT=<free>` and a fixed
   `SESSION_SECRET` (`tests/helpers/start-demo-server.js`);
   - `OFFLINE_MODE` beats a developer `.env` that sets `DB_PASSWORD`,
   - `NODE_ENV=development` keeps the session cookie non-`Secure`, which it
     must be for login to work over plain HTTP;
3. polls `GET /health` until it answers `mode: "DEMO"`, and on timeout throws
   an error with the server's captured stdout and stderr in the message;
4. logs in once and writes the session to `tests/.auth/demo.json`
   (demo login accepts any username/password), which every test reuses through
   `use.storageState`;
5. returns a teardown that kills the server's **process tree**
   (`taskkill /PID <pid> /T /F` on Windows) - on success and on failure alike,
   so no orphaned `node.exe` is left holding the port.

`npm run offline` uses the same launcher in the foreground. It replaces the old
`cross-env OFFLINE_MODE=true ... node server.js` script, which was broken
because `cross-env` is not installed.

## Adding a test

```js
const { test, expect } = require('../fixtures');   // NOT '@playwright/test'
const { openPage, setViewport } = require('../helpers/pages');

test('something holds', async ({ page }) => {
    await openPage(page, { path: '/recipients', name: 'r', ready: '.present-title' });
    await setViewport(page, 320);
    await expect(page.locator('.present-title').first()).toBeVisible();
});
```

Rules of the house:

- Import from `../fixtures`. That gives you the running server's `baseURL`, the
  CDN cache, and an automatic failure if the page throws an uncaught error.
- Use `openPage` / `setViewport` from `helpers/pages.js`. They wait for the
  page's content AND for layout to stop moving. Measuring too early is not
  theoretical: for ~0.5s after a resize the chat page lays `.container` out at
  28px inside a 320px body, which produces a confident, completely wrong
  overflow report.
- Never `page.waitForTimeout(...)`. Use web-first `expect(locator)`
  assertions, `page.waitForResponse`, `page.waitForFunction`, or the app's own
  signals (`shown.bs.modal`, `loadThreadMessages()`).
- Assert measured numbers and put them in the failure message. A failure
  should say `scrollWidth 323 / clientWidth 317 (+6px)`, not just "expected
  true".
- `workers: 1` is deliberate: one server, one shared in-memory demo dataset,
  one demo user. If your test mutates demo state (adds a present, toggles a
  reaction), restore it at the end.

### Helpers

| Helper | What it measures |
|---|---|
| `helpers/overflow.js` | root `scrollWidth` vs `clientWidth`, sideways scroll containers, element and `::before`/`::after` right edges; `ignoreGuard` re-measures with `html, body { overflow-x: hidden }` neutralised |
| `helpers/line-breaks.js` | where text visually breaks, offset-aware so a space dropped at the wrap point is not mistaken for a mid-word slice |
| `helpers/contrast.js` | WCAG ratio from measured colours, resolving the effective background through ancestors |
| `helpers/non-color-cue.js` | a style signature with every colour stripped, so "pressed" can be proven visible without colour |
| `helpers/focus.js` | focus survival by **node identity**, which is the only way to see focus silently falling to `<body>` |
| `helpers/scroll.js` | `scrollY` sampled at 0/60/150/300/450ms around an action |
| `helpers/a11y.js` | unnamed icon-only controls, rendered focusables inside `aria-hidden`, positive `tabindex`, Tab-cycle containment |
| `helpers/pages.js` | the page list, the viewport list, and the "wait until it stops moving" logic |

`tests/e2e/helpers.spec.js` is the helpers' **self-test**: each detector is run
against a deliberately broken DOM (it must report it) and a clean one (it must
not). A detector that can never fire would report green forever, so start there
if you doubt a result.

## Where the demo data lives

All of it is in `server.js`, inside `if (DEMO_MODE)` branches only:

- `demoData` - recipients and presents, including a 41-character unbreakable
  name, a 64-character single-word title, a long URL title, a present with no
  description, and a title full of HTML special characters;
- `demoChat` - three threads, one with seven messages in both directions, and
  seeded emoji reactions with counts 1 / 2 / 9;
- `demoLeaderboard` - rows whose bought/reserved counts cover the Polish plural
  boundaries 0, 1, 2, 5, 12, 22, 112, plus three XSS payload names at the front
  of the array (element injection, attribute breakout,
  JS-string-in-attribute). The payload rows carry both the highest
  `total_presents` and the highest activity so one of them lands on every
  leaderboard render path; keep it to exactly three, because the activity list
  slices to the top ten and a fourth row would push `Piotr Jedyny` out and
  break `pluralization.spec.js`;
- `demoNotifications` - 20 rows covering every activity type the renderers know
  plus one unknown type, a collapsible 5-item burst, and the `dla:`-suppression
  case.

Add fixtures there rather than in a test, and append - do not renumber existing
ids, other demo branches read them.

## The CDN cache

Every page loads Bootstrap from `cdn.jsdelivr.net` and icon fonts from
`cdnjs.cloudflare.com`. Blocking them would change layout and invalidate every
width measurement, so the first run fetches them and writes them through to
`tests/.cache/cdn/`; later runs are served from disk and need no internet. If
the cache is empty and the CDNs are unreachable, the suite fails with
`CDN unreachable and not cached` instead of a confusing layout failure.

## Honest limits - what this suite can NOT tell you

- **No database.** `DEMO_MODE` runs with no MySQL pool at all, so no SQL is
  executed. The suite cannot verify any query, `scripts/init-db.js`, a migration, or
  the real `anon_message_reactions` DDL - in particular
  `emoji VARCHAR(16) ... COLLATE utf8mb4_bin` and the
  `uniq_message_user_emoji` unique key, both of which exist precisely because
  the `*_ci` collations treat different emoji as equal.
- **One account.** Demo login always yields user id 1, so genuinely
  multi-account behaviour - someone else's reaction, the anonymity guarantee
  across two sessions, unread badges between two real users - is represented by
  seeded data, not exercised. **A real two-account MySQL smoke test is still
  owed before relying on chat reactions in production.**
- **One engine.** Edge/Chromium only. No WebKit, no Firefox, no real
  iOS/Android, no on-screen keyboard, so `visualViewport` behaviour stays
  unverified here.
- **No visual baselines.** Two font CDNs make pixel diffs flaky; everything is
  asserted on measured geometry and computed style instead.
- **Contrast is computed**, not perceived. Full WCAG conformance still requires
  manual testing with assistive technology and expert review.
- **The add-present composer and the dock are not covered yet.** See
  `tests/e2e/composer.placeholder.spec.js` - that code was mid-rewrite when
  this suite was written.

## Known product bugs the suite records but does not fix

Each of these is a `test.fixme` with a comment naming the file. (The stored-XSS
sinks that used to be listed here are fixed and covered by
`tests/e2e/xss-usernames.spec.js`.)

| What | Where |
|---|---|
| Three dock controls have no accessible name; on `/rezerwacje` and `/ustawienia` the "Wiadomości" tab renders completely empty yet stays focusable | `public/bottom-tab-bar-snippet.html`, `public/rezerwacje.html`, `public/ustawienia.html` |
| Closing the edit sheet drops focus to `<body>` instead of returning it to the "Edytuj" button | `public/recipients.js:3604` (modal opened programmatically, so Bootstrap does not restore focus) |
