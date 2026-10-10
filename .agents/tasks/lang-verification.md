# Branch LANG — verification evidence (pass 3)

## Changes this pass
- public/intro.html:478 `Dzięki Prezentownik` -> `Dzięki Prezentownikowi` (dative; found by the leftover grep, same class as `Witaj w Prezentowniku`).
- No other code changes; pass-2 code was already approved.
- LANG made NO edits to public/formularz.html, public/formularz.js or public/sw.js in any pass. The formularz.* diffs (sentence case, removed `Co chciałbyś dostać?`) belong to the UI branch.
- Non-blocking for merge/UI step: formularz.html still loads `tab-bar-functions.js?v=15`; it should be bumped to `?v=16` (LANG can't edit that file).

## node --check (all exit 0)
server.js, public/notification-text.js, public/pluralize-pl.js, public/tab-bar-functions.js,
public/recipients.js, public/realtime-updates.js, public/desktop-nav.js, public/filters.js,
public/formularz.js (not edited by LANG, checked anyway).
init-db.js: the OneDrive copy returned `UNKNOWN: unknown error, read` (cloud placeholder) on 3 tries.
It is unchanged vs HEAD (`git diff --quiet HEAD -- init-db.js` -> 0), and `node --check` on the
HEAD blob (written with `cmd /c git show HEAD:init-db.js > %TEMP%\...`) -> exit 0.

## notificationText test (temp file in %TEMP%, deleted afterwards) — PASS 22/22
Covered: present_added (with recipient / without / recipient == actor, case-insensitive -> no "(dla: …)"),
present_reserved, present_unreserved, present_checked, present_unchecked, recipient_added (with/without name),
present_added_batch with count 1/3/5/22 (`1 nowy prezent`, `3 nowe prezenty`, `5 nowych prezentów`, `22 nowe prezenty`),
unknown type with actor and with null actor (`Ktoś · nowa aktywność`), empty-string actor -> `Ktoś`,
missing title -> `„prezent”`, HTML escaping of actor `<b>O'Hara</b>`, title `<img src=x onerror=alert(1)>`,
recipient `Tom & "Jerry"` and `<script>` (all escaped to &lt; &gt; &amp; &quot; &#39;),
opts `{html:false}` (plain text, no escaping), `{showActor:false}` (`· kupione: …`), and custom
actor/person/present callbacks (receive escaped values).
Example: `<strong>Monika</strong> · nowy prezent <strong>„Książka”</strong> (dla: <strong>Tomek</strong>)`.

## Leftover grep (public/*.js|*.html except formularz.* / sw.js / *.min.*, plus server.js)
Patterns: `ł(a)`, `(-a)`, `(-aś)`, `\w+eś `, `mógł`, `zidentyfikowan`, `chciałbyś`, `wykonał akcję`, `pod rokiem`, `já `, `Prezentownik[^ua]`, Title Case labels.
- `(-a)`, `(-aś)`, `chciałbyś`, `wykonał akcję`, `pod rokiem`, `já `: no hits.
- `ł(a)`: only notification-text.js:3, a comment describing the old wording. Intentional.
- `jesteś` (home.html:1291, recipients.html:1226 `Czy to jesteś Ty?`, ustawienia.html:90 `kim jesteś`): not gendered. Fine.
- `mógł`: recipients.js:1004 `Serwer mógł się jeszcze budzić`. Subject is the server (masculine noun). Fine.
- `zidentyfikowan*`: server.js:977/997/3466 `Ta osoba została już zidentyfikowana` (agrees with feminine noun `osoba`),
  osoby.html:208 / recipients.js:1437 `osoby są zidentyfikowane` (plural noun), `zidentyfikowano` impersonal forms
  (recipients.js:1368/1524/1561, ustawienia.html:439), `niezidentyfikowanych osób` (ustawienia.html:99), a code comment
  at recipients.js:1084. All neutral or noun-agreeing. Fine.
- `Prezentownik` nominative: page titles / `Prezentownik v1.0` footers (nominative is correct). intro.html:478 fixed this pass.
- Title Case: only ustawienia.html:119 `Dodaj Prezenty do ekranu głównego`. `Prezenty` is the PWA short_name (manifest.json), so it's a proper noun. Intentional.
- Generic `użytkownik` nouns (e.g. `przez innego użytkownika`) left as the audit allows.

## Constraints
- Joke recipients.js:3313 (`Sorry, teraz to już po ptokach! … Trzeba było szybciej rezerwować matole! Wybierz coś innego.`): not in the diff vs HEAD (`git diff HEAD -- public/recipients.js | Select-String matole` -> no match). Unchanged.
- public/sw.js: unchanged vs HEAD.
- Nothing committed or pushed.
