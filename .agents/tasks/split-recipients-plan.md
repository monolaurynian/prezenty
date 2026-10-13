# Design and plan: split `public/recipients.js` into ordered classic scripts (task 4)

Worktree: `c:\Users\matmamon\OneDrive - amazon.com\Documents\Prezenty\prezenty\.worktrees\split-recipients-1`
Branch: `refactor/split-recipients-1`. Base commit: `bc8be84` (= `main`). Nothing is pushed.
Workflow: `wf_fa58fb431aff1e45`. Review gate: `.agents/tasks/split-recipients-review.json`, `jsonPath: verdict`, value `APPROVED`.

This is a behavior-preserving, byte-preserving partition. No production code was written in this step. The only things I ran were read-only probes and a throw-away dry run in `%TEMP%\splitchk` (outside the worktree, outcome in section 9).

## 0. What I found (facts the design rests on)

| Fact | Evidence |
|---|---|
| `public/recipients.js` is 4,706 lines, 200,654 B in the working tree (CRLF), 195,948 B as the committed blob (LF). No BOM. | `git ls-files --eol`: `i/lf w/crlf`; `core.autocrlf=true`. Blob sha256 `e0ccba3a2097b354f0ab3996b342d77ee088f7c8a1d50620f15424483fc65167`; working-tree sha256 `ceae7774b1814c03ed4b022243693a2495131a0e0d917f6bf97557b0e4712149`. |
| It is a classic script with 136 top-level declarations: 126 `function` declarations and 10 `let`/`const`. That is 135 distinct names, because `convertUrlsToLinks` is declared twice (L2348 and L2475; the later one wins). | Section 3. |
| Exactly two pages load it, both with a plain `<script src>` (no `defer`, no `async`, no `type`, no `integrity`, no `crossorigin`): `recipients.html:775` and `home.html:249`, both as `recipients.js?v=25&t=1111111111`. | grep of `public/**/*.html`. |
| `home.html` sets `window.SKIP_RECIPIENTS_INIT = true` and `window._currentUserId = null` in an inline script (lines 240-247) immediately before the tag. That inline script is order-critical and must not be touched. | `extract-inline-plan.md` section 3, row "home.html script #8". |
| `sw.js` does NOT list `recipients.js` in `urlsToCache` today (it is only runtime-cached by the cache-first fetch handler). `CACHE_NAME` is `prezenty-v125` in `main` and in this worktree. | `public/sw.js:1-45`. |
| `express.static('public')` (`server.js:57`) is registered BEFORE `pageRoutes` (`server.js:145`), before the session middleware, and `redirect` is left at serve-static's default (`true`). | `server.js`. See section 7 for why this rules out a `public/recipients/` folder. |
| Nothing else lists scripts by name: `routes/pages.js` (explicit `sendFile` per page), `Dockerfile` (`COPY . .`), `.dockerignore`, `vercel.json` (routes everything to `server.js`), `render.yaml`, `package.json` (`"build": "echo 'No build step required'"`), `scripts/`, `tests/helpers/*`. | greps. |
| `postcss.config.js` PurgeCSS content globs are `./public/**/*.html`, `./public/**/*.js`, `./public/**/*-page*.css`. The new `recipients-*.js` files are inside `./public/**/*.js`, and a contiguous split keeps every class-name string, so PurgeCSS output cannot change. Nothing to edit. | `postcss.config.js`. |
| Playwright baseline for this base commit: 121 passed, 11 skipped (intentional `test.fixme`), 0 failed, `workers: 1`, Edge, demo-mode server, `serviceWorkers: 'block'`. | `refactor-manageable-1-verification.md`, `extract-inline-1-verification.md`. |
| Parallel worktrees exist: `css-consolidate-1` (task 5, owns CSS and `<link>` tags), `harden-server-1`, `tests-tidy-1`. Task 5 will touch the same HTML files and very likely `sw.js` (`CACHE_NAME`). | `git worktree` dirs under `.worktrees/`. See risk R7. |

## 1. Decisions (with reasons)

1. **Pure contiguous partition at statement boundaries, original order kept.** No reordering at all. The load-order list in section 4 is also the order of the original source.
   Rejected: a pure "group by feature" layout. Feature groups are interleaved in the original (for example the reservation code is spread over lines 2133-2296, 3105-3310 and 4450-4530; there are three `DOMContentLoaded` handlers at 579, 3397 and 4699; `displayRecipientsWithPresents` is declared at 1013 and re-assigned at 3384). Pulling them together would reorder load-time code and move `let`/`const` declarations relative to their users. I therefore cut only at feature *boundaries* that already exist in the file.
2. **11 files, 221 to 586 lines each** (the cap was ~800). Fewer than 11 would push files toward 700+ lines or merge unrelated seams; more than 11 adds one more conditional request per file on every page load, because `server.js` serves `.js` with `Cache-Control: no-cache, must-revalidate`. 11 is the compromise. If the owner prefers fewer requests, adjacent files in section 2 can be merged without any other change (the partition stays contiguous), for example `startup`+`list` (759 lines) or `helpers`+`modals` (807, over the cap, so not recommended).
3. **No header comment in any new file.** Zero header lines makes the acceptance gate a plain equality check (section 8) and keeps every original line number derivable as `orig = new + (start - 1)`. The file name carries the meaning.
4. **Flat names `recipients-<part>.js` in `public/`, no subfolder.** Reasoning in section 7 (route shadowing and relative-URL breakage). The names start with `recipients-` but not with `recipients-page`, so they cannot collide with `recipients-page.js`, `recipients-page-notifbell.js`, `recipients-page-scroll.js`, `recipients-page.css`, and `*-page*.css` globs are not matched.
5. **Version query `?v=1`** on every new tag, same convention as the 27 files extracted in the previous task. The old `?v=25&t=1111111111` disappears with the old file. Future edits to any piece bump that piece's own `?v=`.
6. **`recipients.js` is deleted** (`git rm`) in the same commit that swaps the tags. Only two pages loaded it and both are updated, so nothing is left pointing at it.
7. **Not restructuring the workflow.** The work is one atomic mechanical change (create 11 files, swap two tag lines, delete one file, edit `sw.js`). A half-applied state breaks the app, and every verification needs the whole change, so there are no independent features to split. The existing implement-and-review loop runs section 10 as written.

## 2. (a) File map, in load order

Line ranges are inclusive and refer to the ORIGINAL `public/recipients.js` at `bc8be84`. Counts and byte sizes are from the dry run (CRLF working-tree bytes). Every cut point was checked: the prefix up to it parses as a complete script with `vm.Script`, and every piece parses alone.

| # | New file (`public/`) | Original lines | Lines | Bytes (CRLF) | First line of the piece | Contents (feature) |
|---|---|---|---|---|---|---|
| 1 | `recipients-core.js` | 1-578 | 578 | 20,158 | `console.log('Recipients.js loading... v7.0 - ...` | Load banner; scroll-to-present from a notification (`handleScrollToPresentFromNotification`, `scrollToPresentById`, `scrollAndHighlight`) and its `DOMContentLoaded`/`load` listeners; `logout`; shared state `let currentUserId/currentRecipientId/pendingIdentificationRecipientId`; service-worker registration; search and filter UI (`currentFilter`, `searchTimeout`, `initializeSearchAndFilter`, `performSearch`, `applyFilter`, dropdown, `highlightText`, `escapeRegex`, `scrollToElement`, `scrollToPresent`, no-results message); `initializeFAB`; the keyboard-shortcut `keydown` listener (L533). |
| 2 | `recipients-startup.js` | 579-887 | 309 | 14,577 | `document.addEventListener('DOMContentLoaded', function () {` | The big start-up handler (fast-load from persistent cache, `SKIP_RECIPIENTS_INIT` early return, auth check, periodic auth check, form wiring); `initializeAnimations`; `checkAuth`; `getSkeletonCardsHTML`. |
| 3 | `recipients-list.js` | 888-1337 | 450 | 26,382 | `function loadRecipientsWithPresents(` | Data load (`loadRecipientsWithPresents`), the 278-line renderer `displayRecipientsWithPresents`, present-button listeners (`setupPresentButtonListeners`, `handlePresentButtonClick`), `generateProfilePictureHTML`. |
| 4 | `recipients-identify.js` | 1338-1823 | 486 | 19,731 | `function identifyAsRecipient(` | Self-identification and recipient selection modals (identify, cancel identification, delete from selection, add-and-identify), `showErrorModal`, `showSuccessMessage`, profile-picture upload (`openProfileModal`, `previewImage`, `compressImage`, `saveProfilePicture`, `saveImageToServer`). |
| 5 | `recipients-present-actions.js` | 1824-2297 | 474 | 20,016 | `function generatePresentsList(` | Present list HTML, check/bought flow, progress bar, accordion counts, animations, reservation buttons (`generateReservationButton`, `refreshPresentButtons`, `handleBoughtClick`, `handleReserveClick`). |
| 6 | `recipients-helpers.js` | 2298-2518 | 221 | 8,925 | `function formatCommentsPreview(` | `formatCommentsPreview`, `convertUrlsToLinks` (BOTH declarations), `addRecipient`, `deleteRecipient`, `deleteRecipientConfirmed`, `escapeHtml`, `escapeAttr`, `VERIFIED_BADGE_SVG`, `recipientNameWithBadge`, and the three verified-badge `click`/`keydown`/`focusout` listeners (L2461-2473). |
| 7 | `recipients-modals.js` | 2519-3104 | 586 | 24,411 | `// Modal functions` | Add-present redirect (`openAddPresentModal`, `populateAddPresentModal`, `addPresentFromModal`), reserved-presents modal and its animations, add-recipient modal, `showModalMessage`. |
| 8 | `recipients-optimistic.js` | 3105-3420 | 316 | 13,363 | `// ---- Race guards for fast consecutive actions ----` | Race guards (`_pendingPresentOps`, `_presentOpToken`, `_softReloadQueued`, `beginPresentOp`, `endPresentOp`), optimistic updates and rollback, `reservePresentFromRecipients`, `cancelReservationFromRecipients`, `showReservedByOtherModal`, recipient details modal, the `displayRecipientsWithPresents` re-assignment (L3383-3394), the modal focus `DOMContentLoaded` handler (L3397). |
| 9 | `recipients-edit.js` | 3421-3863 | 443 | 17,533 | `function openChangePictureModal(` | Change-picture modal and preview, edit-present sheet (`editPresent`, `saveEditedPresent`, `showEditPresentMessage`), the `window.deletePresent` guard block (L3708), `reorderPresentsList`, `reorderModalPresentsList`, `getFullProfilePictureUrl`, `getEmojiAvatar`. Last line is `}` with no trailing blank line. |
| 10 | `recipients-sync.js` | 3864-4371 | 508 | 21,741 | `// Persistent cache functions` | Persistent cache (`saveToPersistentCache`, `loadFromPersistentCache`, `clearPersistentCache`), `softReloadRecipients`, `updateChangedElementsOnly`, incremental DOM updates (`updatePresentReservationUI`, `updatePresentCheckUI`, `updatePresentInDOM`, `addPresentToDOM`, `addPresentToIdentifiedUserAccordion`, `generateSinglePresentHTML`). |
| 11 | `recipients-toast-undo.js` | 4372-4706 | 335 | 13,817 | `// Toast notification system` | Toasts (`showToast`, `showSuccessToast`, `showErrorToast`, `showInfoToast`), `shareFormularzLink`, undo helpers (`applyPresentState`, `undoPresentAction`, `undoReservation`, `undoCancelReservation`, `undoCheck`), `loadRecipients`, `clearRecipientsCache`, `displayRecipientsData`, `handleIdentificationLogic`, `refreshRecipientsCache`, `filterRecipients`, and the last `DOMContentLoaded` handler (L4699). |
| | **Total** | 1-4706 | **4,706** | **200,654** | | equals the original byte for byte (section 8) |

Cut rule for the implementer: file k starts at the first byte of line `start_k` and ends at the last byte (including the `\r\n`) of line `start_(k+1) - 1`. The cut lines are `1, 579, 888, 1338, 1824, 2298, 2519, 3105, 3421, 3864, 4372`. Operate on BYTES (split on `0x0A`), never re-encode, never normalize line endings. Piece 7 starts at the comment `// Modal functions` (line 2519) and not at line 2520, so the comment travels with the function it describes. Piece 10 starts at line 3864, the comment line, so piece 9 ends exactly on `}` (line 3863).

Lines that stay together on purpose: both `convertUrlsToLinks` declarations (L2348 and L2475) are in piece 6; `displayRecipientsWithPresents` (L1013, piece 3) is only re-assigned later, in piece 8 (L3383-3394), which loads after it.

## 3. (b) Global-symbol inventory

How this was produced: every top-level `function`, `let`, `const`, `var` at column 0 of the original (a regex pass, cross-checked by reading all column-0 statements and by running the original and the split pieces side by side in a `vm` context, section 9). Counts in the "refs" column are the number of non-comment lines that mention the name, per NEW file, excluding the defining line. Because the match is textual it is an upper bound (it includes names that appear inside strings or template literals, and the inline `onclick="..."` strings that `recipients.js` itself builds, which resolve against the same global scope at run time). "External refs" lists only files that are actually loaded together with `recipients.js` (that is `recipients.html` and `home.html` plus their scripts) and the e2e specs; every other page script that mentions one of these names declares its own copy and never loads `recipients.js`, so it is unaffected (counted in the Notes column).

Reading guide:
- A symbol "defined in file X, referenced in file Y" is only a run-time call from inside a function body or an event callback, with the exceptions called out in section 7 (R2).
- `let`/`const` names live in the global declarative environment record, not on `window`; classic scripts share that record, which is why the split keeps working without any export.
- Anything in the table that is also declared by a script loaded AFTER the recipients pieces (`filters.js`, `home-page.js`, `escape-html.js`, ...) is overridden by that later script exactly as before, because tag order relative to those scripts is unchanged.

| Symbol | Kind | Orig. line | New file | In-file / cross-file refs (count of lines, per new file) | External refs on recipients.html / home.html (+ e2e) | Notes |
|---|---|---|---|---|---|---|
| `handleScrollToPresentFromNotification` | function | 4 | core | core:2 | - |  |
| `scrollToPresentById` | function | 20 | core | core:1 | recipients-page.js(2) |  |
| `scrollAndHighlight` | function | 81 | core | core:3 | - |  |
| `logout` | function | 103 | core | core:1 | bottom-tab-bar-snippet.html(4), desktop-nav.js(3), home-page.js(2), home.html(2), recipients.html(3) | also declared in bottom-tab-bar-snippet.html, home-page.js (loads after the pieces on the page that uses it; overrides, as before); 11 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `currentUserId` | let | 158 | core | startup:5 list:9 present-actions:4 modals:3 optimistic:1 edit:1 sync:4 toast-undo:5 | - | 2 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `currentRecipientId` | let | 159 | core | identify:2 | - |  |
| `pendingIdentificationRecipientId` | let | 160 | core | identify:8 | - |  |
| `currentFilter` | let | 176 | core | core:2 | - |  |
| `searchTimeout` | let | 177 | core | core:2 | - |  |
| `initializeSearchAndFilter` | function | 179 | core | startup:1 | - |  |
| `performSearch` | function | 269 | core | core:5 | - |  |
| `applyFilter` | function | 339 | core | core:1 | - |  |
| `showSearchDropdown` | function | 382 | core | core:1 | - |  |
| `hideSearchDropdown` | function | 441 | core | core:5 | - |  |
| `focusSearch` | function | 448 | core | - | - |  |
| `highlightText` | function | 464 | core | core:2 | filters.js(3) | also declared in filters.js (loads after the pieces on the page that uses it; overrides, as before) |
| `escapeRegex` | function | 470 | core | core:1 | filters.js(2) | also declared in filters.js (loads after the pieces on the page that uses it; overrides, as before) |
| `scrollToElement` | function | 474 | core | core:1 | - |  |
| `scrollToPresent` | function | 486 | core | core:1 | filters.js(2) | also declared in filters.js (loads after the pieces on the page that uses it; overrides, as before) |
| `showNoResultsMessage` | function | 504 | core | core:1 | - |  |
| `hideNoResultsMessage` | function | 519 | core | core:2 | - |  |
| `initializeFAB` | function | 527 | core | startup:1 | - |  |
| `initializeAnimations` | function | 826 | startup | startup:1 | - |  |
| `checkAuth` | function | 839 | startup | startup:2 list:1 | home-page-auth.js(2) | also declared in home-page-auth.js (loads after the pieces on the page that uses it; overrides, as before); 2 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `getSkeletonCardsHTML` | function | 869 | startup | list:1 | - |  |
| `loadRecipientsWithPresents` | function | 888 | list | startup:3 list:2 toast-undo:1 | - |  |
| `displayRecipientsWithPresents` | function | 1013 | list | startup:1 list:2 optimistic:2 sync:1 toast-undo:1 | - |  |
| `setupPresentButtonListeners` | function | 1292 | list | list:1 | - |  |
| `handlePresentButtonClick` | function | 1302 | list | list:2 | - |  |
| `generateProfilePictureHTML` | function | 1322 | list | list:1 | - |  |
| `identifyAsRecipient` | function | 1338 | identify | list:2 toast-undo:1 | home-page-auth.js(2), tests/e2e/xss-usernames.spec.js(1) |  |
| `confirmSelfIdentification` | function | 1356 | identify | - | home.html(1), recipients.html(1) |  |
| `deleteRecipientFromModal` | function | 1385 | identify | - | - |  |
| `showRecipientSelectionModal` | function | 1409 | identify | identify:2 toast-undo:1 | home-page-auth.js(2), home.html(1), recipients.html(1) |  |
| `deleteRecipientFromSelection` | function | 1485 | identify | identify:1 | tests/e2e/xss-usernames.spec.js(1) |  |
| `identifyAsRecipientFromSelection` | function | 1507 | identify | identify:2 | tests/e2e/xss-usernames.spec.js(1) |  |
| `addNewRecipientAndIdentify` | function | 1536 | identify | startup:1 | home.html(1), recipients.html(1) |  |
| `cancelIdentification` | function | 1574 | identify | list:2 | tests/e2e/xss-usernames.spec.js(1) | 1 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `confirmCancelIdentification` | function | 1582 | identify | - | home.html(1), recipients.html(1) |  |
| `showErrorModal` | function | 1610 | identify | identify:15 helpers:5 modals:4 edit:2 | - |  |
| `showSuccessMessage` | function | 1616 | identify | identify:6 helpers:2 edit:1 | - |  |
| `openProfileModal` | function | 1635 | identify | - | - |  |
| `previewImage` | function | 1674 | identify | edit:7 | home-page.js(5), recipients.html(2) | also declared in home-page.js (loads after the pieces on the page that uses it; overrides, as before) |
| `compressImage` | function | 1701 | identify | identify:2 edit:2 | - |  |
| `saveProfilePicture` | function | 1742 | identify | - | recipients.html(1) |  |
| `saveImageToServer` | function | 1787 | identify | identify:2 | - |  |
| `generatePresentsList` | function | 1824 | present-actions | list:1 | - |  |
| `togglePresentFromRecipients` | function | 1903 | present-actions | - | - |  |
| `updatePresentCheckStatus` | function | 1931 | present-actions | present-actions:1 | - |  |
| `updateProgressBar` | function | 2025 | present-actions | present-actions:2 | - |  |
| `updateAccordionBoughtCount` | function | 2060 | present-actions | present-actions:1 | - |  |
| `animatePresentTransition` | function | 2069 | present-actions | present-actions:1 | - |  |
| `calculateContainerHeight` | function | 2118 | present-actions | present-actions:1 | - |  |
| `generateReservationButton` | function | 2133 | present-actions | present-actions:2 sync:1 | - |  |
| `refreshPresentButtons` | function | 2193 | present-actions | present-actions:2 optimistic:3 toast-undo:1 | - |  |
| `handleBoughtClick` | function | 2205 | present-actions | present-actions:2 | - |  |
| `handleReserveClick` | function | 2253 | present-actions | present-actions:2 sync:2 | - |  |
| `formatCommentsPreview` | function | 2298 | helpers | present-actions:1 | - |  |
| `convertUrlsToLinks` | function | 2348 | helpers | present-actions:1 helpers:1 modals:2 | - | declared twice (L2348, L2475); the later one wins |
| `addRecipient` | function | 2356 | helpers | - | - |  |
| `deleteRecipient` | function | 2387 | helpers | - | - |  |
| `deleteRecipientConfirmed` | function | 2397 | helpers | - | recipients.html(1) |  |
| `escapeHtml` | function | 2422 | helpers | core:3 list:9 identify:5 present-actions:2 helpers:5 modals:6 optimistic:1 sync:8 | escape-html.js(4), filters.js(5), home-page.js(8), notification-text.js(3), tab-bar-functions.js(1), tests/e2e/xss-usernames.spec.js(12) | also declared in escape-html.js, filters.js, home-page.js, notification-text.js (loads after the pieces on the page that uses it; overrides, as before); 6 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `escapeAttr` | function | 2429 | helpers | core:1 list:4 present-actions:1 helpers:1 sync:3 | escape-html.js(5), filters.js(2), tests/e2e/xss-usernames.spec.js(3) | also declared in escape-html.js, filters.js (loads after the pieces on the page that uses it; overrides, as before); 1 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `VERIFIED_BADGE_SVG` | const | 2441 | helpers | helpers:1 | - |  |
| `recipientNameWithBadge` | function | 2448 | helpers | list:2 | - |  |
| `convertUrlsToLinks` | function | 2475 | helpers | present-actions:1 helpers:1 modals:2 | - | declared twice (L2348, L2475); the later one wins |
| `openAddPresentModal` | function | 2520 | modals | core:1 | bottom-tab-bar-snippet.html(1), recipients.html(1) | also declared in bottom-tab-bar-snippet.html (loads after the pieces on the page that uses it; overrides, as before); 1 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `populateAddPresentModal` | function | 2527 | modals | - | - |  |
| `addPresentFromModal` | function | 2562 | modals | - | - |  |
| `openReservedPresentsModal` | function | 2649 | modals | core:1 startup:1 modals:1 | bottom-tab-bar-snippet.html(2) | also declared in bottom-tab-bar-snippet.html (loads after the pieces on the page that uses it; overrides, as before) |
| `displayReservedPresentsInModal` | function | 2667 | modals | modals:1 | - |  |
| `togglePresentFromModal` | function | 2778 | modals | modals:2 | - |  |
| `updateModalPresentCheckStatus` | function | 2806 | modals | modals:1 | - |  |
| `updateModalBadgeCounts` | function | 2888 | modals | modals:1 | - |  |
| `animateModalPresentTransition` | function | 2909 | modals | modals:1 | - |  |
| `cancelReservationFromModal` | function | 2957 | modals | - | - |  |
| `openAddRecipientModal` | function | 2978 | modals | core:1 modals:1 | bottom-tab-bar-snippet.html(2) | also declared in bottom-tab-bar-snippet.html (loads after the pieces on the page that uses it; overrides, as before) |
| `addRecipientFromModal` | function | 2993 | modals | startup:1 | recipients.html(1) |  |
| `returnToAddPresentModalWithNewRecipient` | function | 3044 | modals | modals:1 | - |  |
| `showModalMessage` | function | 3098 | modals | identify:2 modals:9 | - |  |
| `_pendingPresentOps` | let | 3112 | optimistic | optimistic:3 sync:1 | - |  |
| `_presentOpToken` | let | 3113 | optimistic | optimistic:1 sync:2 | - |  |
| `_softReloadQueued` | let | 3114 | optimistic | optimistic:2 sync:1 | - |  |
| `beginPresentOp` | function | 3116 | optimistic | present-actions:2 toast-undo:1 | - |  |
| `endPresentOp` | function | 3121 | optimistic | present-actions:1 optimistic:2 toast-undo:1 | - |  |
| `fetchWithTimeout` | function | 3130 | optimistic | optimistic:2 | - |  |
| `updateButtonOptimistically` | function | 3139 | optimistic | - | - |  |
| `updatePresentItemOptimistically` | function | 3150 | optimistic | present-actions:1 | - |  |
| `updateCacheOptimistically` | function | 3159 | optimistic | present-actions:1 | - |  |
| `rollbackOptimisticUpdate` | function | 3174 | optimistic | optimistic:4 | - |  |
| `reservePresentFromRecipients` | function | 3194 | optimistic | present-actions:1 | - |  |
| `cancelReservationFromRecipients` | function | 3252 | optimistic | present-actions:1 | - |  |
| `showReservedByOtherModal` | function | 3310 | optimistic | present-actions:1 sync:1 | - |  |
| `redirectIfAuthenticated` | function | 3317 | optimistic | - | - |  |
| `openRecipientDetailsModal` | function | 3327 | optimistic | optimistic:1 | - |  |
| `showRecipientDetailsFromList` | function | 3372 | optimistic | list:1 | - |  |
| `oldDisplayRecipientsWithPresents` | const | 3383 | optimistic | optimistic:1 | - |  |
| `openChangePictureModal` | function | 3421 | edit | - | - |  |
| `saveNewProfilePicture` | function | 3464 | edit | - | recipients.html(1) |  |
| `openProfilePicturePreview` | function | 3548 | edit | list:2 | home-page.js(2) | also declared in home-page.js (loads after the pieces on the page that uses it; overrides, as before) |
| `editPresent` | function | 3592 | edit | list:1 | - |  |
| `populateEditRecipientSelect` | function | 3608 | edit | edit:1 | - |  |
| `saveEditedPresent` | function | 3627 | edit | - | home.html(1), recipients.html(1) | 2 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `showEditPresentMessage` | function | 3694 | edit | edit:6 | - |  |
| `reorderPresentsList` | function | 3746 | edit | present-actions:2 | - |  |
| `reorderModalPresentsList` | function | 3787 | edit | modals:1 | - |  |
| `getFullProfilePictureUrl` | function | 3836 | edit | list:2 identify:1 optimistic:1 edit:1 | - |  |
| `getEmojiAvatar` | function | 3845 | edit | list:2 identify:1 edit:1 | home-page.js(8) | also declared in home-page.js (loads after the pieces on the page that uses it; overrides, as before); 1 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `saveToPersistentCache` | function | 3865 | sync | startup:1 list:1 sync:1 | - |  |
| `loadFromPersistentCache` | function | 3949 | sync | startup:1 list:1 | - |  |
| `clearPersistentCache` | function | 3971 | sync | toast-undo:1 | - |  |
| `softReloadRecipients` | function | 3981 | sync | list:1 identify:5 present-actions:3 helpers:2 modals:2 optimistic:5 edit:3 toast-undo:1 | realtime-updates.js(3) |  |
| `updateChangedElementsOnly` | function | 4040 | sync | sync:1 | - |  |
| `updatePresentReservationUI` | function | 4090 | sync | sync:1 | - |  |
| `updatePresentCheckUI` | function | 4129 | sync | sync:1 | - |  |
| `updatePresentInDOM` | function | 4146 | sync | edit:1 | - |  |
| `addPresentToDOM` | function | 4184 | sync | modals:1 | - |  |
| `addPresentToIdentifiedUserAccordion` | function | 4250 | sync | sync:1 | - |  |
| `generateSinglePresentHTML` | function | 4342 | sync | sync:1 | - |  |
| `showToast` | function | 4375 | toast-undo | present-actions:2 optimistic:2 toast-undo:3 | fast-loader.js(1), home-page.js(15), home.html(1), realtime-updates.js(2) | 4 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `shareFormularzLink` | function | 4427 | toast-undo | list:2 | tests/e2e/xss-usernames.spec.js(1) |  |
| `applyPresentState` | function | 4450 | toast-undo | toast-undo:3 | - |  |
| `undoPresentAction` | function | 4472 | toast-undo | toast-undo:3 | - |  |
| `undoReservation` | function | 4494 | toast-undo | optimistic:1 | - |  |
| `undoCancelReservation` | function | 4501 | toast-undo | optimistic:1 | - |  |
| `undoCheck` | function | 4508 | toast-undo | present-actions:2 | - |  |
| `showSuccessToast` | function | 4519 | toast-undo | toast-undo:2 | recipients-page.js(3) |  |
| `showErrorToast` | function | 4523 | toast-undo | present-actions:2 optimistic:4 toast-undo:2 | recipients-page.js(8) |  |
| `showInfoToast` | function | 4527 | toast-undo | toast-undo:1 | - |  |
| `loadRecipients` | function | 4532 | toast-undo | core:1 | - | 1 unrelated page script(s) mention/declare the name; they never load recipients.js |
| `clearRecipientsCache` | function | 4541 | toast-undo | identify:2 modals:1 toast-undo:1 | - |  |
| `displayRecipientsData` | function | 4549 | toast-undo | startup:3 list:2 | fast-loader.js(4) |  |
| `handleIdentificationLogic` | function | 4592 | toast-undo | list:1 toast-undo:1 | fast-loader.js(2) |  |
| `refreshRecipientsCache` | function | 4645 | toast-undo | - | - |  |
| `filterRecipients` | function | 4663 | toast-undo | toast-undo:1 | - |  |

**`window.*` assignments made by recipients.js (globals by property, not by declaration)**

| Property | Assigned at (orig. lines) | New file(s) | External readers/writers |
|---|---|---|---|
| `window._isLoggingOut` | 107 | core | - |
| `window._currentUserId` | 607, 858 | startup | home.html (inline, sets null), home-page-auth.js (sets), home-page.js, filters.js (reads) |
| `window._dataCache` | 643, 656, 664, 739, 899, 966, 4019, 4544 | startup, list, sync, toast-undo | filters.js (reads) |
| `window._dataCacheTimestamp` | 648, 657, 665, 900, 967, 4020, 4545 | startup, list, sync, toast-undo | - |
| `window._needsIdentifiedUserReload` | 651, 756 | startup | - |
| `window._identifiedUserDataLoaded` | 738 | startup | - |
| `window._cachedIdentificationStatus` | 744, 974, 4022, 4543, 4557, 4652 | startup, list, sync, toast-undo | filters.js (reads) |
| `window._cachedRecipients` | 973, 4021, 4542, 4651 | list, sync, toast-undo | home-page-auth.js (sets), filters.js (reads) |
| `window.pendingDeleteRecipientId` | 1402 | identify | - |
| `window.pendingDeleteRecipientName` | 1403 | identify | - |
| `window.pendingPresentData` | 2584 | modals | - |
| `window._allRecipients` | 3391 | optimistic | - |
| `window._allPresentsByRecipient` | 3392, 4560 | optimistic, toast-undo | - |
| `window.currentChangingRecipientId` | 3423 | edit | - |
| `window.deletePresent` | 3709 | edit | - |
| `window.SKIP_RECIPIENTS_INIT` (READ only) | 676 | startup | home.html inline script sets `true` before the recipients scripts load |

## 4. (c) Load order and the exact `<script>` block

Load order = file-map order = original source order. Strictly sequential, classic, parser-blocking (no `defer`, no `async`, no `type="module"`), exactly like the one tag they replace.

```
1  recipients-core.js
2  recipients-startup.js
3  recipients-list.js
4  recipients-identify.js
5  recipients-present-actions.js
6  recipients-helpers.js
7  recipients-modals.js
8  recipients-optimistic.js
9  recipients-edit.js
10 recipients-sync.js
11 recipients-toast-undo.js
```

Block to insert. It replaces the single line `    <script src="recipients.js?v=25&t=1111111111"></script>` in place (4-space indent, CRLF line endings as in the file), with the surrounding comment and neighbouring tags untouched:

```html
    <script src="recipients-core.js?v=1"></script>
    <script src="recipients-startup.js?v=1"></script>
    <script src="recipients-list.js?v=1"></script>
    <script src="recipients-identify.js?v=1"></script>
    <script src="recipients-present-actions.js?v=1"></script>
    <script src="recipients-helpers.js?v=1"></script>
    <script src="recipients-modals.js?v=1"></script>
    <script src="recipients-optimistic.js?v=1"></script>
    <script src="recipients-edit.js?v=1"></script>
    <script src="recipients-sync.js?v=1"></script>
    <script src="recipients-toast-undo.js?v=1"></script>
```

Position per page (unchanged relative to every neighbour):

| Page | Old tag line | Immediately before | Immediately after |
|---|---|---|---|
| `recipients.html` | 775 | `fast-loader.js` (L772) | `recipients-page-scroll.js?v=1` (L778), then `filters.js?v=9`, `profile-picture-debug.js`, deferred `update-checker.js` / `realtime-updates.js`, `tab-bar-functions.js?v=19`, `desktop-nav.js?v=5` |
| `home.html` | 249 | the order-critical inline script L240-247 (`SKIP_RECIPIENTS_INIT`, `_currentUserId`) | deferred `update-checker.js` / `realtime-updates.js`, `home-page-auth.js?v=1`, `home-page.js?v=1`, `tab-bar-functions.js?v=19`, `desktop-nav.js?v=5` |

`home.html` runs the same pieces with `SKIP_RECIPIENTS_INIT` set. The flag is read inside the start-up handler (piece 2, original L676) at `DOMContentLoaded`, so it only needs to exist before then; it is set by an inline script that runs before the first piece, as before.

## 5. (d) `public/sw.js` change plan

1. Add 11 entries to `urlsToCache`, in load order, immediately after the existing `'/recipients-page-scroll.js?v=1',` line (L14), same quoting and two-space indent as the neighbours:
   ```
     '/recipients-core.js?v=1',
     '/recipients-startup.js?v=1',
     '/recipients-list.js?v=1',
     '/recipients-identify.js?v=1',
     '/recipients-present-actions.js?v=1',
     '/recipients-helpers.js?v=1',
     '/recipients-modals.js?v=1',
     '/recipients-optimistic.js?v=1',
     '/recipients-edit.js?v=1',
     '/recipients-sync.js?v=1',
     '/recipients-toast-undo.js?v=1',
   ```
   The query string must match the `<script src>` byte for byte, because the cache-first handler does an exact-URL `caches.match`.
2. Nothing to remove: `/recipients.js...` is NOT in `urlsToCache` today (it was only runtime-cached). Do not add an entry for it. Stale runtime copies are discarded by the `activate` handler, which deletes every cache whose name is not `CACHE_NAME`.
3. `const CACHE_NAME = 'prezenty-v125';` becomes `'prezenty-v126'` (one bump). Before editing, re-read `main:public/sw.js`; if `main` has moved past `v125`, use its value + 1. Do not bump twice.
4. Edit `sw.js` byte-safely (Node `Buffer` replace, or `str_replace` followed by a CRLF check). The previous task recorded that a quoting slip in PowerShell silently changed nothing. After the edit: `node --check public/sw.js`; a script asserts every `'/recipients-*.js?v=1'` entry appears exactly once, every referenced file exists, `prezenty-v125` occurs 0 times and `prezenty-v126` once; `git diff --stat` shows 12 added lines and 1 changed line.
5. Install is already failure-tolerant (`Promise.allSettled` plus per-URL `catch`), so a typo here cannot break service-worker install, it can only skip precaching; the assertion script is what catches typos.

## 6. (e) Every file that references `recipients.js` by name

Live references (these determine behavior) and the exact edit:

| File | Line | Reference | Edit |
|---|---|---|---|
| `public/recipients.html` | 775 | `<script src="recipients.js?v=25&t=1111111111"></script>` | Replace this one line with the 11-line block in section 4. |
| `public/home.html` | 249 | same tag | Replace this one line with the same 11-line block. Do NOT touch the inline script at L240-247. |
| `public/sw.js` | 1 and the `urlsToCache` array | no reference to `recipients.js` | Section 5. |
| `public/recipients.js` | n/a | the file itself | `git rm public/recipients.js` in the same commit as the tag swap. |

Searched and confirmed to need NO edit: `routes/pages.js` (explicit `sendFile` per page, no script lists), `server.js` (static middleware serves any file in `public/`), `Dockerfile` (`COPY . .`), `.dockerignore`, `vercel.json`, `render.yaml`, `package.json` (no build, no purge script; the only CSS pipeline is `postcss.config.js` whose `./public/**/*.js` glob already covers `recipients-*.js`), `scripts/`, `tests/helpers/*`, `tests/global-setup.js`, `playwright.config.js`.

Comment-only references. They are NOT live and the task is "no cleanup", so leave them exactly as they are and record them in the verification doc:

| File | Line(s) | Note |
|---|---|---|
| `public/home.html` | 242, 245, 248, 259 | HTML/JS comments that say "recipients.js". Line 248 sits next to the new tags; leave it. Keeping the HTML diff to "1 line out, 11 lines in" per page makes it trivially reviewable. |
| `public/recipients.html` | 267 | comment: `openAddPresentModal() in recipients.js` (now `recipients-modals.js`). |
| `public/escape-html.js` 11, 36; `public/filters.js` 690; `public/home-page-auth.js` 14, 75 | | JS comments. |
| `tests/README.md` | 173 | `public/recipients.js:3604` becomes `public/recipients-edit.js:184` (`new Modal(...).show()` for the edit sheet; 3604 - 3421 + 1 = 184). `tests/` is out of scope for this task, so this is reported, not edited. |
| `tests/e2e/edit-sheet.spec.js` | 176 | same stale pointer in a comment. Out of scope, reported only. |
| `.agents/tasks/*.md`, `docs/archive/performance/*.md` | | historical records. |

The e2e spec `tests/e2e/xss-usernames.spec.js` calls these recipients globals through `page.evaluate`: `identifyAsRecipient`, `deleteRecipientFromSelection`, `identifyAsRecipientFromSelection`, `cancelIdentification`, `shareFormularzLink`, `escapeHtml`, `escapeAttr`. They keep working because the names stay global (inventory, section 3).

## 7. (g) Risks and how the contiguous partition handles them

**R1. Top-level `let`/`const` and the temporal dead zone.**
Ten top-level lexical bindings exist: `currentUserId`, `currentRecipientId`, `pendingIdentificationRecipientId` (piece 1); `currentFilter`, `searchTimeout` (piece 1); `VERIFIED_BADGE_SVG` (piece 6); `_pendingPresentOps`, `_presentOpToken`, `_softReloadQueued`, `oldDisplayRecipientsWithPresents` (piece 8). Classic scripts share one global declarative environment record, so a `let` in piece N is visible from piece N+1 onward exactly as it was from later lines of the single file; no `window.` property is involved and nothing needs exporting. TDZ can only bite if a statement that runs while a piece is executing reads a binding declared in a LATER piece. Because the partition is contiguous and in original order, every binding is declared before every later-numbered piece runs, and the only top-level statement that reads a binding from another piece at load time is `const oldDisplayRecipientsWithPresents = displayRecipientsWithPresents` (piece 8), whose operand is a function declared in piece 3. All other readers are inside function bodies or event callbacks that run after all 11 scripts have executed (see R2).

**R2. Function hoisting is per script, so a call that ran "after hoisting" in one file could now run before the callee exists.**
In the single file every declaration is hoisted before the first statement runs; with 11 files, a function declared in piece N does not exist while pieces < N execute. I enumerated every statement that actually executes during load (everything else is a declaration or sits inside a callback):

| Orig. line | Piece | Statement | Needs at load time |
|---|---|---|---|
| 1 | 1 | `console.log('Recipients.js loading...')` | nothing |
| 99, 100 | 1 | `addEventListener(..., handleScrollToPresentFromNotification)` | function in the same piece |
| 163-172 | 1 | `if ('serviceWorker' in navigator) window.addEventListener('load', ...)` | nothing at load |
| 533 | 1 | `keydown` listener (anonymous) | nothing at load |
| 579 | 2 | `DOMContentLoaded` handler (anonymous) | nothing at load |
| 2461, 2466, 2471 | 6 | `click`, `keydown`, `focusout` listeners (anonymous) | nothing at load |
| 3383-3394 | 8 | `const old... = displayRecipientsWithPresents; displayRecipientsWithPresents = function ...` | `displayRecipientsWithPresents` from piece 3 (earlier, OK) |
| 3397 | 8 | `DOMContentLoaded` handler (anonymous) | nothing at load |
| 3708-3742 | 9 | `if (typeof window.deletePresent !== 'function') { window.deletePresent = ... }` | nothing at load (callee names appear only inside the assigned function) |
| 4699 | 11 | `DOMContentLoaded` handler (anonymous) | nothing at load |

No load-time statement calls a function defined in a later piece. The implementer must re-confirm this list on the final files by running the load simulation in section 9 (it throws a `ReferenceError` on any violation).

**R3. Duplicate declarations and overrides.**
`convertUrlsToLinks` is the only name declared twice inside `recipients.js`. Both copies are in piece 6, so within the piece the later one wins exactly as before and no other piece can observe the first. No function name is declared in two different pieces (checked by the script in section 8). Declarations of the same name in scripts that load AFTER the pieces (`escapeHtml`/`escapeAttr`/`highlightText`/`escapeRegex`/`scrollToPresent` in `filters.js`; `logout`/`previewImage`/`getEmojiAvatar`/`openProfilePicturePreview` in `home-page.js`) override the piece versions as before, because the tags keep their position relative to those scripts.

**R4. Listener registration order.**
Several listeners are registered on the same events (`DOMContentLoaded`: L99, L579, L3397, L4699; `keydown`: L533, L2466). Handlers fire in registration order. Scripts execute in tag order, so the order is unchanged. The dry run recorded the same 9 registrations in the same order for the original and for the 11 pieces.

**R5. The scheduling gap between scripts.**
A 200 KB script executes in one task; 11 scripts execute in 11 tasks, and the browser may run other tasks (timers, `fetch` callbacks from earlier scripts such as `fast-loader.js`) between them. `DOMContentLoaded` and `load` cannot fire before the last parser-blocking script has run, so every listener above is unaffected. The scripts loaded before the pieces that call into them do so behind `typeof ... === 'function'` guards, and the guarded targets are good sentinels: `fast-loader.js` guards `displayRecipientsData` and `handleIdentificationLogic`, both in the LAST piece (11), so a true guard means every piece has run. `realtime-updates.js` is `defer` and guards `softReloadRecipients` (piece 10); deferred scripts run after parsing, i.e. after piece 11. `recipients-page.js` guards `scrollToPresentById` (piece 1) and calls `showSuccessToast`/`showErrorToast` (piece 11) only from user-triggered handlers. The one unguarded early call, `showToast(...)` at `fast-loader.js:179` (network-failure path), is just as exposed before the change as after it.

**R6. Route shadowing and relative URLs (why a `public/recipients/` folder is rejected).**
`express.static('public')` runs before `pageRoutes` and before the session middleware, with serve-static's default `redirect: true`. If `public/recipients/` existed, `GET /recipients` would be answered by the static middleware with a 301 to `/recipients/` before the authenticated page route could run. The page would then load at `/recipients/`, and every relative `src`/`href` in `recipients.html` (`recipients-page.js?v=1`, `filters.js?v=9`, `styles`, ...) would resolve against `/recipients/` and 404. The same applies to any new folder named after a page route. Flat `public/recipients-*.js` files cannot do this: the static middleware has no `extensions` option and only answers when the request path equals an existing file, and `/recipients` is not one. The e2e `smoke` spec loads `/recipients` and would catch a regression.

**R7. Concurrent branches.**
Task 5 (`css-consolidate-1`) will edit `<link>` tags in the same HTML files and very likely bumps `CACHE_NAME` to `v126` as well. Different lines, so HTML merges should be clean; `sw.js` will conflict on the `CACHE_NAME` line and possibly in `urlsToCache`. This task must not edit CSS or `<link>` tags. Merge note for whoever lands second: take the union of `urlsToCache` entries and set `CACHE_NAME` to the next free number. Also run `git -C <worktree> merge-base --is-ancestor main HEAD` (or the CRUX pre-check) before landing.

**R8. More requests per page load.**
`server.js` serves `.js` with `no-cache, must-revalidate`, so each of the 11 files is revalidated on every page load (304 when unchanged) instead of one request. They are requested in parallel by the preload scanner and the server uses compression, but the saving of the old single request is gone. If this matters, merging adjacent pieces is a pure concatenation (section 1, decision 2). Not a behavior change.

**R9. Line endings and OneDrive.**
The working tree is CRLF and the committed blobs are LF (`autocrlf=true`). A splitter that re-encodes, trims, or "normalizes" would break the equality gate. Work on bytes only, split on `0x0A`, never decode and re-encode, write with `fs.writeFileSync(path, buffer)`. After writing, `git ls-files --eol` must show the new files as `i/lf w/crlf` once added, like their neighbours. The repo lives on OneDrive: if a write or read fails with "cloud file provider exited unexpectedly", retry the same command, then re-verify sizes and hashes.

**R10. `home.html` runs the same code with `SKIP_RECIPIENTS_INIT`.**
No piece reads that flag at load. The only read is inside piece 2's `DOMContentLoaded` handler, as in the original, so both pages see identical behavior.

## 8. (h) Acceptance gate: concatenation equals the original, byte for byte

This is the primary gate. Everything else is secondary evidence.

Invariant: `concat(recipients-core.js ... recipients-toast-undo.js in the load order of section 4) == public/recipients.js at bc8be84`, with no header or footer bytes added to any piece.

Reference values (frozen before the change, store them in the baseline folder):

| Form | Bytes | SHA-256 |
|---|---|---|
| Committed blob `bc8be84:public/recipients.js` (LF) | 195,948 | `e0ccba3a2097b354f0ab3996b342d77ee088f7c8a1d50620f15424483fc65167` |
| Working-tree file before the change (CRLF) | 200,654 | `ceae7774b1814c03ed4b022243693a2495131a0e0d917f6bf97557b0e4712149` |

The gate must pass in BOTH forms:
1. Working tree: the concatenated bytes of the 11 files on disk have length 200,654 and the CRLF sha256 above.
2. Git objects (what Render/Docker actually build): `git cat-file blob HEAD:public/<piece>` for the 11 pieces, concatenated in order, has length 195,948 and the LF sha256 above (`git cat-file blob bc8be84:public/recipients.js` is the reference).

Also assert in the same script: each piece parses alone (`new vm.Script`), the per-piece line counts equal the table in section 2, no function name is declared in two pieces, and no piece contains a `\r` that is not followed by `\n`. A reviewer that reads only one thing should read this script's output. Keep the script outside the worktree (it may live under `.agents/tasks/`, then be deleted).

Any difference at all is a failed iteration, even whitespace.

## 9. Dry-run evidence (done in this step, in `%TEMP%\splitchk`, nothing written to the worktree)

A throw-away Node script cut the working-tree file at lines `1, 579, 888, 1338, 1824, 2298, 2519, 3105, 3421, 3864, 4372`:
- concatenation of the 11 buffers is byte-identical to the original (`bytes equal true`);
- each piece parses on its own with `vm.Script`; the prefix before every cut also parses;
- sizes and line counts are exactly the ones in section 2;
- all 11 pieces were run in order in one `vm` context with stubbed `window`/`document`/`navigator`/storage, and the original was run as a single script in a second context. The sets of global property names are equal, the sequence of event-listener registrations is equal (9 registrations, same order, same handler names), the lexical globals (`currentUserId`, `currentFilter`, `_pendingPresentOps`, `VERIFIED_BADGE_SVG`, `oldDisplayRecipientsWithPresents`) resolve across pieces, and `convertUrlsToLinks.toString()` is identical (the later declaration wins in both).
This is a node `vm` simulation, not a browser. The browser check is step 6 of the plan.

## 10. Implementation plan (ordered; each item leaves the repo buildable)

Conventions: absolute paths only; the worktree is the only place product files change; temp scripts and baseline evidence go under `.agents/tasks/` (untracked) and are deleted or left as evidence as stated; never `git add .`, stage by name; commit locally, never push; PowerShell uses `;`.

- [ ] 1. Preflight and baseline (nothing in `public/` changes yet).
      Confirm branch `refactor/split-recipients-1`, `git status` clean for tracked files, HEAD is `bc8be84` or a descendant that does not touch `public/recipients*.js`. Copy `public/recipients.js` to `.agents/tasks/split-recipients-baseline/recipients.js.orig` and write the two hashes from section 8 to `SHA256SUMS.txt`. Write the temporary browser harness `.agents/tasks/tmp-split-snapshot.js` (Playwright from the worktree's `node_modules`, `channel: 'msedge'`, `serviceWorkers: 'block'`, storage state `tests/.auth/demo.json`, server from `npm run offline` or the global setup). For `/recipients` and `/home` it records: own global property names added by the page scripts (diff against a blank page) with `typeof`; a hash of every function's source with `\r\n` normalised to `\n`; `typeof` of the 10 lexical names from section 7 R1 via `page.evaluate`; the list of `.js` requests with status; console messages (type and text, stack frames dropped) and `pageerror`s; HTTP >= 400 responses. Run it twice to prove it is deterministic, store as `before-1`, `before-2`, compare them (0 differences).
      Files: `.agents/tasks/split-recipients-baseline/*`, `.agents/tasks/tmp-split-snapshot.js` (all untracked).
      Verify: `before-1` vs `before-2` compare exits 0; baseline hashes equal the section 8 table.

- [ ] 2. Create the 11 pieces with a byte-level splitter.
      Write `.agents/tasks/tmp-split-apply.js` (Node `Buffer` only): read `public/recipients.js`, index the offsets of every `0x0A`, cut at the lines `1, 579, 888, 1338, 1824, 2298, 2519, 3105, 3421, 3864, 4372`, refuse to run if the input hash is not the CRLF hash in section 8, refuse to overwrite an existing file (`wx` flag), write the 11 files named in section 2, then re-read them and assert the concatenation equals the input. `public/recipients.js` stays in place for this item, so the app still works (the pieces are not loaded by any page yet).
      Files created: the 11 `public/recipients-*.js` files of section 2.
      Verify: the splitter's own assertion passes; `node --check` exits 0 for each of the 11 files; line counts and byte sizes equal the section 2 table; run the section 8 script in working-tree mode (it must print equality and pass the "no name declared in two pieces" check); run the vm load simulation from section 9 against the 11 files (no exception, global names and listener order equal to the original).

- [ ] 3. Swap the script tags, delete the old file, commit. This is the atomic behavior-bearing change.
      In `public/recipients.html` (line 775) and `public/home.html` (line 249) replace the single `recipients.js?v=25&t=1111111111` tag line with the 11-line block of section 4, preserving CRLF, indentation, the neighbouring comments and, in `home.html`, the inline script at L240-247. Do the edit with a Node `Buffer` replace (exact old line bytes -> exact new bytes) or `str_replace` plus a check; do not use PowerShell `-replace` on the whole file. Then `git rm public/recipients.js`. Do not touch any `<link>` tag or CSS file.
      Files: `public/recipients.html`, `public/home.html`, `public/recipients.js` (deleted).
      Verify: `git diff --stat` shows exactly 1 deleted + 11 added lines in each HTML file and nothing else besides the deleted JS file; `git ls-files --eol public/recipients.html public/home.html` still shows `i/lf w/crlf`; `npm run test:e2e -- smoke xss-usernames edit-sheet` passes (this repo has no other build step; `package.json` build is a no-op); then commit `refactor: split recipients.js into 11 ordered classic scripts`, staging the 11 new files, the two HTML files and the deletion by name.

- [ ] 4. Service worker.
      Apply section 5 to `public/sw.js`: 11 `urlsToCache` entries after `'/recipients-page-scroll.js?v=1'`, `CACHE_NAME` to `'prezenty-v126'` (or main's value + 1).
      Files: `public/sw.js`.
      Verify: `node --check public/sw.js` exits 0; assertion script (each entry exactly once, each file exists, `prezenty-v125` 0x, new name 1x); `git diff --stat` = 12 added lines, 1 changed; commit `chore: precache recipients scripts and bump service worker cache to v126`.

- [ ] 5. Full verification, evidence and cleanup.
      (a) Section 8 gate in both forms (working tree and `git cat-file blob HEAD:...`). (b) Re-run the harness as `after-final` and compare with `before-1`: the only allowed differences are the request list (`recipients.js?v=25&t=...` replaced by the 11 `recipients-*.js?v=1`, all HTTP 200, `Content-Type` JavaScript, no 404) and the stack-frame/line-number text already dropped; global property names, `typeof`, function-source hashes, lexical names, console messages and page errors must be identical on `/recipients` and `/home`. (c) Full suite `npx playwright test --reporter=list`: expect 121 passed, 11 skipped, 0 failed, the same as the baseline. (d) `git diff --name-status bc8be84..HEAD` must be exactly: 11 `A` (`public/recipients-*.js`), 1 `D` (`public/recipients.js`), `M public/recipients.html`, `M public/home.html`, `M public/sw.js`. Nothing under `routes lib server.js package.json package-lock.json tests postcss.config.js` and no CSS. (e) Write `.agents/tasks/split-recipients-verification.md` with the results above, the commit list, the comment-only stale references of section 6, and the observations of section 12. (f) Delete `tmp-split-apply.js` and `tmp-split-snapshot.js`; keep the baseline folder and snapshot folders as untracked evidence.
      Verify: every check above is recorded as pass in the verification doc, with command and exit code.

- [ ] 6. Review gate (loop contract).
      The semantic reviewer runs last in every iteration, re-checks the section 8 equality, the tag order and attributes in both HTML files, the `sw.js` entries, the forbidden-path diff, and that no behavior-bearing byte changed, then writes `.agents/tasks/split-recipients-review.json` as `{"verdict": "APPROVED"}` or `{"verdict": "CHANGES_REQUESTED", "findings": [...]}` every iteration. The loop stops on `verdict == "APPROVED"`.

## 11. (f) `public/recipients-page.js` finding

743 lines, 35,399 B, a classic script (it is the extracted inline "PWA Install Script", hence the 8-space indentation). It has three clear seams: PWA install prompt and install instructions (L1-L189: `recipientsDeferredPrompt`, logo click handler, `showInstallInstructions`, `showManualInstallInstructions`); notification bell, dropdown and banner (L190-L499: `toggleNotificationDropdown` ... `window.navigateToPresent` ... `handleNotificationClick`, `markAllAsRead`, `showNotificationBanner`, a `click` and a `DOMContentLoaded` listener); push permission and subscription (L501-L743: `requestNotificationPermission`, `checkNotificationStatus`, `subscribeToNotifications`, `sendSubscriptionToServer`, `urlBase64ToUint8Array`, `testNotification`). It is under the 800-line cap, it loads BEFORE the recipients pieces (tag at `recipients.html:736`), and it calls into them only from user events or behind a guard (`scrollToPresentById`, `showSuccessToast`, `showErrorToast`). Decision: leave it as-is in this task. Splitting it is not trivial (three more tags, three more `sw.js` entries, and `let recipientsDeferredPrompt` / `notificationDropdownOpen` would have to stay in the first loaded piece), and it is not required to reach the goal. If a later task wants it, the three seams above are contiguous and it can use the same method. Its name is misleading (it holds PWA and push code, not recipients-list code), which is a naming cleanup, also out of scope.

## 12. Observations for the verification doc (recorded, NOT fixed in this task)

1. `convertUrlsToLinks` is declared twice (L2348 and L2475); the first copy is dead code. Both are kept.
2. **Possible attribute injection, existing behavior.** `convertUrlsToLinks(escapeHtml(title))` (L1855, L2711, L2762) builds `<a href="${cleanUrl}" title="${cleanUrl}">`. `escapeHtml` (textContent to innerHTML) does not escape `"`, and the URL regex `[^\s<]+` accepts `"`, so a present title that contains a URL followed by a `"` can break out of the attribute. This is not changed here (zero behavior change) but should be filed as a follow-up.
3. `window.checkAndPromptIdentification` is checked in `home-page-auth.js:76` but is not defined anywhere, so that branch is never taken and the fallback always runs.
4. `if (typeof window.deletePresent !== 'function')` (L3708) is always true on the pages that load these scripts.
5. `initializeFAB` (L527) is an empty function.
6. The start-up handler dereferences `document.getElementById('profilePictureUrl')` without a null check (L790). It exists on `recipients.html` and the handler returns earlier on `home.html` (`SKIP_RECIPIENTS_INIT`), so it does not fail today.
7. Names with no non-comment textual reference anywhere in `public/` or `tests/` (candidates for dead code, kept): `focusSearch`, `deleteRecipientFromModal`, `openProfileModal`, `togglePresentFromRecipients`, `addRecipient`, `deleteRecipient`, `populateAddPresentModal`, `addPresentFromModal`, `cancelReservationFromModal`, `updateButtonOptimistically`, `redirectIfAuthenticated`, `openChangePictureModal`, `refreshRecipientsCache`. (Textual scan, so a name built dynamically would be missed.)
8. Known and already documented: closing the edit sheet does not return focus to the trigger because the modal is opened with `new bootstrap.Modal(...).show()` (original L3604, will be `recipients-edit.js:184`); covered by an existing `test.fixme`.
9. `sw.js` never precached `recipients.js`; after this change the 11 pieces are precached on install. That is a small, deliberate change in service-worker behavior requested for this task, limited to caching.
