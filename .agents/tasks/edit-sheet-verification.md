# "Edytuj prezent" modal -> bottom sheet (CSS only)

## Stylesheet edited

`public/app-theme.css` — appended one commented block at the end. Nothing else was touched.

It is the only hand-maintained stylesheet loaded by **all three** pages that own an
`#editPresentModal`:

| page | stylesheets loaded (local) |
|---|---|
| `formularz.html` | `styles.deduped.min.css`, `bottom-tab-bar.css?v=41`, **`app-theme.css?v=13`** |
| `recipients.html` | `styles.deduped.min.css`, `aws-design.css?v=4`, `bottom-tab-bar.css?v=41`, **`app-theme.css?v=13`**, `filters.css?v=7` |
| `home.html` | `styles.deduped.min.css`, `bottom-tab-bar.css?v=41`, **`app-theme.css?v=13`** |

`public/styles.css`, `styles-clean.css` and `styles.purged.css` are not linked by any of the
three pages — confirmed, they are not served.

**No page is left uncovered.** All three load `app-theme.css`.

## Selectors added

Everything is scoped to `#editPresentModal`, so `authModal`, `loginModal`,
`addPresentModal`, `selfIdentificationModal`, etc. are unaffected.

Inside `@media (max-width: 768px)`:

- `#editPresentModal .modal-dialog` — `position: fixed; left/right/bottom: 0; width: 100%; max-width: 100%; margin: 0` (overrides `.modal-lg` on recipients/home).
- `#editPresentModal .modal-content` — `border-radius: 20px 20px 0 0`, `border-bottom: none`, `max-height: 90vh` then `max-height: 90dvh` (vh first as the fallback), `box-shadow: 0 -8px 32px rgba(0,0,0,.3)`.
- `#editPresentModal .modal-content::before` — decorative grab handle, `position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 40px; height: 4px; border-radius: 2px; background: rgba(0,0,0,.18); pointer-events: none`.
- `#editPresentModal .modal-header` — `padding-top: 1.5rem` (room for the handle), `border-radius: 20px 20px 0 0`. The existing title + close-button flex layout is untouched; verified in the screenshots on all three pages.
- `#editPresentModal .modal-body` — `overflow-y: auto; -webkit-overflow-scrolling: touch; min-height: 0` (so flex shrinks the body, not the footer).
- `#editPresentModal .modal-footer` — `padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px))`.
- `#editPresentModal.modal.fade .modal-dialog` — `transform: translateY(100%); transition: transform .3s ease-out`; `#editPresentModal.modal.show .modal-dialog` — `transform: translateY(0)`. Replaces Bootstrap's drop-from-top.
- Nested `@media (prefers-reduced-motion: reduce)` zeroes both the transform and the transition.

Outside the media query:

- `textarea#editPresentComments.form-control, textarea#presentComments.form-control` — `min-height: 120px; resize: vertical`.
- `@media (min-width: 769px)` bumps the same two to `min-height: 132px`.

**No `!important` was needed.** Grepped every CSS file and every inline `<style>` block on the
three pages: nothing targets `#editPresentModal`, `#editPresentComments` or `#presentComments`,
and no rule sets a `min-height` on a textarea. The ID-based selectors outrank both
Bootstrap's `.form-control` and the page-level rules such as
`.recipients-page .modal-content { ... !important }` (that one only sets background and
backdrop-filter, which the sheet keeps).

## z-index: no intervention needed

Measured in the harness: tab bar `1000`, Bootstrap backdrop `1050` / modal `1055`
(`1055` / `1060` on recipients, which raises `.modal` with an inline rule). The sheet and its
backdrop already sit above the fixed tab bar.

## Measurements (headless Edge via playwright-core, real viewports, DPR 2)

| shot | page | viewport | dialog bottom | viewport height | content max-height | textarea height | body scrolls inside sheet |
|---|---|---|---|---|---|---|---|
| `edit-sheet-375.png` | recipients | 375x720 | **720** | 720 | 648px (90dvh) | **120px** | yes (427 > 416) |
| `edit-sheet-320.png` | recipients | 320x640 | **640** | 640 | 576px | **120px** | yes (427 > 344) |
| `edit-sheet-375-longform.png` | recipients | 375x720 | **720** | 720 | 648px | **120px** | yes (427 > 416) |
| `edit-sheet-1024.png` | recipients | 1024x800 | 598 (top-anchored, dialog top 28) | 800 | `none` | **132px** | no |
| `edit-sheet-formularz-375.png` | formularz | 375x720 | **720** | 720 | 648px | **120px** | no (short form) |
| `edit-sheet-home-375.png` | home | 375x720 | **720** | 720 | 648px | **120px** | no (short form) |

- Dialog bottom edge == viewport bottom exactly (0px gap) on every mobile shot.
- Textarea height 120px on mobile / 132px on desktop, both above the ~110px bar. `resize`
  computes to `vertical` everywhere.
- `#presentComments` (formularz inline add-form, behind the sheet) measured 120px too.
- Grab handle resolves on mobile (`::before` content `""`, 40x4px) and is absent on desktop
  (`content: none`).
- Desktop is unchanged: `border-radius: 12px` all round (the existing `--aws-radius-lg`), no
  `max-height`, dialog still top-anchored at `top: 28`.

## Cache-buster bumps needed (I could not edit the HTML)

`app-theme.css` changed, so the three `<link>` tags need `?v=13` -> `?v=14`:

- `public/formularz.html` line 19 — `<link href="app-theme.css?v=13" rel="stylesheet">`
- `public/recipients.html` line 38 — `<link href="app-theme.css?v=13" rel="stylesheet">`
- `public/home.html` line 52 — `<link href="app-theme.css?v=13" rel="stylesheet">`

The service worker cache name in `public/sw.js` likely needs its usual bump as well.

## Harness

Built in `%TEMP%\prezenty-sheet-harness` (outside the repo, deleted after the run). A Node
script read each page's real `<head>`, rewrote every local `<link>` to a `file:///` URL into
`public/`, copied every inline `<style>` block verbatim, copied the `#editPresentModal` markup
verbatim by brace-matching the `<div>`s, kept the real `<body class>` and added a stub
`.bottom-tab-bar`. Bootstrap 5.3 CSS/JS came from the CDN; the modal was opened with
`new bootstrap.Modal(...).show()` and measured with `getBoundingClientRect` +
`getComputedStyle`. `playwright-core` drove the installed Edge.
