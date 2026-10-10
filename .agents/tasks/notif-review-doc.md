# Warm present-tense notification wording

The activity and notification copy changes from the log style `Monika · rezerwacja: „T” (dla: Tomek)` to present-tense 3rd-person sentences with an emoji: `Monika rezerwuje „T” dla: Tomek 🔖`. The user found the old copy cold and suggested going back to `dodał(a)`. Present tense gives the warmth without gendered forms, since Polish present-tense verbs don't inflect for gender. All wording stays in `public/notification-text.js`. `server.js` now reuses it for the two "new present" push bodies, which replaces the old impersonal `Dodano nowy prezent …`. No `(a)` forms or `·` separators remain in activity output.

Watch for: `kupuje` (present_checked) can read as "is buying" rather than "bought" (likely, minor). The service-worker cache still serves the old `notification-text.js` until `sw.js` `CACHE_NAME` is bumped, which is deferred to the final step (confirmed). The `dla: X` colon form reads slightly stiff inside a full sentence. It is a deliberate convention (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

Every renderer keeps going through `notificationText(type, data, actor, opts)`. Those are the activity page, the recipients.html bell and realtime toasts, the tab-bar dropdown, and now the server push bodies. The `opts` callbacks still own the markup. The actor is in `<strong>` by default, and person/present/count links come from each page. Escaping is unchanged: values go through `escapeHtml` before reaching the callbacks, and `html:false` returns raw text for pushes and toasts. The coder's 28-assertion test covers the XSS cases and the plain-text path.

`showActor:false` now returns just the body instead of `· body`. The recipients.html bell is the only caller of that flag, and it prints `<strong>actor</strong>` itself, so the result is `Monika rezerwuje …`. That fixes a separator that would otherwise have been left dangling.

Privacy behaviour hasn't changed. Hiding reservations and purchases from the recipient happens on the server: `GET /api/notifications` filters the rows, and `sendNotificationToUsers` excludes the recipient's subscriptions. The diff doesn't touch either. The renderers never contained privacy logic. The new push bodies only cover `present_added`, which already went out with the same audience.

## Issues (3)

1. **`kupuje` tense ambiguity (likely, non-blocking)**: `Monika kupuje „T”` can sound like a purchase in progress. Consider `ma już „T”` or keep `kupuje`. Either is gender-neutral, so this is a copy preference.
2. **Stale SW cache for notification-text.js (confirmed, non-blocking)**: `sw.js` precaches `/notification-text.js` and no page uses `?v=`. Bump `CACHE_NAME` in the final step, or returning users keep the old `·` wording.
3. **No emoji on the undo types (possible, non-blocking)**: `present_unreserved` and `present_unchecked` have no emoji while the other types do. This looks intentional, since undo actions aren't celebratory, but confirm it matches the agreed set.

<details>
<summary>Details</summary>

### Wording and gender neutrality

The verbs are `dodaje`, `rezerwuje`, `rezygnuje z rezerwacji`, `kupuje` and `cofa oznaczenie „kupione” przy`. The noun phrases are `nowa osoba`/`nowy prezent`, which agree with nouns and not with the actor. The fallback is `coś zmienia ✨`, mirrored in the tab-bar-functions.js fallback for when the script hasn't loaded. With no actor, the text uses `Ktoś`, which is grammatically fine with every 3rd-person verb. The emoji per type are 🎁 added/batch, 🔖 reserved, ✅ checked, 👤 person and ✨ unknown.

The batch count drops the `nowych` adjective (`dodaje 5 prezentów`) because the verb already says "adds". The new inline plural fallback uses the same 1 / 2–4 (except 12–14) / other rule as `pluralize-pl.js`, so output doesn't depend on load order (confirmed by the 12/22 assertions). `cofa oznaczenie „kupione” przy „T” dla: Tomek` is long but correct. Keep it in mind if dropdown width is tight on small screens.

### Server push bodies

Both push sites now build their body with `notificationText('present_added', …, { html:false })`. In `/api/presents` (behind `requireAuth`), `recipient_id ? recipientName : null` drops the old `dla: kogoś` filler for presents with no recipient. In `/api/formularz/present`, the actor is `req.session.username` only when `req.session.userId` is set, so anonymous submissions read `Ktoś dodaje prezent …`. The title `Nowy prezent!` and the nudge, leaderboard, message and dev pushes are unchanged. Those were already warm or out of scope. The new `require('./public/notification-text')` works because the module already exports for CommonJS (`root` handling plus the `require('./pluralize-pl.js')` path).

### Scope

The joke in `public/recipients.js:3313` is unchanged (`…Trzeba było szybciej rezerwować matole! Wybierz coś innego.`). `sw.js` and `realtime-updates.js` are untouched. The working tree also has changes to `public/formularz.html`, `public/formularz.js` and `public/app-theme.css`. They contain no notification or activity wording: a grep of their diff for `notif`, `dodaje`, `Dodano` and `aktywno` finds nothing. They belong to the parallel second-field task, not this one. Keep them in a separate commit.

</details>

<details>
<summary>File map</summary>

- `public/notification-text.js`: present-tense wording with emoji; `showActor:false` returns the body only; batch plural fallback.
- `public/tab-bar-functions.js`: fallback text `coś zmienia ✨`.
- `server.js`: requires notification-text and uses it for the two `present_added` push bodies.

Full diff: `git -P diff -- public/notification-text.js public/tab-bar-functions.js server.js`
</details>
