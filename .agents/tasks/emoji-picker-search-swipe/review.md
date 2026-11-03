# Review: Emoji Picker Search + Swipe

## Criterion-by-criterion findings

### 1. Search input placement and aria-label
`searchInput` is created via `createElement('input')`, given `type='search'`, `className='emoji-picker-search'`, and `aria-label='Szukaj emoji'`. It is appended to `container` (which is `#emojiPickerRoot`) **before** `tablist` and `grid` (`emoji-picker.js` lines 70-84). ✓

### 2. Non-empty searchQuery: tabs hidden, flat list shown
`setSearchMode(on)` sets `tablist.hidden = on` then calls `paintGrid()`. `paintGrid()` branches on `searchQuery.length > 0`: when true it uses `allEmoji` (all emoji concatenated from every category). ✓

### 3. Empty searchQuery: tabs visible, category view
`paintGrid()` falls through to `lists[active]` when `searchQuery` is empty; `setSearchMode(false)` sets `tablist.hidden = false`. ✓

### 4. show() focuses search; reset() clears state
`show()` calls `searchInput.focus()` at line 283. `reset()` sets `searchQuery = ''`, clears `searchInput.value`, sets `tablist.hidden = false`, then calls `selectCategory(0, false)` and resets `scrollLeft`. ✓

### 5. Touch swipe direction and search guard
`touchend` returns immediately when `searchQuery.length > 0`. Threshold is `Math.abs(dx) >= 40` AND `Math.abs(dx) > Math.abs(dy)`. Swipe-left (`dx < 0`) → `Math.min(active + 1, categories.length - 1)` (next); swipe-right → `Math.max(active - 1, 0)` (prev). Early return when `next === active`. ✓

### 6. Animation direction and reduced-motion
`fromX = dx < 0 ? 20 : -20`: content slides in from the right (positive offset) on leftward swipe (next category) and from the left on rightward swipe (prev), matching a natural carousel feel. Transition is `150ms ease`. `prefersReducedMotion` is checked once at `create()` time via `window.matchMedia`; animation block is skipped entirely when true. ✓  
The CSS `@media (prefers-reduced-motion: reduce)` block does not explicitly disable the inline transition, but the JS already skips setting it entirely, so no duplication is needed. ✓

### 7. CSS – .emoji-picker-search styles
`border-radius: 12px` ✓, `padding: 10px 14px` ✓, `width: 100%` with `box-sizing: border-box` ✓. Focus ring uses `border-color: #7B1FA2` with a matching soft shadow ✓. `#emojiPickerRoot` gains `padding: 8px 12px 0` ✓.

### 8. sw.js cache bump
`CACHE_NAME` changed from `prezenty-v135` to `prezenty-v136`. ✓

### 9. No innerHTML; keyboard nav unmodified
`create()` uses `createElement` / `textContent` / `setAttribute` throughout – no `innerHTML`. The `tablist.addEventListener('keydown')` and `grid.addEventListener('keydown')` blocks are byte-for-byte identical to the pre-change version. `refreshSelected()` is unchanged. ✓

### 10. tablist.hidden toggled and restored on reset
`setSearchMode(true)` → `tablist.hidden = true`. `setSearchMode(false)` → `tablist.hidden = false`. `reset()` explicitly sets `tablist.hidden = false` before calling `selectCategory`. ✓

## Minor observations (non-blocking)
- `prefersReducedMotion` is captured once at `create()` time, not per-event. This means a user who changes system motion preference without reloading will not have it reflected until the picker is recreated. This is an accepted trade-off for simplicity and is not a regression.
- If a rapid second swipe begins before the 150 ms transition ends, a second `transitionend` listener is added without removing the first. The first's `cleanup` will fire on the second transition's end and will self-remove; no leak or correctness failure occurs because each `cleanup` unconditionally removes itself.
- `searchInput` has no `id` attribute, so it cannot be associated with a `<label>`. The `aria-label` attribute covers screen-reader association. Not a blocker.

## Verdict
All ten review criteria are satisfied. No blockers found.
