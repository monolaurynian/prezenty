# Stored XSS through user-controlled names: output escaping across the leaderboard, intro, dock and inline handlers

The fix adds one shared, namespaced escaping module (`public/escape-html.js`, exposing
`escapeHtml` / `escapeAttr` / `safeImageSrc` / `jsStringAttr` on `window.PrezentyEscape`) and routes
every user-controlled name, title and picture URL through it before it reaches `innerHTML`. All
eleven leaderboard sinks are closed, including both near-identical podium renderers; the three
`onclick="navigateToUserInRecipients('${user.username}')"` contexts are gone, replaced by
`data-username` plus a single delegated `document` click listener. `intro.html`, `activity.html`,
`recipients.html`, `osoby.html`, `home.html`, `recipients.js` and `filters.js` get the same
treatment, and a second wave (authorised mid-task per the verification note) also closed the dock
notification sink in `tab-bar-functions.js` and the `'${escapeHtml(...)}'`-inside-`onclick` family
in `recipients.js` / `formularz.js` / `osoby.html` via `jsStringAttr`. Demo fixtures carrying one
payload per injection context were seeded at the front of `demoLeaderboard.users`, and a 23-test
spec (`tests/e2e/xss-usernames.spec.js`) asserts, on every render path, that nothing executed,
nothing was created, and the name still displays character for character.

Watch for: `safeImageSrc` accepts `/\evil.example/x.png`, which the URL parser resolves off-origin,
so the documented same-origin guarantee has a hole (confirmed, non-blocking — image loads cannot
execute script and `profile_picture` is server-generated today). Three files on this task's
forbidden list (`tab-bar-functions.js`, `formularz.js`, `formularz.html`) were edited under a
claimed mid-task scope lift (confirmed in the diff; needs orchestrator adjudication, not a code
defect). `public/sw.js` still does not precache `/escape-html.js` even though six pages now hard-
depend on it, so a first offline load of those pages fails closed.

**Verdict**: APPROVED

## High-level view

Escaping is centralised, not scattered. One module is loaded in `<head>` on all six pages that need
it (`formularz.html:1167`, `home.html:228`, `intro.html:362`, `leaderboard.html:925`,
`osoby.html:73`, `recipients.html:839`), always before the scripts that call it
(`recipients.js` at `home.html:412` and `recipients.html:2380`, `formularz.js` at
`formularz.html:1551`), so there is no load-order hazard. The namespacing decision is the right one
and is argued from evidence: nine page scripts declare a competing top-level quote-unsafe
`function escapeHtml`, which would silently shadow a flat `window.escapeHtml`. Pages whose only
sinks are element content (`activity.html`, `recipients.html`) reuse their own existing correct
helper rather than taking a new script dependency.

The JS-string-in-attribute contexts are handled two different ways, both sound. The leaderboard's
three handlers are deleted outright in favour of `data-username` + one delegated listener keyed on
`[data-username]` (not `.user-card`, which is shared with the never-clickable activity list);
`dataset` hands back the decoded original, so `navigateToUserInRecipients` and its
`encodeURIComponent` are untouched. Where the handler had to stay, `jsStringAttr` builds a complete
JS string literal with `JSON.stringify` first and HTML-escapes the result second, which is the
correct ordering for that context. The second wave also caught something the plan missed:
`encodeURIComponent` leaves `'` untouched, so `scrollToPresentFromNotification(id, '...')` was
breakable by a name like `'-alert(1)-'` with no angle bracket involved.

`profile_picture` is treated as untrusted and allowlisted (`/path` or `https://`, no whitespace or
control characters), with call sites branching on the sanitised value so a rejected URL falls
through to the emoji or default avatar instead of rendering a broken image — which matters for the
one avatar that has no `onerror` at all. The allowlist's same-origin test is `charAt(0) === '/' &&
charAt(1) !== '/'`, and that misses the backslash form: `/\evil.example/x.png` is accepted and
resolves to `https://evil.example/x.png`.

Verification evidence is unusually thorough and honest about its limits. The deliberate-break proof
is real, not tautological: pre-fix the new spec went 13 failed / 3 passed (the 3 being Node-only
unit tests the file swap does not touch), with failure output showing `onmouseover="window.__xss=1"`
rendered as a real attribute and a `SyntaxError: missing ) after argument list` from an apostrophe.
The second wave was proven the same way per file, with hash-verified restores. The note also
discloses a process slip (a backup taken in parallel with an edit, so one proof initially tested the
wrong bytes) and the fact that a post-scope-lift baseline could not be re-captured without a
forbidden whole-tree git operation.

<details>
<summary>Issues (6)</summary>

1. **`safeImageSrc` backslash bypass** — `/\evil.example/x.png` passes the same-origin check and
   resolves off-origin (verified: `new URL('/\\evil.example/x.png', base).href` →
   `https://evil.example/x.png`). Tighten the test to reject `charAt(1) === '\\'` as well, and add
   the case to the `safeImageSrc` rejection list in the spec.
2. **Forbidden-list files edited** — `public/tab-bar-functions.js` (3 escaping edits),
   `public/formularz.js` (`escapeAttr` + 2 `jsStringAttr`) and `public/formularz.html` (the
   `escape-html.js` script tag) were changed by this fix under a scope lift recorded only in the
   implementer's own note. Orchestrator should confirm the lift; the edits themselves are correct
   and the composer workflow's changes are already in the same files.
3. **`/escape-html.js` not precached** — `public/sw.js` has `CACHE_NAME` bumped to `prezenty-v122`
   but `urlsToCache` still lacks `/escape-html.js`, which six pages now hard-depend on. A first
   offline load of those pages fails closed (render functions throw on `PrezentyEscape`). Needs the
   `sw.js` owner to add the entry.
4. **`safeImageSrc` not applied on the `/recipients` and `/` avatars** — `recipients.js:1176` and
   the `home.html` avatars escape the URL (`escapeAttr`) but do no scheme allowlisting, so the
   defence-in-depth posture is inconsistent with the leaderboard. Low risk (those URLs are built
   from a numeric recipient id, or come from a server-written column), worth a follow-up for parity.
5. **`activity.html:483` still interpolates `${data.presentId}` raw into an `onclick`** — a
   server-written numeric id, and `tab-bar-functions.js` wraps the equivalent in `Number()`. Wrap it
   for parity.
6. **Podium and ranking cards remain mouse-only** — unchanged by this fix (`<div>`s with no
   `tabindex`/`role`), and deliberately so to avoid new `a11y.spec.js` interactions. Candidate
   follow-up, not a regression.

</details>

<details>
<summary>Details</summary>

### Every listed sink, including both podium copies

`public/leaderboard.html` has no remaining raw interpolation: grepping the file for
`${user.username}` / `${user.profile_picture}` returns one hit, inside the comment that documents
the old handler. The duplicated patterns are both fixed — `data-username` now appears at 1276
(`renderActivityPodium`) and 1327 (`renderPodium`) with identical shape, plus 1367 for the
`#usersList` card, and each of the four render functions computes `pic`/`name` once at the top of its
map callback. `intro.html` has zero remaining `${user.username}` / `${user.profile_picture}` hits;
both `.map()` callbacks were converted to block bodies for the same `pic`/`name` pattern.

The spec asserts `#activityPodium` and `#podium` independently, so fixing one and assuming the other
could not have passed.

### The `onclick` contexts

```
leaderboard.html:1405-1410
document.addEventListener('click', function (e) {
    const target = e.target.closest && e.target.closest('[data-username]');
    if (!target) return;
    navigateToUserInRecipients(target.dataset.username);
});
```

`[data-username]` appears on exactly the three elements that had a handler, and nowhere else in
`public/`. `style="cursor: pointer;"` is preserved verbatim on all three, and the spec asserts both
the `cursor` affordance and that `getAttribute('onclick')` is `null`, plus that the activity cards
did *not* acquire a `data-username`.

`jsStringAttr` is `escapeAttr(JSON.stringify(String(value)))` — literal first, attribute escaping
second, which is the only ordering that works here. The spec round-trips it through an HTML-attribute
decode and `new Function`, and separately through a real Edge parser by injecting into
`<button onclick>` and clicking. Two caveats, both acceptable: `JSON.stringify` leaves U+2028/U+2029
raw (legal in string literals since ES2019, and the Node test covers the round trip), and call sites
keep the inner `escapeHtml(name)` so handlers receive the same string they always did — which
preserves the pre-existing cosmetic quirk that a name containing `&` reaches `confirm()` as `&amp;`.

`osoby.html:345` goes further and drops the title from the markup entirely
(`data-delete-present="${p.id}"` + delegated listener), with `deletePresent` looking the title up
from `presents`. `presentRow` is only ever called over rows filtered from `presents`
(`osoby.html:215, 226`), so the lookup cannot miss and fall back to the generic `ten prezent`
wording.

### The `safeImageSrc` hole

```js
const sameOriginPath = raw.charAt(0) === '/' && raw.charAt(1) !== '/';
```

Under WHATWG URL parsing a leading `/\` behaves like `//`: relative state sees `/`, relative-slash
state sees `\` on a special scheme, and parsing continues in authority state. Verified against the
module itself:

```
safeImageSrc('/\evil.example/x.png') -> "/\evil.example/x.png"   (accepted)
new URL(...,'https://prezenty.example/page').href
                                     -> https://evil.example/x.png
```

Consequence is an off-origin image request (IP, UA, referrer to an attacker host), not script
execution — `<img src>` cannot run JS, and `profile_picture` is server-generated
(`server.js:2529-2533`) so nothing reaches this today. It still contradicts the function's stated
contract, and the spec's rejection list (`//evil.example/x.png`, `http://`, `javascript:`,
`data:`, leading whitespace variants) does not include the backslash form.

Rejecting the whole `\u0000-\u0020` range also rejects a legitimate path containing a space, which
would silently downgrade such an avatar to the emoji fallback. The server's generated paths have no
spaces, so nothing regresses today.

### Forbidden-file scope

The brief lists `public/tab-bar-functions.js`, `public/formularz.js` and `public/formularz.html` as
untouchable; the diff shows this fix changed all three (notification escaping at
`tab-bar-functions.js` ~226-234, `escapeAttr`/`jsStringAttr` in `formularz.js`, the `escape-html.js`
script tag at `formularz.html:1167`). The verification note records that the orchestrator lifted the
restriction once the composer workflow released those files, and the diff corroborates that the
composer workflow's own work (the `initTabBarAutoHide` rewrite) is sitting in the same file. The
code is correct and closes what the plan itself called the highest-priority remaining sink, so this
is a process question for the orchestrator rather than a defect.

`public/sw.js` was not edited by this fix beyond what is already in the tree (`CACHE_NAME`
`prezenty-v121` → `prezenty-v122`, no `urlsToCache` change), consistent with the note. No `?v=`
value in `leaderboard.html` was touched by the first wave; the `tab-bar-functions.js?v=18` → `?v=19`
bumps across the eight dock pages belong to the second wave's edit of that file.

### Test coverage

23 tests in `tests/e2e/xss-usernames.spec.js`: four Node-side unit tests of the module, and browser
tests over `#activityList`, `#activityPodium`, `#podium`, `#usersList`, the intro podium and 4-10
list, `/activity`'s `leaderboard_leader` renderer, the dock panel on two pages, the `/recipients`
inline handlers (hostile rows injected via `page.route`, so shared demo state is not mutated), and
`/osoby`. `expectLiteralName` checks `textContent` equality, zero child elements and entity-encoded
innerHTML; `expectNoInjectedHandlers` enumerates every `on*` attribute in the card against an
allowlist of the known-static avatar `onerror` and fails on any `javascript:` in `outerHTML`. The
previously-`fixme`'d test at `escaping.spec.js:103` is live with its assertion unchanged, and the
self-cancelling "the sink is still there" guard test is deleted; `tests/README.md`'s known-bugs
table no longer lists any stored-XSS row.

Not tested: the `/\host` form of `safeImageSrc` rejection; WebKit and Firefox (the suite is
Edge/Chromium only); a real MySQL-backed instance (the suite runs in DEMO mode); keyboard activation
of the podium cards, which remains absent by design.

`node --check` passed on `escape-html.js`, `filters.js`, `recipients.js`, `server.js` and both spec
files per §8.6; I re-ran it on the two second-wave files the note does not list
(`tab-bar-functions.js`, `formularz.js`) — both exit 0.

### Suite result and baseline

Reported: 131 tests, Run A 119 passed / 1 failed / 11 skipped, Run B 120 passed / 0 failed /
11 skipped, exit 0. The Run A failure is `no-horizontal-overflow › home` aborting `goto` on the
harness's known one-shot `home.html` self-reload; it passed under `--repeat-each=3` and in Run B, and
nothing in this change touches `home.html` layout or navigation. Both arithmetics are internally
consistent (119+1+11 = 120+0+11 = 131).

The note is explicit that a post-scope-lift "current tree minus my changes" baseline was not
obtainable without `git stash`, which would have destroyed another workflow's uncommitted work, and
offers the pre-edit 77/0/23 baseline plus per-file pre-fix runs instead. That is the right trade and
the right disclosure.

### Demo fixtures

Three rows at the front of `demoLeaderboard.users` with ids 9/10/11, highest `total_presents` *and*
highest activity so one payload reaches all four render paths, no existing id renumbered,
`cumulativeStats` untouched. Row 10 carries a legitimate `/images/default-avatar.svg` so the `<img>`
branch and `alt=` escaping are exercised in a browser rather than only in Node; row 9 carries
`javascript:window.__xss=1` so rejection is exercised. The three-row cap is justified against
`renderActivityLeaderboard`'s top-10 slice and the two `pluralization.spec.js` assertions a fourth
row would break.

Worth noting: `DEMO_MODE` turns on whenever `DB_PASSWORD` is unset (`server.js:83-86`), so a
degraded deploy would serve these payload names publicly. Post-fix they render as literal text, so
the impact is cosmetic — but the fixture set now contains a `javascript:` URL and three
`window.__xss=1` strings that a user could in principle see on the live host.

</details>

<details>
<summary>Files changed (this fix's portion of a shared working tree)</summary>

- `public/escape-html.js` — new shared module: `escapeHtml`, `escapeAttr`, `safeImageSrc`,
  `jsStringAttr`, namespaced on `window.PrezentyEscape`, dual browser/Node.
- `public/leaderboard.html` — all 11 sinks; both podium renderers; three `onclick`s → `data-username`
  + one delegated listener; module script tag.
- `public/intro.html` — I1-I4; both map callbacks reshaped; default-avatar fallback preserved.
- `public/activity.html` — `leaderboard_leader` / `anon_message` names escaped; apostrophe encoded in
  the present-link `onclick`.
- `public/recipients.html` — the `innerHTML`-path notification config escaped; the `html:false` one
  left alone.
- `public/osoby.html` — delete button → `data-delete-present` + delegated listener; edit field
  `value` → `escapeAttr`; `deletePerson` handler → `jsStringAttr`.
- `public/home.html` — avatar `alt` → `escapeAttr`; four `openProfilePicturePreview` handlers →
  `data-preview-*` + one delegated listener.
- `public/recipients.js` — seven `data-present-*` attributes → `escapeAttr`; profile-picture URL
  escaping moved outside the URL helper; eight inline handlers → `jsStringAttr`; one `setAttribute`
  → `JSON.stringify`.
- `public/filters.js` — `data-name` → a new local `escapeAttr` mirroring `recipients.js:2429`.
- `public/tab-bar-functions.js` — dock notification names/label escaped; apostrophe encoded in the
  present-link `onclick`. (Forbidden-list file; see Issues #2.)
- `public/formularz.js`, `public/formularz.html` — `escapeAttr` on the link `href`/`title`, two
  `jsStringAttr` handler arguments, module script tag. (Forbidden-list files; see Issues #2.)
- `server.js` — three XSS demo rows in `demoLeaderboard.users` and a payload on demo notification 118
  (DEMO_MODE fixtures only).
- `tests/e2e/xss-usernames.spec.js` — new, 23 tests.
- `tests/e2e/escaping.spec.js` — `fixme` promoted, guard test deleted, comment rewritten.
- `tests/README.md` — stored-XSS rows removed from the known-bugs table.

The working tree also carries two other workflows' uncommitted work (composer, e2e harness) in
`formularz.*`, `tab-bar-functions.js`, `bottom-tab-bar.css`, `server.js`, `tests/` and the `?v=`
cache-busters; those lines are out of scope here. Full diff: `git -P diff HEAD -- <path>` per file.

</details>
