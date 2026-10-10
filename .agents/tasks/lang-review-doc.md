# Gender-neutral Polish wording and shared notification text (Branch LANG, pass 3)

Branch LANG rewrites the gendered UI strings into neutral Polish (Tier A) and applies the section 5 fixes from the audit. It also replaces the four copies of the activity/notification wording with one dual browser/Node module, `public/notification-text.js`. Pass 3 adds one code change: intro.html:478 `Dzięki Prezentownik` becomes `Dzięki Prezentownikowi`, the correct dative and the same class of fix as `Witaj w Prezentowniku` (confirmed). This pass also supplies the verification evidence that was missing in passes 1 and 2, in `.agents/tasks/lang-verification.md`. node --check exits 0 on every edited JS file. The notificationText test passes 22/22, covering escaping, plCount batches, `html:false`, `showActor:false` and the null-actor fallback. The leftover-grep report finds only a comment and noun-agreeing or impersonal forms. The coder also states that LANG made no edits to formularz.*.

Watch for: formularz.html still loads `tab-bar-functions.js?v=15` (likely, non-blocking). LANG is not allowed to edit that file, so the merge or UI step has to bump it.

**Verdict**: APPROVED

## High-level view

All four renderers delegate their wording to `notificationText(type, data, actor, opts)`. These are activity.html (per-type config, the batch row, and the unknown-type fallback), the recipients.html bell, the second recipients.html config (`{ html: false }`), and tab-bar-functions.js `getNotificationMessage`. Each renderer still supplies its own person/present callbacks, so links, colours and the outer `notification-item` markup stay as they were. The module escapes the actor, names and titles. The wording follows the audit pattern (`Monika · rezerwacja: „T” (dla: Tomek)`).

The Polish matches the audit. That covers the `już` typo, the `(dla: X)` push bodies, `Zarezerwowane przez:`, the plural counts in osoby.html, `Witaj w Prezentowniku` / `Dzięki Prezentownikowi`, the comma fixes, sentence case, `w archiwum za rok`, and the 2nd-person Tier A rewrites.

On the constraints, the joke at recipients.js:3313 (`Sorry, teraz to już po ptokach! … Trzeba było szybciej rezerwować matole! Wybierz coś innego.`) is byte-identical to HEAD apart from console encoding (confirmed by spot-check). sw.js has no diff (confirmed). The coder states that the formularz.* diffs belong to the UI branch. The shared working tree can't confirm this independently, but it is consistent with LANG's scope.

<details>
<summary>Issues (1)</summary>

1. **formularz.html still loads tab-bar-functions.js?v=15** (likely, non-blocking) — returning users on formularz.html can keep the cached old script with the `dodał(a)` wording and no notification-text loader. The UI or merge step should bump it to `?v=16`.

</details>

<details>
<summary>Details</summary>

### notification-text.js and the four renderers

```
activity.html   activityMessage() ──────┐
                burst row (batch) ──────┤
                unknown-type fallback ──┤
recipients.html bellMessage() ──────────┼──> notificationText(type, data, actor, opts)
                2nd config {html:false} ┤      escape · neutral wording · plCount · (dla: X)
tab-bar-functions.js default: ──────────┘
```

tab-bar-functions.js injects notification-text.js on demand on pages that don't include it (formularz.html). Until the script loads, every type falls back to "· nowa aktywność". Combined with the stale `?v=15`, this only affects formularz.html.

### Verification evidence

The evidence file reports node --check exit 0 on server.js, notification-text.js, pluralize-pl.js, tab-bar-functions.js, recipients.js, realtime-updates.js, desktop-nav.js and filters.js. init-db.js was checked from the HEAD blob because of an OneDrive read error. The file is unchanged vs HEAD, so this is acceptable. The test cases include XSS payloads in the actor, title and recipient, and the 1/3/5/22 plural boundaries.

</details>

<details>
<summary>File map</summary>

- public/notification-text.js (new): shared neutral wording, escaping, plCount batch text, browser + Node export.
- public/activity.html, recipients.html, tab-bar-functions.js: renderers delegate to notificationText; sentence case; ?v bumps.
- public/intro.html: `Witaj w Prezentowniku`, `Dzięki Prezentownikowi`, sentence case, `Zostań pierwszą aktywną osobą!`.
- server.js: `już` typo, `(dla: X)` push bodies, identify conflict message.
- public/realtime-updates.js, osoby.html, archiwum.html: colon forms, plural counts, archive wording.
- public/home.html, rezerwacje.html, ustawienia.html, leaderboard.html, recipients.js, desktop-nav.js, bottom-tab-bar-snippet.html, tab-bar-demo.html, wiadomosci.html, filters.js: Tier A rewording, commas, sentence case.
- Full diff: `git -P diff --ignore-cr-at-eol`.

</details>
