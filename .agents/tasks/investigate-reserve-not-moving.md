# Investigation: "reserved present does not move to the booked list" (demo mode)

Read-only investigation. No product code was changed. Throwaway scripts are in `.agents/tasks/tmp-repro/` (safe to delete). Temporary worktrees `.worktrees/investigate-reserve` and `.worktrees/investigate-reserve-old` were removed and pruned (both folders are gone).

## 1. Summary answer

**I could NOT reproduce the bug.** In a real browser (Playwright + Edge, headless) against demo mode, the reserve flow works on current main (9f30f33, also tested at 4f94a3c) and on the pre-refactor baseline (4d06241). The server confirms the reservation, the UI moves the present, and a reload keeps it. Because the behaviour is identical on both commits, there is **no regression from today's refactors** in any flow I could drive.

What I did find:

1. **A real but cosmetic bug (pre-existing, not a regression):** on the recipients page, `document.querySelector('[data-id="N"]')` is used for presents, but recipient cards also carry `data-id="<recipient.id>"`. When a present id equals a recipient id, the optimistic UI code touches the recipient card instead of the present. Verified: reserving present 3 puts `reserved-by-me` on `recipient#3`, not the present. It is the most plausible "UI did not react correctly" candidate on the recipients page, but in the demo it is mostly benign because the present's own card happens to be the matched recipient card.
2. **A service-worker staleness window (cache-first for all JS/CSS):** after a code update the first page load is served by the old SW's cache. It did not break reservation in my upgrade simulation, but it can leave a long-lived tab or browser profile running old JS. I cannot verify the user's browser state.
3. **Test gap:** no Playwright test clicks a reserve button or checks any reserved/bought list.

Most likely explanations for what the user saw, ranked (all UNVERIFIED, since I could not see their browser):

- A tab or browser profile running stale JS (old SW cache or an already-open page from before a reload). A hard reload plus "Unregister" of the service worker would confirm or rule this out.
- The user looked at a different surface than the one that updates (for example, the recipients page, where the present stays in place with a "Kupione" button and reserved-first sorting only applies on the next render, versus home "Moje rezerwacje" or `/rezerwacje.html`).
- The id collision in point 1.

I recommend asking the user for: which page they were on, the browser console, and whether Ctrl+Shift+R fixes it (details in section 6).

## 2. What I ran (VERIFIED)

Server: `node server.js` with `DEMO_MODE=true`, started by `tmp-repro/run.js`, which boots the worktree server, runs a Playwright script, and kills the server. Login via `POST /api/login` (any username/password, demo user id 1). CDN assets were served from the repo's `tests/helpers/cdn-cache.js`. No console errors or page errors in any run.

| # | Scenario | Result |
|---|---|---|
| A | main 4f94a3c, `/recipients`, click "Zarezerwuj" on present 1 | `POST /api/presents/1/reserve` returns 200 `{"success":true}`. Card gets "Kupione" + "Anuluj", toast "Prezent zarezerwowany!", `_dataCache.presents[1].reserved_by = 1`, `reserved_by_username = 'demo'`. Ctrl+B modal ("Do kupienia") lists it. Reload keeps it. |
| B | main, `/recipients`, present 5 and present 3 | Same. Present card updates and survives reload. Present 3: `recipient#3` also got class `reserved-by-me` (id collision, see section 4). |
| C | main, home `/`, click "Zarezerwuj" on present 5 | Present disappears from "Dostępne prezenty" and appears in "Moje rezerwacje" with "Kupione"/"Anuluj" within 2.5 s. Then "Kupione" moves it to "Kupione". After reload it stays there. `/rezerwacje.html` lists it under "Kupione (3)". `/recipients` shows `reserved-by-me` on 5 and 9. |
| D | baseline 4d06241: same recipients (present 3) and home (present 1) flows | Identical results to main, including the `recipient#3 reserved-by-me` collision. **Not a regression.** |
| E | main at 9f30f33 (after the CSS consolidation merged): scenario C again | Same result. |
| F | SW upgrade simulation: persistent Edge profile, warm up on baseline (SW cache `prezenty-v124`), then load main on the same origin and reserve on home | Reserve still moved the present to "Moje rezerwacje". All main JS was served `fromServiceWorker=true` from the old cache on the first load. `caches.keys()` still showed only the old cache name at that moment (the new SW had not activated yet). |
| G | Raw HTTP: login, GET combined, POST reserve 3, GET combined with the old `If-None-Match`, GET `/api/presents/all`, GET `/api/presents`, POST reserve again, DELETE reserve, GET combined | After reserve every GET returns `reserved_by=1`, `reserved_by_username='demo'`. The old ETag does not produce a stale 304 (the new body has a different ETag). Second reserve returns 409 "Prezent jest już zarezerwowany". DELETE returns 200 and the combined endpoint shows `reserved_by=null`. `/api/updates?since=0` returns `hasUpdates:false` (demo mode never records updates). |

## 3. Answers to the numbered questions

### Q1. Reproduction and observations

- (i) Network: `POST /api/presents/:id/reserve` returns 200 `{"success":true}`, followed by `GET /api/recipients-with-presents` (soft reload on the recipients page) or `GET /api/user/identification` + `GET /api/recipients-with-presents` (home reconcile). All 200.
- (ii) UI: the card switches to the reserved state ("Kupione" + "Anuluj"), shows the toast with "Cofnij". On the home page the present leaves "Dostępne prezenty" and enters "Moje rezerwacje". On the recipients page it stays inside the recipient card (it is not moved to another section there); reserved-by-me items are sorted first only when the list is re-rendered (`recipients-present-actions.js` sort at the top of the list builder).
- (iii) Console errors: none.
- (iv) After reload the present is still reserved on all three surfaces (home, recipients, `/rezerwacje.html`). So server state and client state agree.
- (v) Caching: no stale data. `lib/cache.js` `clearCombinedDataCache()` is called at the start of every mutating presents route (`POST /api/presents`, `PUT .../check`, `PUT /api/presents/:id`, `DELETE /api/presents/:id`, `POST .../reserve`, `DELETE .../reserve`, `routes/presents.js` lines 246, 352, 431, 480, 569, 655). In demo mode the mutation of `demoData.presents` is synchronous right after the clear, so no stale repopulation is possible. The server sets no `Cache-Control` on API responses (only on static files in `server.js` lines 58-73), and the combined endpoint has a 30 s in-memory cache that is cleared on reserve. Incremental sync (`updateTracker`) is NOT involved in demo mode: the demo branch of the reserve route returns before `updateTracker.addUpdate(...)` (that call exists only on the DB path, `routes/presents.js` ~line 634). That only matters for cross-tab/cross-user live updates, not for the acting user's own UI.

### Q2. Where the present gets its place in the reserved list

- Home (`public/home-page.js`): data comes from `GET /api/recipients-with-presents`. "Moje rezerwacje" = `Number(p.reserved_by) === userId && !p.is_checked` (line ~229), "Kupione" = same with `is_checked` (line ~247), "Dostępne" = `!reserved_by && !is_checked && recipient_id !== identifiedRecipientId` (line ~83). `userId` comes from `GET /api/user/identification` (demo returns `userId: 1`) or `window._currentUserId`. Optimistic path: `reservePresent` (line ~407) mutates `window._homeData` and calls `rerenderHomeSections()`, then `reconcileWithServer()` after the request settles.
- `/rezerwacje.html` (`public/rezerwacje-page.js`): `GET /api/presents/all` filtered with `p.reserved_by === currentUserId` where `currentUserId` is `data.user.id` from `GET /api/auth` (demo: 1, a number, same type as `reserved_by`).
- Recipients Ctrl+B modal: `openReservedPresentsModal` (`public/recipients-modals.js` ~131) uses `GET /api/presents/all` with `reserved_by === currentUserId`.
- Demo branch of the reserve route sets `present.reserved_by = userId` (session user id 1, from `routes/auth.js` demo login) on the shared `demoData.presents` object, so every endpoint sees it. Demo responses always set `reserved_by_username: 'demo'` (shown as "demo" to other users, never relevant to the owner). The `identified_by`/`created_by` rules do not hide it in any of these lists. One demo quirk: recipient 2 (Jan Nowak) is `identified_by: 1` in `lib/demo-data.js`, and the recipients page therefore shows that recipient's presents as a masked "own presents" list with no reserve button, while `GET /api/user/identification` in demo always reports `isIdentified:false`, so the home page still offers Jan's presents (ids 2, 7) for reservation. This is an inconsistency, but it does not stop a reserved present from showing up on home.

### Q3. Regression?

No. Scenarios C and D give the same result on 4d06241 and main. I did not need to bisect. I also did not find any difference in the reserve flow across the commit groups (server split, security hardening, inline JS extraction, recipients.js split, CSS consolidation), at least for the flows listed in section 2.

### Q4. Service worker (`public/sw.js`, `CACHE_NAME` 'prezenty-v128' in the main checkout, v127 in 4f94a3c)

Strategy by URL pattern (read from the file, behaviour partly confirmed by scenario F):

| Pattern | Strategy |
|---|---|
| Non-GET requests, or any URL containing `/api/` | Not intercepted at all. They go straight to the network. API responses are never cached by the SW. |
| `*.html` and navigations (`mode === 'navigate'`) | Network-first; successful responses are stored; cache is the offline fallback. |
| Everything else (JS, CSS, images, fonts, manifest, CDN assets), including `?v=` URLs | **Cache-first** (`caches.match` on the full URL including the query string), network on miss, stored if `status 200 && type 'basic'`. |
| Install | Precaches the `urlsToCache` list with `cache.add` per URL, calls `skipWaiting()`. |
| Activate | Deletes every cache whose name is not `CACHE_NAME`, then `clients.claim()`. |

Consequences: a stale SW cannot make `GET /api/*` return stale data (so the "stale API" theory is ruled out). It can, however, keep serving old JS/CSS for the same URL until `CACHE_NAME` changes. Edits to `public/*.js` that keep the same `?v=N` URL are invisible to a profile that already cached them until a `CACHE_NAME` bump takes effect (the new SW activates in the background, and the page that is already open keeps its old scripts until the next reload). Scenario F shows the first load after an upgrade is served entirely from the old SW cache. This is a plausible cause of "I changed or pulled code and the UI behaves like the old version", but I could not confirm it for the user's profile.

### Q5. Test coverage

Gap confirmed. `grep -E "reserve|Kupione|rezerw|Zarezerwuj"` over `tests/e2e/*.js` and `tests/helpers/*.js` finds no test that clicks a reserve button or checks a reserved/bought list. Hits are only: pluralization strings, leaderboard counts, a page-list entry for `/rezerwacje` (`smoke.spec.js:16`, `helpers/pages.js:60` waits on `#reservedContent`), and unrelated CSS "reserved padding" comments. So the 121-pass suite says nothing about this flow.

## 4. Evidence for the one real defect found: `data-id` collision (VERIFIED behaviour, pre-existing)

- Recipient cards: `public/recipients-list.js` line 284: `<div class="recipient-item" data-id="${recipient.id}" id="recipient-...">`.
- Present rows: `public/recipients-present-actions.js` line 27 (`present-item`, `data-id="${present.id}"`) and the "own presents" list at `public/recipients-list.js` line 240.
- Lookups that use the unscoped selector `document.querySelector('[data-id="${presentId}"]')` and therefore return the first match in DOM order (which can be a recipient card):
  - `public/recipients-present-actions.js`: `refreshPresentButtons` (line ~372), `handleBoughtClick` (~386), `handleReserveClick` (~435), `togglePresentFromRecipients` (~82)
  - `public/recipients-optimistic.js`: `rollbackOptimisticUpdate` (~81)
  - `public/recipients-toast-undo.js` (~88)
  - `public/recipients-sync.js`: `updatePresentReservationUI` (228), `updatePresentCheckUI` (267), `updatePresentInDOM` (284)
  - `public/recipients-edit.js` (~298, delete animation)
- Observed in scenario B/D: reserving present 3 produced `recipient#3 class="recipient-item reserved-by-me"` while the present row itself was updated (because `refreshPresentButtons` found the recipient 3 card, whose first `.present-actions` happened to be present 3's).
- Why it can hurt: when present N belongs to a different recipient than recipient N, and recipient N's card comes earlier in the DOM, the lookup lands in the wrong card. `refreshPresentButtons` then rewrites the FIRST `.present-actions` cell of recipient N's card with present N's buttons (wrong `onclick` ids), and the real present N row is not updated until a reload. In the demo data this mismatch does not occur (the DOM order 2,1,4,3,5 happens to resolve every collision to a card that contains the right present), so I could not make it misbehave, but real data has low present ids mixed with low recipient ids (INFERRED). The same code is in the pre-refactor baseline, so it is not new. `reserved-by-me` on a recipient card also affects the "my-reserved" filter in `recipients-core.js` (~line 353) and `filters.js` (~179), which read classes off `.present-item` only, so the stray class on `recipient-item` is harmless there.

## 5. Other observations (not causing the reported symptom)

- `public/home-page.js` `loadStats()` (line ~8) triggers three independent fetches (`loadAvailablePresents`, `loadMyReservations`, `loadBoughtPresents`), each of which overwrites `window._homeData` and renders only its own section. A reserve click in the short window while these are in flight can show an inconsistent state until the post-action `reconcileWithServer()` runs (it does run on `endOp`, so it self-heals). INFERRED from reading, not reproduced.
- Demo reserve never calls `updateTracker`, so `/api/updates` stays empty in demo mode. The "present_reserved" live update path (`realtime-updates.js`) is therefore not exercisable in demo.
- `routes/presents.js` mount order is fine: `lateRouter` is mounted at `server.js:152` and the `DELETE /api/presents/:id/reserve` route works (scenario G). `lib/cache.js` `clearCombinedDataCache` clears the same Map the GET route reads.
- Note: `.agents/tasks/prezenty-fix-home-buckets-1-2025-06-13/home-buckets-1-plan.md` (another agent's plan) mentions a "known UI issue where the card may not move" after optimistic reserve. I found no evidence for it; it looks derived from the same user report rather than from a measurement.

## 6. Recommendations (nothing applied)

1. **Get the user's evidence before changing logic.** Ask: which page (home, recipients, Rezerwacje)? Does Ctrl+Shift+R or DevTools > Application > Service Workers > Unregister + Clear storage fix it? Any console error? Which port/server process (an older `node server.js` still running on 3002 serves the same code from disk, so the API is identical, but check it is the demo server and not one with a DB)?
2. **Fix the id collision (minimal, low risk).** Scope the lookups to presents: replace `document.querySelector('[data-id="${presentId}"]')` with `.present-item[data-id="${presentId}"]` at the locations listed in section 4 (about 9 call sites). Alternatively give recipient cards a different attribute (`data-recipient-id`), but that touches CSS/JS that reads `data-id` on recipients (`recipients-sync.js:325` and others), so the selector change is safer. `recipients-core.js` already uses the scoped form (lines 26, 73), which is the pattern to copy.
3. **Make SW staleness less likely (optional):** keep bumping `CACHE_NAME` together with any `public/*.js`/`*.css` change (already the practice), and consider network-first (or stale-while-revalidate) for same-origin `.js`/`.css` during development, or have `sw.js` skip registration when `location.hostname === 'localhost'` with DEMO/dev.
4. **Demo-mode fidelity (optional):** in the demo reserve/unreserve branches call `updateTracker.addUpdate('present_reserved', ...)`, and make `/api/user/identification` honour `identified_by` in demo data, so the demo behaves like the DB path.

## 7. Test that would lock it in

Add a Playwright spec (for example `tests/e2e/reserve-flow.spec.js`, using the `tests/fixtures.js` fixtures and demo server):

1. Home: click "Zarezerwuj" on a present (use present 5), assert it leaves `#availablePresentsList` and appears in `#myReservationsList`; click "Kupione", assert it moves to `#boughtPresentsList`; reload and assert the state persists; open `/rezerwacje` and assert it is listed.
2. Recipients: click `.present-item[data-id="3"] .reserve-btn` and assert `.present-item[data-id="3"]` has `reserved-by-me` and the button text "Kupione", and that `.recipient-item[data-id="3"]` does NOT have `reserved-by-me` (this fails today and locks the collision fix). Add a case where a present id equals the id of a different recipient's card by extending `lib/demo-data.js` (for example a present with id 2..5 attached to another recipient), which is the configuration that exposes the wrong-card update.
3. Service worker: a test that loads the page twice with `serviceWorkers: 'allow'` after bumping a file would be heavier; at minimum assert in a unit-style check that `sw.js` never intercepts `/api/` (already true by reading).

## 8. What was verified vs inferred

- Verified by running: scenarios A to G (section 2), absence of console/page errors, identical behaviour on 4d06241 and main/9f30f33, API responses after reserve, SW precaching and cache-first serving in the upgrade simulation, the recipient-card class leak from the id collision.
- Inferred from code only: the wrong-card button rewrite for a mismatching present/recipient pair, the `loadStats` race window, the user's actual cause (stale browser state or different page), the behaviour on an actual phone/PWA install.
- Not tested: real mobile/PWA install, Safari, a DB-backed server, concurrent users, headless screenshots (unreliable here; DOM text/state was used).
