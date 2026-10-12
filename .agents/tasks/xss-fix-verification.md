# Verification: stored XSS via user-controlled names

First iteration — `.agents/tasks/xss-fix-review.json` did not exist, so this was implemented
from scratch against `.agents/tasks/xss-fix-plan.md`.

Nothing is committed. All changes are left uncommitted in the working tree.

---

## 1. An important correction to the brief

The brief says the payload arrives through `username` from public self-registration. It does not.
`GET /api/leaderboard` (`server.js:2514-2568`) selects **`r.name AS username`** — the column is
`recipients.name`, not `users.username`. That value is written by:

- `POST /api/recipients` (`server.js:3692`) — any authenticated user, validation is
  `!name || name.trim() === ''` and nothing else;
- `POST /api/user/identify` — same empty-check only.

Two consequences:

1. The bug is **easier** to reach than registration — no new account needed, just "add a person".
2. Tightening `/api/register` would **not** have closed this path at all. See §7.

---

## 2. Every sink fixed, with file and line

Line numbers are post-fix, in the current working tree.

### `public/leaderboard.html` — all 11 sinks, both duplicated podium copies

| Plan id | Post-fix line | Sink | Fix |
|---|---|---|---|
| L1 | 1208 | `<img src="${pic}" alt="${name}" class="activity-avatar-img">` | `safeImageSrc` + `escapeHtml`; branch is now on the **sanitised** url, so a rejected one falls through to the emoji avatar (this avatar has no `onerror` at all) |
| L2 | 1217 | `<div class="activity-name">${name}</div>` | `escapeHtml` |
| L3 | 1265-1266 | activity-podium avatar `src`/`alt` | `safeImageSrc` / `escapeHtml` |
| L4 | 1276 | `.podium-place` — was `onclick="navigateToUserInRecipients('${user.username}')"` | **handler removed**, `data-username="${escapeAttr(...)}"` + one delegated listener (§4) |
| L5 | 1282 | `<div class="podium-name">${name}</div>` | `escapeHtml` |
| L6 | 1316-1317 | podium avatar `src`/`alt` (second copy) | `safeImageSrc` / `escapeHtml` |
| L7 | 1327 | `.podium-place` second copy — same `onclick` | handler removed, `data-username` |
| L8 | 1333 | `<div class="podium-name">${name}</div>` (second copy) | `escapeHtml` |
| L9 | 1356-1357 | users-list avatar `src`/`alt` | `safeImageSrc` / `escapeHtml` |
| L10 | 1367 | `.user-card` — same `onclick` | handler removed, `data-username` |
| L11 | 1371 | `<div class="user-name">${name}</div>` | `escapeHtml` |

`renderActivityPodium` (≈1253) and `renderPodium` (≈1304) really are near-identical functions.
**Both were fixed**, and the spec asserts both independently (`#activityPodium` and `#podium`),
so fixing one and assuming the other cannot pass.

Left alone in this file on purpose: `getEmojiAvatar(user.username)` (7 call sites). It returns one
character from a hard-coded emoji array; the name is only summed into an index.

### `public/intro.html` — I1-I4

| Plan id | Post-fix line | Sink | Fix |
|---|---|---|---|
| I1 | 612-613 | podium `<img src>` / `alt` | `safeImageSrc(...) || '/images/default-avatar.svg'`, `escapeHtml` |
| I2 | 616 | `<div class="podium-name">${name}</div>` | `escapeHtml` |
| I3 | 637-638 | user-row `<img src>` / `alt` | same |
| I4 | 642 | `<div class="user-name">${name}</div>` | `escapeHtml` |

Both `.map()` callbacks were converted from expression bodies to block bodies so `pic`/`name` can
be computed once. The two `onerror="this.src='/images/default-avatar.svg'"` literals are preserved
verbatim.

### `public/activity.html`

- **531** — `leaderboard_leader`: `data.leaderName` and `data.previousLeaderName` wrapped in the
  page's existing `escapeHtmlText`. `leaderName` is `recipients.name` (`server.js:282`), so this
  was a live username sink on a live page.
- **537** — `anon_message`: `data.label` wrapped in `escapeHtmlText`.

### `public/recipients.html`

- **1883** — `leaderboard_leader`: both names wrapped in the page's existing
  `notificationTextEscape`.
- **1889** — `anon_message`: `data.label` wrapped (not in the plan; same sink, same line of code).

**Finding worth recording: this code path is currently dead.** `renderNotification` is only called
from `loadRecentNotifications` (`recipients.html:1788`), and `tab-bar-functions.js?v=18` is loaded
*later* in the document (line 2449) and declares its own top-level
`function loadRecentNotifications`, which overwrites the page's. The dock version renders into
`#notificationsContent`; the page version targets `#notificationDropdownBody`, **an element that
does not exist anywhere in `recipients.html`** (so even unshadowed it would return early). The
escaping was applied anyway as defence in depth, and because it costs nothing. The sink that is
actually live on `/recipients` is `tab-bar-functions.js:224` — a forbidden file, see §9.

The *second* `leaderboard_leader` config at `recipients.html:2330` was deliberately **not**
escaped: every sibling entry in that block passes `html: false`, so it is the plain-text wording
config and escaping it would put `&amp;` into visible text.

### `public/osoby.html`

- **345** — the delete button. Was
  `onclick="deletePresent(${p.id}, '${escapeHtml(p.title).replace(/'/g, "\\'")}')"`. This page's
  `escapeHtml` is the `textContent → innerHTML` idiom, which escapes `& < >` but **not quotes**, so
  a title containing `"` closed the attribute and could add arbitrary ones. Now
  `data-delete-present="${p.id}"` + a delegated listener (§4). `title="Usuń"` is unchanged, so the
  accessible name is unchanged.
- **360** — `value="${PrezentyEscape.escapeAttr(p.title)}"` in the inline edit field (was the
  quote-unsafe helper in an attribute).
- **287** `flags.push(\`dodany przez: ${p.creator_username}\`)` — assessed, **not a sink**, left
  alone. `flags` is rendered at line 294 as `${escapeHtml(flags.join(' · '))}` in element content,
  which is correct for that context.

### Second wave — quote-unsafe helper inside quoted attributes

Lower severity (needs a `"` in the value rather than an apostrophe), same bug class.

| File:line | Change |
|---|---|
| `public/recipients.js:422` | `data-present-name` → the file's existing `escapeAttr` |
| `public/recipients.js:1136, 1138, 1144` | `data-present-title` ×2, `data-present-comments` → `escapeAttr` |
| `public/recipients.js:4290, 4292, 4298` | same three attributes in the second renderer → `escapeAttr` |
| `public/recipients.js:1176` | `src="${getFullProfilePictureUrl(escapeHtml(...))}"` → `src="${escapeAttr(getFullProfilePictureUrl(...))}"`. Not in the plan; found during the sweep. Escaping moved *outside* the URL helper, which is also more correct — it previously ran `startsWith('/uploads/')` against an already-entity-encoded string |
| `public/filters.js:563` | `data-name` → `escapeAttr`, and an `escapeAttr` added next to the file's `escapeHtml` (line ~684), mirroring `recipients.js:2429` |
| `public/home.html:576` | `alt="${PrezentyEscape.escapeAttr(identifiedRecipient.name)}"` |
| `public/home.html:641, 801` | `alt="${PrezentyEscape.escapeAttr(recipient.name)}"` |

**`public/home.html:643, 648, 803, 808` — a critical sink the plan did not list.** All four read

```html
onclick="openProfilePicturePreview(${recipient.id}, '${escapeHtml(recipient.name).replace(/'/g, "\\'")}', ...)"
```

That is the same JS-string-inside-an-HTML-attribute pattern as the leaderboard podium, escaped
with the quote-unsafe helper, so a recipient name containing `"` closed the `onclick` attribute and
could add arbitrary attributes. Fixed the same way as the leaderboard: the inline handlers are gone,
replaced by `data-preview-recipient` / `data-preview-name` / `data-preview-url` and one delegated
listener next to `openProfilePicturePreview` (`home.html:1016`).

---

## 3. The shared escaping approach, and why

**New file `public/escape-html.js`**, a dual browser/Node module in the same IIFE shape as
`public/notification-text.js` and `public/pluralize-pl.js`, exposing a **namespaced** global
`window.PrezentyEscape` with `escapeHtml`, `escapeAttr` and `safeImageSrc`, plus `module.exports`
so the Node side is unit-testable. The five replacements are copied from
`notification-text.js:27-34` — the one already-correct implementation in this repo — not reinvented.

Why a new namespaced module rather than reusing `notification-text.js` (the other option the brief
offered):

1. `notification-text.js` does not expose `escapeHtml` to the browser at all. Line 106 assigns only
   `root.notificationText`; `escapeHtml` leaves through `module.exports`, which a browser never
   sees. It needed a change either way.
2. **Nine** page scripts declare a competing top-level `function escapeHtml` — `filters.js`,
   `formularz.js`, `recipients.js`, `archiwum.html`, `home.html`, `osoby.html`, `rezerwacje.html`,
   `ustawienia.html`, `wiadomosci.html` — and every one is the quote-unsafe `textContent` idiom. A
   function declaration in a later script block **silently overwrites** a flat `window.escapeHtml`,
   which would downgrade attribute escaping with no visible symptom. (That exact shadowing is not
   hypothetical here: §2 documents `tab-bar-functions.js` overwriting
   `recipients.html`'s `loadRecentNotifications` the same way.) An object property cannot be
   shadowed by a function declaration, so the escaping is load-order independent. This was the
   deciding argument.
3. `safeImageSrc` has nothing to do with notification wording.

Loaded on: `leaderboard.html` (line 925, immediately after `notification-text.js` — nowhere near
the `?v=` line the concurrent workflow owns), `intro.html` (362), `osoby.html` (73),
`home.html` (229).

**Not** loaded on `activity.html` / `recipients.html`: both sinks there are element contexts, and
both pages already have a correct-for-element-content helper that they use for every other value
on the same line (`escapeHtmlText`, `notificationTextEscape`). Using `PrezentyEscape` for one value
and the page helper for its neighbours would have been less consistent, not more. No new escape
function was hand-rolled anywhere; `filters.js` gained a copy of `escapeAttr` to match its sibling
`recipients.js:2429`, which is the house pattern for a page-local attribute escaper.

A hard, unguarded script dependency is acceptable here: `pluralize-pl.js` is already exactly that
on `leaderboard.html` and `intro.html` (`plCount` is called straight from the render templates), and
if the module ever fails to load these pages fail **closed** (render nothing) rather than open.

---

## 4. How the inline-`onclick` contexts were removed

HTML-entity escaping cannot make `onclick="f('NAME')"` safe: the HTML parser decodes entities
*before* the JS parser sees the attribute value, so `&#39;` still arrives at the JS parser as `'`.
So the handlers are gone, not escaped.

**`public/leaderboard.html`** — `data-username="${PrezentyEscape.escapeAttr(user.username)}"` on the
three elements that had a handler (two `.podium-place`, one `#usersList .user-card`), and one
delegated listener registered next to `navigateToUserInRecipients` (line ~1406):

```js
document.addEventListener('click', function (e) {
    const target = e.target.closest && e.target.closest('[data-username]');
    if (!target) return;
    navigateToUserInRecipients(target.dataset.username);
});
```

`dataset` returns the **decoded** value, so `navigateToUserInRecipients` receives the original name
and its existing `encodeURIComponent` keeps working unchanged. The selector is `[data-username]`
and not `.user-card` precisely because `.user-card` is shared with `#activityList`, which has never
been clickable — and the spec asserts the activity cards did **not** acquire a `data-username`.

**`public/osoby.html`** — `data-delete-present="${p.id}"` + a delegated listener;
`deletePresent(presentId)` now looks the title up from the `presents` array, exactly as
`deleteAbandoned` already did.

**`public/home.html`** — `data-preview-recipient` / `data-preview-name` / `data-preview-url` + a
delegated listener; `openProfilePicturePreview` is unchanged.

Behaviour parity:

- `style="cursor: pointer;"` preserved verbatim on all three leaderboard elements (asserted).
- Propagation is unchanged: the old inline handlers did not stop propagation either.
- **Keyboard access is unchanged — still mouse-only.** These are `<div>`s with no `tabindex` and no
  `role`, and they were mouse-only before. Adding `tabindex`/`role` would create focusable controls
  needing accessible names and would newly interact with `a11y.spec.js` ("no positive tabindex",
  "nothing rendered is both `aria-hidden` and focusable"). No regression, no improvement; recorded
  in §9 as a candidate follow-up.

### Two small user-visible corrections this produced

Both are consequences of no longer passing an HTML-escaped string through a JS argument, and both
replace mangled output with correct output. Flagging them explicitly rather than burying them:

1. `/osoby` delete confirm used to read `Usunąć prezent "Zestaw &lt;script&gt;alert(1)&lt;/script&gt; &amp; "mega" 'mini'"?`
   (the title was `escapeHtml`'d before being put in the JS string). It now reads the real title.
   This also makes it consistent with `deleteAbandoned`, which always showed the raw title.
2. `/` (home) profile-picture preview modal used to show the same entity-mangled name in
   `previewName.textContent`. It now shows the real name.

Neither changes *which* object is acted on (both are bound by numeric id), and neither changes any
wording.

---

## 5. The `profile_picture` decision

Treated as untrusted even though it is server-generated today
(`CONCAT('/api/recipients/', r.id, '/profile-picture')` or `NULL`, `server.js:2529-2533`) — the page
must not depend on that.

`safeImageSrc(url)` is an **allowlist**:

- accepts a same-origin absolute path (`/…`, but **not** `//…`, which is protocol-relative and
  therefore off-origin);
- accepts `https://…`;
- rejects anything containing a control character or whitespace (`java\tscript:` is parsed as
  `javascript:` by some browsers, so a URL containing either is never worth rendering);
- rejects everything else — `javascript:`, `data:`, `vbscript:`, `http:`, `//evil.example`;
- returns the accepted URL **already escaped for a quoted attribute**, or `''`.

`data:` is deliberately not allowed: nothing in the codebase emits a data URL for a profile picture,
so allowing it would widen the surface for no feature.

Call sites branch on the **sanitised** value, so a rejected URL falls through to the existing
emoji-avatar branch (leaderboard) or the default avatar (intro) on every path, rather than
rendering a broken image. The existing `onerror` handlers are preserved verbatim —
`leaderboard.html` 1268, 1319, 1359 (`this.style.display='none'; this.nextElementSibling…`) and
`intro.html` 615, 640 (`this.src='/images/default-avatar.svg'`). The spec asserts the
`nextElementSibling` one is still present.

---

## 6. Everything found in the `public/` sweep and deliberately left alone

| File:line | Sink | Why it was left |
|---|---|---|
| `tab-bar-functions.js:224` | `${data.leaderName}` / `${data.previousLeaderName}` raw into `innerHTML` | **FORBIDDEN FILE.** A genuine, live username sink in the dock notifications panel, on every page with the dock. **The username XSS is not fully closed until this is fixed** — §9 |
| `tab-bar-functions.js:227` | `${data.label}` raw into `innerHTML` | FORBIDDEN FILE. Same follow-up |
| `formularz.js:1233` | `title="${escapeHtml(cleanUrl)}"` — quote-unsafe helper in an attribute | FORBIDDEN FILE. Value already passed a URL regex. Follow-up |
| `bottom-tab-bar-snippet.html:199` | `${notif.message}` | FORBIDDEN FILE, and documentation only — the one reference is `tab-bar-demo.html:95` telling a human to copy-paste it. Never loaded at runtime |
| `recipients.html:2330` | `${data.leaderName}` in the second `notificationConfig` | The `html: false` plain-text config (every sibling passes `html: false`). Escaping it would put `&amp;` into visible text |
| `osoby.html:307, 410` | `p.title` into `confirm(...)` | Text context, not XSS — `confirm()` never renders markup. **UI-spoofing judgement:** a title like `X"? Kliknij OK, aby anulować` can make the dialog read misleadingly. Impact is bounded and self-inflicted: the dialog only appears on the user's own `/osoby` page, the delete target is bound by **numeric id** not by the label, and the worst outcome is deleting a present the user could delete anyway. Left as-is |
| `recipients.js:1486, 1524, 1561, 3710, 4431, 4436` | names/titles in `confirm()` / toasts | Text contexts. Same judgement |
| `activity.html:579, 590` | `${error.message}` | `Error` objects from `fetch`/JSON parsing, not attacker-authored markup |
| `activity.html:460-465` (`linkifyEscaped`) | `href="${clean}"` | Input is already entity-escaped and the regex only matches `https?://` tokens containing no quotes or angle brackets |
| `activity.html:544` / `tab-bar-functions.js:216` (`personLinkHtml`) | `href="…?osoba=${encodeURIComponent(name)}"` | `encodeURIComponent` escapes `'`, `"`, `<`. Correct |
| `home.html:579` | `onerror="this.outerHTML='${getEmojiAvatar(...)}';"` | `getEmojiAvatar` returns one character from a hard-coded emoji array |
| `home.html:582` | `link.title = \`${identifiedRecipient.name} …\`` | Property assignment, not HTML |
| `home.html:779`, `recipients.html:1663`, `recipients.js:1622` | `${emptyMessage}` / `${title}` / `${message}` | Hard-coded literals from the page's own code |
| `filters.js:550` (`highlightText`) | `${recipientNameHighlighted}` | `highlightText` escapes first, then wraps matches in `<mark>` (`filters.js:674-678`). Element content only |
| `recipients.js:1187, 1233` (`recipientNameWithBadge`) | name + badge | Escapes every branch with `escapeHtml` and every attribute with `escapeAttr` |
| `wiadomosci.html:473, 622` | `${escapeHtml(t.otherLabel)}` | Element content, correctly escaped |
| `notification-text.js:69, 75` | `${person(data.recipientName)}` | `person()` escapes via the module's own (correct, quote-safe) `escapeHtml` |
| `osoby.html:216` | `data-person="${person.id}"` | Numeric id |
| `osoby.html:344` | `onclick="startEdit(${p.id})"` | Numeric id only; asserted by the spec's handler allowlist |
| `recipients.js:3872` | `` `[Cache] Present "${p.title}"` `` | `console.log`, not HTML |

---

## 7. Registration / name validation in `server.js` — recommendation, not implemented

Per the brief I am recommending and **not** implementing. Reasons, in order of weight:

1. **It would not fix this bug.** The value the leaderboard renders is `recipients.name` from
   `POST /api/recipients` and `POST /api/user/identify`, not `users.username` from
   `/api/register` (§1). Validating only registration would give false assurance.
2. **It would reject legitimate Polish names.** Apostrophes and `&` occur in real names
   (`Anna O'Brien`, `Zuzia & Marek`). The repo's own demo fixture `Zuzia & "Zuza" <mała> 'Z'`
   (`server.js:4055`) is exactly such a value and three e2e specs depend on it — a denylist would
   make the test fixtures unrepresentable.
3. **Existing rows already contain these characters**, so any rule must be create/update-only and
   cannot be retrofitted without a data audit. That is a separate, reviewed change.
4. **Output escaping is the fix**, and with §2 landed it is complete for every page in scope
   (modulo the forbidden file in §9).

What I would recommend as separate tasks, in priority order:

1. A **length cap** (e.g. 100 chars) plus stripping of NUL and C0 control characters on
   `POST /api/recipients`, `POST /api/user/identify` and `POST /api/register`. Input hygiene, not a
   security control; safe because it only affects new writes.
2. A **Content-Security-Policy** header. Currently infeasible without a large refactor: the app uses
   inline `<script>` blocks and inline `on*` attributes on essentially every page, so a meaningful
   CSP would need `unsafe-inline`, which defeats the purpose. Worth a dedicated task.

---

## 8. Verification

### 8.0 Conventions read first

`.agents/tasks/e2e-harness-verification.md`, `tests/README.md`, `tests/fixtures.js`,
`tests/helpers/pages.js`, `tests/e2e/escaping.spec.js`, `tests/e2e/pluralization.spec.js`.
House rules followed: `{ test, expect }` imported from `../fixtures` (never `@playwright/test`);
`openPage`/`setViewport` from `../helpers/pages`; no `page.waitForTimeout` anywhere; measured values
in failure messages; demo fixtures live in `server.js` inside `if (DEMO_MODE)`; `workers: 1`, so
mutated state is restored (the `/osoby` delete dialog is **dismissed**, and the inline edit is
cancelled).

### 8.1 Baseline, before any edit

```
Running 100 tests using 1 worker
  23 skipped
  77 passed (4.3m)
```

Exit 0. Matches `.agents/tasks/e2e-harness-verification.md` (77/0/23).

### 8.2 The `fixme` at `leaderboard.html:1209` is now a passing test

`tests/e2e/escaping.spec.js:101` — `test.fixme` → `test`, **assertion unchanged**: it still calls
`expectNoInjection(name, NASTY_NAME)` with the same locator (`.activity-name` filtered on `Zuza`)
and `expectNoInjection` (lines 24-37) was not weakened. The companion test at the old line 110
(`'the leaderboard XSS sink is still exactly where the fixme says it is'`, which asserted
`expect(victim.html).toContain('<mała>')`) was **deleted**, as its own failure message instructed.
`escaping.spec.js` now reports **5 passed, 0 skipped**.

### 8.3 New spec: `tests/e2e/xss-usernames.spec.js` — 16 tests

Three Node-side unit tests of the new module (`require('../../public/escape-html.js')`, the pattern
`pluralization.spec.js` already uses) covering all five escaped characters, `null`/`undefined` → `''`,
`escapeAttr === escapeHtml`, and `safeImageSrc` accepting `/api/recipients/1/profile-picture`,
`/images/default-avatar.svg`, `https://…` and rejecting `javascript:`, `JaVaScRiPt:`, a leading
tab/newline/space before the scheme, `data:image/png;base64,…`,
`data:image/svg+xml,<svg onload=…>`, `vbscript:`, `//evil.example/x.png`, `http://…`,
`x" onerror="…`, `''`, `null`, `undefined`.

Thirteen browser tests covering **every affected page and render path**:

| Path | Test |
|---|---|
| `#activityList` (`renderActivityLeaderboard`) | all three payloads literal; no handlers; **asserts the activity card did NOT gain a `data-username`** |
| `#activityPodium` (`renderActivityPodium`) | all three payloads literal; no handlers |
| `#podium` (`renderPodium`, the duplicate) | all three payloads literal; no handlers |
| `#usersList` (`renderUsersList`) | all three payloads literal; no handlers |
| all clickable cards | no element anywhere on the page has an inline `onclick` mentioning `navigateToUserInRecipients`; each card's `onclick` is `null`; `data-username` round-trips the **raw** payload; `cursor` is still `pointer` |
| hover | hovering every payload name in `#usersList` and `#podium` fires nothing |
| click | clicking `#usersList .user-card` and `#podium .podium-place` for the JS-string payload still lands on `/recipients.html` with `searchParams.get('osoba')` **exactly equal to the raw payload** |
| `profile_picture` | the `javascript:` URL renders **no** `<img>` and falls back to the emoji avatar; the legitimate `/images/default-avatar.svg` still renders, `alt` round-trips the attribute-breakout payload exactly, the img has no `onmouseover`, and the static `onerror` fallback is intact |
| `intro.html` podium | all three payloads literal; rejected picture falls back to `/images/default-avatar.svg` with the right `alt` |
| `intro.html` 4-10 list | the seeded `Zuzia & "Zuza" <mała> 'Z'` renders literally (the payload rows occupy the top three, so this list cannot be reached by a payload) |
| `/activity` `leaderboard_leader` | both leader names display literally, no `img/script/iframe/svg/object/embed` created, `&lt;img` present in `innerHTML`, no handler beyond the static `a[onclick]=event.stopPropagation` |
| `/osoby` | the delete button has **no** `onclick` and does have `data-delete-present`; `title="Usuń"` unchanged; the inline edit field `inputValue()` round-trips `Zestaw <script>alert(1)</script> & "mega" 'mini'` exactly |
| `/osoby` | clicking delete still confirms with the real title; the dialog is **dismissed**, nothing is deleted |

Every browser test checks three things, because any one alone can be satisfied by a broken fix:
no execution (`window.__xss === undefined`), no creation (the name element holds zero child
elements; no unexpected `on*` attribute anywhere in the card; no `javascript:` in `outerHTML`), and
**the name still displays character-for-character** (`textContent` equals the payload exactly). A
fix that stripped names would fail.

Page errors are caught automatically by `tests/fixtures.js:60-71`; `ignorePageErrors` is not used.

### 8.4 Demo fixtures added

`server.js`, three rows at the **front** of `demoLeaderboard.users` (new ids 9/10/11, no existing id
renumbered, `cumulativeStats` untouched):

```js
{ id:  9, username: 'Ola <img src=x onerror=window.__xss=1> Z', profile_picture: 'javascript:window.__xss=1',  total_presents: 115, user_bought_count: 200, user_reserved_count: 0 }
{ id: 10, username: 'Ala" onmouseover=window.__xss=1 x="',      profile_picture: '/images/default-avatar.svg', total_presents: 114, user_bought_count: 180, user_reserved_count: 0 }
{ id: 11, username: "O'Brien'); window.__xss=1; //",            profile_picture: null,                        total_presents: 113, user_bought_count: 160, user_reserved_count: 0 }
```

Front placement is required because `renderPodium` uses `users.slice(0, 3)` in **array order** while
`renderActivityPodium`/`renderActivityLeaderboard` sort by activity; the highest counts in both
orderings put one payload on all four render paths plus both intro lists.

Exactly three rows, which is a hard constraint: `renderActivityLeaderboard` slices to the top 10 by
activity, and 8 + 3 = 11 drops exactly `Oliwia Bezaktywności` (activity 0), which the renderer's own
`totalActivity === 0` filter already skips. A fourth row would drop `Piotr Jedyny` (activity 1) and
break `pluralization.spec.js:138` (`'0 zarezerwowanych'`) and `:152` (`'1 aktywność'`).

Row 10 was given a **legitimate** same-origin picture on purpose: it is the only way the `<img>`
branch — and therefore `alt=` attribute escaping — is exercised end to end in a browser rather than
only in the Node unit test.

`demoNotifications` row 118 (`leaderboard_leader`) now carries the element payload as `leaderName`
and the attribute payload as `previousLeaderName`, so the `/activity` custom renderer is tested
against a real payload. `pluralization.spec.js:83` asserts only `notification-text.js`'s *default*
wording for that type, which is unaffected.

### 8.5 The spec is proven to detect the bug (pre-fix run)

No `git stash` and no whole-tree git command was used — the tree holds ~18 files of another
workflow's uncommitted work. Instead:

1. `git diff HEAD -U0` was read for all four page files first. `intro.html`'s diff is 100% mine;
   `leaderboard.html`, `activity.html` and `osoby.html` each contain exactly two foreign lines, both
   cache-busters (`bottom-tab-bar.css?v=41→42`, `tab-bar-functions.js?v=17→18`). Nothing else
   foreign.
2. The fixed files were copied to `%TEMP%\xss-fixed\` (byte-exact `Copy-Item`).
3. The pre-fix versions were written back with `cmd /c "git show HEAD:<path> > <path>"` — **cmd**
   redirection, because `git show … | Set-Content -Encoding UTF8` under PowerShell 5.1 adds a BOM
   *and* re-decodes git's bytes through the console codepage, which corrupted the Polish string
   literals and produced a first, invalid pre-fix run (`ReferenceError: showLeaderboard is not
   defined`). That run was discarded.
4. The item-8.4 fixtures and the new spec stayed in place.
5. Afterwards the fixed files were restored from the `%TEMP%` copies and verified by
   `Get-FileHash` (all four `match=True`) and by `git diff HEAD --stat` returning the identical
   `11 / 34 / 75 / 25` line counts it showed before the swap.

Pre-fix result: **13 failed, 3 passed (4.3m)** — the 3 passes are the Node-only unit tests of the
new module, which the swap does not touch. The failures name the vulnerability directly:

```
5) no clickable card carries an inline onclick, and the raw name survives in data-username
   Error: navigateToUserInRecipients must not be an inline handler any more
   + Array [
   +   "<div class=\"podium-place first\" onclick=\"navigateToUserInRecipients('Ola &lt;img src=x onerror=window.__xss=1&gt; Z')\" style=\"cursor: pointer;\">
   +   "<div class=\"podium-place second\" onclick=\"navigateToUserInRecipients('Ala\" onmouseover=\"window.__xss=1\" x=\"')\" style=\"cursor: pointer;\">
   +   "<div class=\"podium-place third\" onclick=\"navigateToUserInRecipients('O'Brien'); window.__xss=1; //')\" style=\"cursor: pointer;\">
   +   "<div class=\"user-card\" onclick=\"navigateToUserInRecipients('Ala\" onmouseover=\"window.__xss=1\" x=\"')\" ...
```

Note the second entry: `onmouseover="window.__xss=1"` and `x=""` are rendered by the browser as
**real attributes** — the attribute was closed, exactly as the payload intended. And:

```
7) clicking a payload card still navigates to that person
   Error: Page threw 1 uncaught error(s):
   SyntaxError: missing ) after argument list
```

— the JS-string-in-attribute break, from a name whose only weapon is an apostrophe.

```
1) the activity list renders every payload as literal text
   Error: activity list: the payload row must be rendered
   Locator: locator('#activityList .activity-card').filter({ has: locator('.activity-name')
            .filter({ hasText: 'Ola <img src=x onerror=window.__xss=1> Z' }) })
   Error: element(s) not found
```

— the element-content sink: the name is not findable as literal text because the `<img>` really was
created and split the text node. Same failure for `#activityPodium`, `#podium`, `#usersList` and the
`intro.html` podium.

The `/activity` and `/osoby` cases were re-run in isolation
(`npm run test:e2e -- xss-usernames --grep "osoby|leaderboard-leader"`) because in the full pre-fix
run they hit `openPage` timeouts after eleven preceding failures had each burned 15-20s writing
traces. In isolation they fail on the real assertions — **3 failed**:

```
1) /activity renders both leader names as literal text
   Error: the new leader name must display literally
   expect(received).toContain(expected)

2) the delete button carries no title and the edit field round-trips it
   Error: the delete button must be driven by a data attribute
   Locator: ... .locator('[data-delete-present]')
   Error: element(s) not found
```

Post-fix, the same spec: **16 passed (1.1m)**, exit 0.

### 8.6 `node --check`

Every JS file added or edited:

```
public/escape-html.js             -> exit=0
public/filters.js                 -> exit=0
public/recipients.js              -> exit=0
server.js                         -> exit=0
tests/e2e/xss-usernames.spec.js   -> exit=0
tests/e2e/escaping.spec.js        -> exit=0
```

HTML files cannot be `node --check`ed. Their inline scripts are covered because
`tests/fixtures.js` fails any test whose page throws an uncaught error — which is exactly how a
real syntax error I introduced in `osoby.html` (an HTML comment containing backticks, inside a
template literal) was caught on the first spec run: `SyntaxError: Unexpected identifier 'presents'`.
It is fixed; the comment was moved above the function.

### 8.7 Full suite

Superseded by §11 — the scope widened mid-task (the composer workflow finished and released
`tab-bar-functions.js`, `formularz.*`), the suite grew to 131 tests, and the final numbers are in
§11.4. Sections 1-8.6 describe the first wave and remain accurate except where §11 says otherwise
(notably: §6 "left alone" rows for `tab-bar-functions.js` and `formularz.js:1233`, and §9 items 1-2,
are now FIXED).

---

## 9. Known gaps after this change — the vulnerability is NOT fully closed

1. **[FIXED in §11 — kept for history]** **`public/tab-bar-functions.js:224, 227`** —
   `data.leaderName` / `data.previousLeaderName` / `data.label` went raw into `innerHTML` in the dock
   notifications panel, on **every page that has the dock**. `leaderName` is `recipients.name` (`server.js:282`), the same attacker-controlled
   value this task closed everywhere else. Forbidden file, not edited. **Highest-priority
   follow-up.** It is also now the *only* live `leaderboard_leader` renderer on `/recipients`
   (§2). Recorded in `tests/README.md`'s known-bugs table; not asserted, because reaching it
   requires opening the panel and `markAllNotificationsAsReadOnOpen` would mutate shared demo state
   under `workers: 1`.
2. **[FIXED in §11]** **`public/formularz.js:1233`** — `title="${escapeHtml(cleanUrl)}"` with the
   quote-unsafe helper.
3. **`public/sw.js` needs two edits I did not make** (still forbidden):
   `'/escape-html.js'` added to `urlsToCache`, and `CACHE_NAME` bumped (the orchestrator says it is
   now `'prezenty-v122'`; see §11.6 — `escape-html.js` is now needed by SIX pages, not four).
   Not a blocker: the `fetch` handler is cache-first for non-HTML resources and a never-cached file
   has no stale entry, so the first request goes to the network; HTML is network-first
   (`sw.js:44-70`), so the fixed pages reach users on their next load.
4. **No `?v=` cache-buster needs bumping by me.** The four edited HTML pages are served
   network-first by the service worker, and `escape-html.js` is a brand-new URL. I deliberately did
   **not** touch any `?v=` value in `leaderboard.html` or `activity.html` — those belong to the
   concurrent composer workflow.
5. **No CSP**, and inline event handlers remain throughout the app, so output escaping is the only
   layer of defence (§7).
6. **No input validation** on recipient names beyond an empty check, by design (§7).
7. **Keyboard access** to the leaderboard podium / ranking cards is unchanged — still mouse-only
   (§4). Candidate follow-up, not a regression.
8. **One browser engine.** The suite is Edge/Chromium only, so the fix is not verified on WebKit or
   Firefox.

---

## 10. Files changed

```
new:  public/escape-html.js
new:  tests/e2e/xss-usernames.spec.js
mod:  public/leaderboard.html
mod:  public/intro.html
mod:  public/activity.html
mod:  public/recipients.html
mod:  public/osoby.html
mod:  public/home.html
mod:  public/recipients.js
mod:  public/filters.js
mod:  server.js            (demo fixtures only, inside DEMO_MODE data)
mod:  tests/e2e/escaping.spec.js
mod:  tests/README.md
new:  .agents/tasks/xss-fix-verification.md
```

None of the forbidden files were opened for writing: `public/formularz.html`, `public/formularz.js`,
`public/tab-bar-functions.js`, `public/bottom-tab-bar.css`, `public/bottom-tab-bar-snippet.html`,
`public/app-theme.css`, `public/sw.js`. No `?v=` value was changed anywhere. Nothing is committed.


---

## 11. Second wave: scope lifted by the orchestrator (composer workflow finished)

`public/tab-bar-functions.js`, `public/formularz.html` and `public/formularz.js` were released.
`public/sw.js` stays forbidden and was not touched by me.

### 11.1 The dock notifications panel — the gap §9 flagged is closed

`public/tab-bar-functions.js` (`getNotificationMessage`, ~lines 226-234). It already had a local
`escapeHtmlNotif` (line ~245, the `textContent` idiom, used for `data.preview`). Per the
orchestrator's instruction it is **reused**, not replaced with a dependency on `escape-html.js`:
`tab-bar-functions.js` runs on 8 pages and a missing script tag on any one would break the dock.
`tab-bar-functions.js` therefore has **no new load-order dependency**.

| Line | Was | Now |
|---|---|---|
| ~231 | `<strong>${data.leaderName}</strong>` / `<strong>${data.previousLeaderName}</strong>` | wrapped in `escapeHtmlNotif(...)` |
| ~234 | `<strong>${data.label}</strong>` | `escapeHtmlNotif(data.label ...)` |

### 11.2 A sink worse than the ones in the brief: `encodeURIComponent` does not escape `'`

`tab-bar-functions.js` (line ~226) and `activity.html` (line ~481) build

```html
<a href="#" onclick="scrollToPresentFromNotification(8, '${encodeURIComponent(recipientName)}'); return false;">
```

A code comment there claimed `encodeURIComponent` is "safe for inline onclick attributes regardless
of quotes in names". It is not: `encodeURIComponent` leaves `' ( ) ! * ~ - _ .` untouched (verified:
`encodeURIComponent("'-alert(1)-'")` returns `'-alert(1)-'`). A recipient named `'-alert(1)-'` yields
`scrollToPresentFromNotification(8, ''-alert(1)-'')`, valid JS that runs on click. No `<`, `>`, `"`,
`=` or `;` needed (those encode to `%3C` etc. and just produce a syntax error — I found that out
the hard way when my first test payload used `=`). `recipients.name` is attacker-controlled.

Fix, both places: `.replace(/'/g, '%27')`. The value then contains only
`[A-Za-z0-9 - _ . ! ~ * ( ) %]` and cannot end the string; `decodeURIComponent` in
`scrollToPresentFromNotification` restores the name, so behaviour is identical for every benign name.

### 11.3 More inline-handler sinks the plan's sweep missed (`'${escapeHtml(...)}'` inside `onclick`)

The plan's §5.5 grepped `="${escapeHtml(` (helper inside an attribute) and so missed the helper
inside a **JS string** inside an attribute. `escapeHtml` on those pages is the `textContent` idiom
(escapes `& < >`, not quotes), and entity-escaping cannot protect a JS string in any case. All of
these accepted a stored name containing an apostrophe:

| File:line | Handler | Value |
|---|---|---|
| `recipients.js:1189, 1237` | `identifyAsRecipient(id, 'NAME')` | `recipients.name` |
| `recipients.js:1193, 1243` | `cancelIdentification(id, 'NAME')` | `recipients.name` |
| `recipients.js:1217, 1249` | `shareFormularzLink('NAME')` | `recipients.name` |
| `recipients.js:1443, 1448` | `identifyAsRecipientFromSelection(id, 'NAME')` | `recipients.name` |
| `recipients.js:1451` | `deleteRecipientFromSelection(id, 'NAME')` | `recipients.name` |
| `recipients.js:2174` | `showReservedByOtherModal('NAME')` | **`users.username`** — registration |
| `recipients.js:4112` | same, via `setAttribute('onclick', ...)` | `users.username` |
| `formularz.js:1202` | `openEditPresentModal(id, 'TITLE', 'COMMENTS', rid)` | present title/comment |
| `osoby.html:222` | `deletePerson(id, 'NAME')` (used `.replace(/'/g, "\\'")`, which a trailing backslash defeats) | `recipients.name` |

`recipients.js:2174` is notable: `reserved_by_username` is `users.username`, i.e. it **is** the
registration path the brief originally described.

**Fix: one new shared helper, `PrezentyEscape.jsStringAttr(value)`** in `public/escape-html.js`:
`escapeAttr(JSON.stringify(String(value)))`. `JSON.stringify` makes a complete JS string literal
(it escapes `"`, `\` and control characters) *before* the HTML-attribute escaping, so after the HTML
parser decodes the attribute, JS sees exactly that literal and nothing in the value can leave it.
Call sites become `onclick="f(${id}, ${PrezentyEscape.jsStringAttr(escapeHtml(name))})"` — **no
surrounding quotes**. For the one `setAttribute('onclick', ...)` site (no HTML-parsing step) plain
`JSON.stringify` is used instead.

Deliberate: the inner `escapeHtml(name)` is **kept**, so each handler receives the same string it
always did (the handlers pass it to `showSuccessMessage` etc.). This changes only the quoting layer,
not what any handler sees for a benign name. (It does leave the pre-existing cosmetic quirk that a
name containing `&` shows as `&amp;` in a `confirm()`; out of scope, noted.)

`recipients.js:2176` `title="Zarezerwowane przez: ${escapeHtml(...)}"` → `escapeAttr`.

`escape-html.js` is now loaded on **six** pages: `leaderboard.html`, `intro.html`, `osoby.html`,
`home.html` (it also loads `recipients.js`), and newly `recipients.html` (after
`notification-text.js`) and `formularz.html` (after `pluralize-pl.js`).

### 11.4 `formularz.js:1233` (now 1258)

`title="${escapeHtml(cleanUrl)}"` and `href="${cleanUrl}"` → `escapeAttr(cleanUrl)` (the file's
existing helper). Defence in depth only: `cleanUrl` already passed a regex that excludes quotes.

### 11.5 Tests added (7 new; spec file now has 23 tests)

- `jsStringAttr` unit test: for every payload, plus `\`, newline, U+2028 and Polish text, the
  attribute text contains no raw quote and decodes + evaluates back to the original string.
- `jsStringAttr` in a **real HTML parser** (Edge): each value is placed in `<button onclick="...">`
  via `innerHTML`, clicked, and must reach the handler exactly as typed, with `window.__xss` unset.
- **dock panel × 2 pages (`/leaderboard.html`, `/recipients`)**, two tests each: (a) leader names
  and `anon_message` label render as literal text, no element created, no unexpected handler;
  (b) an apostrophe-only recipient name cannot break out of the present link's `onclick`.
  The renderer is driven directly (`displayNotifications`) because opening the real panel marks
  everything read on the shared demo server (`workers: 1`).
- `/recipients` inline handlers: `page.route` adds two hostile recipients to
  `/api/recipients-with-presents` (no mutation of shared demo state), the real handlers are
  replaced by recorders, every `identify/cancel/share/...` button is clicked, and each hostile name
  must arrive at its handler intact with `window.__xss` unset.

### 11.6 Pre-fix proof for the second wave (targeted, byte-exact, no stash)

Each fix was reverted in place, the tests run, and the fixed file restored and **hash-verified**:

- `tab-bar-functions.js` (all three edits reverted): **4 failed** — `leaderboard dock row 0 created
  elements` (Expected 0, Received 1) and `the apostrophe name broke out of the onclick string and
  ran`, on both pages. Post-fix: 4 passed.
- `recipients.js` handlers reverted: **1 failed** — `Error: no handler received the name
  "O'Brien'); window.__xss=1; //" intact` plus six uncaught `SyntaxError: Failed to execute
  'dispatchEvent' ... Invalid or unexpected token / missing ) after argument list` (the string
  breaking apart). The pure-helper test correctly still passes. Post-fix: passes.

One process note: an earlier attempt at this proof silently tested the wrong thing because a backup
`Copy-Item` and the `str_replace` ran in parallel and the backup missed an edit. I caught it because
the test reported the *pre*-fix symptom against supposedly fixed code, re-applied the edit, took the
backup sequentially, and re-ran. The numbers above are from the corrected run.

### 11.7 Full suite

Current tree, nothing else running (checked `otherNode=0` before each run):

```
Run A  18:39-18:46  131 tests  119 passed, 1 failed, 11 skipped   (7.0m)
         the 1 failure: no-horizontal-overflow › home — "page.goto: net::ERR_ABORTED"
Run B  18:48-18:56  131 tests  120 passed, 0 failed, 11 skipped   EXIT=0  (7.8m)
```

The Run A failure is the harness's known `home.html` one-shot self-reload (`reloadsOnce` in
`tests/helpers/pages.js`) aborting `goto`; that test passed 3/3 under `--repeat-each=3` and in Run B.
It is not related to this change (no layout or navigation logic was touched in `home.html`).

**Baseline caveat, stated plainly.** The orchestrator asked for the pre-change baseline to be
re-captured from the current tree. I could not do that honestly: by the time the composer workflow
finished, I had already edited the shared files, and reverting them byte-for-byte to "current tree
minus my changes" is not possible without `git stash` (forbidden: it would destroy other work). What
I do have: (1) the original baseline, **77 passed / 0 failed / 23 skipped / 100 tests**, captured
before any edit and before `composer.spec.js` existed; (2) per-file pre-fix runs of the new specs
against the original code (§8.5, §11.6); (3) the final suite of 131 tests, **0 failed** (the growth from 100 is the 20 composer tests, my 23
tests in `xss-usernames.spec.js`, minus the deleted guard test and whatever the composer workflow
changed in its own placeholder spec — I did not count that independently). The skip count dropped from 23 to 11 because the
composer workflow replaced its placeholder `fixme`s with real tests and `escaping.spec.js` lost its
one. Two full runs on the contended machine (other workflows were also running the suite and
overwriting the shared `tests/.auth/demo.json`) produced spurious mass failures and were discarded;
the two runs above are the uncontended ones.

### 11.8 Cache-busters changed

| File | Was | Now | Reason |
|---|---|---|---|
| `tab-bar-functions.js` (8 pages: activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci) | `?v=18` | `?v=19` | edited; verified by grep, all 8 tags re-read intact |
| `recipients.js` (`home.html`, `recipients.html`) | `?v=24&t=1111111111` | `?v=25&t=1111111111` | edited |
| `filters.js` (`recipients.html`) | `?v=8` | `?v=9` | edited (`escapeAttr`, `data-name`) |
| `formularz.js` (`formularz.html`) | `?v=21` | `?v=22` | edited |

`escape-html.js` is a new URL and needs no buster.

### 11.9 For the service-worker edit (`sw.js`, yours)

- Add **`'/escape-html.js'`** to `urlsToCache` and bump `CACHE_NAME`. It is now required by six
  pages. Until it is in the cache, a first offline load of those pages would fail closed (the
  render functions throw on `PrezentyEscape`) — online it is fetched normally.
- No other new asset was added.

### 11.10 Remaining open items

1. `bottom-tab-bar-snippet.html:199` `${notif.message}` — documentation snippet only, never loaded
   at runtime (referenced by `tab-bar-demo.html:95` as copy-paste text). Left.
2. `activity.html:483` still interpolates `${data.presentId}` raw into the same `onclick`. It is a
   server-written numeric id; `tab-bar-functions.js` wraps the equivalent in `Number()`. Not
   attacker-reachable today, but worth a `Number()` for parity in a later pass.
3. `recipients.html`'s own `renderNotification` / `loadRecentNotifications` are dead code (the
   dock's version of `loadRecentNotifications` overwrites it, and its target element does not
   exist). The escaping there is belt and braces; deleting the dead code is a separate task.
4. Handlers like `deletePerson` / `identifyAsRecipient` receive the `escapeHtml`'d name, so a name
   with `&` shows `&amp;` in a `confirm()`. Pre-existing cosmetic bug, unchanged.
5. §7 recommendations (length cap + control-char stripping on name writes; CSP) and §9 items 5-8
   stand unchanged.
6. Not run/verifiable here: WebKit/Firefox; a real MySQL-backed instance (the suite is DEMO mode).
