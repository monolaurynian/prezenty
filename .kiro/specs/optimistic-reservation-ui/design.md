# Design Document

## Overview

The present reservation system currently updates the UI only after receiving a server response, causing a noticeable delay (typically 200-500ms). This design implements optimistic UI updates where the button state changes immediately upon click, with rollback capability if the server request fails.

## Current Implementation Analysis

### Existing Flow

1. User clicks reserve/unreserve button
2. Button shows spinner and disables
3. Fetch request sent to server
4. Wait for server response
5. Update cache and UI
6. Call `softReloadRecipients()` to re-render

**Problems:**
- Button remains in loading state until server responds
- User must wait for network round-trip before seeing feedback
- `softReloadRecipients()` causes full re-render, which is slow
- No immediate visual feedback

### Current Code Structure

```javascript
function handleReserveClick(event, presentId, action) {
    // Disable button and show spinner
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    // Make API call
    if (action === 'reserve') {
        reservePresentFromRecipients(presentId, button, originalHTML);
    } else {
        cancelReservationFromRecipients(presentId, button, originalHTML);
    }
}
```

## Architecture

### New Optimistic Flow

1. User clicks reserve/unreserve button
2. **Immediately** update button UI to target state
3. **Immediately** update present item classes
4. **Immediately** update cache
5. Send fetch request in background
6. On success: keep optimistic state
7. On failure: revert to previous state and show error

### State Management

```javascript
// Store previous state for rollback
const previousState = {
    reserved_by: present.reserved_by,
    reserved_by_username: present.reserved_by_username,
    buttonHTML: button.innerHTML,
    itemClasses: presentItem.className
};
```

## Components and Interfaces

### Modified Functions

#### 1. handleReserveClick()

**Current behavior:** Disables button, shows spinner, calls API function

**New behavior:**
- Store previous state for rollback
- Immediately update button to target state (with subtle loading indicator)
- Immediately update present item classes
- Immediately update cache
- Call API function with rollback callback

#### 2. reservePresentFromRecipients()

**Current behavior:** 
- Makes API call
- On success: updates cache, calls softReloadRecipients()
- On error: restores button

**New behavior:**
- Accept previousState parameter
- Make API call
- On success: confirm optimistic update (no re-render needed)
- On error: rollback to previousState, show error

#### 3. cancelReservationFromRecipients()

**Current behavior:** Same as reserve

**New behavior:** Same changes as reserve function

#### 4. New Helper: updateButtonOptimistically()

```javascript
function updateButtonOptimistically(button, action) {
    if (action === 'reserve') {
        button.className = 'btn btn-danger btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-xmark"></i> <span class="d-none d-md-inline">Anuluj</span>';
    } else {
        button.className = 'btn btn-outline-warning btn-sm w-100 w-md-auto reserve-btn updating';
        button.innerHTML = '<i class="fas fa-bookmark"></i> <span class="d-none d-md-inline">Zarezerwuj</span>';
    }
    button.disabled = true;
}
```

#### 5. New Helper: updatePresentItemOptimistically()

```javascript
function updatePresentItemOptimistically(presentItem, action) {
    if (action === 'reserve') {
        presentItem.classList.remove('reserved-by-other');
        presentItem.classList.add('reserved-by-me');
    } else {
        presentItem.classList.remove('reserved-by-me');
    }
}
```

#### 6. New Helper: rollbackOptimisticUpdate()

```javascript
function rollbackOptimisticUpdate(presentId, previousState) {
    // Restore cache
    const present = window._dataCache.presents.find(p => p.id === presentId);
    if (present) {
        present.reserved_by = previousState.reserved_by;
        present.reserved_by_username = previousState.reserved_by_username;
    }
    
    // Restore button
    const button = document.querySelector(`[data-id="${presentId}"] .reserve-btn`);
    if (button) {
        button.outerHTML = previousState.buttonHTML;
    }
    
    // Restore item classes
    const presentItem = document.querySelector(`[data-id="${presentId}"]`);
    if (presentItem) {
        presentItem.className = previousState.itemClasses;
    }
}
```

## Data Models

No database changes required. All changes are client-side UI updates.

### Client-Side State

```javascript
{
    presentId: number,
    previousState: {
        reserved_by: number | null,
        reserved_by_username: string | null,
        buttonHTML: string,
        itemClasses: string
    }
}
```

## Error Handling

### Network Errors

1. **Timeout**: Rollback after 10 seconds if no response
2. **Connection error**: Immediate rollback with error message
3. **Server error (500)**: Rollback with error message
4. **Conflict (409)**: Rollback with specific message (e.g., "Already reserved by someone else")

### Edge Cases

1. **Rapid clicking**: Button disabled during request prevents double-clicks
2. **Multiple tabs**: Server is source of truth; on conflict, rollback and show message
3. **Offline**: Fetch will fail, rollback will occur with offline message

## Visual Feedback

### Loading State

Instead of a spinner, use a subtle visual indicator:

```css
.reserve-btn.updating {
    opacity: 0.8;
    position: relative;
}

.reserve-btn.updating::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: inherit;
    animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
```

### Success Confirmation

Keep existing success animation but make it more subtle since the button already changed.

### Error State

On rollback, add a brief shake animation:

```css
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
}

.reserve-btn.error {
    animation: shake 0.3s ease-in-out;
}
```

## Testing Strategy

### Manual Testing

1. **Happy path - Reserve**:
   - Click reserve button
   - Verify button changes immediately to "Anuluj" (red)
   - Verify present item gets "reserved-by-me" class
   - Verify no full page re-render
   - Verify success toast appears

2. **Happy path - Unreserve**:
   - Click unreserve button on reserved present
   - Verify button changes immediately to "Zarezerwuj" (yellow outline)
   - Verify "reserved-by-me" class removed
   - Verify success toast appears

3. **Error handling**:
   - Simulate network error (disconnect network)
   - Click reserve button
   - Verify button changes immediately
   - Verify rollback occurs after error
   - Verify error toast appears

4. **Rapid clicking**:
   - Click reserve button multiple times quickly
   - Verify only one request sent
   - Verify button stays disabled during request

5. **Multiple tabs**:
   - Open app in two tabs
   - Reserve present in tab 1
   - Try to reserve same present in tab 2
   - Verify conflict handling and rollback

### Performance Testing

- Measure time from click to visual update (should be <50ms)
- Verify no full page re-renders occur
- Check memory usage doesn't increase with multiple reservations

## Implementation Notes

### Key Improvements

1. **Instant feedback**: Button updates in <50ms instead of 200-500ms
2. **No re-renders**: Avoid calling `softReloadRecipients()` on success
3. **Graceful degradation**: If rollback fails, user can refresh page
4. **Better UX**: Subtle loading indicator instead of spinner

### Backward Compatibility

All changes are client-side only. Server API remains unchanged. Existing functionality preserved with enhanced UX.

### Performance Impact

- **Positive**: Eliminates unnecessary re-renders, faster perceived performance
- **Neutral**: Same number of API calls
- **Minimal**: Slightly more client-side state management

### CSS Requirements

Add new CSS classes for optimistic update states:

```css
.reserve-btn.updating {
    opacity: 0.8;
    cursor: wait;
}

.reserve-btn.error {
    animation: shake 0.3s ease-in-out;
}
```
