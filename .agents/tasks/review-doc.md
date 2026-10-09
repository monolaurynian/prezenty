# UI Cleanup: Frosted Glass, Heading Hierarchy, Button Visibility, and Spacing

The change set normalizes the visual language across Prezentownik's five main pages. The core intervention is replacing solid/opaque card backgrounds with a consistent frosted glass surface (`rgba(255,255,255,0.78)` + `backdrop-filter: blur(16px) saturate(160%)`), which was already present on the homepage but absent or inconsistent on the remaining pages. Supporting changes reduce alert visual weight, tighten button styles for small screens, and suppress a `dark overlay` that was obscuring the background photo. The JS layer is untouched.

**Watch for:** (1) **confirmed** — home.html JS-generated present cards use slightly weaker glass values (`0.72` alpha, `blur(14px)`) than the CSS class standard, creating a visible inconsistency between the static container and the dynamically injected rows. (2) **confirmed** — `btn-transparent-blur` ("Dodaj dla kogoś innego") renders dark text on a near-white surface inside a white frosted card — the button blends into its own container and is not self-evidently interactive. (3) **likely** — `app-theme.css` defines `.glass-card` as a reusable utility class but the HTML files that could use it (formularz, recipients, activity) don't reference it, reproducing the same values inline; future edits must be kept in sync in multiple places.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The frosted glass token is now applied consistently across `recipients.html`, `activity.html`, and `formularz.html` via per-page scoped rules, matching what `home.html` already had. `app-theme.css` adds a `.glass-card` class and a `desktop-nav` sidebar that encode the canonical values, which is good, but those values are replicated as inline styles in the dynamically generated home.html HTML strings rather than consumed via the class.

The `background-overlay` dark blur has been correctly disabled on all non-login pages; each page instead declares its own body background so the photo renders reliably under the frosted cards. The comments in the code correctly explain *why* (the deduped min.css resets body to transparent), which is useful institutional knowledge.

Button visibility on small screens received a targeted fix in recipients.html via an `@media (max-width: 480px)` rule that drops font-size and allows wrapping for action buttons. The `btn-transparent-blur` button in formularz.html sits inside a light frosted card, where its near-white background makes it appear disabled or part of the surrounding container — the fix addresses one surface while introducing the problem on another.

Alert boxes in formularz.html have been de-weighted with a muted `rgba(0,0,0,0.04)` background, which is the right direction. The change is scoped to that page; activity.html's card text uses an aggressive `* { color: #2d3748 !important }` override that cascades to link text (caught with a carve-out rule), but the `text-shadow: none !important` cascade on the same selector flattens all text treatments — including the accordion headers that rely on white text on colored backgrounds.

---

<details>
<summary>Issues (4)</summary>

1. **Home.html JS card token drift** — Present cards injected by JS use `rgba(255,255,255,0.72)` / `blur(14px) saturate(150%)` / `rgba(255,255,255,0.55)` border / `rgba(0,0,0,0.13)` shadow. The CSS standard (`app-theme.css` `.glass-card`) is `0.78` / `blur(16px) saturate(160%)` / `rgba(255,255,255,0.6)` / `rgba(0,0,0,0.18)`. Update the inline template strings in the `renderAvailablePresents` and `renderMyReservations` functions to use the canonical values, or apply the `.glass-card` class.
2. **btn-transparent-blur contrast** — "Dodaj dla kogoś innego" has `background: rgba(0,0,0,0.06)` on a `rgba(255,255,255,0.78)` card body. The combined visual result is near-white on white with a hairline border; on any screen with slight glare the button is invisible. Use a more distinct fill (e.g. `rgba(0,0,0,0.09)` minimum, or convert to `btn-outline-secondary` / an explicit border color that meets 3:1 contrast).
3. **Activity page cascade clobbers accordion header text** — `activity-page .card *, .activity-page .main-card *` sets `color: #2d3748 !important; text-shadow: none !important` on all descendants. If an accordion-style card with a colored header is ever added to the activity page, the rule will render the header text dark-on-dark. The existing carve-out for `btn-primary` etc. covers buttons but not `card-header h5`. Add `.activity-page .card-header` to the carve-out list proactively.
4. **app-theme.css glass-card utility underused** — `.glass-card` encodes the canonical frosted token but formularz.html, recipients.html, and activity.html reproduce the same rgba/blur values inline rather than using the class. This isn't a visual bug today, but a single future edit to the token will require touching five files. Adopt the utility class as part of any follow-on cleanup.

</details>

<details>
<summary>Details</summary>

## Frosted glass token: canonical values vs. actual usage

The agreed surface is `rgba(255,255,255,0.78)` + `backdrop-filter: blur(16px) saturate(160%)` + `1px solid rgba(255,255,255,0.6)` + `box-shadow: 0 8px 24px rgba(0,0,0,0.18)`. This exact set appears in:

- `app-theme.css` `.glass-card` (the canonical source)
- `recipients.html` `.recipients-page .recipient-item` and the filter panel inline style
- `formularz.html` card inline styles on both tabs (`0.78`, `blur(16px)`)
- `activity.html` `.activity-page .card` via `!important` rules

The home.html JS-generated cards break from this in both places they appear (available presents and reservations template strings):

```js
// home.html ~line 588 and ~line 746
background: rgba(255,255,255,0.72);     // should be 0.78
backdrop-filter: blur(14px) saturate(150%);  // should be blur(16px) saturate(160%)
border: 1px solid rgba(255,255,255,0.55);    // should be 0.6
box-shadow: 0 6px 20px rgba(0,0,0,0.13);    // should be 0 8px 24px rgba(0,0,0,0.18)
```

The static `.stats-container` on the same page uses the correct values. At typical viewing distances on mobile the difference between `0.72` and `0.78` alpha is subtle but measurable — the dynamically loaded rows will appear marginally more transparent than the surrounding containers.

## btn-transparent-blur visibility

The button is styled in formularz.html:

```css
.btn-transparent-blur {
    background: rgba(0, 0, 0, 0.06) !important;
    border: 2px solid rgba(0, 0, 0, 0.12) !important;
    color: #2d3748 !important;
}
```

It sits inside a card whose body has `background: rgba(255,255,255,0.78)`. The rendered button background is effectively `#f0f0f0` on a `#f9f9f9` card — a contrast ratio well below the 3:1 WCAG non-text minimum for interactive elements. The earlier reported problem ("button is not visible") was on the dark-overlay version; the fix correctly moved it to a dark-on-light style, but the specific values leave it under-differentiated from the card surface.

## Small-screen button safety on recipients.html

The `@media (max-width: 480px)` rule in recipients.html adds `white-space: normal; font-size: 0.8rem; padding: 0.5rem 0.75rem; min-height: 36px` to `.present-item .present-actions .btn`. This correctly prevents overflow on narrow viewports. The `min-height: 36px` keeps touch targets accessible. The change is well-scoped and doesn't affect desktop.

## Activity page text cascade

`activity.html` contains:

```css
.activity-page .card *,
.activity-page .main-card * {
    color: #2d3748 !important;
    text-shadow: none !important;
}
```

Carve-outs exist for `btn-primary`, `btn-danger`, and `btn-success` to restore white text on those buttons. The page currently has no accordion with a colored header, so this causes no visible bug today. The risk is that adding a red/orange/green card header to the activity page in the future produces dark text on a dark background. The fix is one additional carve-out line: `.activity-page .card-header { color: white !important; }` (with specificity matching the existing pattern).

The link carve-out (`.activity-page .notification-message a`) correctly preserves blue link color in notification rows — that is a new addition and works.

## Alert de-weighting on formularz.html

The seasonal info alert now renders at:
```css
.alert-info {
    background-color: rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.08);
    color: #4a5568;
}
```

The text is still fully legible and the alert's informational content is preserved; it no longer competes visually with the primary submit button.

## Sidebar dead-code retention

`activity.html` and `formularz.html` both carry full sidebar component definitions (`.sidebar-header`, `.sidebar-close`, `.sidebar-item`, hundreds of lines) with `display: none !important` on the activating elements. These are the old hamburger-menu sidebars superseded by the bottom tab bar. The CSS definitions remain in the files unused. This is not a visual regression but represents meaningful dead weight that should be cleaned up in a follow-on pass.

</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|------|-------------|
| `public/styles.css` | CSS custom properties (`--ios-*`) normalized; base `.btn`, `.form-control`, `.present-item`, `.recipient-item`, `.main-card` refactored for consistency |
| `public/app-theme.css` | Added `.glass-card` utility class, `desktop-nav` sidebar component, toast styles, `btn-reserve` color, identity modal sizing, and unified top-bar rules |
| `public/home.html` | Background overlay switched to transparent; `stats-container` adopts frosted surface; page-title navbar hidden on mobile; user avatar added to navbar |
| `public/recipients.html` | Frosted glass applied to all card types via scoped `.recipients-page` rules; outer wrapper made transparent to fix `backdrop-filter` stacking; small-screen button safety rule added; notification-item rows set to solid white for readability |
| `public/formularz.html` | Frosted glass applied to both tab cards via inline styles; dark overlay removed; `alert-info` de-weighted; `btn-transparent-blur` introduced for the "Dodaj dla kogoś innego" secondary action |
| `public/activity.html` | Frosted glass applied to `.card`/`.main-card`; dark overlay removed; `*` color cascade added with carve-outs for buttons and links; notification rows set to solid white |

Full diff: `git diff main -- public/styles.css public/app-theme.css public/home.html public/recipients.html public/formularz.html public/activity.html`

</details>
