# Quick-add attention scrim - verification

Dims the "Dodaj i edytuj moje prezenty" page behind the mobile quick-add
composer while the user is adding a present.

## Files and selectors changed

**public/formularz.html**
- New markup: `<div class="quick-add-scrim" id="quickAddScrim" aria-hidden="true">`, a direct child of `<body>` just before `.bottom-tab-bar` (body-level, so no transformed/filtered ancestor can break `position: fixed`).
- New CSS, all inside formularz.html's own inline `<style>` block (no shared stylesheet touched):
  - `.quick-add-scrim { display: none }` - the default, i.e. desktop gets no scrim.
  - Inside `@media (max-width: 768px)`: `.quick-add-scrim` (fixed, `inset: 0`, `z-index: 998`, `rgba(0,0,0,0.45)`, `opacity: 0`, `visibility: hidden`, `pointer-events: none`, `transition: opacity 0.18s ease`), `body.quick-add-active .quick-add-scrim` (opacity 1, visible, `pointer-events: auto`), `body.quick-add-active .quick-add-composer` (opaque `#ffffff` + `0 10px 36px rgba(0,0,0,0.45)` shadow).
  - `@media (prefers-reduced-motion: reduce)`: added `.quick-add-scrim` and `body.quick-add-active .quick-add-scrim` to the existing `transition: none !important` group.
- Cache-buster: `formularz.js?v=18` → `?v=19`.

**public/formularz.js** (inside `setupQuickAddComposer`)
- `activateComposer()` / `deactivateComposer(suppressMs)` toggle `body.quick-add-active`; `isComposerActive()`.
- Activate on `form` `focusin`, and on `input` in `#quickAddTitle` / `#quickAddComments` (so typing re-dims after a dismissal).
- Deactivate on: scrim tap, Escape (document-level `keydown`), chevron collapse (existing `#quickAddToggle` handler, `else` branch), successful add (`window._resetQuickAddComposer`), and on `focusout` of the composer.
- `focusout` keeps the composer active if `event.relatedTarget` is inside the form, and otherwise waits 150 ms before deciding; it also bails out if `document.activeElement` is back inside the form, or if a `pointerdown` landed inside the composer in the last 500 ms (iOS does not focus buttons on tap, so a tap on `+`/chevron arrives as a plain blur).
- `updateComposerLayout()` deactivates whenever the composer is not docked (desktop, or the edit tab was left), so a scrim can never get stuck.
- Nothing clears or collapses anything: a dismissal only removes the body class.

## Choices

**z-index: scrim 998.** Measured in the harness: composer `999`, bottom tab bar `1000`, tab-bar menu overlay `9998`, menu/notification panels `9999`. 998 puts the scrim above all page content (header, list, "Dodaj dla kogoś innego" - everything in the auto layer) and below the composer, so the composer stays fully bright.

**Tab bar is not dimmed** (it sits at 1000, above the scrim). It stays fully interactive, it is the user's way off the page, and its labels are `#8e8e93` on translucent glass - already close to the contrast floor, so dimming it would push an interactive control below 4.5:1. Dimming it with a `filter`/`opacity` would also mean an interactive element looks disabled. The composer plus the bar read as one bright "controls" zone against the dimmed list, which is what the change is for.

**pointer-events: auto on the scrim, with tap-vs-drag detection.** `pointerdown` records position and time, `pointerup` dismisses only if the move was < 12 px and the gesture < 700 ms; a longer drag is treated as a scroll and the scrim stays. The scrim is not itself scrollable, so touch scrolling chains straight to the page - no `body` scroll lock was added, and none is needed. Fallback for engines without `PointerEvent`: a plain `click` dismiss.

**No backdrop blur.** The page background is a photo (seba.jpg) behind frosted cards; a blur there costs frames on mobile and muddies the photo for no readability gain.

**Desktop (> 768px): no scrim.** The add form there is already a bounded light-green card at the top of the page with nothing competing for attention, and there is no keyboard occlusion or thumb-reach problem to solve. A full-page dim would be heavy-handed, so `.quick-add-scrim` is `display: none` outside the mobile media query. Confirmed at 1024 px: `display: none`, composer background unchanged (`#f3faf4` card), page untouched.

**Accessibility.** The scrim is `aria-hidden="true"`, has no role, no children and is not focusable (`tabIndex` -1, never in the tab order). It is not a modal: no `role="dialog"`, no focus trap, tabbing out of the composer still works. The composer's labels and the chevron's `aria-expanded` behaviour are untouched. The composer surface is opaque white while active, so all of its text keeps its original (≥ 7:1) contrast and now sits against a darker surround.

## Harness

`%TEMP%\prezenty-scrim` (outside the repo, deleted afterwards): `playwright-core@1.47.2` driving the locally installed Edge, headless, `deviceScaleFactor: 2`, `isMobile`/`hasTouch` at 320 and 375.
`build.js` copied the real `public/` into the temp dir and wrote `harness.html` from the real `formularz.html` with one injected script that stubs `fetch` (`/api/auth`, `/api/user/identification`, `/api/formularz/recipients`, `/api/formularz/my-presents`, `/api/formularz/present`) with six seeded presents. Everything else is real: real stylesheets, real `formularz.js?v=19`, real `tab-bar-functions.js`, real bootstrap/Font Awesome/Remix from CDN, real `seba.jpg` background.
Only failed request: `file:///C:/notification-text.js` (tab-bar-functions.js loads it from an absolute path, which a `file://` page cannot resolve) - unrelated to this change.

## Exercised interactions (375 x 750 unless noted)

| Step | Result |
|---|---|
| Idle | `body.quick-add-active` absent, scrim `opacity 0`, `visibility hidden`, `pointer-events none` |
| Focus `#quickAddTitle`, no text | active, scrim `opacity 1 / visible / pointer-events auto`, composer background `rgb(255,255,255)` |
| Type "Czajnik elektryczny" | still active, `is-expanded` true - the description still auto-expands, above the scrim |
| Hit test | over a list item → `quickAddScrim`; over the page header → `quickAddScrim`; over the `Główna` tab → the tab's icon (bar still clickable); over `#quickAddBtn` → the button |
| Wheel scroll over the scrim | `scrollY` 0 → 260, scrim stays up |
| Pointer drag on the scrim (100 px) | stays active (treated as a scroll) |
| Tap the scrim | dismissed; name still `"Czajnik elektryczny"`, description still expanded |
| Tap back into the name field | dims again immediately (no suppression after a tap/Escape dismissal) |
| Escape | dismissed; name still `"Czajnik elektryczny"`, description still expanded, focus released |
| Chevron collapse | dismissed; name text kept |
| Click `+` while active | add went through: list 6 → 7 items, newest item `"Czajnik elektryczny"`, name/description cleared by the normal add flow, composer collapsed, focus back in `#quickAddTitle`, scrim off (so the new item's flash is visible) |
| Type again after the add | dims again |
| `switchTab('add')` while active | scrim cleared (`active: false`, `opacity 0`) - no stuck dimming when leaving the edit tab |
| `prefers-reduced-motion: reduce` | `transition: none / 0s`, scrim still appears |
| Scroll lock check | `body` stays `overflow: visible`, `position: static`, `touch-action: auto` |
| 320 x 700 | same active behaviour, composer bright, list dimmed |
| 1024 x 800 | scrim `display: none`, desktop card untouched |

`node --check public/formularz.js` exits 0.

## Screenshots (`.agents/tasks/screenshots/`)

`formularz-scrim-375-idle.png`, `formularz-scrim-375-active.png`, `formularz-scrim-320-active.png`, `formularz-scrim-1024.png`.
The first active capture showed the dimmed list bleeding faintly through the composer's `rgba(255,255,255,0.98)` background (the dark scrim made that 2% show-through noticeable); the active state now forces an opaque `#ffffff`, and the re-captured shots are clean.

## Still to do by the orchestrator

`public/sw.js` cache version needs bumping (not touched here). No other cache-buster changes: only `formularz.js` changed, bumped to `?v=19` in `formularz.html`; the inline CSS ships with the HTML.
