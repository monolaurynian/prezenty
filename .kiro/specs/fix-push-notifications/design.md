# Design Document

## Overview

The push notification system has all the necessary components in place but is experiencing delivery issues. This design addresses the root causes and provides solutions to ensure reliable notification delivery.

## Root Cause Analysis

Based on code review, the potential issues are:

1. **Async Function Not Awaited**: The `sendNotificationToUsers()` function is called but not awaited in the present creation endpoint, which may cause the function to execute after the response is sent
2. **Insufficient Logging**: Limited visibility into whether subscriptions exist and if notifications are actually being sent
3. **Error Handling**: Silent failures may be occurring without proper error reporting
4. **VAPID Configuration**: Hardcoded VAPID keys instead of environment variables for production

## Architecture

The notification flow follows this pattern:

```
User adds present → POST /api/presents → sendNotificationToUsers() → 
Query subscriptions → Send to each subscription → Handle errors
```

### Current Issues in Flow

1. **Non-blocking call**: `sendNotificationToUsers()` is fire-and-forget
2. **No subscription validation**: No check if subscriptions exist before attempting to send
3. **Limited error feedback**: Errors are logged but not surfaced to the caller

## Components and Interfaces

### Modified Components

#### 1. Present Creation Endpoint (`POST /api/presents`)

**Changes:**
- Add `await` to `sendNotificationToUsers()` call or wrap in try-catch
- Add logging before and after notification sending
- Handle notification errors gracefully without failing the present creation

#### 2. sendNotificationToUsers Function

**Changes:**
- Add logging for subscription count
- Add early return if no subscriptions found
- Improve error logging with more context
- Add success count tracking

#### 3. VAPID Configuration

**Changes:**
- Load VAPID keys from environment variables
- Fallback to development keys if not set
- Log configuration source

#### 4. Subscription Endpoint (`POST /api/notifications/subscribe`)

**Changes:**
- Add more detailed logging
- Verify subscription was saved successfully
- Return subscription count to client

## Data Models

No changes to existing data models. The `push_subscriptions` table structure is adequate:

```sql
CREATE TABLE push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_endpoint (user_id, endpoint(255))
)
```

## Error Handling

### Notification Send Errors

1. **410 Gone**: Subscription expired - remove from database (already implemented)
2. **Network errors**: Log and continue to next subscription
3. **Invalid payload**: Log error with payload details
4. **No subscriptions**: Log info message, don't treat as error

### Subscription Errors

1. **Database errors**: Return 500 with error message
2. **Missing web-push**: Return 503 with clear message
3. **Invalid subscription format**: Return 400 with validation error

## Testing Strategy

### Manual Testing Steps

1. **Verify web-push module**:
   - Check server logs for "Web-push module loaded successfully"
   - If not loaded, run `npm install web-push`

2. **Test subscription flow**:
   - Open app in browser
   - Click notification permission button
   - Verify subscription saved in database
   - Check browser console for subscription object

3. **Test notification delivery**:
   - Open app in two different browsers/devices
   - Subscribe to notifications in both
   - Add a present from one browser
   - Verify notification received in other browser

4. **Test error scenarios**:
   - Add present with no subscriptions - verify graceful handling
   - Test with invalid subscription - verify removal from database

### Debugging Checklist

- [ ] Web-push module installed and loaded
- [ ] VAPID keys configured
- [ ] User has granted notification permission
- [ ] Subscription saved in database
- [ ] Service worker registered and active
- [ ] Subscriptions queried when sending notification
- [ ] Notification payload properly formatted
- [ ] No errors in server logs
- [ ] No errors in browser console

## Implementation Notes

### Key Changes

1. **Add comprehensive logging** throughout the notification flow
2. **Make notification sending non-blocking** but with proper error handling
3. **Add subscription count check** before attempting to send
4. **Improve error messages** for better debugging

### Backward Compatibility

All changes are backward compatible. Existing subscriptions will continue to work, and the API contracts remain unchanged.

### Performance Considerations

- Notification sending is already async and won't block present creation
- Database query for subscriptions is simple and indexed
- Promise.all ensures parallel notification sending

### Security Considerations

- VAPID keys should be stored in environment variables in production
- Subscription endpoints are user-specific and properly authenticated
- No sensitive data exposed in notification payloads
