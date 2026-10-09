# editTab as primary landing view with "Dodaj dla kogoś innego" entry point

The change inverts the default tab visibility so `editTab` is the landing view for logged-in users, and `addTab` is demoted to an opt-in flow reached via a new "Dodaj dla kogoś innego" button. The heading on the edit card is updated from "Edytuj Moje Prezenty" to "Dodaj i edytuj moje prezenty". Unauthenticated users are dynamically redirected to `addTab` by the auth check so they never see a blank edit view. An old `localStorage`-based flag that previously navigated to the edit tab on page load is removed, along with its polling interval.

**Watch for:** The `editTab` is rendered with `class="tab-content active"` (visible) in static HTML, but `checkAuth()` is async — there is a confirmed flash window where an unauthenticated user sees the edit tab's spinner before the auth response arrives and hides it. No blocking issue, but worth noting. All five review criteria pass.

**Verdict**: APPROVED

---

## High-level view

The heading is correct. `editTab`'s `<h5>` in the HTML diff (line ~513 in the current file) reads "Dodaj i edytuj moje prezenty" — exactly matching the requirement.

`editTab` is now the statically active tab (`class="tab-content active"`, no `display: none`), while `addTab` carries `style="display: none;"` as its initial state. `checkAuth()` flips both when the session is unauthenticated, and calls `loadMyPresents()` immediately on the authenticated path so the list is fetched without any tab switch needed.

The "Dodaj dla kogoś innego" button is present inside `editTab`'s card body, rendered as a full-width `btn-transparent-blur btn-lg` button that calls `switchTab('add', true)`. The `fromButton` flag controls whether the "Wróć do moich prezentów" back-link inside `addTab` is revealed, giving users a clear path back. The button is placed between the quick-add form and the presents list, which is a reasonable position but makes it secondary to the quick-add inline form at the top.

The old `localStorage` roundtrip (`openEditTab` flag + polling interval) is fully removed from both the HTML and JS. The tab bar menu item's `onclick` that set the flag is stripped cleanly. This simplifies the auth flow: the page loads showing the edit tab, and the auth check either confirms it (loads presents) or swaps to add tab.

The `addTab` remains fully functional. The `recipientSelect` dropdown, form submission, and `?osoba=` deep-link pre-selection are untouched by this diff.

---

<details>
<summary>Issues (1)</summary>

1. **Unauthenticated flash of editTab** — `editTab` is statically visible in HTML; unauthenticated users will briefly see the edit card's spinner before `checkAuth()` responds and hides it. Low visual impact, but could be addressed by defaulting both tabs to `display: none` in HTML and letting JS always decide what to show.

</details>

<details>
<summary>Details</summary>

### Heading correctness

The diff at line ~513 shows the `<h5>` text inside `editTab`'s `card-header` changed from `Edytuj Moje Prezenty` to `Dodaj i edytuj moje prezenty` — confirmed match to the requirement.

### editTab as default view

`addTab` now carries `style="display: none;"` as a static inline style (confirmed in diff: `-        <div id="addTab" class="tab-content active">` → `+        <div id="addTab" class="tab-content" style="display: none;">`). `editTab` carries `class="tab-content active"` with no `display: none` override (confirmed: `-        <div id="editTab" class="tab-content" style="display: none;">` → `+        <div id="editTab" class="tab-content active">`).

The `tab-content.active` CSS rule in the page's `<style>` block sets `display: block`, so `editTab` renders immediately on page paint.

The JS-side complement in `checkAuth()` adds two branches:
- Authenticated path: calls `loadMyPresents()` directly — no tab switch needed because the tab is already visible.
- Unauthenticated path and error path: both explicitly set `addTab` to `display: block` and `editTab` to `display: none` (confirmed lines in diff).

There is a confirmed flash gap: between page paint and `checkAuth()` resolving, an unauthenticated user sees `editTab` with its loading spinner. The spinner disappears and `addTab` appears once the fetch completes. This is cosmetic and not a blocking regression.

### "Dodaj dla kogoś innego" button

The button is added to `editTab`'s card body (confirmed in diff at the `+<div class="d-grid mb-4">` block). It uses `btn-transparent-blur btn-lg`, a class defined in the page's `<style>` block as a frosted-glass white button — consistent with the app's visual language. The `onclick` calls `switchTab('add', true)`.

The `fromButton` parameter is new in this diff (`function switchTab(tab, fromButton)`). When `true`, it reveals `#backToEditLink` inside `addTab`, giving the user a clear return path. When `switchTab('add')` is called without the flag (e.g., from other code paths like `switchTab('add')` previously in the empty-list state), the back-link stays hidden — now corrected in the diff to `switchTab('add', true)` in the empty-list button as well.

### localStorage flag removal

The diff removes 17 lines from `formularz.js`: the `DOMContentLoaded` block that read `openEditTab` from localStorage, cleared it, and then polled `currentUser` on a 100ms interval (up to 5 seconds) before calling `switchTab('edit')`. The corresponding `onclick` on the tab bar menu item is also removed from the HTML. This is a clean removal with no dangling references — confirmed by searching the remaining file content.

### Auth flow — no regressions

`switchTab('edit')` still checks `!currentUser` and shows `authModal` for unauthenticated users attempting to reach the edit tab via the back-link or any other code path. The `modalLogin` and `modalRegister` handlers are unchanged. The `authModal` still uses `data-bs-backdrop="static"` (no accidental dismissal). No auth regression.

### addTab accessibility

`addTab` remains fully wired: `#presentForm`, `#recipientSelect`, `#recipientName`, `#formMessage`, and `#editMyPresentsLink` are all present and their IDs are unchanged. `loadRecipients()` still runs unconditionally in `DOMContentLoaded`, so the dropdown populates regardless of which tab is active. The `?osoba=` deep-link path is intact.

### Visual consistency

`btn-transparent-blur` is defined in the page's inline CSS. The frosted-glass appearance (`rgba(255,255,255,0.2)`, `backdrop-filter: blur(10px)`, white border) matches the style used elsewhere on the page. The button sits inside the same `glass-card`-style container as the rest of `editTab`.

</details>

---

<details>
<summary>File map</summary>

- `public/formularz.html` — swapped active/hidden state of addTab and editTab; updated editTab heading; added "Dodaj dla kogoś innego" button; added "Wróć do moich prezentów" back-link in addTab; removed `localStorage` onclick from tab bar menu item.
- `public/formularz.js` — removed `openEditTab` localStorage polling block from DOMContentLoaded; added `loadMyPresents()` call on authenticated path in `checkAuth()`; added unauthenticated/error fallback to show addTab; added `fromButton` parameter to `switchTab()`; updated empty-list button to pass `true` to `switchTab('add', true)`.

Full diff: `git diff 38a5c18..HEAD -- public/formularz.html public/formularz.js`

</details>
