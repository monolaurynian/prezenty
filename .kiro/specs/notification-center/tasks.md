# Implementation Plan

- [x] 1. Create database schema and helper functions




  - Create `notifications` table with proper indexes
  - Create `createNotification()` helper function with privacy filtering
  - Add function to check if user is identified as recipient
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_



- [x] 2. Implement backend API endpoints


  - Create GET `/api/notifications` endpoint with limit/offset params
  - Create GET `/api/notifications/unread-count` endpoint
  - Create POST `/api/notifications/:id/read` endpoint
  - Create POST `/api/notifications/read-all` endpoint
  - Add privacy filtering to all endpoints
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_


- [x] 3. Add notification creation to existing endpoints



  - Add notification creation to POST `/api/recipients` (recipient_added)
  - Add notification creation to POST `/api/presents` (present_added)
  - Add notification creation to POST `/api/presents/:id/reserve` (present_reserved)
  - Add notification creation to DELETE `/api/presents/:id/reserve` (present_unreserved)
  - Add notification creation to PUT `/api/presents/:id/check` (present_checked/unchecked)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 4. Create notification bell UI component




  - Replace test button with bell icon in navigation
  - Add badge element with count display
  - Implement badge hiding when count is 0
  - Implement "99+" display for counts > 99
  - Add click handler to toggle dropdown
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_


- [x] 5. Implement notification dropdown

  - Create dropdown HTML structure
  - Implement `loadRecentNotifications()` function
  - Display 5 most recent notifications with icons and colors
  - Show unread indicator (background color/bold text)
  - Implement click handler to mark as read
  - Add "Brak powiadomień" empty state
  - Add "Zobacz więcej" link at bottom
  - Implement close on outside click
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_


- [x] 6. Create activity feed page




  - Create `activity.html` page with navigation
  - Display all notifications in chronological order
  - Implement pagination (20 per page)
  - Add "Mark all as read" button
  - Implement notification click to mark as read
  - Add notification type icons and colors
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_


- [x] 7. Implement real-time badge updates

  - Add polling function to check unread count every 30 seconds
  - Update badge count when new notifications arrive
  - Update badge when notifications are marked as read
  - Cache count in localStorage for offline resilience
  - _Requirements: 6.1, 6.2_


- [x] 8. Add CSS styling for notification components


  - Style bell icon and badge
  - Style dropdown with proper positioning and shadows
  - Style notification items with hover effects
  - Style unread indicator
  - Add responsive styles for mobile
  - Style activity feed page
  - _Requirements: 1.1, 1.2, 2.2, 2.3, 5.7_
