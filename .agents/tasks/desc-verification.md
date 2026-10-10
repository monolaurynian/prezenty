# Verification: optional description nudges (formularz)

Files changed: `public/formularz.html`, `public/formularz.js` only (script tag bumped to `formularz.js?v=18`; `sw.js` not touched per ownership, the new `?v` already bypasses the cached URL).

## What changed
- **Auto-expand (mobile composer)**: `input` on `#quickAddTitle` with non-whitespace text sets `.is-expanded` + `aria-expanded="true"` (label "Ukryj opis"); focus is not moved. Closing via the chevron sets a `descDismissed` flag so it doesn't auto-reopen for that entry. Clearing the name resets the flag and collapses (kept open only if a description was already typed, so typed text isn't hidden). A successful add calls `window._resetQuickAddComposer()` → compact + flag reset.
- **Animation**: on <=768px the desc row is always in the grid (`"toggle name submit" / "desc desc submit"`, `row-gap: 0`) and animates `max-height`/`margin-top`/`opacity` (0.2s), with `visibility: hidden` when collapsed (out of tab order / AT). `prefers-reduced-motion: reduce` → `transition: none`.
- **Desktop (>768px)**: desc is always visible in the green card (unchanged); only the hint/placeholder are new.
- **Hint**: placeholder `Rozmiar, kolor, link do sklepu…` plus helper line above the field `Szczegóły pomagają trafić 🎯` (`#quickAddHint`, textarea `aria-describedby`, emoji `aria-hidden`). The longer "…trafić w prezent 🎯" wrapped to 2 lines at 320px (column is 218px next to the round + button), so it was shortened; gender-neutral.
- **Keys**: Enter in the name input still submits (form implicit submission). In the textarea Enter = newline, Ctrl/Cmd+Enter calls `quickAddPresent()` (ignored while IME composing).
- **Chip**: `displayMyPresents()` renders `<button class="my-present-add-details" data-add-details="{id}" aria-label="Dodaj szczegóły do: {title}">` below the title when comments are empty/whitespace and the title has no `http(s)://` link. Title escaped with new `escapeAttr()` (escapeHtml + `"`/`'`). One delegated click listener on `#myPresentsList` (bound once, survives innerHTML re-renders) looks up the present in `myPresentsById` (refreshed each render) and calls `openEditPresentModal(..., focusComments=true)`, which focuses `#editPresentComments` (caret at end) on `shown.bs.modal`. Saving reloads the list, so the chip disappears once a description exists. Style: dashed `#c99700` border, `#fff8e1` fill, `#664d03` text, 32px visual, `::after` inset -6px → 44px hit area, focus-visible outline.

## Harness (temp, deleted)
`%TEMP%\prezenty-desc-harness\run.js` with `playwright-core@1.47.2` driving local headless Edge. Playwright request routing served the **real, unmodified** `public/formularz.html`, `formularz.js`, stylesheets, `tab-bar-functions.js`, etc. from the repo at `http://app.test/`, and mocked `/api/auth`, `/api/user/identification` (Ania), `/api/formularz/recipients`, `/api/formularz/my-presents`, `POST /api/formularz/present`, `PUT /api/presents/:id` (in-memory). Bootstrap/FA from CDN. Seed: "Kubek termiczny" (no desc), "Sweter wełniany" (desc), `Perfumy "Chanel" & 'Coco' <b>` (null desc, escaping test). No page errors logged. Also `node --check public/formularz.js` → exit 0.

## Results: 27 PASS, 0 FAIL
375×812:
- Initial: compact, `aria-expanded=false`, desc hidden, height 0; composer 632–702px, FAB top 712, bar top 730 (docked).
- Type "Słuchawki": expanded, `aria-expanded=true`, desc visible (89px), focus still `quickAddTitle`; composer 537–702 (still above FAB/bar); `--quick-add-h` = 165px = composer height; body padding-bottom grew 200px → ~295px; at page bottom "Dodaj dla kogoś innego" ends at 506px, composer top 594px (not covered).
- Chevron collapse, then keep typing " bezprzewodowe": stays collapsed.
- Enter: POST with title "Słuchawki bezprzewodowe"; afterwards compact, name empty, focus back in name.
- Next entry "Książka" auto-expands again; Ctrl+A + Backspace collapses.
- Textarea: Enter inserted newline (no POST); Ctrl+Enter posted comments "Wydanie twarde\nAutor: Lem"; compact afterwards, focus in name.
- Chips only on Słuchawki, Kubek, Perfumy (not Książka/Sweter). Perfumy aria-label exactly `Dodaj szczegóły do: Perfumy "Chanel" & 'Coco' <b>`. Chip 32px tall, `::after` top/bottom -6px.
- Click Kubek chip: modal open, focus `editPresentComments`, id 3. Typed "Czarny, 500 ml", Zapisz → re-render shows comments, chip gone.
- Keyboard: focus Perfumy chip + Enter → modal, desc focused, raw title intact.
- Edit/delete buttons: 5/5/5 items; count badge "5 prezentów".

320×640: auto-expanded, composer bottom 534 < FAB 544 / bar 558, focus in name; hint 1 line; no horizontal overflow.
1024×900: toggle `display:none`, desc visible (100px), form not fixed, not docked; Enter adds "Gra planszowa", desc stays visible, focus in name.
Reduced motion: desc `transition-duration: 0s`, expands instantly (89px without waiting).

Not verifiable in harness: a real on-screen keyboard. `visualViewport` resize/scroll listeners and `updateComposerLayout()` are unchanged, and expansion goes through the same function and ResizeObserver.

## Screenshots (`.agents/tasks/screenshots/`)
- `formularz-desc-375-empty.png`: compact bar.
- `formularz-desc-375-typing.png`: auto-expanded with hint and placeholder.
- `formularz-desc-375-chip.png`: Kubek and Perfumy with chip, Sweter with description and no chip.
- `formularz-desc-320-typing.png`, `formularz-desc-1024.png`.
