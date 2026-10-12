# Composer v2 — summary

## Service worker cache version

`public/sw.js`: `CACHE_NAME` bumped `prezenty-v121` → `prezenty-v122`, via a
single targeted one-line edit. `node --check public/sw.js` passes. The bump is
what rotates the cached *HTML* so clients actually pick up the new `?v=`
references below.

## urlsToCache

**No additions.** The composer-v2 work introduced no new asset — every change
was made inside files that already exist (`public/formularz.html`,
`public/formularz.js`, `public/tab-bar-functions.js`,
`public/bottom-tab-bar.css`, plus the new `tests/e2e/composer.spec.js`, which
is not shipped to the browser). The current `public/formularz.html` references
only already-known files (`styles.deduped.min.css`, `bottom-tab-bar.css`,
`app-theme.css`, `pluralize-pl.js`, `formularz.js`, `tab-bar-functions.js`,
`desktop-nav.js`, the three CDN URLs and `remixicon.css`), so the existing
`urlsToCache` list is left byte for byte as it was.

## Cache-busters bumped across the feature

| File | From | To | Pages |
|---|---|---|---|
| `tab-bar-functions.js` | `?v=17` | `?v=18` | 8 (activity, formularz, home, leaderboard, recipients, rezerwacje, ustawienia, wiadomosci) |
| `bottom-tab-bar.css` | `?v=41` | `?v=42` | 8 (same set) |
| `formularz.js` | `?v=20` | `?v=21` | formularz (1 occurrence) |

`app-theme.css` stays at `?v=14` — nothing in this feature touches it. No
`?v=17`, `?v=41` or `?v=20` reference remains anywhere. `archiwum.html` and
`osoby.html` load neither shared file; `tab-bar-demo.html` loads an unversioned
copy and was left alone.

## Collapsed bar and chevron

The collapsed add-present bar no longer shows a `+` button, and the chevron is
gone from the collapsed state too.

- The redundant `+` submit (`#quickAddBtn`) is `visibility: hidden` while
  collapsed, but **keeps its 52px grid column**; the chevron
  (`#quickAddToggle`) is likewise `visibility: hidden` with its 48px column
  reserved. Nothing animates `grid-template-columns`, so the name field's box is
  pixel-identical collapsed → add mode → collapsed (77/217 at 375px) — no layout
  jump, and no reliance on WebKit interpolating grid columns.
- A decorative `.quick-add-cue` (48×48 green circle with a `+`, `aria-hidden`,
  `pointer-events: none`, no tab stop) sits in the chevron's cell so the
  collapsed row still reads as "add something".
- The affordance is the **whole row**: a `click` listener on `#quickAddForm`
  enters add mode and focuses the name field, giving a ~70 × 296–390px target.
  The collapsed name field is borderless/transparent with the prompt
  `Dodaj prezent…` (`Dodaj nowy prezent…` was rejected: it needs 159.1px of the
  130px available at 320px and clipped mid-word).
- The chevron **is kept in add mode** — it is the only control that re-opens a
  manually collapsed details row. Making it unreachable while collapsed removes
  it from both the tab order and the a11y tree, which is what let the pointer
  coordination code be deleted outright: `togglePointerDown`,
  `markTogglePointer`, the `pointerdown`/`mousedown` listeners, the `keepDesc`
  option and branch, the `fromTogglePointer` branch, and `descDismissed`.

## Root cause of the fixed judder

**The page's reserved bottom padding was derived from the dock's live
visibility.** `tabBarOffset()` read
`bar.classList.contains('tab-bar-hidden')` and a `MutationObserver` on the dock
re-ran `updateComposerLayout()` on every class write, so `--quick-add-bottom`
changed, `body.has-tab-bar.quick-add-docked`'s `padding-bottom` animated, and
`document.scrollHeight` moved **mid-gesture**. The browser clamped `scrollY` to
the new maximum, the clamp reached the scroll handler as a ">8px scrolled up"
delta, the handler re-showed the dock, and the loop re-armed.

The fix broke the feedback loop at its source: the handler now reads only
`scrollY`, `innerWidth`, `documentElement.scrollHeight` and two body classes —
never the dock's geometry. Visibility is a single `body.dock-hidden` flag, the
dock `MutationObserver` is gone, padding comes from one monotonic-on-entry
`--quick-add-reserve`, and the composer rides the same `--dock-hide-shift`
transform so composer and dock move as one unit. Measured on a 30 × 22px drag at
375px: 14 distinct `scrollHeight` values → 1, 15 padding values → 1, 30 dock
attribute mutations → 0, and the composer-to-dock gap pinned at 28px instead of
collapsing from 28px to 1.6px (negative at 320px). Hysteresis thresholds
(`HIDE = 14px`, `SHOW = 8px`, `NOISE = 1px`) cut dock state changes from 11 to 1
across twelve ±11px reversals.

Two related defects found and fixed alongside it: entering add mode from a
scroll-hidden dock dropped `transform` from the transition list and displaced the
composer 98px in a single frame (now 0.01–0.02px — both properties share duration
and easing), and a bottom-pinned reader lost 9px of scroll on entry because the
reserve was read live while the row grew (now floored for 320ms after entry, 0px
of drift).
