# Design Document

## Overview

The notification center replaces the simple test notification button with a comprehensive activity feed system. It consists of three main components: a bell icon with badge in the navigation bar, a dropdown showing recent notifications, and a dedicated activity feed page. The system tracks user actions (adding recipients, adding/reserving/checking presents) and displays them as notifications, while respecting privacy for identified recipients.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                    Navigation Bar                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Bell Icon + Badge Count                         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
                        ├─── Click ───┐
                        │              │
                        ▼              ▼
        ┌───────────────────────┐   ┌──────────────────────┐
        │  Notification Dropdown│   │  Activity Feed Page  │
        │  (5 most recent)      │   │  (All notifications) │
        └───────────────────────┘   └──────────────────────┘
                        │                      │
                        └──────────┬───────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │  Notifications Database  │
                    │  - id, user_id, type     │
                    │  - actor_id, data        │
                    │  - is_read, created_at   │
                    └──────────────────────────┘
```

### Data Flow

1. **Action occurs** (e.g., user adds present)
2. **Server creates notification** for relevant users
3. **Notification stored** in database
4. **Badge count updated** via API call
5. **User clicks bell** → dropdown fetches recent notifications
6. **User clicks notification** → marked as read, badge decrements

## Components and Interfaces

### 1. Database Schema

**New Table: `notifications`**

```sql
CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('recipient_added', 'present_added', 'present_reserved', 
              'present_unreserved', 'present_checked', 'present_unchecked') NOT NULL,
    actor_id INT NOT NULL,
    data JSON,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_read (user_id, is_read),
    INDEX idx_created (created_at DESC),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Data JSON Structure:**
```json
{
  "recipientId": 123,
  "recipientName": "Jan",
  "presentId": 456,
  "presentTitle": "Książka"
}
```

### 2. Backend API Endpoints

#### GET `/api/notifications`
- Returns recent notifications for current user
- Query params: `limit` (default 5), `offset` (default 0)
- Filters out notifications for identified recipient's presents
- Response:
```json
{
  "notifications": [...],
  "unreadCount": 3,
  "hasMore": true
}
```

#### GET `/api/notifications/unread-count`
- Returns count of unread notifications
- Fast endpoint for badge updates
- Response: `{ "count": 3 }`

#### POST `/api/notifications/:id/read`
- Marks notification as read
- Returns updated unread count
- Response: `{ "success": true, "unreadCount": 2 }`

#### POST `/api/notifications/read-all`
- Marks all notifications as read
- Response: `{ "success": true }`

### 3. Frontend Components

#### NotificationBell Component (in navigation)

**HTML Structure:**
```html
<div class="notification-bell-container">
  <button class="notification-bell-btn" onclick="toggleNotificationDropdown()">
    <i class="fas fa-bell"></i>
    <span class="notification-badge" id="notificationBadge">3</span>
  </button>
  <div class="notification-dropdown" id="notificationDropdown">
    <!-- Notification items -->
  </div>
</div>
```

**Key Functions:**
- `loadUnreadCount()` - Fetches and updates badge
- `toggleNotificationDropdown()` - Opens/closes dropdown
- `loadRecentNotifications()` - Fetches 5 most recent
- `markAsRead(notificationId)` - Marks notification read

#### Activity Feed Page (`activity.html`)

**Features:**
- Full-page notification list
- Pagination (20 per page)
- Filter by type (optional)
- Mark all as read button

### 4. Notification Creation Helper

**Server-side function:**
```javascript
async function createNotification(type, actorId, data, excludeUserId = null) {
  // Get all users except actor and excluded user
  const [users] = await pool.execute(
    'SELECT id FROM users WHERE id != ? AND id != ?',
    [actorId, excludeUserId || -1]
  );
  
  // Filter out identified recipients if notification is about their presents
  for (const user of users) {
    // Check if user is identified as the recipient in the notification
    if (type.includes('present_') && data.recipientId) {
      const [identification] = await pool.execute(
        'SELECT id FROM recipients WHERE id = ? AND identified_by = ?',
        [data.recipientId, user.id]
      );
      
      // Skip this user if they're identified as the recipient
      if (identification.length > 0) continue;
    }
    
    // Create notification for this user
    await pool.execute(
      'INSERT INTO notifications (user_id, type, actor_id, data) VALUES (?, ?, ?, ?)',
      [user.id, type, actorId, JSON.stringify(data)]
    );
  }
}
```

## Data Models

### Notification Object

```typescript
interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  actorId: number;
  actorUsername: string;
  data: {
    recipientId?: number;
    recipientName?: string;
    presentId?: number;
    presentTitle?: string;
  };
  isRead: boolean;
  createdAt: string;
}

type NotificationType = 
  | 'recipient_added'
  | 'present_added'
  | 'present_reserved'
  | 'present_unreserved'
  | 'present_checked'
  | 'present_unchecked';
```

### Notification Display Configuration

```javascript
const notificationConfig = {
  recipient_added: {
    icon: 'fa-user-plus',
    color: '#4CAF50',
    getMessage: (data) => `dodał(a) osobę ${data.recipientName}`
  },
  present_added: {
    icon: 'fa-gift',
    color: '#2196F3',
    getMessage: (data) => `dodał(a) prezent "${data.presentTitle}" dla ${data.recipientName}`
  },
  present_reserved: {
    icon: 'fa-bookmark',
    color: '#FF9800',
    getMessage: (data) => `zarezerwował(a) prezent "${data.presentTitle}"`
  },
  present_unreserved: {
    icon: 'fa-bookmark-slash',
    color: '#9E9E9E',
    getMessage: (data) => `anulował(a) rezerwację "${data.presentTitle}"`
  },
  present_checked: {
    icon: 'fa-check-circle',
    color: '#4CAF50',
    getMessage: (data) => `oznaczył(a) jako kupione "${data.presentTitle}"`
  },
  present_unchecked: {
    icon: 'fa-circle',
    color: '#9E9E9E',
    getMessage: (data) => `odznaczył(a) "${data.presentTitle}"`
  }
};
```

## Error Handling

### Database Errors
- Graceful degradation if notifications table doesn't exist
- Log errors but don't fail main operations
- Show generic error message to user

### Privacy Violations
- Double-check recipient identification before showing notifications
- Never expose present details to identified recipients
- Log potential privacy issues for debugging

### Network Errors
- Retry badge count updates on failure
- Cache last known count in localStorage
- Show stale data with indicator if API fails

## Testing Strategy

### Manual Testing

1. **Bell Icon & Badge**
   - Verify badge shows correct count
   - Verify badge hides when count is 0
   - Verify "99+" for counts > 99

2. **Dropdown**
   - Add recipient → verify notification appears
   - Add present → verify notification appears
   - Click notification → verify marked as read
   - Verify dropdown closes on outside click

3. **Privacy**
   - Identify as recipient
   - Have another user add present for you
   - Verify you don't see the notification

4. **Activity Feed**
   - Verify all notifications shown
   - Verify pagination works
   - Verify "mark all as read" works

### Edge Cases

- User with no notifications
- User with 100+ notifications
- Rapid notification creation
- Concurrent read/unread operations
- Deleted users/recipients/presents

## Implementation Notes

### Performance Considerations

1. **Badge Count Query** - Use indexed query for fast lookups
2. **Notification List** - Limit to 5 in dropdown, paginate in feed
3. **Real-time Updates** - Poll every 30 seconds for badge count
4. **Database Cleanup** - Consider archiving old notifications (>30 days)

### Privacy Implementation

The key privacy check happens during notification creation - we check if a user is identified as the recipient before creating the notification for them.

### Migration Strategy

1. Create `notifications` table
2. Replace test button with bell icon in navigation
3. Add notification creation to existing endpoints
4. Create activity feed page
5. Add polling for badge count updates

### Backward Compatibility

- Keep existing push notification system
- Notifications table is additive (doesn't break existing features)
- Test button removal is UI-only change
