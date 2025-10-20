# Implementation Plan

- [x] 1. Create helper functions for optimistic updates


  - Create `updateButtonOptimistically(button, action)` function to immediately change button appearance
  - Create `updatePresentItemOptimistically(presentItem, action)` function to update CSS classes
  - Create `updateCacheOptimistically(presentId, action, userId)` function to update window._dataCache
  - Create `rollbackOptimisticUpdate(presentId, previousState)` function to revert all changes
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Modify handleReserveClick function for optimistic updates


  - Store previous state (button HTML, item classes, cache values) before making changes
  - Call `updateButtonOptimistically()` immediately after storing state
  - Call `updatePresentItemOptimistically()` immediately
  - Call `updateCacheOptimistically()` immediately
  - Pass previousState to reservation functions for rollback capability
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_

- [x] 3. Refactor reservePresentFromRecipients function


  - Accept previousState parameter
  - Remove the cache update code (already done optimistically)
  - Remove the `softReloadRecipients()` call on success
  - On success: just re-enable button and show success toast
  - On error: call `rollbackOptimisticUpdate()` with previousState
  - Add error-specific messages for different failure types
  - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.2_

- [x] 4. Refactor cancelReservationFromRecipients function


  - Accept previousState parameter
  - Remove the cache update code (already done optimistically)
  - Remove the `softReloadRecipients()` call on success
  - On success: just re-enable button and show success toast
  - On error: call `rollbackOptimisticUpdate()` with previousState
  - Add error-specific messages for different failure types
  - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.2_

- [x] 5. Add CSS for optimistic update states


  - Add `.reserve-btn.updating` styles for subtle loading indicator
  - Add pulse animation for updating state
  - Add `.reserve-btn.error` styles for error feedback
  - Add shake animation for error state
  - Ensure animations are smooth and not distracting
  - _Requirements: 3.3, 3.4_

- [x] 6. Improve error handling and user feedback



  - Add specific error messages for 409 conflicts (already reserved)
  - Add specific error messages for network failures
  - Add timeout handling (10 seconds) with rollback
  - Ensure error toasts are clear and actionable
  - _Requirements: 2.3, 3.1, 3.4_
