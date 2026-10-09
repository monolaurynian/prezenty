# Implementation Plan: Dodaj Tab — Edit View as Primary Screen

## Context summary

`formularz.html` has two toggled views controlled by `switchTab()` in `formularz.js`:

- **`#addTab`** (`class="tab-content active"`, `display: block` at load) — the "Dodaj Swój Prezent" form with a recipient dropdown.
- **`#editTab`** (`class="tab-content"`, `display: none` at load) — the "Edytuj Moje Prezenty" view with a quick-add form and the user's own present list.

`switchTab('edit')` checks `currentUser`; if not authenticated it shows `#authModal`. `checkAuth()` runs on `DOMContentLoaded` and sets `currentUser` asynchronously. A `localStorage` flag `openEditTab` already exists to jump straight to the edit tab on load (used from the hamburger menu). The `.glass-card` class in `app-theme.css` gives frosted glass at `rgba(255,255,255,0.78)` + `blur(16px)`.

The **add-for-someone-else form** (current `#addTab`) must remain fully functional; it becomes a secondary destination reachable via a new "Dodaj dla kogoś innego" button on the edit view.

---

## Plan

- [ ] 1. **Make `#editTab` the default visible view and `#addTab` hidden at page load.**

  In `formularz.html`, swap the initial visibility of the two tabs:
  - `#addTab`: remove `active` from `class`, add `style="display: none;"`.
  - `#editTab`: add `class="tab-content active"` (remove `style="display: none;"`).

  Change the `<h5>` heading inside `#editTab`'s `.card-header.bg-red` from
  `Edytuj Moje Prezenty` → `Dodaj i edytuj moje prezenty`.

  Files: `public/formularz.html`
  Verify: open `formularz.html` in a browser — the edit/manage view is the first thing visible; the add-for-someone form is not shown on load.

---

- [ ] 2. **Add a "Dodaj dla kogoś innego" button to `#editTab`.**

  Place a full-width button just below the `<hr>` separator that sits between the quick-add form and `#myPresentsList` inside `#editTab`. The button navigates to the add view by calling `switchTab('add')`.

  Button markup to insert immediately before `<div id="myPresentsList">`:

  ```html
  <div class="d-grid mb-4">
      <button type="button" class="btn btn-transparent-blur btn-lg"
              onclick="switchTab('add')" style="border-radius: 14px;">
          <i class="fas fa-user-friends me-2"></i>Dodaj dla kogoś innego
      </button>
  </div>
  ```

  Use the existing `.btn-transparent-blur` class defined in `formularz.html`'s `<style>` block — it already gives the frosted glass look (`rgba(255,255,255,0.2)` + `blur(10px)` + white border) consistent with the app.

  Files: `public/formularz.html`
  Verify: the new button is visible below the quick-add form; clicking it reveals `#addTab` and hides `#editTab`.

---

- [ ] 3. **Update `switchTab('add')` to give `#addTab` a back-navigation path.**

  When the user arrives at `#addTab` from the new button (instead of from a cold page load), they need a way back. Add a "← Wróć do moich prezentów" link at the top of `#addTab`'s card body — only visible after `switchTab('add')` is called programmatically (i.e., not on first cold load from the tab bar).

  Strategy: add a hidden `<div id="backToEditLink">` at the very top of `#addTab`'s `.card-body` (before the alert):

  ```html
  <div id="backToEditLink" class="mb-3" style="display: none;">
      <a href="#" onclick="switchTab('edit'); return false;"
         class="text-decoration-none fw-semibold"
         style="color: #43A047; font-size: 14px;">
          <i class="fas fa-arrow-left me-1"></i>Wróć do moich prezentów
      </a>
  </div>
  ```

  In `formularz.js`, update `switchTab`:
  - When switching to `'add'` via the button (not cold load), show `#backToEditLink`.
  - When switching to `'edit'`, hide `#backToEditLink` (so it doesn't linger if the user goes back).

  Concretely, add a `fromButton` parameter — the default cold path never passes it:

  ```js
  function switchTab(tab, fromButton) {
      const addTab = document.getElementById('addTab');
      const editTab = document.getElementById('editTab');
      const backLink = document.getElementById('backToEditLink');

      if (tab === 'add') {
          addTab.style.display = 'block';
          editTab.style.display = 'none';
          if (backLink) backLink.style.display = fromButton ? 'block' : 'none';
      } else if (tab === 'edit') {
          if (!currentUser) {
              authModal.show();
          } else {
              addTab.style.display = 'none';
              editTab.style.display = 'block';
              if (backLink) backLink.style.display = 'none';
              loadMyPresents();
          }
      }
  }
  ```

  Update the new button in step 2 to pass the flag: `onclick="switchTab('add', true)"`.

  The existing `onclick="switchTab('add')"` call inside the empty-state button in `loadMyPresents()` does NOT need the flag (it's already within the edit view context; the back link is fine either way, but it's safer to pass `true` there too for consistency — update that one call as well in `formularz.js`).

  Files: `public/formularz.html`, `public/formularz.js`
  Verify: tapping "Dodaj dla kogoś innego" shows the add form with the back link; tapping the back link returns to the edit view; a cold page load does not show the back link.

---

- [ ] 4. **Auto-trigger the edit view on `DOMContentLoaded` when user is authenticated.**

  Currently the page cold-loads showing `#addTab`. After step 1 it cold-loads showing `#editTab` — but `#editTab` contains `#myPresentsList` which needs `currentUser` to be set before `loadMyPresents()` is safe to call. The `checkAuth()` call is already in `DOMContentLoaded`; once it resolves and sets `currentUser`, we need to call `loadMyPresents()`.

  The `switchTab('edit')` flow already calls `loadMyPresents()` only when `currentUser` is truthy, so calling `switchTab('edit')` from within `checkAuth()` on success is safe.

  Update `checkAuth()` in `formularz.js`:

  ```js
  function checkAuth() {
      fetch('/api/auth')
          .then(response => response.json())
          .then(data => {
              if (data.authenticated) {
                  currentUser = data.user;
                  console.log('User authenticated:', currentUser);
                  const editLink = document.getElementById('editMyPresentsLink');
                  if (editLink) editLink.style.display = 'block';
                  // Edit tab is now the default view - load presents immediately
                  loadMyPresents();
              } else {
                  currentUser = null;
                  console.log('User not authenticated');
                  // Not logged in: show the add form as fallback
                  // (editTab visible but unauthenticated - show auth prompt or
                  //  swap to add tab so the page isn't blank)
                  document.getElementById('addTab').style.display = 'block';
                  document.getElementById('editTab').style.display = 'none';
              }
          })
          .catch(error => {
              console.error('Auth check error:', error);
              currentUser = null;
              document.getElementById('addTab').style.display = 'block';
              document.getElementById('editTab').style.display = 'none';
          });
  }
  ```

  **Rationale for unauthenticated fallback:** Since `#editTab` is now the default, an unauthenticated visitor would land on a view that just shows a spinner then a login prompt. It's a better UX to swap them to `#addTab` silently (they can still add presents for others without logging in). If they want their own list they can tap "Dodaj dla kogoś innego" and then navigate back — or we could show `#authModal` instead. The plan uses the silent swap because it avoids an unexpected modal appearing immediately on page load.

  Files: `public/formularz.js`
  Verify: logged-in user — page loads directly into the edit view with presents loaded. Logged-out user — page loads into the add form (no modal flash).

---

- [ ] 5. **Remove the `openEditTab` localStorage dance from `DOMContentLoaded` (or keep it but ensure no conflict).**

  The existing `localStorage.getItem('openEditTab')` block in `DOMContentLoaded` hides `#addTab` immediately, then polls for `currentUser` before calling `switchTab('edit')`. After steps 1 and 4, `#editTab` is already the default and `checkAuth` triggers `loadMyPresents()` automatically — the localStorage block is now redundant and its interval-and-timeout approach could race with the new flow.

  Remove the entire `openEditTab` block from `DOMContentLoaded`:

  ```js
  // DELETE this entire block:
  if (localStorage.getItem('openEditTab') === 'true') {
      localStorage.removeItem('openEditTab');
      ...
      const checkAndSwitch = setInterval(...);
      setTimeout(() => clearInterval(checkAndSwitch), 5000);
  }
  ```

  Also update the hamburger menu item in `formularz.html` that sets the flag:

  ```html
  <!-- BEFORE -->
  <a href="formularz.html" class="tab-bar-menu-item edit-presents-item"
      onclick="localStorage.setItem('openEditTab', 'true');">

  <!-- AFTER (flag no longer needed; formularz.html always opens the edit view) -->
  <a href="formularz.html" class="tab-bar-menu-item edit-presents-item">
  ```

  Files: `public/formularz.js`, `public/formularz.html`
  Verify: navigating to `formularz.html` from the hamburger menu "Edytuj Moje Prezenty" item still lands on the edit view (because it's now always the default for authenticated users).

---

## Summary of exact changes

| File | Change |
|---|---|
| `formularz.html` | `#addTab` — remove `active` class, add `style="display:none"` |
| `formularz.html` | `#editTab` — add `active` class, remove `style="display:none"` |
| `formularz.html` | `#editTab` card header text → `Dodaj i edytuj moje prezenty` |
| `formularz.html` | Add `#backToEditLink` div at top of `#addTab` `.card-body` |
| `formularz.html` | Add `Dodaj dla kogoś innego` button inside `#editTab` before `#myPresentsList` |
| `formularz.html` | Remove `onclick="localStorage.setItem('openEditTab','true')"` from hamburger menu item |
| `formularz.js` | `switchTab()` — add `fromButton` param, show/hide `#backToEditLink` |
| `formularz.js` | `checkAuth()` — call `loadMyPresents()` on success; swap to `#addTab` on failure |
| `formularz.js` | Remove the `openEditTab` localStorage polling block from `DOMContentLoaded` |
| `formularz.js` | Update `switchTab('add')` call inside `renderMyPresentsEmptyState`/`loadMyPresents` to pass `true` |

## CSS note

No new CSS classes are needed. The new button uses `.btn-transparent-blur` which is already defined in `formularz.html`'s inline `<style>` block. The back link uses the same inline style pattern already used for `#editMyPresentsLink`. No changes to `app-theme.css` or `bottom-tab-bar.css` are required.
