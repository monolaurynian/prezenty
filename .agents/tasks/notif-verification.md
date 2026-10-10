# Notification wording: verification (iteration 1)

## Changes
- public/notification-text.js: present-tense, gender-neutral wording with emoji. Recipient phrase is ` dla: X` (colon form, used the same way everywhere). It's skipped when X is the actor (case-insensitive) or missing. `showActor: false` now returns the body only, with no leading `· `. The recipients.html bell prints `<strong>actor</strong> ` itself, so it renders `Monika rezerwuje …`. Batch count words are now `prezent/prezenty/prezentów`, with a local Polish plural fallback if pluralize-pl.js isn't loaded.
- public/tab-bar-functions.js:235: the fallback used when the script isn't loaded yet changes from `· nowa aktywność` to `coś zmienia ✨`.
- server.js: requires `./public/notification-text`. Both push bodies (POST /api/presents ~1687, formularz ~3316) used `Dodano nowy prezent „T” (dla: X)` and now use `notificationText('present_added', …, actor, {html:false})`, giving e.g. `Monika dodaje prezent „T” dla: Tomek 🎁`. An anonymous formularz submission gives `Ktoś dodaje prezent …`. For /api/presents with no recipient, the old body showed `dla: kogoś`; now the `dla:` part is omitted. The push title `Nowy prezent!` is unchanged. These were reviewed and left unchanged: the nudge (`Masz … do kupienia … 🎅`, already warm 2nd person), the leaderboard push, the message push, and the English dev-only test push.
- `?v=` bump: none needed. No page loads notification-text.js with a `?v=` query (grep: activity, home, leaderboard, recipients, rezerwacje, wiadomosci, ustawienia all use plain `notification-text.js`). Cache invalidation goes through sw.js `CACHE_NAME`, which belongs to the final step.
- Privacy is unchanged. It is enforced server-side: GET /api/notifications filters out `present_*` rows whose recipientId is the caller's identified recipient, and sendNotificationToUsers excludes the identified recipient's subscriptions. The renderers have no privacy logic of their own, and no filtering code was touched.
- Not touched: formularz.html, formularz.js, sw.js, realtime-updates.js (it has no activity wording beyond `Zarezerwowane przez: X`), and the recipients.js:3313 joke (verified present and identical: `…Trzeba było szybciej rezerwować matole! Wybierz coś innego.`).

## Wording (HTML output, actor/person/present in <strong> or the renderer's links)
| type | output |
|---|---|
| present_added | `Monika dodaje prezent „T” dla: Tomek 🎁` / own list or no recipient: `Monika dodaje prezent „T” 🎁` |
| present_added_batch | `Monika dodaje 5 prezentów dla: Tomek 🎁` |
| recipient_added | `Monika dodaje nową osobę: Tomek 👤` / no name: `Monika dodaje nową osobę 👤` |
| present_reserved | `Monika rezerwuje „T” dla: Tomek 🔖` |
| present_unreserved | `Monika rezygnuje z rezerwacji „T” dla: Tomek` |
| present_checked | `Monika kupuje „T” dla: Tomek ✅` (chosen over `oznacza „T” jako kupione`, which reads awkwardly with `dla: X` inserted) |
| present_unchecked | `Monika cofa oznaczenie „kupione” przy „T” dla: Tomek` |
| unknown | `Monika coś zmienia ✨`; no actor -> `Ktoś …` for every type |

## node --check (all exit 0)
server.js, public/notification-text.js, public/tab-bar-functions.js.

## Temp Node test (%TEMP%\notif-test.js, deleted afterwards): 28 passed, 0 failed
The test required public/notification-text.js and asserted exact strings for:
- Every type with an actor and a recipient.
- present_added for the own list (`'monika '` vs actor `Monika`), with no recipient, and with no actor (`Ktoś`).
- reserved with no actor (`''`) and no recipient.
- recipient_added with and without a name.
- Unknown type, with an actor and with null data and an undefined actor.
- Missing title (`„prezent”`).
- Batch 1/2/5/22/12 -> `1 prezent`, `2 prezenty`, `5 prezentów`, `22 prezenty`, `12 prezentów`, and the batch `count` callback.
- Plain text (`html:false`) with and without an actor, with no escaping (`Jo< rezerwuje „A & B” 🔖`).
- `showActor:false` -> `rezerwuje <strong>„Książka”</strong> dla: <strong>Tomek</strong> 🔖`.
- XSS: actor `<b>O'Neil</b>` -> `&lt;b&gt;O&#39;Neil&lt;/b&gt;`; title `<img src=x onerror=alert(1)>` -> escaped; recipient `Tom & "Jerry"` -> `Tom &amp; &quot;Jerry&quot;`; the person callback receives (escaped, raw) and the present callback receives the escaped quoted title.
- No output for any type or mode contains `·` or `(a)`.

## Grep for leftovers
- ` · ` and `\w\(a\)` across server.js, public/*.js and public/*.html: the only hit is osoby.html:295 `flags.join(' · ')`, an admin flag separator unrelated to activity wording. No `(a)` forms. `nowa aktywność` and `Dodano nowy prezent` no longer appear in the edited files.
