# Description field + notification wording: summary

Service worker cache: `prezenty-v119` (`public/sw.js`). No new precache assets; `/notification-text.js` stays in `urlsToCache`.

## Changed files (uncommitted)

- public/activity.html
- public/app-theme.css
- public/archiwum.html
- public/formularz.html
- public/formularz.js
- public/home.html
- public/leaderboard.html
- public/notification-text.js
- public/osoby.html
- public/recipients.html
- public/rezerwacje.html
- public/sw.js
- public/tab-bar-functions.js
- public/ustawienia.html
- server.js

## Final notification wording (public/notification-text.js)

Present tense, which is gender-neutral in Polish. ` dla: <osoba>` is left out when the recipient is the actor.

| Type | Final string |
|---|---|
| recipient_added | `<actor> dodaje nową osobę: <osoba> 👤` (no name: `<actor> dodaje nową osobę 👤`) |
| present_added | `<actor> dodaje prezent „<tytuł>” dla: <osoba> 🎁` |
| present_reserved | `<actor> rezerwuje „<tytuł>” dla: <osoba> 🔖` |
| present_unreserved | `<actor> rezygnuje z rezerwacji „<tytuł>” dla: <osoba>` |
| present_checked | `<actor> kupuje „<tytuł>” dla: <osoba> ✅` |
| present_unchecked | `<actor> cofa oznaczenie „kupione” przy „<tytuł>” dla: <osoba>` |
| present_added_batch | `<actor> dodaje <N prezent/prezenty/prezentów> dla: <osoba> 🎁` |
| (other) | `<actor> coś zmienia ✨` |

Missing actor → `Ktoś`; missing title → `prezent`.

## Screenshots (DESC branch, .agents/tasks/screenshots/)

- formularz-desc-320-typing.png
- formularz-desc-375-empty.png
- formularz-desc-375-typing.png
- formularz-desc-375-chip.png
- formularz-desc-1024.png
