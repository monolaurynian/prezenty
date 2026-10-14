# Prezenty - user journey map: evidence and inefficiency register

Read-only investigation of `main` @ e20c501. No product code, config or git state was changed. Throwaway scripts lived in `.agents/tasks/tmp-journey/` and were deleted afterwards; every measurement table they produced is reproduced below.

## 0. Summary answer

The app has no admin or organiser role. There are three real actors: a **visitor** (adds a wish via `/formularz` without login), a **logged-in user** who is a **giver** by default, and the same user once they **identify as a recipient** (spoiler shield). Chat adds the roles **initiator** and **target** per thread. Every logged-in user can run destructive organiser actions (archive the whole year, delete people and their presents).

The core giver loop (find a present, reserve, mark bought, undo) is fast and well designed once the page is loaded. Measured in a real browser: the UI reacts in 3-8 ms (optimistic), every reserve/buy/cancel shows a "Cofnij" toast, and server confirmation costs 3-4 requests. The inefficiencies are around that loop, not inside it:

1. **Session expiry and offline are treated as "nothing happened" or as "go to login".** After the cookie is lost, the home page shows a red "Wymagana autoryzacja" toast on the first click and then every later button is dead (uncaught `TypeError` in `optimisticUpdatePresent`, `window._homeData.presents` is `undefined`). An open chat thread silently empties itself on the next 8 s poll. Offline, every page bounces to the cached home page and shows skeleton cards forever. This matches the user report "my user is not authenticated" with no visible message. (F28, F27)
2. **Bytes and requests are dominated by two images and by cache headers, not by code.** `seba.jpg` (1,010.7 KB) loads on every page and `seba_logo.png` (447.9 KB) on recipients: about 90% of the local bytes of home and recipients. JS and CSS are served `no-cache, must-revalidate` even with `?v=N`, so a repeat visit without the service worker costs 44 requests on home (all 304s) and 38 on recipients. (F17, F19)
3. **Home makes 18 API calls per load** (identification x6, recipients-with-presents x5, leaderboard x2, plus auth, recipients, version and two badge counts) and 4 calls per reserve/buy. A hidden one-shot reload doubles the first load after every logout done from the home page. (F20, F21)
4. **Live updates are half-wired.** Home never refreshes (verified: not after 25 s). Recipients refreshes via polling (about 8 s measured) but the update path re-renders the row with older markup: own reservation becomes a single icon-only red "Anuluj" with no "Kupione" button (verified DOM). (F22, F23)
5. **Navigation has four generations stacked.** Dock + FAB menu (live), four hidden hamburger sidebars (dead markup, one of them pulls a 448 KB image), a desktop nav, and orphan pages (`intro.html`). `/osoby` and `/archiwum` have no dock on mobile. The "Czat" dock tab is a 58x10 px empty link on `/rezerwacje` and `/ustawienia`. (F7, F9, F10)
6. **First-run is thin.** Register lands on `/recipients` (not `intro.html`, which has no inbound link). The unidentified user's main CTA ("Dodaj" composer) answers with a plain-text "Najpierw zidentyfikuj się w Ustawieniach..." with no link. (F13, F32)

Top quick wins (S effort, H/M impact): central 401/offline handling (F28), resize the two images (F17), long-lived cache headers for `?v=` URLs (F19), reuse `generateReservationButton` in the live-update path (F23), remove the home one-shot reload (F21), dedupe home boot calls (F20), name the dock close buttons and close the broken `<div>` on two pages (F7). Ranking in section 7.

## 1. Method, environment, legend

**Environment.** Demo server (`PORT=3071`, `DEMO_MODE=true`, `NODE_ENV=development`) booted per script and killed afterwards (no listener left on 3071). Playwright + installed Edge (`channel: 'msedge'`), viewport 375x812, touch, `serviceWorkers: 'block'` unless stated. CDN assets served from `tests/.cache/cdn` (so CDN time is ~0 and CDN bytes below are raw file sizes). Server-side request counts come from a `--require` hook that logs status per request (200 vs 304, Referer), so they are exact. The full Playwright suite was not run.

**Caveats.** localhost, no network or CPU throttling, headless Edge: timings are lower bounds, request counts and bytes are real. Page routing (`context.route`) disables Chromium's HTTP cache, so cache behaviour was measured separately in a persistent context without routing (T4). Demo mode differences that matter: identification is always `isIdentified:false` while recipient "Jan Nowak" has `identified_by: 1` (so the identification modal never opens), `/api/updates` is always empty (`updateTracker` is not called in demo), `/api/formularz/present` returns `{success:true}` without persisting, archive is unavailable.

**Legend.** **VERIFIED** = observed in a run or measured. **INFERRED** = from reading code only. Taps are mobile unless marked (D) desktop.

**Corrections to the brief's assumptions.** (1) Recipients loads 24 local JS files, home loads 21 (the same 11 `recipients-*.js` files plus 10 others), not just recipients. (2) The home one-shot reload (`home.html:12-43`) is keyed by `localStorage.homePageVersion`, a `sessionStorage` flag and `PAGE_VERSION='3.0.0'`; it fires on first visit per profile and again after any logout that runs `localStorage.clear()` (home page's own `logout()`), verified. (3) Express `compression` is enabled (`server.js:34-44`, level 6, gzip). (4) The a11y suite has 10 `test.fixme` (one per page in `PAGES`) plus 1 in `edit-sheet.spec.js` (focus return), 11 in total.

## 2. Personas and goals (roles verified in code)

No `admin`/`role` column or check exists in `routes/*.js`, `lib/*.js`, `server.js` (grep). `requireAuth` only tests `req.session.userId`.

| Persona | How the code defines it | Goal | Main screens |
|---|---|---|---|
| Visitor / family member without account | No session; `/formularz` has no auth (`routes/pages.js:53`), `POST /api/formularz/present` is public (`routes/formularz.js:51`) | Put a wish on the list for themselves or someone else | index -> `/formularz` (add tab) |
| Giver (default logged-in user) | `users` row + session; `recipients.identified_by` unset | Find a present, reserve it, buy it, not duplicate others | HOME, REC, RES, ACT, CHAT |
| Recipient (identified giver) | `recipients.identified_by = userId` (`POST /api/recipients/:id/identify`) | List own wishes, not see what others reserved/bought | FORM (edit tab), SET |
| Chat initiator | `threads.initiator_id` (sees recipient's name) | Ask a question anonymously | CHAT_LIST, CHAT_THREAD |
| Chat target ("Święty Mikołaj 🎅" for the initiator) | `threads.target_id` | Answer and react without learning who asked | CHAT |
| System | `lib/cron.js` nudge: daily 17:00 UTC, 1-23 Dec, only for "reserved but not bought"; keep-alive ping every 14 min on Render; `updateTracker` (100 entries in memory) | Keep users engaged, keep free host awake | push |
| (Implicit) organiser | Not a role: any user sees "Zamknij rok i archiwizuj" (`archiwum.html`), can delete unidentified people and their presents (`/osoby`) | Close the year, clean up | ARCH, PEOPLE |

## 3. Journeys

Format per step: **screen/URL** · **control** (Polish label · selector/file) · **effort** · **calls** · **freshness** · **feedback** · **failure**. Counts are from the demo run (same on prod except where noted).

### J1 First visit: landing -> register/login -> onboarding -> home (VERIFIED unless marked)

| # | Screen / URL | Control | Effort | Calls | Freshness | Feedback | Failure |
|---|---|---|---|---|---|---|---|
| 1 | `/` -> `index.html` (`routes/pages.js:7`, no session) | open app | 0 | 11 requests (CDN incl.); `/health` polled by `index-page.js:1-34` | static | cold-start overlay "Budzimy serwer..." only if `/health` > 2.5 s | server asleep: overlay + retry every 3 s |
| 2 | login | "Nie masz konta? Zarejestruj się" (`a.btn-link`, `toggleToRegister`) | 1 tap, 300 ms fade | 0 | | fade | |
| 3 | `/register` | 3 fields (`#username` >=3, `#password` >=6, `#confirmPassword`) + "Zarejestruj się" | 3 fields, 1 tap | `POST /api/register` x1 | | button spinner "Rejestracja..." | inline alert (client rules, server error, "Błąd połączenia z serwerem") |
| 4 | redirect `/recipients` (`register.js:44`) | none | 0 | 9 on load (rwp, identification, 3x unread-count, version, auth, ...) | persistent cache shown first, refreshed if older than 30 s (`recipients-startup.js`), then polling | skeleton cards | on auth fail: silent redirect `/` |
| 5 | `/recipients` | identification modal auto-opens at +500 ms (`handleIdentificationLogic`, `recipients-toast-undo.js:221`): "Potwierdź swoją tożsamość" if username equals a recipient name, else "Wybierz swoje imię" with "To jestem ja" list and "Dodaj i zidentyfikuj" (INFERRED: demo cannot show it) | 1 tap (or type name + 1 tap) | `POST /api/recipients/:id/identify` + softReload (rwp + identification) | | toast "Pomyślnie zidentyfikowano!" | `showErrorModal` text; modal reopens on every `/` and `/recipients` load until identified |
| 6 | `/recipients` | to reach home: dock "Główna" | 1 tap | home boot (18 calls) | | | |
| - | `intro.html` | **no inbound link anywhere** (grep of all `href`/`location`); `startApp()` writes `localStorage.introCompleted` which nothing reads | unreachable | `/api/leaderboard` | | | orphan |

Returning login: 2 fields + "Zaloguj się" (spinner "Logowanie..."), `POST /api/login`, 300 ms fade, `/` -> `home.html`. Errors inline ("Nieprawidłowa nazwa użytkownika lub hasło.", 5xx text, offline text). Cost for a new user: 3-4 taps, 5 fields (about 25-35 keystrokes). First home load in a fresh profile does the one-shot reload (F21).

### J2 Identify yourself as a recipient

Entry points (three, different behaviour): (a) auto modal on `/` and `/recipients` (500 ms after load); (b) "To jestem ja" on every person card header, only while the user has no identification (`!isIdentified && !hasAnyIdentification`, `recipients-list.js`); (c) Ustawienia -> "Mój profil" -> select "Wybierz osobę..." + "To jestem ja" (`ustawienia-page.js:231`, toast "Zidentyfikowano! Twoje prezenty będą przed Tobą ukryte."). Taps from home: (c) = 1 (avatar top right) or 2 (FAB) + select + 1.

Cancel: card "To jest Twój profil" -> confirmation modal (2 taps); Ustawienia "To nie ja - anuluj" (`cancelIdentification`) fires `DELETE .../identify` **immediately with no confirmation** and un-hides every gift (F40). The selection modal puts a trash button (`btn-outline-danger`, no label) next to "To jestem ja" that deletes a person and all their presents behind one `confirm()` (`recipients-identify.js` `deleteRecipientFromSelection`).

Spoiler shield is client-side: `/api/recipients-with-presents` returns all presents including `reserved_by`/`is_checked` for the identified user's own gifts; `recipients-startup.js:15-82` filters them in the browser; `/api/formularz/my-presents` selects every present of the user's recipient with no `created_by` filter (`routes/formularz.js:226-229`), against `docs/archive/misc/PRIVACY_FEATURES.md` ("only their own added presents"). INFERRED, needs a DB run to confirm (F16).

### J3 Find a present for someone and reserve it

**Path A - from home.** Home (dock "Główna", 1 tap) -> accordion "Dostępne prezenty" (open by default) -> `button.btn-reserve` "Zarezerwuj" (`home-page.js` `reservePresent`).
- Effort: 1 tap, first button at y=532 px of an 812 px viewport (no scroll needed). 7 available presents in 5 person cards in demo.
- UI: present leaves "Dostępne" and appears in "Moje rezerwacje" in 3-8 ms (in-page timing).
- Calls per action (VERIFIED): `POST /api/presents/:id/reserve`, `GET /api/leaderboard`, `GET /api/user/identification`, `GET /api/recipients-with-presents` = 4.
- Feedback: toast "Prezent zarezerwowany! 🎁" + "Cofnij" (6 s configured; measured 6.4 s isolated, 5.1 s when chained 1.2 s after another toast, 0.7 s in a 4-action chain: F25).
- Failure: rollback + toast; offline gives "Błąd połączenia. Zmiana została cofnięta." (VERIFIED); 409 gives server text "Prezent jest już zarezerwowany"; session lost gives "Wymagana autoryzacja" and then a dead page (F28).
- Where the present went: "Moje rezerwacje" starts at y=2086 px (2.6 screens down), "Kupione" at y=2346; page height 3094 px.

**Path B - from recipients.** Dock FAB (1) -> "Wszystkie prezenty" (1) = 2 taps -> filter panel (always open, 311 px) -> optional "Osoba" `<select>` (native picker, 2 taps) -> scroll -> `button.btn-reserve` "Zarezerwuj" (`handleReserveClick`).
- First reserve button at y=1162 px: below the first screen (the 311 px filter panel comes first and, in the demo data, the first person card has no reserve button); page 3414 px, person cards start at y=319, 677, 1278, 2085, 2757.
- UI 2-8 ms; calls: `POST reserve`, `GET recipients-with-presents`, `GET user/identification` = 3; toast + "Cofnij" -> `undoReservation` (DELETE + softReload).
- Other state: grey "Niedostępne" (mobile) / icon-only bookmark (>=md) opens `reservedByOtherModal` with fixed copy that ignores the name (`recipients-optimistic.js:206`: "...Trzeba było szybciej rezerwować matole!"); the reserver name is only in the `title` tooltip.
- Deep links into the same screen: leaderboard row -> `?osoba=`, activity items -> `?osoba=`, push click -> `?osoba=&prezent=` (service worker + `filters.js` highlight), `shareFormularzLink` URLs go to `/formularz?osoba=`.

### J4 Mark reserved as bought

Three surfaces, three behaviours: recipients (row button "Kupione" replaces "Zarezerwuj" in the same row; 1 tap; PUT check + rwp + identification = 3 calls; toast "Oznaczono jako kupione 🛍️" + "Cofnij"); home ("Kupione" in "Moje rezerwacje", needs a 2.6-screen scroll first; 1 tap; PUT check + identification + rwp + leaderboard = 4 calls; same toast); `/rezerwacje` ("Kupione" `btn-buy`, 1 PUT, toast without action, no undo). Minimum path is reserve + buy = 2 taps; there is no direct "already bought" action. The server's `PUT /api/presents/:id/check` does not look at `reserved_by` (`routes/presents.js:351-428`), so "bought follows reservation" is UI-only.

### J5 Cancel reservation / undo

Home: "Anuluj" (red outline) in "Moje rezerwacje" -> DELETE + 3 calls, toast "Rezerwacja anulowana" + "Cofnij" (re-reserve may fail with 409 if someone took it); "Anuluj zakup" in "Kupione". Recipients: "Anuluj" (icon + label), same toast pattern. `/rezerwacje`: "Anuluj" and "Cofnij kupione", toasts without undo. Ctrl+B "Zarezerwowane prezenty" modal (keyboard only): `cancelReservationFromModal` behind `confirm()`. Undo toast limits: 6 s, may be shortened by an earlier toast (F25).

### J6 Add a present I want (formularz), with link/comment, edit, delete

| # | Screen | Control | Effort | Calls | Feedback | Failure |
|---|---|---|---|---|---|---|
| 1 | dock "Dodaj" (`a.tab-item.form-tab`, JS appends `?add=1` on click, `tab-bar-functions.js:577-596`) | 1 tap | | `/formularz` page load: 6 calls (2 unread-counts, auth, identification, formularz/recipients, my-presents) | composer docks above the dock | |
| 2 | composer | `#quickAddTitle` "Nazwa prezentu…" (focus, keyboard opens) | type | | | |
| 3 | optional details | `#quickAddToggle` / "Szczegóły ułatwią zakupy 🎯" -> `#quickAddComments` "Rozmiar, kolor, link do sklepu…" | 1 tap + type | | | link is plain text inside title/comment; no link field, no preview (previews exist only in chat) |
| 4 | send | round `#quickAddBtn` "+" (or Enter, `enterkeyhint=send`) | 1 tap | `POST /api/formularz/present` x1, then `GET my-presents` | "Prezent dodany! 🎁" inline + reveal animation | **unidentified user: "Najpierw zidentyfikuj się w Ustawieniach, żeby dodawać prezenty do swojej listy"** (VERIFIED in demo; plain text, no link) (F13) |
| 5 | edit | pencil `button[aria-label="Edytuj prezent"]` 41x40 px | 1 tap, modal "Edytuj prezent" (title, comments) + "Zapisz" | `PUT /api/presents/:id` | list updated in place | `showEditMessage` |
| 6 | edit details | chip "+ Dodaj szczegóły" (32 px high) | 1 tap, opens the edit modal focused on the description | | | |
| 7 | delete | trash `button[aria-label="Usuń prezent"]` | 1 tap + native `confirm("Czy na pewno chcesz usunąć ten prezent?")` (VERIFIED dialog) | `DELETE /api/presents/:id` | optimistic fade-out; no undo toast after success | native `alert()` on failure |

Entry alternatives: FAB -> "Edytuj moje prezenty" (2 taps; sets `openEditTab`, redundant because the edit tab is the default view once `checkAuth` succeeds), desktop nav has both "Dodaj prezent" and "Edytuj moje prezenty" pointing at `/formularz.html`. Drafts are preserved and no field is cleared on error (good).

### J7 Add a present idea for someone else

Possible, three ways: (1) `/formularz` -> "Dodaj dla kogoś innego" (`switchTab('add', true)`): select "Dla kogo?" (list or "+ Dodaj nowe imię") + title + comments + "Dodaj" -> same `POST /api/formularz/present`, message "Prezent został dodany pomyślnie! 🎁", form reset (VERIFIED); (2) person card "Udostępnij" (`shareFormularzLink`: `navigator.share` or clipboard or `window.prompt` fallback) sends `/formularz?osoba=<name>` so that person adds their own wishes without login; (3) login page "Dodaj życzenie bez logowania". Server side: if the named recipient is identified, `created_by` is set to **that recipient's user** (`routes/formularz.js:79-95`), so the idea appears in the recipient's own list as if self-written and counts for their leaderboard "presents added" (F15). Unknown names silently create new recipients; the endpoint has no auth or rate limit.

### J8 Anonymous chat: send, receive reply, react, read the thread list

| # | Screen | Control | Effort | Calls | Freshness | Feedback |
|---|---|---|---|---|---|---|
| 1 | dock "Czat" (`messages-tab`, badge from `/api/wiadomosci/unread-count` every 30 s) | 1 tap | | page load 5 calls (VERIFIED) | | skeleton none, spinner-less list |
| 2 | `/wiadomosci` list | compose block is **above** the list: `#targetSelect` "Do kogo?" (native select, 301x38) + `#composeBody` + "Wyślij" | 2-3 taps + typing | `POST /api/wiadomosci/threads`, then `GET threads` | list polls every 60 s, plus on `visibilitychange` and SW `push` relay | toast "Wiadomość wysłana anonimowo! 🎅" |
| 2b | alt entry | person card "Wiadomość" (`?do=<userId>`, only for identified others), avatar preview modal "Wyślij anonimową wiadomość" (home) | 1-2 taps | opens new-chat view | | text "Napisz pierwszą anonimową wiadomość do X - zobaczy tylko Świętego Mikołaja." |
| 3 | list | thread row (`.thread-row`, label "Święty Mikołaj 🎅" for the target side, unread bubble count) | 1 tap | `GET /api/wiadomosci/threads/:id` (full thread every time) | open thread polls every **8 s** (full re-fetch) | spinner then bubbles; marks read, updates dock badge |
| 4 | thread | reply `#replyBody` + Enter or `#replyBtn` | 1 tap + typing | `POST .../messages` then full `GET thread`; bubble appears in <1 s (VERIFIED: 7 -> 8 bubbles, input cleared) | | input kept on error (good), toast "Nie udało się wysłać" |
| 5 | thread | react: `.chat-reaction-add` "Dodaj reakcję do wiadomości" (44x32 px) -> sheet of 6 emoji (105x56 each) -> pick = **2 taps**; chip tap toggles (53x32) = 1 tap | | `POST .../reactions` | reactions ride along in the 8 s poll | chip strip repaint without scroll jump |
| 6 | list | preview line: other side's newest reaction if newer than last message: **"Zareagowano 🙏 na „Niezwyklenieprawdopodobnieskomplikowanazabawkaedu…”"** (VERIFIED row "Ola") | | | | |
| 7 | thread | trash -> `confirm()` "Usunąć tę rozmowę? Zniknie ona również u drugiej osoby. Tej operacji nie można cofnąć." | 1 tap | `DELETE thread` | | toast "Rozmowa została usunięta" |

Taps: Czat (1) + row (1) + "+" (1) + emoji (1) = 4 to react from anywhere. Reactions do not push (by design), messages do (SW suppresses the OS notification when that thread is visible). 401 behaviour: F28.

### J9 Activity/notifications and enabling push

Notifications: dock bell (1 tap) opens a bottom sheet (10 items, `GET /api/notifications?limit=10&offset=0`, one item opens `/recipients.html?osoba=..&prezent=..`); **closing the sheet marks everything read** (`POST /api/notifications/read-all`, `tab-bar-functions.js:53-56`); "Zobacz wszystkie powiadomienia" (1 tap) -> `/activity.html` (20 per page, "Oznacz wszystkie"). Desktop has only the page (+ badge). Badges poll every 30 s (up to 3 pollers on recipients). Push: FAB (1) -> Ustawienia (1) -> "Włącz powiadomienia" (`#enableNotifBtn`, 1) -> browser permission prompt (1) -> `GET /api/vapid-public-key`, `POST /api/notifications/subscribe`. The permission is never requested in context (e.g. after the first reservation); the install prompt exists only on the login page and in Ustawienia -> "Zainstaluj aplikację". Push channels (code): new present (to everyone except the actor), chat messages, Christmas nudge. Not pushed: reservations, purchases, reactions.

### J10 Leaderboard

FAB (1) -> "Ranking" (1): `/leaderboard.html`, `GET /api/leaderboard` (public endpoint, no `requireAuth`). Four blocks (activity podium, activity list top 10, wishes podium, full ranking), 4812 px tall (5.9 screens), 3 API calls on load. Row tap -> `/recipients.html?osoba=<name>` (1 tap). Empty state "Dołącz do Rankingu!" -> `/formularz.html`.

### J11 Browse an archived year

FAB (1) -> "Archiwum" (1): `archiwum.html` has **no dock** (only "Powrót" -> `/`). `GET /api/archive/years` -> pills per year -> `GET /api/archive/presents?year=`. Empty state "Archiwum jest puste". "Zamknij rok i archiwizuj" is visible to every user; modal asks for year + typing `ARCHIWIZUJ`, `POST /api/archive/run` (server rejects in demo). Cost to archive: 5+ taps and 10 characters; guarded only by that word.

### J12 Settings, log out, log in again after the session expires

Settings: avatar top right on home (1 tap) or FAB -> "Ustawienia" (2 taps). Sections: "Mój profil" (identify/photo/cancel), "Zarządzanie osobami" -> `/osoby` (3 taps from home; add person, edit/delete presents of unidentified people, "Porzucone prezenty"), "Powiadomienia", "Zainstaluj aplikację", "Konto" (rename with password check, "Wyloguj", delete account with 2-step). Logout: FAB -> "Wyloguj" (2 taps) -> `POST /api/logout` -> `/`. There are 9 independent `logout()` implementations with different clean-up (F30). Session: cookie `prezenty.sid`, 30 days from login, no `rolling` (`server.js:98-110`); prod uses the MySQL store, demo an in-memory store (a server restart logs everyone out). What each page does on 401 is in F28. Re-login: 2 fields + 1 tap.

### J13 Returning from the home-screen icon (cold start, SW, offline)

`manifest.json`: `start_url: "/"`, `display: standalone`. `/` -> `home.html` with session, else login. Service worker `prezenty-v129`: HTML network-first, everything else cache-first, `/api/` never intercepted. Repeat navigation, no SW: 44 requests on home, all conditional (T4); with SW: 26 on 2nd and 20 on 3rd navigation. First paint warm: FCP 304 ms, first real content 492 ms (home), 379 ms (recipients) on localhost (T2). `update-checker.js` polls `/api/version` every 5 min and on visibility/online, shows a green banner "Nowa wersja dostępna! Odśwież teraz / Później" (reload deletes all caches). Offline (VERIFIED with SW): see F27.

### J14 Manage people (osoby) and J15 anonymous visitor

`/osoby` (Ustawienia -> "Zarządzanie osobami"): "Dodaj osobę" (name + Dodaj), per-person present edit/delete, "Usuń osobę" behind `confirm()`, "Porzucone prezenty". No dock on mobile; back = "Ustawienia". Visitor: login page -> "Dodaj życzenie bez logowania" -> `/formularz` (unauthenticated: add tab, select name or "+ Dodaj nowe imię"). Both reachable by URL without a login redirect for `.html` forms (static middleware precedes the page router).

## 4. Screen and navigation graph

### 4.1 Nodes

LANDING (login, `index.html`), REG (`register.html`), HOME (`home.html`, "Strona główna"), REC (`recipients.html`, "Wszystkie prezenty"), FORM_EDIT (`formularz.html` edit tab "Moje prezenty" + quick-add composer), FORM_ADD (`formularz.html` add tab "Dodaj dla kogoś innego"), CHAT_LIST, CHAT_THREAD, REACT_SHEET, ACT_PANEL (dock bottom sheet "Powiadomienia"), ACT (`activity.html`), LEAD (`leaderboard.html`), RES (`rezerwacje.html`), SET (`ustawienia.html`), PEOPLE (`osoby.html`), ARCH (`archiwum.html`), ARCH_MODAL ("Zamknij rok"), INTRO (`intro.html`), MENU (FAB panel "Menu"), IDENT_MODAL ("Potwierdź swoją tożsamość"), SELECT_MODAL ("Wybierz swoje imię"), AVATAR_MODAL (profile photo preview), RESBY_MODAL ("już zarezerwowane"), RESERVED_MODAL ("Zarezerwowane prezenty", Ctrl+B), EDIT_MODAL ("Edytuj prezent"), PUSH (browser prompt), UPDATE_BANNER, OFFLINE (SW fallback / skeleton loop), MAINT (`maintenance.html`).

### 4.2 Edges (mobile unless marked; D = desktop only)

```
LANDING --(Zaloguj się: 2 fields + 1 tap)--> HOME
LANDING --(Nie masz konta? Zarejestruj się, 1 tap)--> REG
LANDING --(Dodaj życzenie bez logowania, 1 tap)--> FORM_ADD
REG --(Zarejestruj się: 3 fields + 1 tap, redirect)--> REC          [skips INTRO]
REC --(auto +500ms if unidentified)--> IDENT_MODAL / SELECT_MODAL   [also from HOME]
HOME --(auto +500ms if unidentified)--> IDENT_MODAL / SELECT_MODAL
IDENT_MODAL --(To jestem ja, 1 tap)--> REC
SELECT_MODAL --(To jestem ja / Dodaj i zidentyfikuj, 1 tap)--> REC
HOME --(dock Aktywność, 1 tap)--> ACT_PANEL
ACT_PANEL --(Zobacz wszystkie powiadomienia, 1 tap)--> ACT
ACT_PANEL --(notification item, 1 tap, full navigation)--> REC (?osoba=&prezent=)
ACT --(item link, 1 tap)--> REC (?osoba=) | CHAT_THREAD | LEAD
HOME --(dock Czat, 1 tap)--> CHAT_LIST
HOME --(dock Dodaj, 1 tap, +?add=1)--> FORM_EDIT
HOME --(avatar top right, 1 tap)--> SET
HOME --(FAB, 1 tap)--> MENU
MENU --(Wszystkie prezenty, 1 tap)--> REC                          [HOME->REC = 2 taps]
MENU --(Zarezerwowane prezenty, 1 tap)--> RES                      [2 taps]
MENU --(Ranking, 1 tap)--> LEAD                                    [2 taps]
MENU --(Edytuj moje prezenty, 1 tap)--> FORM_EDIT                  [2 taps]
MENU --(Ustawienia, 1 tap)--> SET                                  [2 taps]
MENU --(Archiwum, 1 tap)--> ARCH                                   [2 taps]
MENU --(Wyloguj, 1 tap)--> LANDING                                 [2 taps]
HOME --(person avatar, 1 tap)--> AVATAR_MODAL --(Wyślij anonimową wiadomość, 1 tap)--> CHAT_THREAD (new)
HOME --(Zarezerwuj / Kupione / Anuluj / Anuluj zakup, 1 tap)--> HOME (bucket move + toast Cofnij)
REC --(Zarezerwuj / Kupione / Anuluj / Anuluj zakup, 1 tap)--> REC (in place + toast Cofnij)
REC --(grey Niedostępne, 1 tap)--> RESBY_MODAL
REC --(To jestem ja, 1 tap)--> IDENT_MODAL
REC --(Wiadomość, 1 tap, identified others only)--> CHAT_THREAD (new, ?do=)
REC --(Udostępnij, 1 tap)--> OS share sheet / clipboard / prompt()
REC --(own card accordion: edit icon, 2 taps)--> EDIT_MODAL
REC --(Ctrl+B)--> RESERVED_MODAL                                   [D only; #reserved deep link has no inbound link]
CHAT_LIST --(thread row, 1 tap)--> CHAT_THREAD
CHAT_LIST --(select + text + Wyślij, 2 taps + typing)--> CHAT_LIST (toast)
CHAT_THREAD --(+ under bubble, 1 tap)--> REACT_SHEET --(emoji, 1 tap)--> CHAT_THREAD
CHAT_THREAD --(back, 1 tap)--> CHAT_LIST
FORM_EDIT --(Dodaj dla kogoś innego, 1 tap)--> FORM_ADD
FORM_ADD --(back link, 1 tap)--> FORM_EDIT
FORM_EDIT --(pencil / + Dodaj szczegóły, 1 tap)--> EDIT_MODAL
FORM_EDIT --(trash, 1 tap)--> native confirm()
SET --(Zarządzanie osobami, 1 tap)--> PEOPLE                       [HOME->PEOPLE = 3 taps]
SET --(Włącz powiadomienia, 1 tap)--> PUSH                         [HOME->PUSH = 3 taps + prompt]
SET --(Wyloguj, 1 tap)--> LANDING
PEOPLE --(Ustawienia, 1 tap)--> SET                                [no dock]
ARCH --(Powrót, 1 tap)--> HOME                                     [no dock]
ARCH --(Zamknij rok i archiwizuj, 1 tap)--> ARCH_MODAL
LEAD --(user row, 1 tap)--> REC (?osoba=)
LEAD --(CTA Dołącz do Rankingu!, 1 tap)--> FORM_EDIT
RES --(Przeglądaj prezenty, 1 tap, empty state)--> REC
INTRO --(startApp, 1 tap)--> REC                                   [INTRO has no inbound edge]
any with API --(network error)--> OFFLINE                          [recipients/wiadomosci/ustawienia/rezerwacje/osoby: location.href='/']
any --(maintenance)--> MAINT
Desktop (>=992 px): left nav (desktop-nav.js) --(1 click)--> HOME, ACT, REC, LEAD, FORM_EDIT ("Dodaj prezent" and "Edytuj moje prezenty" both -> /formularz.html), RES, CHAT_LIST ("Anonimowe wiadomości"), ARCH, SET, LANDING (Wyloguj); profile block -> SET.
```

### 4.3 Dead ends, duplicates, orphans (VERIFIED by DOM scan at 375 and 1280 px unless marked)

- **Dead ends on mobile**: PEOPLE and ARCH (no dock, no FAB; only the page's own back link), MAINT, INTRO. Dock exists on 8 pages (home, recipients, formularz, wiadomosci, activity, leaderboard, rezerwacje, ustawienia).
- **Orphans / dead markup**: `intro.html` (no inbound link); `recipients.html#reserved` and Ctrl+B/K/P/F shortcuts (no touch entry); `tab-bar-demo.html` and `bottom-tab-bar-snippet.html` in `public/` (served, unlinked); four hamburger sidebars (`activity`, `leaderboard`, `formularz`, `recipients`: `[onclick*=toggleSidebar]` is not visible at either width; recipients has no opener at all) with an `<img src="seba_logo.png">` that still downloads (447.9 KB on recipients, VERIFIED); `/statystyki` legacy redirect.
- **Duplicated paths with different behaviour**: reserve/buy/cancel on HOME, REC, RES, RESERVED_MODAL (different code, undo vs none, `confirm()` vs toast); reservations listed as "Moje rezerwacje" (home), "Do kupienia" (RES), "Zarezerwowane" (filter, FAB), "Zarezerwowane prezenty" (modal); identify via modal, card button, Settings; edit my presents via composer tab, FAB item, own-card accordion, desktop nav (two items, one URL); notifications via dock sheet, `/activity`, `#notificationBanner` on recipients; settings via avatar, FAB, desktop profile block; messages via dock, card button, avatar modal, activity link; two spellings per URL (`recipients.html` in dock vs `/recipients` in routes; SW cache and auth redirect behave differently, VERIFIED offline).

## 5. Inefficiency register

Columns: ID · journey/step · symptom · evidence · V = VERIFIED / I = INFERRED · impact H/M/L (who, how often) · effort S/M/L · fix.

### (a) Interaction cost and structure

| ID | Where | Symptom | Evidence | V/I | Impact | Effort | Fix |
|---|---|---|---|---|---|---|---|
| F1 | J3 B, HOME dock | The giver's main browse screen "Wszystkie prezenty" is 2 taps deep; the 4 dock slots are Główna, Aktywność, Czat, Dodaj | `home.html:301-345` (dock and menu panel); FAB items listed at runtime | V | M (all givers, every session) | S | Put "Prezenty" in the dock (e.g. replace Aktywność, reachable from badge/FAB) |
| F2 | J3 B | On recipients the first "Zarezerwuj" is at y=1162 px (>812): filter panel is always open (311 px) and the page is 3414 px | measured layout; `recipients.html:150-190` | V | M (every recipients visit) | S | Collapse filters into a chip row or sheet; open at the first actionable card |
| F3 | J3 A/J4 | After reserving on home, the present moves to "Moje rezerwacje" at y=2086 (2.6 screens away); "Kupione" y=2346; catalogue first, own work below | measured 3094 px page | V | M | S-M | Order buckets by user intent (own reservations first when non-empty) or sticky bucket tabs/counters |
| F4 | J4 | Reserve then buy is always 2 taps and the server does not tie `check` to the reservation; no "already bought" shortcut | `home-page.js` buttons; `routes/presents.js:351-428` | V/I | M | M | Add "Kupione" on available rows (reserve+check, 1 tap) with one combined undo |
| F5 | J3-J5 | Same reservations in 4 places under 4 names, with different undo/confirm behaviour | `home.html`, `rezerwacje-page.js:48-130`, `recipients-modals.js` `cancelReservationFromModal`, filter label | V | M | M | Keep HOME + REC; turn RES into a link or drop it; remove Ctrl+B modal |
| F6 | all | Inconsistent wording: "Kupione" is a button, a bucket and a filter; "Anuluj" (cancel reservation) vs "Anuluj zakup" vs "Cofnij kupione" vs toast "Cofnij"; app named "Prezenty", "Prezentownik", "Życzenia Prezentowe"; "Główna"/"Strona główna", "Czat"/"Anonimowe wiadomości", "Dodaj"/"Dodaj prezent"/"Formularz"; reserved-by-other modal text is an insult ("matole") and ignores the name | titles in `home.html`, `leaderboard.html`, `index.html`, manifest; `desktop-nav.js:22-30`; `recipients-optimistic.js:206` | V | L-M | S | One glossary; neutral copy; show who reserved in the modal |
| F7 | a11y | Unnamed icon-only controls: `button.tab-bar-menu-close` and `button.tab-bar-notifications-close` on all 8 pages that have the dock (the 10 `test.fixme` cover 10 pages; `/osoby` and `/archiwum` have no dock); `a.tab-item.messages-tab` is a **58x10 px empty link** on `/rezerwacje` and `/ustawienia` (unclosed `<div class="tab-icon-wrapper">` in those two files) so "Czat" is missing from the dock there; identified-user edit/delete icon buttons in the recipients accordion have no `aria-label`; icon-only "Niedostępne"/"Zarezerwowane" at >=md | `tests/e2e/a11y.spec.js:53-79` + live scan T6; `recipients-list.js` accordion | V (dock), I (accordion) | M (screen-reader and keyboard users, all pages; dead Czat tab for everyone on 2 pages) | S | `aria-label` on both close buttons; close the div; label the accordion buttons |
| F8 | h | Small targets (<44 px): recipients 11 controls (filter chips 32 px, `select` 39 px, "Udostępnij" 37 px), activity 13 (7 text links 17 px high), reaction "+" 44x32, chips 53x32, formularz edit/delete 41x40, link inside present title 22 px | T6 scan | V | M | S | `min-height:44px` utility on `.btn-sm`, chips, inline links |
| F9 | all | Dead navigation markup: 4 hidden hamburger sidebars with their own `toggleSidebar()` scripts (and `seba_logo.png` 448 KB), dock markup (~110 lines) pasted into 8 HTML files, desktop nav built in JS | grep of 8 pages; DOM scan | V | M (bytes + the F7 bug is a copy-paste artefact) | S-M | Delete sidebars; render dock/menu from one script |
| F10 | J1, J11, J14 | Dead ends and orphans: PEOPLE and ARCH have no dock; INTRO unreachable; register skips INTRO; osoby is 3 taps deep | DOM scan, grep | V | L-M | S | Add dock to both pages; link INTRO from register or delete it |
| F11 | J5 | Keyboard-only "Do kupienia/Zarezerwowane" modal (Ctrl+B) and shortcuts have no touch trigger; `#reserved` deep link unused | `recipients-core.js:563`, `recipients-startup.js:115` | V | L | S | Remove or add a button |
| F12 | J8 | Chat list puts the compose form (select + textarea) above the thread list (first thread at y=564 of 812); reacting costs 4 taps from anywhere; error toast "Nie udało się załadować rozmowy" repeats every 8 s while the thread view is open and the network is down | measured `composeTop 282`, `firstRowTop 564`; `wiadomosci-page.js:61` (8 s poll) and the `.catch` of `loadThreadMessages` (:344) | V/I | L-M | S | List first, compose behind a "Nowa wiadomość" button; one toast per outage |
| F13 | J6 | The primary "Dodaj" action fails for a user who has not identified: text-only error with no link; identification is only offered in Settings, an auto modal elsewhere, or card buttons | VERIFIED message (`formularz.js` `quickAddPresent`) | V | H (every new recipient, first session) | S-M | Inline "Wybierz siebie" select in the composer error state |
| F14 | J5-J7 | Native `confirm()`/`alert()` instead of undo toasts: formularz delete (confirm, alert on failure), osoby delete, identify-modal trash, Ctrl+B cancel, chat "Usuń rozmowę"; no undo after successful delete | `formularz.js:1346-1393`, `osoby-page.js:169,268,310`, `wiadomosci-page.js` `deleteThread` | V (dialog), I (rest) | M | S-M | Replace with the existing `showToast(..., {label:'Cofnij'})` pattern (soft delete for 6 s) |

### (b) Logic and privacy friction

| ID | Where | Symptom | Evidence | V/I | Impact | Effort | Fix |
|---|---|---|---|---|---|---|---|
| F15 | J7 | An idea added for an identified person gets `created_by` = that person; it shows up in their own list and counts for them in the leaderboard. Unknown names create recipients; endpoint is public, no rate limit | `routes/formularz.js:79-95,135-160`; `docs/archive/formularz/FORMULARZ_IDENTIFIED_USER_TRACKING.md` | I | M | M | Store the real submitter; add rate limit/CAPTCHA to the public endpoint |
| F16 | J2 | Spoiler shield is client-side: combined endpoint sends `reserved_by`/`is_checked` of own gifts to the identified user; `my-presents` lists every present of the recipient with no `created_by` filter | `routes/presents.js:117-198`, `routes/formularz.js:226-229`, `recipients-startup.js:15-82`, `PRIVACY_FEATURES.md` | I (needs DB run) | H for the recipient persona (trust) | M | Filter in SQL by identification; return counts only |
| F40 | J2/J12 | "To nie ja - anuluj" in Ustawienia fires immediately, un-hiding every gift; selection modal trash deletes a person + presents | `ustawienia-page.js:248-261`, `recipients-identify.js` | I | M (rare, irreversible spoiler) | S | Confirm modal; remove the trash from the identification modal |
| F35 | J11/J14 | Any user can archive all presents (type `ARCHIWIZUJ`) or delete unidentified people/presents; no role | `routes/archive.js:34-60`, `archiwum.html`, `osoby-page.js` | V (UI), I (server) | M (low frequency, very high blast radius) | S-M | Admin flag or "creator" role; hide for others |
| F41 | J3 | Sorting/state: "reserved by me first" and `Kupione` accordion order apply only on re-render; live-update path never re-sorts | `recipients-present-actions.js:1-25`, `.agents/tasks/investigate-reserve-not-moving.md` §3 | I | L | S | Re-sort on state change |

### (c) Performance and loading (T1-T4)

| ID | Where | Symptom | Evidence | V/I | Impact | Effort | Fix |
|---|---|---|---|---|---|---|---|
| F17 | all pages | `seba.jpg` 1,010.7 KB (body background, `app-theme.css:4`) on every page; `seba_logo.png` 447.9 KB on recipients (sidebar `<img>` + `fast-loader.js:197`). Local transferred bytes: home 1,118 KB of which 90%; recipients 1,599 KB of which 91%; archiwum 1,033 KB of which 98% | T2 `staticKB`; top-8 responses | V | H (first visit on mobile data, after the 1 h `max-age`) | S | Re-encode to ~100-150 KB WebP/AVIF or CSS gradient; remove sidebar img; `loading=lazy`; add to SW precache |
| F18 | HOME/REC | Home loads 21 JS (312 KB raw / 77.7 KB gz), 63% of it the 11 `recipients-*.js` (196 KB / 47.9 KB gz) pulled only for `showToast`, identification and shared helpers; 22 synchronous `<script>` tags; recipients loads 24 JS (345 KB raw) + 6 CSS (214.5 KB raw: `aws-design.css` 98.5 KB, `styles.deduped.min.css` 39 KB) | T1 | V | M | M | Extract a small shared `toast+auth` module; `defer`; bundle per page |
| F19 | all | JS/CSS get `Cache-Control: no-cache, must-revalidate` even when URL has `?v=N` (`server.js:57-70`), HTML `no-store`. Repeat navigation without SW = home 44 server requests (21 JS + 4 CSS + HTML + 17 API all 304, 1 API 200), recipients 38 | T4 | V | H (every page change when SW is not controlling, i.e. first visits, iOS eviction, after F21) | S | `public, max-age=31536000, immutable` for versioned URLs |
| F20 | HOME | One home load = **18 API calls** (identification x6, recipients-with-presents x5, leaderboard x2, auth, recipients, version, wiadomosci/unread-count, notifications/unread-count). Each reserve/buy/cancel = 4 requests (action + leaderboard + identification + rwp). Recipients load = 7-9 incl. `notifications/unread-count` x3 (three scripts poll the same endpoint) | `home-page.js` `loadStats` + the three loaders at lines 66, 213, 233 and `reconcileWithServer` at 391, `home-page-auth.js`, `recipients-page-notifbell.js`, `recipients-page.js:497`; T2 | V | H (every home visit; every action) | M | One boot fetch feeding all sections; reconcile only on error or via `If-None-Match`; delete duplicate pollers |
| F21 | HOME | One-shot reload: `localStorage.homePageVersion !== '3.0.0'` clears all caches, unregisters the SW and reloads after 500 ms (first visit per profile, and again after every logout via the home page's `logout()` which calls `localStorage.clear()`). Cold home = 2 navigations, 90 requests (vs 52 warm), FCP 948 vs 304 ms, 4-5 "Failed to fetch" console errors from aborted requests; SW must be reinstalled (about 50 extra precache requests) | T2 and the logout test (home logout: 2 navigations after re-login, recipients logout: 1) | V | M (every login after a home logout; every new device) | S | Delete the block (the SW `CACHE_NAME` already versions); never unregister the SW |
| F22 | HOME/REC/CHAT | Polling: `/api/updates` every 10 s on home and recipients, plus `/api/recipients-hash` every 10 s on recipients when no updates; 70 s idle windows: recipients 20 requests (17/min), home 11 (9.4/min), chat thread 13 (11/min, full thread every 8 s), other pages 4 (3.4/min); no `document.hidden` check (INFERRED). On home the updates do nothing: handlers target `[data-present-id]`/`.presents-list` that home does not render, and home never refetches (cross-tab test: home not updated in 25 s) while still toasting "Zaktualizowano N elementów" when updates exist | T3, `realtime-updates.js:51-52,120-190`, cross-tab run | V/I | H (freshness for givers who race each other), M (cost) | M | Visibility-aware polling; single `/api/updates` etag; or SSE; home subscribes to the same stream |
| F23 | REC | Live-update render path is a different generation of markup: `updatePresentReservationUI` rewrites the first `.reserve-btn` as a red icon-only "Anuluj" (own reservation, **no "Kupione" button**), "Zarezerwowane"/"Zarezerwuj" with `d-none d-md-inline` labels (icon-only on mobile). Verified DOM after reserving in another tab: `actionsHTML` = one `btn-danger` with an `<i class="fa-xmark">` and a hidden label. `realtime-updates.js` handlers use `[data-present-id]` that the main rows do not carry | `recipients-sync.js:227-265`; DOM dump | V (own case), I (others) | H for multi-user (any remote change within 10-20 s) | S-M | Call `generateReservationButton(present)` from the sync path; delete the old handlers |
| F25 | J3-J5 | Toast timers overlap: `new bootstrap.Toast(el)` per call on one element, older timers hide newer toasts. "Cofnij" toast visible 6.4 s isolated, 5.1 s when chained 1.2 s later, 0.7 s observed after a 4-action chain | `recipients-toast-undo.js:5-56`; T5 | V | M (undo window silently shortened) | S | `getOrCreateInstance` + `dispose`, or a single toast manager |
| F26 | all | Two FontAwesome versions (6.4.0 on home/leaderboard/intro, 6.0.0 elsewhere) + Remix Icon: moving home -> recipients downloads a second FA css (87-100 KB raw) and font (124-147 KB woff2) (cdn cache sizes); SW precaches only 6.0.0; precache list omits `tab-bar-functions.js`, `desktop-nav.js`, `bottom-tab-bar.css`, `app-theme.css`, `filters.*`, `fast-loader.js`, `realtime-updates.js`, `update-checker.js`, `formularz.js`, `seba.jpg` and all HTML; first home load with a fresh SW = 96 server requests vs 48 without it (precache of about 48 extra files) | HTML `<link>` scan, `sw.js:1-49`, T4 | V | M | S | One FA version, one icon set, regenerate the precache list from the build |

### (d) State, feedback, errors

| ID | Where | Symptom | Evidence | V/I | Impact | Effort | Fix |
|---|---|---|---|---|---|---|---|
| F27 | J13 | Network failure is handled as auth failure. With SW installed and offline: `/recipients`, `/wiadomosci`, `/ustawienia` all end up at `/` showing home skeletons ("Ładowanie...", `0/0` stats, 12 skeleton nodes) forever; `/formularz` shows the login modal "Wymagana autoryzacja"; `.html` URL variants not cached return the raw body "Network error". Home click offline is handled well (rollback + toast "Błąd połączenia. Zmiana została cofnięta.") | offline run with SW installed; `recipients-core.js:149-154`, `recipients-startup.js:202-208`, `wiadomosci-page.js:49` etc. | V | M-H (shopping in a weak-signal store is a core giver moment) | M | Distinguish `TypeError: Failed to fetch` from 401; offline banner; serve last cached lists read-only |
| F28 | all | Session expiry is invisible and can break the page. Home after cookie loss: first click -> red toast "Wymagana autoryzacja", no login link/redirect; the follow-up reconcile stores `{presents: undefined}` into `window._homeData`, so the next click throws `Cannot read properties of undefined (reading 'find')` and does nothing (VERIFIED `pageerror`, `homeDataOk:false`). Chat thread: 8 s poll gets 401 JSON, `msgs=[]`, the conversation is wiped (0 bubbles, title "Rozmowa"), no toast, no redirect (VERIFIED after 26 s). Recipients checks auth every 5 min and silently redirects. Reload with no session correctly shows login | flow runs (T5); `home-page.js:348` (`optimisticUpdatePresent`), `:391` (`reconcileWithServer`), `wiadomosci-page.js:344` (`loadThreadMessages`), `recipients-startup.js:196-210` | V | H (this is the reported "my user is not authenticated"; every server restart in demo; 30-day cookie expiry in prod) | S-M | One `apiFetch` wrapper: on 401 -> toast "Sesja wygasła" + redirect to `/?next=`; never write error JSON into app state |
| F29 | J12 | Cookie is fixed 30 days from login, no `rolling:true` (`server.js:98-110`), so active users are logged out exactly 30 days after login; demo's in-memory store logs everyone out on each restart | `server.js:98-110` | I | L-M | S | `rolling: true` or re-issue cookie on activity |
| F30 | J12 | 9 separate `logout()` implementations (`desktop-nav.js:70`, `home-page.js:~610`, `recipients-core.js:105`, `formularz.html:~555`, `activity-page.js:450`, `rezerwacje-page.js:121`, `ustawienia-page.js:389`, `wiadomosci-page.js:466`, `leaderboard.html:244`) with different clean-up. VERIFIED: home logout clears all localStorage (2 -> 0 keys), recipients logout removes 5 keys and keeps `homePageVersion`; most others clear nothing, so the previous user's cached recipients/presents/identification (`app_data_cache`, `recipientsCache`) survive on a shared phone (INFERRED for the others) | logout test (localStorage keys before/after) | V/I | M | S | One shared `logout()` in the dock script |
| F31 | HOME | No error or retry state on the three bucket lists: every load error only does `console.error`; skeleton stays (VERIFIED offline home with SW: 12 skeletons). Empty states exist ("Brak dostępnych prezentów" etc.) | `home-page.js:66-76,213-223,233-243` | V | M | S | Error card with "Spróbuj ponownie" like `rezerwacje-page.js:36-46` |
| F42 | J8 | Reply, reaction and reply send do full thread refetch; reply bubble waits for it (<1 s here, 1 RTT + payload on 3G) | `wiadomosci-page.js` `sendReply` | I | L | S | Append bubble optimistically |

### (e) Onboarding and engagement

| ID | Where | Symptom | Evidence | V/I | Impact | Effort | Fix |
|---|---|---|---|---|---|---|---|
| F32 | J1/J2 | No guided first run: register -> `/recipients`; `intro.html` (5 steps + leaderboard) is unlinked and its completion flag is never read; the user must discover "To jestem ja", the spoiler shield and where to add wishes alone; identification modal reappears on every `/` and `/recipients` load until done | VERIFIED navigation trail `["/","/register","/recipients"]`; `intro-page.js:134-155`; grep | V (trail), I (modal) | H (every new user) | M | After register show a 3-card onboarding (identify -> wishes -> reserve), remember dismissal |
| F33 | J9 | Push opt-in is 3 taps + prompt away, never contextual; install prompt only on the login page and in Settings; push covers new presents, chat, Dec 1-23 nudge for reserved-not-bought (fixed 17:00 UTC = 18:00/19:00 Warsaw); nothing for "you have not added wishes" or "nobody reserved your…" (deliberate for spoilers); reactions do not notify (by design) | `ustawienia-page.js:313-324`, `lib/cron.js:34-70`, `index-page-pwa.js:20-35` | I | M | S-M | Ask after first reserve/identify; nudge recipients with an empty list |
| F34 | J9 | Closing the dock notifications sheet marks **all** notifications read, even unseen ones; two notification UIs (sheet vs page) with different page sizes (10 vs 20) | `tab-bar-functions.js:53-72` | V (code) | L-M | S | Mark visible items only |
| F43 | J10 | Leaderboard is 4812 px with 4 blocks; endpoint is public | measured | V | L | S | Collapse to one tab per ranking |

### (f) Maintainability that blocks UX work (context only)

| ID | Symptom | Evidence | Fix |
|---|---|---|---|
| F36 | Two independent implementations of the same present row (home: ~600-char inline-style template duplicated in `renderAvailablePresents` and `renderPresentsList`; recipients: `generatePresentItem`) are the root of F5/F23; globals (`window._homeData`, `_dataCache`, `currentUserId` vs `window._currentUserId`); `data-id` collision between recipient cards and present rows (see `investigate-reserve-not-moving.md` §4); inline `style=` attributes: home 53, recipients 40, formularz 30; inline handlers 7-30 per page; 11 `recipients-*.js` split but still global-scope; `formularz.js` 64 KB, `styles.css` 107 KB + `aws-design.css` 101 KB | one shared row component + one state store |

## 6. Measurements (reproduced tables)

### T1 Static weight per page (local files, gzip on the wire; CDN = css+js only, raw)

| page | HTML raw / gz kB | JS n · raw / gz kB | CSS n · raw / gz kB | CDN css/js n · raw kB | inline `style=` | inline handlers |
|---|---|---|---|---|---|---|
| index | 6.6 / 2.0 | 2 · 9.0 / 2.7 | 1 · 39.2 / 6.6 | 3 · 393 | 12 | 1 |
| home | 34.6 / 6.4 | 21 · 312.1 / 77.7 | 4 · 84.7 / 17.9 | 4 · 526 | 53 | 12 |
| recipients | 47.2 / 8.3 | 24 · 344.8 / 86.7 | 6 · 214.5 / 38.4 | 4 · 514 | 40 | 30 |
| formularz | 30.4 / 6.0 | 5 · 102.9 / 29.2 | 5 · 121.4 / 26.6 | 4 · 514 | 30 | 17 |
| wiadomosci | 13.2 / 3.6 | 6 · 89.4 / 25.8 | 5 · 95.8 / 21.4 | 4 · 514 | 21 | 11 |
| activity | 13.4 / 3.4 | 6 · 71.1 / 20.2 | 5 · 184.6 / 32.6 | 4 · 514 | 11 | 12 |
| leaderboard | 17.2 / 4.1 | 6 · 63.5 / 18.4 | 4 · 101.4 / 20.0 | 4 · 526 | 32 | 12 |
| ustawienia | 14.7 / 3.8 | 5 · 64.8 / 18.6 | 4 · 80.1 / 16.7 | 4 · 514 | 28 | 15 |
| rezerwacje | 9.6 / 2.6 | 5 · 48.8 / 15.0 | 4 · 80.7 / 16.8 | 4 · 514 | 13 | 7 |
| osoby | 4.9 / 1.7 | 4 · 30.5 / 9.1 | 3 · 54.9 / 11.0 | 3 · 393 | 6 | 1 |
| archiwum | 4.7 / 1.6 | 3 · 18.3 / 5.9 | 3 · 55.8 / 11.3 | 3 · 393 | 3 | 1 |

Headers: gzip active for HTML/JS/CSS and JSON > 1 KB (`Content-Encoding: gzip`). Static JS/CSS (60 files): `Cache-Control: no-cache, must-revalidate`, ETag present. HTML: `no-cache, no-store, must-revalidate`. `manifest.json` and images: `public, max-age=3600`. `sw.js`: `no-cache, must-revalidate`. API: no `Cache-Control`, ETag present, revalidation returns 304 with 0 body bytes (checked on `recipients-with-presents`). API payloads (raw/gz bytes): recipients-with-presents 3132/859, leaderboard 2565/614, notifications?limit=10 2458/653, presents/all 2530/777, wiadomosci/threads 735, recipients 575, identification 90, unread counts 11 each (demo data, scale with real data; prod has no pagination on rwp). Largest local assets: `aws-design.css` 98.5 kB (14.7 gz), `formularz.js` 62.5 kB (16.3 gz), `styles.deduped.min.css` 39.2 kB, `recipients-page.js` 34.6 kB. Images in `public/`: `seba2.jpg` 1,049 kB, `seba.jpg` 1,035 kB (loaded everywhere), `seba_ios_icon.png` 955 kB, `PWA-icon.svg`/`favicon.svg` 746 kB each, `seba_logo.png` 459 kB. CDN files (raw, cache fixture): bootstrap.min.css 227 kB, bootstrap.bundle.min.js 78.5 kB, FA 6.4.0 css 99.6 kB + woff2 146.6 kB, FA 6.0.0 css 87.1 kB + woff2 123.9 kB, remixicon css 120.5 kB + woff2 140.4 kB.

### T2 Page load at 375x812 (cold = fresh profile, warm = second navigation; HTTP cache disabled by routing)

| page | load | navs | requests | JS / CSS / img | API calls | CDN | local KB (enc.) | FCP ms | LCP ms | first content ms | DOM nodes | page height px | console errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home | cold | **2** | **90** | 42 / 8 / 2 | 25 | 10 | 2,233 | 948 | 1,268 | 891 | 469 | 3,094 | 5 |
| home | warm | 1 | 52 | 21 / 4 / 1 | **18** | 6 | 1,118 | 304 | 672 | 492 | 469 | 3,094 | 0 |
| recipients | cold | 1 | 49 | 24 / 6 / 2 | 9 | 6 | 1,599 | 340 | 672 | 565 | 793 | 3,414 | 0 |
| recipients | warm | 1 | 47 | 24 / 6 / 2 | 7 | 6 | 1,599 | 240 | 508 | 379 | 771 | 3,246 | 0 |
| wiadomosci list | cold/warm | 1 | 25 | 6 / 5 / 1 | 5 | 6 | 1,066 | 572 / 292 | 572 / 292 | 561 / 293 | 217 | 995 | 0 |
| wiadomosci thread | cold/warm | 1 | 28 | 6 / 5 / 1 | 8 | 6 | 1,066 | 336 / 304 | 504 / 304 | 369 / 403 | 279 | 911 | 0 |
| formularz | cold/warm | 1 | 27 | 6 / 5 / 2 | 6 | 6 | 1,527 | 260 / 196 | 476 / 416 | 322 / 355 | 452 | 1,795 | 0 |
| activity | cold/warm | 1 | 26 | 6 / 5 / 2 | 5 | 6 | 1,520 | 172 | 388 | 275 / 288 | 363 | 1,759 | 0 |
| leaderboard | cold/warm | 1 | 24 | 6 / 4 / 3 | 3 | 6 | 1,505 | 192 | 560 / 444 | 242 / 349 | 575 | 4,812 | 0 |
| ustawienia | cold/warm | 1 | 23 | 5 / 4 / 1 | 5 | 6 | 1,054 | 224 / 308 | 224 / 308 | 248 / 256 | 227 | 1,558 | 0 |
| rezerwacje | cold/warm | 1 | 22 | 5 / 4 / 1 | 4 | 6 | 1,049 | 256 / 236 | 408 / 352 | 285 / 273 | 189 | 812 | 0 |
| osoby | cold/warm | 1 | 19 | 4 / 3 / 1 | 4 | 5 | 1,036 | 216 / 188 | 348 / 340 | 171 | 207 | 2,489 | 0 |
| archiwum | cold/warm | 1 | 15 | 3 / 3 / 1 | 1 | 5 | 1,033 | 200 / 180 | 200 / 180 | 172 / 161 | 114 | 812 | 0 |

Home warm API call list (in order): identification, recipients-with-presents, auth, leaderboard, wiadomosci/unread-count, version, notifications/unread-count, identification, recipients-with-presents, **recipients**, identification, leaderboard, identification, recipients-with-presents, identification, recipients-with-presents, identification, recipients-with-presents. Recipients warm: identification, rwp, notifications/unread-count x3, version, auth. The first-visit home errors are `TypeError: Failed to fetch` from `loadAllData`, `checkIdentificationStatus`, `loadMyReservations`, `loadBoughtPresents` (requests aborted by the 500 ms reload).

### T3 Idle polling, 9 pages open together for 70 s, attributed by Referer (server side)

| page | requests / 70 s | per min | endpoints |
|---|---|---|---|
| `/recipients` | 20 | 17.1 | `/api/updates` x7, `/api/recipients-hash` x7, `notifications/unread-count` x6 |
| `/wiadomosci?rozmowa=1` | 13 | 11.1 | `threads/:id` x9, unread-count x2 each |
| `/` (home) | 11 | 9.4 | `/api/updates` x7, 2 unread counts x2 |
| `/wiadomosci` | 5 | 4.3 | threads x1, 2 counts x2 |
| formularz, activity, leaderboard, ustawienia, rezerwacje | 4 each | 3.4 | 2 badge endpoints x2 |

### T4 Cache and service worker, server-side status counts (persistent Edge profile, no routing, CDN blocked)

| scenario | nav 1 | nav 2 | nav 3 |
|---|---|---|---|
| home, SW blocked | 48 (21 JS, 4 CSS, 2 html, 3 img, 18 API) | **44: 1 html 304, 21 JS 304, 4 CSS 304, 17 API 304, 1 API 200** | 44 |
| recipients, SW blocked | 45 | **38: 1 html 304, 24 JS 304, 6 CSS 304, 6 API 304, 1 API 200** | 38 |
| home, SW allowed | 96 (precache + page) | 26 (5 JS 304, 2 CSS 304, 18 API) | 20 (1 JS 304, 18 API, html) |

Images: 0 requests on repeat navigation (`max-age=3600`).

### T5 Flow measurements (VERIFIED)

| flow | UI reaction (in-page) | server requests | toast |
|---|---|---|---|
| home reserve | 8 ms | POST reserve, GET leaderboard, GET identification, GET rwp (4) | "Prezent zarezerwowany! 🎁" + Cofnij |
| home bought / unbuy / cancel | 3 / 4 / 3 ms | PUT check (or DELETE reserve) + the same 3 GETs (4) | "Oznaczono jako kupione 🛍️" + Cofnij / "Cofnięto oznaczenie" / "Rezerwacja anulowana" + Cofnij |
| recipients reserve / bought / unbuy / cancel | 4 / 8 / 2 / 2 ms | action + GET rwp + GET identification (3) | with Cofnij |
| remote change on recipients (other tab) | row updated after about 8 s, then icon-only markup | `/api/updates` + `/api/recipients-hash` + rwp | silent |
| remote change on home | not updated in 25 s | - | - |
| home offline click | row moves then rolls back | 0 | "Błąd połączenia. Zmiana została cofnięta." |
| session lost, home click | rollback | POST 401, then GET rwp 401 | "Wymagana autoryzacja"; next click throws TypeError |
| session lost, chat thread | conversation emptied after 8 s poll | `threads/:id` 401 | none |
| Cofnij toast duration | isolated 6,373 ms; chained 1.2 s later 5,149 ms; 696 ms in a 4-action chain | | |

### T6 Tap targets and unnamed controls at 375x812 (visible interactive elements, dock included, closed panels excluded)

| page | interactive | <44 px | <24 px | unnamed icon-only | text <12 px |
|---|---|---|---|---|---|
| home | 19 | 4 | 1 (link in title, 22 px) | 2 (menu-close, notif-close) | 6/65 |
| recipients | 32 | 11 | 1 | 2 | 5/80 |
| formularz | 27 | 4 | 1 | 2 | 6/44 |
| wiadomosci list | 12 | 1 | 0 | 2 | 7/38 |
| wiadomosci thread | 22 | 5 | 0 | 2 | 14/54 |
| activity | 35 | 13 | 7 (17 px links) | 2 | 6/37 |
| leaderboard | 6 | 0 | 0 | 2 | 6/179 |
| ustawienia | 15 | 2 | 1 (`messages-tab` 58x10) | 3 (+ empty `a.tab-item.messages-tab`) | 7/34 |
| rezerwacje | 10 | 1 | 1 (`messages-tab` 58x10) | 3 | 7/28 |
| osoby | 21 | 0 | 0 | 0 | 0/32 |
| archiwum | 2 | 0 | 0 | 0 | 0/15 |

Viewport meta is `width=device-width, initial-scale=1.0` everywhere (zoom allowed). Contrast: not re-measured; `chat-reactions-review-doc.md:227` records `#868F99` on white at 3.28:1.

## 7. Quick wins vs bigger bets (top 10 by impact / effort)

| rank | ID | change | impact | effort |
|---|---|---|---|---|
| 1 | F28 | `apiFetch` wrapper: 401 -> "Sesja wygasła" + redirect; stop writing error JSON into `_homeData`; keep chat thread on 401 | H | S-M |
| 2 | F17 | Re-encode `seba.jpg` (1,011 KB) and `seba_logo.png` (448 KB), delete sidebar `<img>` | H | S |
| 3 | F19 | Immutable long cache for `?v=` JS/CSS (saves 25-30 conditional requests per navigation without SW) | H | S |
| 4 | F23 | Use `generateReservationButton` in `updatePresentReservationUI`; remove stale realtime handlers | H | S-M |
| 5 | F20 | Home: one boot fetch, no `loadStats` fan-out, reconcile only on error; remove duplicate unread-count pollers (18 -> about 5 calls) | H | M |
| 6 | F13 | Inline "Wybierz siebie" in the composer when unidentified | H | S-M |
| 7 | F21 | Delete the home one-shot reload block; share one `logout()` (F30) | M | S |
| 8 | F7/F8 | `aria-label` on 2 close buttons, close the `<div>` on `/rezerwacje` and `/ustawienia`, 44 px minimum targets | M | S |
| 9 | F25 + F14 | Single toast manager; replace `confirm()`/`alert()` with the existing Cofnij pattern | M | S-M |
| 10 | F1/F2/F3 | Put "Prezenty" in the dock, collapse the recipients filter panel, order home buckets by intent | M | S-M |

**Bigger bets**: F22 (SSE or visibility-aware polling that also drives home), F18 + F36 (one shared present-row component and per-page bundles, drop `recipients-*.js` from home), F27 (real offline mode with read-only cached lists), F16/F15 (move spoiler protection and submitter identity to the server), F35 (organiser role for archive/delete), F32 (onboarding), F5 (collapse four reservation surfaces into two).

What already works and should be kept: optimistic UI with rollback (3-8 ms), "Cofnij" toasts on the main loop, skeleton cards on home/recipients, retry links on chat/rezerwacje/ustawienia, preserved drafts, gzip, ETag/304 on API, network-first HTML in the SW, reaction preview line "Zareagowano ... na ...".

## 8. MAP DATA (for the diagram)

### 8.1 Swimlanes

- **Visitor**: LANDING, REG, FORM_ADD (unauthenticated)
- **Giver**: HOME, REC, RES, LEAD, ACT_PANEL, ACT, MENU, RESBY_MODAL, RESERVED_MODAL, AVATAR_MODAL
- **Recipient / identified**: IDENT_MODAL, SELECT_MODAL, SET, FORM_EDIT, EDIT_MODAL, PEOPLE, ARCH, ARCH_MODAL
- **Chat sender / receiver**: CHAT_LIST, CHAT_THREAD, REACT_SHEET
- **System**: PUSH, UPDATE_BANNER, OFFLINE, MAINT, INTRO (orphan), service worker, polling, cron nudge

### 8.2 Nodes (id · Polish display name)

LANDING · Logowanie ("Życzenia Prezentowe") | REG · Rejestracja | HOME · Strona główna (Dostępne prezenty / Moje rezerwacje / Kupione) | REC · Wszystkie prezenty | FORM_EDIT · Moje prezenty + composer "Dodaj" | FORM_ADD · Dodaj dla kogoś innego | CHAT_LIST · Anonimowe wiadomości (Czat) | CHAT_THREAD · Rozmowa | REACT_SHEET · Dodaj reakcję | ACT_PANEL · Powiadomienia (panel) | ACT · Aktywność | LEAD · Ranking | RES · Zarezerwowane prezenty (/rezerwacje) | SET · Ustawienia | PEOPLE · Zarządzanie osobami | ARCH · Archiwum | ARCH_MODAL · Zamknij rok | INTRO · Intro (orphan) | MENU · Menu (FAB) | IDENT_MODAL · Potwierdź swoją tożsamość | SELECT_MODAL · Wybierz swoje imię | AVATAR_MODAL · Podgląd zdjęcia | RESBY_MODAL · Już zarezerwowane | RESERVED_MODAL · Zarezerwowane (Ctrl+B) | EDIT_MODAL · Edytuj prezent | PUSH · Zgoda na powiadomienia | UPDATE_BANNER · Nowa wersja dostępna | OFFLINE · Brak sieci (szkielety) | MAINT · Przerwa techniczna

### 8.3 Edges

Use the edge list in section 4.2 verbatim (labels and tap costs). Key cost summary: HOME->REC 2, HOME->RES 2, HOME->LEAD 2, HOME->ARCH 2, HOME->SET 1 (avatar) / 2 (FAB), HOME->PEOPLE 3, HOME->PUSH 3 + prompt, HOME->CHAT 1, HOME->FORM 1, reserve on HOME 1, reserve on REC 3 (+scroll, +2 if filtered), react 4.

### 8.4 Inefficiencies attached to nodes/edges (stable IDs, severity)

| ID | Attach to | Sev |
|---|---|---|
| F1 | edge HOME->REC (FAB + item, 2 taps), node MENU | M |
| F2 | node REC (filter panel, first reserve at 1162 px) | M |
| F3 | node HOME (buckets order), edge HOME->HOME (reserve) | M |
| F4 | edge HOME/REC reserve -> bought | M |
| F5 | nodes HOME, REC, RES, RESERVED_MODAL | M |
| F6 | all nodes (labels), RESBY_MODAL | L |
| F7 | nodes MENU, ACT_PANEL (close buttons), RES, SET (empty Czat tab), REC (accordion icons) | M |
| F8 | nodes REC, ACT, FORM_EDIT, CHAT_THREAD | M |
| F9 | nodes REC, ACT, LEAD, FORM_EDIT (hidden sidebars), MENU | M |
| F10 | nodes PEOPLE, ARCH, INTRO; edge REG->REC | M |
| F11 | node RESERVED_MODAL | L |
| F12 | nodes CHAT_LIST, CHAT_THREAD, REACT_SHEET | L |
| F13 | edge HOME->FORM_EDIT (dock Dodaj), node FORM_EDIT | H |
| F14 | nodes FORM_EDIT, PEOPLE, SELECT_MODAL, CHAT_THREAD, RESERVED_MODAL | M |
| F15 | node FORM_ADD, edge LANDING->FORM_ADD | M |
| F16 | nodes IDENT_MODAL, FORM_EDIT, REC (own card) | H |
| F17 | all nodes (background image), node REC (logo) | H |
| F18 | nodes HOME, REC | M |
| F19 | all page-to-page edges | H |
| F20 | node HOME (boot), edges HOME reserve/bought/cancel | H |
| F21 | edge LANDING->HOME, MENU->LANDING (logout from home) | M |
| F22 | nodes HOME, REC, CHAT_THREAD (polling) | H |
| F23 | node REC (live update path) | H |
| F25 | edges reserve/bought/cancel -> toast Cofnij | M |
| F26 | all nodes (CDN fonts), OFFLINE | M |
| F27 | node OFFLINE; edges any -> LANDING on network error | M |
| F28 | nodes HOME, CHAT_THREAD, REC; edge any -> LANDING (401) | H |
| F29 | node LANDING (session), MENU->LANDING | L |
| F30 | edges MENU->LANDING, SET->LANDING | M |
| F31 | node HOME (bucket lists) | M |
| F32 | edges REG->REC, node INTRO, nodes IDENT_MODAL/SELECT_MODAL | H |
| F33 | edge SET->PUSH (3 taps), node PUSH | M |
| F34 | node ACT_PANEL (close = read all), ACT | L |
| F35 | nodes ARCH_MODAL, PEOPLE | M |
| F36 | nodes HOME, REC (duplicate row implementations) | L |
| F40 | nodes SET (cancel identification), SELECT_MODAL (trash) | M |
| F41 | node REC (sorting) | L |
| F42 | node CHAT_THREAD (reply refetch) | L |
| F43 | node LEAD | L |

## 9. Not verified / limits

- No database run: F15, F16, F29, F35 (server side) and the prod identification modal (F32) are from code and docs only.
- No real phone, no throttled network or CPU, no iOS Safari/PWA install; FCP/LCP are localhost lower bounds. Background-tab polling (`document.hidden`) is from reading code.
- Push delivery, install prompt, share sheet and the browser permission dialog were not exercised.
- Screenshots were not used; all findings are DOM, state, network or server-side counts.
- The brief's list of 10 a11y fixmes: confirmed 10 in `a11y.spec.js` plus 1 in `edit-sheet.spec.js`.
