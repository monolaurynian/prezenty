# Stored XSS via user-controlled names — implementation plan

Branch: `main`, work directly in the repo (no worktree). The app is **live on Render** and
publicly registerable, so every item below is remediation of an exploitable bug, not hardening.

Everything in this plan is grounded in code I read. Line numbers are as of the working tree at
planning time; the tree is **dirty from other workflows**, so **re-read every file immediately
before editing it** and use targeted `str_replace` edits only.

---

## 0. Forbidden files — never edit these

Another workflow owns the add-present composer and is editing it right now. Do **not** open these
for writing under any circumstance:

- `public/formularz.html`
- `public/formularz.js`
- `public/tab-bar-functions.js`
- `public/bottom-tab-bar.css`
- `public/bottom-tab-bar-snippet.html`
- `public/app-theme.css`
- `public/sw.js`

`public/leaderboard.html` is in scope, **but** that workflow may make a one-line cache-bust edit
near **line 1509** (`<script src="tab-bar-functions.js?v=18">`; it was already bumped from `?v=17`
when I read it). Stay off that line entirely. Never touch `?v=` values in that file.

Additional repo-wide prohibitions for this task:

- **No whole-tree git operations.** `git stash`, `git checkout -- .`, `git reset --hard`,
  `git clean` would destroy the other workflow's uncommitted work. The tree currently has ~18
  modified files that are not yours. Item 8 gives a stash-free way to prove the new test fails.
- **Stage files by name** when committing. Never `git add -A` / `git add .`.
- This repo lives in a OneDrive folder. File reads occasionally fail with a cloud timeout or
  `UNKNOWN` error — wait a few seconds and retry rather than concluding the file is missing.

---

## 1. The vulnerability, and an important correction to its description

`GET /api/leaderboard` (`server.js:2514-2568`) returns `r.name AS username` — the column is
`recipients.name`, **not** `users.username`. So the attacker-controlled value rendered by the
leaderboard is a **recipient name**, written by:

- `POST /api/recipients` (`server.js:3692`) — any authenticated user, validation is
  `!name || name.trim() === ''` and nothing else;
- `POST /api/user/identify` (`server.js:3691+`) — same, empty-check only.

This matters for two reasons. It makes the vulnerability *easier* to reach than registration
(no new account needed), and it means **tightening `/api/register` would not close this path at
all** (see §5.4).

`profile_picture` is server-generated in production
(`CONCAT('/api/recipients/', r.id, '/profile-picture')` or `NULL`, `server.js:2529-2533`), so a
strict same-origin allowlist is safe (§5.3).

### 1.1 Confirmed sinks — `public/leaderboard.html`

No escape helper of any kind is defined in this file today. It loads `pluralize-pl.js` and
`notification-text.js` (lines 923-924) and `notification-text.js` does **not** put `escapeHtml`
on the browser global — it only assigns `root.notificationText` (line 106) and exports
`escapeHtml` through `module.exports` (line 108), which the browser never sees.

The podium block genuinely exists **twice**: `renderActivityPodium` (≈1240-1292) and
`renderPodium` (≈1294-1334) are near-identical. **Fix every copy.**

| # | Line | Sink | Context | Severity |
|---|---|---|---|---|
| L1 | 1200 | `<img src="${user.profile_picture}" alt="${user.username}" class="activity-avatar-img">` | attribute × 2 (untrusted URL in `src`) | high |
| L2 | 1210 | `<div class="activity-name">${user.username}</div>` | element content | high |
| L3 | 1254-1255 | activity-podium avatar `src="${user.profile_picture}"` / `alt="${user.username}"` | attribute × 2 | high |
| L4 | 1266 | `<div class="podium-place ..." onclick="navigateToUserInRecipients('${user.username}')">` | **JS string inside an HTML attribute** | **critical** |
| L5 | 1272 | `<div class="podium-name">${user.username}</div>` | element content | high |
| L6 | 1302-1303 | podium avatar `src` / `alt` (second copy) | attribute × 2 | high |
| L7 | 1314 | `<div class="podium-place ..." onclick="navigateToUserInRecipients('${user.username}')">` (second copy) | **JS string in attribute** | **critical** |
| L8 | 1320 | `<div class="podium-name">${user.username}</div>` (second copy) | element content | high |
| L9 | 1339-1340 | users-list avatar `src` / `alt` | attribute × 2 | high |
| L10 | 1351 | `<div class="user-card" onclick="navigateToUserInRecipients('${user.username}')">` | **JS string in attribute** | **critical** |
| L11 | 1355 | `<div class="user-name">${user.username}</div>` | element content | high |

L4 / L7 / L10 are the worst: the name lands inside a single-quoted JS string inside a
double-quoted HTML attribute. A name containing a bare apostrophe breaks straight into executable
JS **with no angle brackets at all**. HTML-escaping does not make this safe — see §5.2.

Safe in the same file, leave alone: `getEmojiAvatar(user.username)` (lines 1201, 1259, 1262, 1307,
1310, 1344, 1347) returns a character from a hard-coded emoji array; the name is only summed into
an index.

Note the live demo fixture `Zuzia & "Zuza" <mała> 'Z'` (`server.js:4035`) **already** produces
malformed markup on this page today — the `"` closes the `onclick` attribute early. The breakage
is not hypothetical.

### 1.2 Confirmed sinks — `public/intro.html`

Served by `express.static('public', …)` (`server.js:430`), so `/intro.html` is publicly reachable
even though nothing links to it. It loads `pluralize-pl.js` only (line 360) and defines no escape
helper.

| # | Line | Sink | Context |
|---|---|---|---|
| I1 | 604-605 | `<img src="${user.profile_picture || '/images/default-avatar.svg'}" alt="${user.username}" …>` | attribute × 2 |
| I2 | 608 | `<div class="podium-name">${user.username}</div>` | element content |
| I3 | 624-625 | `<img src="${…profile_picture…}" alt="${user.username}" …>` | attribute × 2 |
| I4 | 629 | `<div class="user-name">${user.username}</div>` | element content |

No inline `onclick` carries a name here. The `onerror="this.src='/images/default-avatar.svg'"`
handlers are static literals — **preserve them verbatim**.

### 1.3 `public/osoby.html` — assessed as instructed

- **Line 287**, `flags.push(\`dodany przez: ${p.creator_username}\`)` — **not a sink.** `flags` is
  rendered at line 294 as `${escapeHtml(flags.join(' · '))}` in element content. Correctly escaped.
  Leave alone.
- **Lines 306 and 390**, `p.title` / `title` interpolated into `confirm(...)` — **not XSS.**
  `confirm()` renders text, never markup. **UI-spoofing judgement:** a title like
  `X"? Kliknij OK, aby anulować` can make the dialog read misleadingly, so a user could be talked
  into confirming. Impact is bounded and self-inflicted: the dialog only ever appears on the
  user's own `/osoby` page, the delete target is bound by **numeric id** (not by the label), and
  the worst outcome is deleting a present the user could delete anyway. **Recommendation: leave
  as-is.** Item 10 removes the title from the *markup* for a different reason (attribute
  breakout); it deliberately does not change the `confirm()` wording.
- **Line 338** — `onclick="deletePresent(${p.id}, '${escapeHtml(p.title).replace(/'/g, "\\'")}')"`
  — **a real sink I found, not in the brief.** `escapeHtml` here (line 158) is the
  `textContent → innerHTML` idiom, which escapes `& < >` but **not quotes**. A title containing
  `"` closes the `onclick` attribute and lets an attacker add arbitrary attributes. Fixed in
  item 10.
- **Line 353** — `value="${escapeHtml(p.title)}"` — same quote-unsafe helper in an attribute.
  Fixed in item 10.

---

## 2. Decision: one shared escaping module (`public/escape-html.js`) — new file

**Chosen:** add `public/escape-html.js`, a dual browser/Node module following the exact IIFE
pattern of `public/notification-text.js` and `public/pluralize-pl.js`, exposing a **namespaced**
global `window.PrezentyEscape` with three functions. Every page fixed by this plan loads it and
calls it namespaced.

**Why not reuse `public/notification-text.js`** (the other option offered):

1. It does not expose `escapeHtml` to the browser at all (line 106 assigns only
   `root.notificationText`), so it needs a change either way.
2. Nine files define a competing top-level `function escapeHtml` — `filters.js:682`,
   `formularz.js:1408`, `recipients.js:2422`, `archiwum.html:173`, `home.html:691`,
   `osoby.html:158`, `rezerwacje.html:147`, `ustawienia.html:357`, `wiadomosci.html:383` — and all
   of them are the quote-unsafe `textContent` idiom. A function declaration in a later page script
   **silently overwrites** a flat `window.escapeHtml`, which would downgrade attribute escaping
   with no visible symptom. A namespaced object cannot be shadowed by a function declaration, so
   the fix is load-order independent. This is the deciding argument.
3. `notification-text.js` is about notification *wording*. `safeImageSrc` (§5.3) does not belong
   there.

**Why a hard dependency is acceptable:** `pluralize-pl.js` is already a hard, unguarded dependency
of `leaderboard.html` and `intro.html` (`plCount` is called straight from the render templates).
A same-origin blocking `<script>` in `<head>` is the established house pattern, and if it ever
fails to load these pages fail **closed** (render nothing) rather than open.

**Service worker (report only — do NOT edit `public/sw.js`):** `sw.js` precaches a fixed
`urlsToCache` list (lines 2-14) which already contains `/notification-text.js` and
`/pluralize-pl.js`. The new file should be added as `'/escape-html.js'` and `CACHE_NAME`
(currently `'prezenty-v121'`) bumped. **Report this in your completion message; do not make the
edit.** It is not a blocker: the `fetch` handler is cache-first for non-HTML resources, and a file
that has never been cached has no stale entry, so the first request goes to the network. HTML is
network-first (sw.js:44-70), so the fixed pages reach users on their next load with no cache-bust
query needed.

### Module contract

```js
// public/escape-html.js
(function (root) {
    // Text AND quoted-attribute safe. Same five replacements as
    // notification-text.js:27-34, which is the one correct implementation
    // already in this repo.
    function escapeHtml(text) { /* & < > " '  ->  entities */ }

    // Explicit alias for attribute contexts. Identical output; the separate
    // name documents intent at the call site and mirrors the
    // escapeHtml/escapeAttr pair in formularz.js and recipients.js.
    function escapeAttr(text) { return escapeHtml(text); }

    // Untrusted image URL -> a safe, already-attribute-escaped URL, or ''.
    // Allowlist only (see 5.3).
    function safeImageSrc(url) { /* ... */ }

    root.PrezentyEscape = { escapeHtml, escapeAttr, safeImageSrc };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { escapeHtml, escapeAttr, safeImageSrc };
    }
})(typeof window !== 'undefined' ? window : globalThis);
```

Do **not** assign a flat `window.escapeHtml` — that is exactly the collision described above.
Do **not** delete or rewrite the nine existing per-page `escapeHtml` helpers; that would widen the
diff into files other workflows are touching. This plan only stops using them where they are
wrong (attribute contexts).

---

## 3. Decision: remove the inline `onclick`, use `data-username` + one delegated listener

For L4 / L7 / L10, **do not escape into the handler.** Replace

```html
<div class="podium-place ${positions[index]}" onclick="navigateToUserInRecipients('${user.username}')" style="cursor: pointer;">
```

with

```html
<div class="podium-place ${positions[index]}" data-username="${PrezentyEscape.escapeAttr(user.username)}" style="cursor: pointer;">
```

and add **one** document-level delegated listener, registered once next to
`navigateToUserInRecipients` (`leaderboard.html:1371`):

```js
document.addEventListener('click', function (e) {
    const target = e.target.closest && e.target.closest('[data-username]');
    if (!target) return;
    navigateToUserInRecipients(target.dataset.username);
});
```

`dataset` returns the **decoded** value, so `navigateToUserInRecipients` receives the original
name and its existing `encodeURIComponent` call (line 1373) keeps working unchanged. Keep that
function as-is and keep it global.

Behaviour parity requirements:

- Add `data-username` **only** to the three elements that have an `onclick` today: the two
  `.podium-place` blocks (1266, 1314) and the `#usersList` `.user-card` (1351). The
  `#activityList` `.user-card.activity-card` (line 1203) has **no** click handler today — do not
  give it one. Note that `.user-card` is shared by both lists, which is precisely why the selector
  must be `[data-username]` and not `.user-card`.
- Keep the inline `style="cursor: pointer;"` exactly as-is on all three.
- **Keyboard:** these are `<div>`s with no `tabindex` and no `role`, so they are mouse-only today.
  Leave them mouse-only. Do **not** add `tabindex`/`role` — that would create focusable controls
  needing accessible names and would newly interact with `a11y.spec.js` ("no positive tabindex",
  "nothing rendered is both `aria-hidden` and focusable"). No regression, no improvement; recorded
  here as a known gap and a candidate follow-up.
- Do not touch the unrelated `.sidebar-item` click listener (lines 1107-1118).

---

## 4. Decision: `profile_picture` is untrusted — allowlist, then escape

Treat it as attacker-controlled (today it is server-generated, but the page must not depend on
that). Add `safeImageSrc(url)` to the shared module:

- Accept a **same-origin absolute path**: starts with `/` but **not** `//` (which is
  protocol-relative and off-origin).
- Accept `https://…`.
- Reject everything else — in particular `javascript:`, `data:`, `vbscript:`, `//evil.example`,
  and anything containing a control character or whitespace.
- Return the accepted URL **already escaped for a quoted attribute**; return `''` on rejection.

`data:` is deliberately **not** allowed: nothing in the codebase emits a data URL for a profile
picture (`server.js:2529-2533` emits only `/api/recipients/<id>/profile-picture` or `NULL`), so
allowing it would widen the surface for no feature.

**Call-site shape — branch on the sanitised value, not the raw one.** In each of the four render
functions, compute once at the top of the map callback:

```js
const pic = PrezentyEscape.safeImageSrc(user.profile_picture);
const name = PrezentyEscape.escapeHtml(user.username);
const avatarHTML = pic ? `<img src="${pic}" alt="${name}" …>` : `<div class="…-avatar-emoji" …>`;
```

A rejected URL therefore falls through to the existing emoji-avatar branch on **every** path
instead of rendering a broken image. This matters for L1 (line 1200), which is the one avatar that
has **no** `onerror` fallback at all.

**Preserve the existing `onerror` handlers verbatim** — `leaderboard.html` 1257, 1305, 1342
(`this.style.display='none'; this.nextElementSibling.style.display='flex';`) and `intro.html` 607,
627 (`this.src='/images/default-avatar.svg'`). They are static literals; do not rewrite or
"modernise" them.

For `intro.html`, keep the default-avatar fallback semantics:
`const pic = PrezentyEscape.safeImageSrc(user.profile_picture) || '/images/default-avatar.svg';`

---

## 5. Decisions summary (the five the brief asked for)

### 5.1 Shared escape approach
New `public/escape-html.js`, namespaced as `window.PrezentyEscape`, dual browser/Node. One
implementation, loaded on every page this plan fixes. Reasoning in §2. New file must be reported
for `sw.js urlsToCache` + `CACHE_NAME` bump — **report only, do not edit `sw.js`**.

### 5.2 Inline `onclick`
Removed entirely; replaced by `data-username` + a single delegated `document` click listener.
Reasoning and behaviour-parity rules in §3. Escaping into a JS-string-in-attribute is **not**
an acceptable alternative: HTML-entity escaping is undone by the HTML parser *before* the JS
parser sees the attribute value, so `&#39;` still arrives at the JS parser as `'`.

### 5.3 `profile_picture`
Untrusted. Scheme/shape allowlist (`/path` or `https:`), escaped for the attribute, rejection
falls back to the emoji avatar. `data:` not allowed. Existing `onerror` handlers preserved.
Details in §4.

### 5.4 Registration / name validation in `server.js` — **recommend, do not implement**

I am not confident a character denylist is safe here, so per the brief I am recommending it and
not planning it:

- **It would not fix this bug.** The value on the leaderboard is `recipients.name` from
  `POST /api/recipients` and `POST /api/user/identify`, not `users.username` from
  `/api/register` (§1). Validating only registration would give false assurance.
- **It would reject legitimate Polish names.** Apostrophes and `&` occur in real names
  (`Anna O'Brien`, `Zuzia & Marek`). The repo's own demo fixture
  `Zuzia & "Zuza" <mała> 'Z'` (`server.js:4035`) is exactly such a value and the e2e suite depends
  on it — a denylist would make the test fixtures unrepresentable.
- **Existing rows already contain these characters**, so any rule must be create/update-only and
  cannot be retrofitted without a data audit. That is a separate, reviewed change.
- **Output escaping is the fix** and, once items 4-6 and 9-11 land, it is complete for every page
  in scope.

What I would recommend as a *separate* task, in priority order:
1. A **length cap** (e.g. 100 chars) plus stripping of NUL and C0 control characters on
   `POST /api/recipients`, `POST /api/user/identify` and `POST /api/register`. This is input
   hygiene, not a security control, and is safe because it only affects new writes.
2. A **Content-Security-Policy** header. Currently infeasible without a large refactor: the app
   uses inline `<script>` blocks and inline `on*` attributes on essentially every page, so a
   meaningful CSP would need `unsafe-inline`, which defeats the purpose. Worth a dedicated task.

### 5.5 Other interpolations reaching `innerHTML` — full `public/` sweep

I grepped `public/**` for template interpolation of name/title-like fields and for the
quote-unsafe-helper-in-attribute pattern (`="${escapeHtml(…)}"`). Everything found, with a
decision:

**Fix in this task (same bug class, non-forbidden files):**

| File:line | Sink | Why |
|---|---|---|
| `activity.html:528` | `<strong>${data.leaderName}</strong>` and `${data.previousLeaderName}` raw into `innerHTML` | `leaderName` is `recipients.name` (`server.js:282`, `285`) — attacker-controlled. Live page, in the e2e page list. Item 9. |
| `activity.html:534` | `<strong>${data.label}</strong>` | legacy `anon_message` path (no creation site remains; production queries exclude the type, `server.js:2399`), but one cheap escape. Item 9. |
| `recipients.html:1877` | same `leaderName` / `previousLeaderName` pattern, consumed by `innerHTML` at `recipients.html:1833` | Item 9. |
| `osoby.html:338` | `onclick="deletePresent(${p.id}, '${escapeHtml(p.title)…}')"` — quote-unsafe helper in an attribute | Item 10. |
| `osoby.html:353` | `value="${escapeHtml(p.title)}"` | Item 10. |
| `home.html:576, 640, 800` | `alt="${escapeHtml(recipient.name)}"` — quote-unsafe helper in an attribute | Item 11. |
| `filters.js:563` | `data-name="${escapeHtml(present.name)}"` | Item 11. |
| `recipients.js:422, 1136, 1138, 1144, 4290, 4292, 4298` | `data-present-*="${escapeHtml(…)}"` | Item 11. `recipients.js:2429` **already defines a correct `escapeAttr`** — this is a 7-site swap. |

**Found but deliberately NOT fixed:**

| File:line | Sink | Reason |
|---|---|---|
| `tab-bar-functions.js:224` | `${data.leaderName}` / `${data.previousLeaderName}` raw into `innerHTML` | **FORBIDDEN FILE.** This is a genuine, broad username sink: the dock notifications panel renders it on *every* page that has the dock. **The username XSS is not fully closed until this is fixed.** Raise it as an immediate follow-up security task. |
| `tab-bar-functions.js:227` | `${data.label}` raw into `innerHTML` | **FORBIDDEN FILE.** Legacy `anon_message` path. Same follow-up. |
| `formularz.js:1233` | `title="${escapeHtml(cleanUrl)}"` | **FORBIDDEN FILE.** Value already passed a URL regex. Follow-up. |
| `bottom-tab-bar-snippet.html:199` | `${notif.message}` | **FORBIDDEN FILE**, and it is documentation only — the single reference is `tab-bar-demo.html:95` telling a human to copy-paste it. Never loaded at runtime. Leave. |
| `recipients.html:2323` | `${data.leaderName}` in the *second* `notificationConfig` | Every sibling entry in that block passes `html: false` (plain-text wording), so this is the text-rendering config; escaping it would put `&amp;` into visible text. Item 9 tells you how to confirm which config the `innerHTML` call at line 1833 actually resolves to, and to fix that one. |
| `activity.html:579, 590` | `${error.message}` | `Error` objects from `fetch`/JSON parsing, not attacker-authored markup. Leave. |
| `activity.html:460-465` (`linkifyEscaped`) | `href="${clean}"` | Input is already entity-escaped and the regex only matches `https?://` tokens with no quotes or angle brackets. Leave. |
| `activity.html:541` / `tab-bar-functions.js:216` (`personLinkHtml`) | `href="…?osoba=${encodeURIComponent(name)}"` + `${safe}` | `encodeURIComponent` escapes `'`, `"`, `<`. Correct. Leave. |
| `home.html:582` | `link.title = \`${identifiedRecipient.name} …\`` | Property assignment, not HTML. Safe. Leave. |
| `home.html:779`, `recipients.html:1663`, `recipients.js:1622` | `${emptyMessage}` / `${title}` / `${message}` | Hard-coded literals from the page's own code. Leave. |
| `recipients.js:1486, 1524, 1561, 3710, 4431, 4436` | names/titles in `confirm()` / toasts | Text contexts. Same UI-spoofing judgement as §1.3. Leave. |
| `filters.js:550` (`highlightText`) | `${recipientNameHighlighted}` | `highlightText` escapes first, then wraps matches in `<mark>` (`filters.js:674-678`). Element content only. Correct. Leave. |
| `recipients.js:1187, 1233` (`recipientNameWithBadge`) | `${recipientNameWithBadge(...)}` | Escapes every branch with `escapeHtml` and every attribute with `escapeAttr` (`recipients.js:2410-2420`). Correct. Leave. |
| `wiadomosci.html:473, 622` | `${escapeHtml(t.otherLabel)}` | Element content, correctly escaped. Leave. |
| `notification-text.js:69, 75` | `${person(data.recipientName)}` | `person()` escapes via the module's own `escapeHtml` (lines 59, 64). Correct. Leave. |
| `osoby.html:216` | `data-person="${person.id}"` | Numeric id. Leave. |

---

## 6. Required test changes

Read `.agents/tasks/e2e-harness-verification.md` and `tests/README.md` **before writing any test**.
House rules that apply here: import `{ test, expect }` from `../fixtures` (never
`@playwright/test`); use `openPage`/`setViewport` from `../helpers/pages`; never
`page.waitForTimeout`; put measured values in failure messages; demo fixtures live in `server.js`
inside `if (DEMO_MODE)` branches and are **appended**, never renumbered; `workers: 1`, so restore
any mutated demo state.

Baseline to preserve: **77 passed, 0 failed, 23 skipped**, ~5.7-5.9 min
(`.agents/tasks/e2e-harness-verification.md:89-103`).

Required:

1. **Un-skip the existing `fixme`** at `tests/e2e/escaping.spec.js:101`
   (`'a leaderboard name containing markup renders as literal text'`) — change `test.fixme` to
   `test` and make it pass **without weakening `expectNoInjection`** (lines 24-37) and without
   narrowing the locator.
2. **Delete** the test at `tests/e2e/escaping.spec.js:110`
   (`'the leaderboard XSS sink is still exactly where the fixme says it is'`). It asserts the sink
   **still exists** (`expect(victim.html).toContain('<mała>')`) and its own failure message says to
   delete it once the sink is fixed. It will fail otherwise.
3. **Update** `tests/README.md`: remove the leaderboard row from the "Known product bugs" table
   (line ~211) and correct the `escaping.spec.js` skip count. Add the
   `tab-bar-functions.js:224/227` sink as a new known-bug row, since it remains open.
4. **New spec** `tests/e2e/xss-usernames.spec.js` covering **every affected page and render path**:
   activity list, activity podium, podium, users list (`/leaderboard.html`), and the intro podium +
   other-users list (`/intro.html`), plus `/activity` and `/recipients` for item 9 and `/osoby` for
   item 10.
5. **Node-side unit tests** for the new module in the same spec file, via
   `require('../../public/escape-html.js')` — the pattern `pluralization.spec.js` already uses for
   `notification-text.js`. Cover: all five characters escaped; `null`/`undefined` → `''`;
   `safeImageSrc` accepting `/api/recipients/1/profile-picture` and `https://x/y.png` and rejecting
   `javascript:…`, `data:image/png;base64,…`, `//evil.example/x.png`, `JaVaScRiPt:…`, and a value
   with a leading tab/newline before the scheme.

### 6.1 Demo fixtures (`server.js`, `demoLeaderboard.users` at line 4026)

**Insert three rows at the FRONT of the array** (do not renumber existing ids; use new ids 9, 10,
11). Front placement is required because `renderPodium` uses `users.slice(0, 3)` in **array order**
(`leaderboard.html:1296`), while `renderActivityPodium` / `renderActivityLeaderboard` sort by
activity. Give the new rows the **highest** `total_presents` (115, 114, 113) **and** the highest
activity (e.g. `user_bought_count` 200/180/160, `user_reserved_count` 0) so one payload lands on
every one of the four leaderboard render paths.

```js
username: 'Ola <img src=x onerror=window.__xss=1> Z',   // id 9  — element injection + execution
                                                        //          profile_picture: 'javascript:window.__xss=1'
username: 'Ala" onmouseover=window.__xss=1 x="',        // id 10 — attribute breakout
username: "O'Brien'); window.__xss=1; //",              // id 11 — JS-string-in-attribute + bare apostrophe
```

Keep every other field shaped exactly like the existing rows (the comment at `server.js:4022-4024`
insists on the production column names). Give id 9 `profile_picture: 'javascript:window.__xss=1'`
and leave ids 10 and 11 at `profile_picture: null`, so §4 is exercised on every path at once.

**Three rows and no more — this is a hard constraint.** `renderActivityLeaderboard` slices to the
top 10 by activity (`leaderboard.html:1186`). There are 8 rows today; 8 + 3 = 11 drops exactly one
row — `Oliwia Bezaktywności` (activity 0), which the `totalActivity === 0` filter
(`leaderboard.html:1197`) already skips, so nothing visible is lost. A **fourth** row would drop
`Piotr Jedyny` (activity 1) and break
`pluralization.spec.js:138` (`'0 zarezerwowanych'`) and `:152` (`'1 aktywność'`).

Leave `demoLeaderboard.cumulativeStats` (line 4040) untouched.

### 6.2 Assertions for each payload, on each render path

- **No execution:** `expect(await page.evaluate(() => window.__xss === undefined)).toBe(true)`
  (the convention `escaping.spec.js:50` already uses), checked after the page settles **and again**
  after `locator.hover()` on the name (to try to fire `onmouseover` from the attribute-breakout
  payload) and after the delegated click in the next bullet.
- **No element injection:** inside the card, `querySelectorAll('img, script, iframe, svg, object, embed').length === 0`.
  Valid for these fixtures because `safeImageSrc` rejects id 9's URL and ids 10/11 have
  `profile_picture: null`, so every demo avatar renders as the emoji `<div>`. Print `innerHTML` in
  the failure message.
- **Still displays as literal text:** the element's `textContent` equals the payload **exactly**,
  and `innerHTML` contains the entity forms (`&lt;img`, `&quot;`, `&#39;`) and matches
  `not.toMatch(/<(script|img|iframe|b|i)\b/i)`.
- **No injected handler attribute:** the card's `outerHTML` must not match
  `/\son(mouseover|error|click|load)=/i` beyond the known-static `onerror` on avatar `<img>`s
  (there are none in the demo fixtures), and the `.podium-place` / `.user-card` elements must have
  **no** `onclick` attribute at all (`expect(await el.getAttribute('onclick')).toBeNull()`).
- **Click behaviour preserved:** clicking a `.podium-place` and a `#usersList .user-card` still
  navigates to `/recipients.html?osoba=<encodeURIComponent(payload)>`. Assert with
  `page.waitForURL` and compare against `encodeURIComponent` of the raw payload. This proves the
  delegated listener survives the nastiest name. Navigate back / re-open the page afterwards —
  `workers: 1` means later tests share the context.
- **No `javascript:` / `data:` in markup:** the rendered card's `outerHTML` must not contain
  `javascript:`.
- **Page-error free:** automatic via `tests/fixtures.js:60-71` (uncaught page errors fail the
  test). Do **not** add `ignorePageErrors`.

Payload-length note: tokens are 22-26 chars; `demoLeaderboard` already carries the 41-char
unbreakable `Konstantynopolitańczykowianeczkaniezwykła` and `no-horizontal-overflow.spec.js`
passes with it, so there is headroom. If a width test does start failing, **shorten the payload
token** (e.g. `onerror=window.x=1`) — never relax an overflow or wrapping assertion.

---

## 7. Implementation plan

- [ ] **1. Establish the green baseline before changing anything.**
      Read `.agents/tasks/e2e-harness-verification.md`, `tests/README.md`, `tests/fixtures.js`,
      `tests/helpers/pages.js` and `tests/e2e/escaping.spec.js`. Then run the suite untouched so
      you can tell a pre-existing failure from one you caused.
      Files: none (read-only).
      Verify: `npm test` → **77 passed, 0 failed, 23 skipped**. Record the real counts and runtime.
      If the baseline is not green, stop and report before editing.

- [ ] **2. Create the shared escaping module.**
      `public/escape-html.js` per the contract in §2 and the allowlist in §4: `escapeHtml`,
      `escapeAttr`, `safeImageSrc`, `window.PrezentyEscape` + `module.exports`, same IIFE shape as
      `public/notification-text.js:26-110`. Copy the five replacements from
      `notification-text.js:27-34` rather than inventing another implementation. No flat
      `window.escapeHtml`.
      Files: `public/escape-html.js` (new).
      Verify: `node --check public/escape-html.js` passes, and
      `node -e "const e=require('./public/escape-html.js'); console.log(e.escapeHtml(`a<b>\"c\"'d&`), e.safeImageSrc('javascript:1'), e.safeImageSrc('/api/x'))"`
      prints fully-entitised text, `''`, and `/api/x`.

- [ ] **3. Append the malicious demo fixtures.**
      Insert the three rows from §6.1 at the **front** of `demoLeaderboard.users`
      (`server.js:4026-4039`). Re-read that region first — `server.js` is modified in the working
      tree. Targeted `str_replace` on the `users: [` opening and the first row only. Three rows
      exactly; do not touch `cumulativeStats`.
      Files: `server.js`.
      Verify: `node --check server.js`, then `npm run test:e2e -- pluralization` → all 10 pass
      (this is the suite that is sensitive to the fixture set; it proves the top-10 slice reasoning
      in §6.1 holds). The leaderboard specs will still fail at this point — expected, that is the
      vulnerability.

- [ ] **4. Fix `public/leaderboard.html` — all 11 sinks, every duplicated copy.**
      Add `<script src="escape-html.js"></script>` immediately after line 923
      (`pluralize-pl.js`) — **not** near line 1509. Then in each of the four render functions
      (`renderActivityLeaderboard` ≈1183, `renderActivityPodium` ≈1240, `renderPodium` ≈1294,
      `renderUsersList` ≈1335) compute `pic`/`name` once per §4 and use them. Escape L2, L5, L8,
      L11 with `escapeHtml`; L1/L3/L6/L9 `alt` with `escapeAttr` and `src` with `safeImageSrc`;
      replace the `onclick` on L4/L7/L10 with `data-username` and add the single delegated listener
      per §3. Preserve the three `onerror` literals and the three `style="cursor: pointer;"`
      attributes verbatim. Leave `getEmojiAvatar` calls alone. **`renderActivityPodium` and
      `renderPodium` are near-identical — fix both; do not fix one and assume the other.**
      Files: `public/leaderboard.html`.
      Verify: `npm run test:e2e -- escaping` and `npm run test:e2e -- pluralization` — pluralization
      still fully passes; the leaderboard `fixme` is still skipped (item 6 enables it). Also
      `npm run test:e2e -- no-horizontal-overflow --grep leaderboard` passes, proving the payloads
      did not break layout.

- [ ] **5. Fix `public/intro.html` — I1-I4.**
      Add `<script src="escape-html.js"></script>` after line 360 (`pluralize-pl.js`). Apply the
      same `pic`/`name` shape in both `renderLeaderboard` map callbacks (≈601 and ≈621), keeping
      the `|| '/images/default-avatar.svg'` fallback per §4 and the two
      `onerror="this.src='/images/default-avatar.svg'"` literals verbatim.
      Files: `public/intro.html`.
      Verify: covered by item 6's new spec. `/intro.html` is not in `tests/helpers/pages.js`
      `PAGES`, so add a local descriptor in the new spec rather than editing `PAGES` (editing
      `PAGES` would add that page to the overflow/a11y/smoke matrices and is out of scope).

- [ ] **6. Write the new spec, un-skip the `fixme`, delete the guard test, update the README.**
      Create `tests/e2e/xss-usernames.spec.js` per §6.2 with the Node-side unit tests from
      §6 requirement 5.
      In `tests/e2e/escaping.spec.js`: `test.fixme` → `test` at line 101 (assertion unchanged),
      delete the whole test at lines 110-123, and update the explanatory comment block at
      lines 91-100 so it describes the fix instead of the bug. Update `tests/README.md` per §6
      requirement 3.
      Files: `tests/e2e/xss-usernames.spec.js` (new), `tests/e2e/escaping.spec.js`,
      `tests/README.md`.
      Verify: `node --check` on both spec files, then
      `npm run test:e2e -- xss-usernames` and `npm run test:e2e -- escaping` — all pass, and the
      escaping file now reports **0 skipped**.

- [ ] **7. Prove the new spec fails against pre-fix code — without `git stash`.**
      A whole-tree stash would destroy the concurrent workflow's uncommitted work. Instead:
      copy `public/leaderboard.html` and `public/intro.html` to `$env:TEMP\xss-fixed\`; copy the
      **pre-fix** versions back over them with `git show HEAD:public/leaderboard.html` /
      `git show HEAD:public/intro.html` redirected to the working files (these two files' only
      uncommitted change at `HEAD` is the cache-bust bump, which does not affect the sinks — check
      `git diff HEAD -- public/leaderboard.html` first and if it contains anything beyond the
      `?v=` bump, use your own `$env:TEMP` copy of the pre-edit file instead). Keep the item 3
      fixtures and the new spec in place. Run the spec, confirm it **fails** on injection, then
      restore the fixed files from `$env:TEMP\xss-fixed\`.
      Files: none permanently changed.
      Verify: `npm run test:e2e -- xss-usernames` fails pre-fix with injection/execution assertion
      messages (paste them); after restore, `git diff --stat` shows only your intended files and
      `npm run test:e2e -- xss-usernames` passes again.

- [ ] **8. Escape the `leaderboard_leader` notification sinks.**
      `public/activity.html:528` — wrap `data.leaderName` and `data.previousLeaderName` in the
      page's existing `escapeHtmlText` (line 454); also wrap `data.label` at line 534. Element
      contexts only, so the page's own helper is sufficient and no module load is needed here.
      `public/recipients.html:1877` — wrap the same two values in the page's existing
      `notificationTextEscape` (line 1803). First confirm which `notificationConfig` the
      `innerHTML` call at line 1833 resolves to (there are two declarations, 1877 and 2323, in
      separate `<script>` blocks); fix the one in the `innerHTML` path and leave the `html: false`
      plain-text one alone (§5.5).
      Files: `public/activity.html`, `public/recipients.html`.
      Verify: add a case to `tests/e2e/xss-usernames.spec.js` driving `/activity` (demo row id 118,
      `server.js:4049`, type `leaderboard_leader`) and asserting the rendered message contains the
      literal name with no injected element; then `npm run test:e2e -- xss-usernames escaping` passes.
      Temporarily set that demo row's `leaderName` to one of the §6.1 payloads so the assertion is
      meaningful, and leave it that way (it is a fixture, and `pluralization.spec.js:83` asserts
      only the `notificationText` *default* wording for that type, not the page's custom renderer).

- [ ] **9. Fix the `public/osoby.html` attribute sinks.**
      Line 338: drop the title argument from the markup entirely — change the button to
      `data-delete-present="${p.id}"` and change `deletePresent(presentId, title)` (line 389) to
      `deletePresent(presentId)` that looks the title up from the `presents` array, exactly as
      `deleteAbandoned` already does at lines 304-306. Add a delegated listener for
      `[data-delete-present]` (and keep the existing `deleteAbandoned` inline handler at line 297
      as-is — it only interpolates a numeric id). Keep `title="Usuń"` on the button so its
      accessible name is unchanged. Line 353: `value="${PrezentyEscape.escapeAttr(p.title)}"`, and
      add `<script src="escape-html.js"></script>` to the page head.
      Files: `public/osoby.html`.
      Verify: add a `/osoby` case to the new spec using the existing demo present title
      `Zestaw <script>alert(1)</script> & "mega" 'mini'` (`server.js` `demoData`, already seeded) —
      assert the delete button has no `onclick`, no injected attribute, that the edit input's
      `value` round-trips the title exactly (`inputValue()`), and that clicking delete still opens
      the confirm dialog with the right title (handle the dialog with `page.on('dialog', …)` and
      **dismiss** it so demo state is not mutated — `workers: 1`). Then
      `npm run test:e2e -- xss-usernames` and `npm run test:e2e -- no-horizontal-overflow --grep osoby`
      pass.

- [ ] **10. Second wave: the remaining quote-unsafe-helper-in-attribute sites.**
      Lower severity than items 4-9 (needs a name/title containing a double quote rather than an
      apostrophe), same bug class. Do this only once items 1-9 are green, as a separate commit so
      it can be reverted independently.
      `public/recipients.js` lines 422, 1136, 1138, 1144, 4290, 4292, 4298 — swap `escapeHtml(` for
      the file's **existing** `escapeAttr(` (defined line 2429); no module load needed.
      `public/filters.js:563` — same swap, adding an `escapeAttr` next to its `escapeHtml`
      (line 682) mirroring `recipients.js:2429`.
      `public/home.html` lines 576, 640, 800 — `alt="${…}"`: add
      `<script src="escape-html.js"></script>` to the head and use `PrezentyEscape.escapeAttr`.
      Re-read each file first; `home.html` and `recipients.html` carry other workflows'
      uncommitted changes.
      Files: `public/recipients.js`, `public/filters.js`, `public/home.html`.
      Verify: `node --check public/recipients.js public/filters.js`, then the **full** suite
      (`npm test`) — `/recipients` and `/` are heavily covered by `escaping.spec.js`,
      `edit-sheet.spec.js`, `chat-reactions.spec.js`, `a11y.spec.js` and
      `no-horizontal-overflow.spec.js`, so a regression in the `data-present-*` attributes (which
      the edit sheet reads back) will surface there. Add one assertion to the new spec that the
      edit sheet still round-trips the HTML-special demo title.

- [ ] **11. Full verification and hand-off.**
      Run the full suite twice (the harness doc establishes stability by running it twice). Run
      `node --check` on every JS file added or edited: `public/escape-html.js`, `public/filters.js`,
      `public/recipients.js`, `server.js`, `tests/e2e/xss-usernames.spec.js`,
      `tests/e2e/escaping.spec.js`. HTML files cannot be `node --check`ed; their inline scripts are
      covered because `tests/fixtures.js` fails any test whose page throws an uncaught error.
      Confirm with `git status --short` that you changed **only** your files and none of the
      forbidden ones, then commit staging files **by name** (Conventional Commits, `fix(security):`).
      Files: none new.
      Verify: `npm test` → **0 failed**, skipped count down from 23 to **22** (the leaderboard
      `fixme` is now a passing test), passed count up by the number of new tests. Paste the real
      counts and runtime for both runs.
      Report in the completion message: (a) `public/sw.js` needs `'/escape-html.js'` added to
      `urlsToCache` and `CACHE_NAME` bumped from `'prezenty-v121'` — not done, file forbidden;
      (b) `public/tab-bar-functions.js:224` and `:227` are still-open username sinks rendered in
      the dock on every page — not done, file forbidden, **needs an immediate follow-up task**;
      (c) the §5.4 input-hygiene and CSP recommendations were not implemented, by design.

---

## 8. Known gaps after this plan lands

State these plainly in the completion message rather than claiming the vulnerability is fully
closed:

1. **`public/tab-bar-functions.js:224, 227`** — `data.leaderName` / `data.previousLeaderName` /
   `data.label` still go raw into `innerHTML` in the dock notifications panel, on every page that
   has the dock. `leaderName` is `recipients.name` (`server.js:282`). Forbidden file; highest
   priority follow-up.
2. **`public/formularz.js:1233`** — `title="${escapeHtml(cleanUrl)}"` with the quote-unsafe helper.
   Forbidden file.
3. **No CSP**, and inline event handlers remain throughout the app, so output escaping is the only
   layer of defence (§5.4).
4. **No input validation** on recipient names beyond an empty check, by design (§5.4).
5. **Keyboard access** to the leaderboard podium / user cards is unchanged — still mouse-only
   (§3). Candidate follow-up, not a regression.
6. **One browser engine.** The suite is Edge/Chromium only (`tests/README.md`), so the fix is not
   verified on WebKit or Firefox.
