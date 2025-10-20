# Push Notifications Debugging Guide

## Quick Diagnosis Steps

### Step 1: Check Server Console

When you start the server, you should see:
```
🔑 [VAPID] Using fallback development VAPID keys
✅ [VAPID] Web-push module loaded and configured successfully
```

### Step 2: Check Browser Console When Enabling Notifications

Open browser DevTools (F12) → Console tab

When you click "Powiadomienia" button, you should see:
```
Notification permission: granted
Push subscription successful: [subscription object]
Subscription sent to server: {success: true, userSubscriptions: 1, totalSubscriptions: X}
```

### Step 3: Check Server Console After Subscription

You should see:
```
📝 Notification subscription request: { userId: X, hasSubscription: true }
💾 [SUBSCRIPTION] Saving subscription for user X
✅ [SUBSCRIPTION] Subscription saved successfully for user X. User has 1 subscription(s). Total system subscriptions: X
```

### Step 4: Test Notification Button

Click the "Test" button. Check server console:
```
🧪 Testing notification for user: X
🔔 [NOTIFICATION] Starting notification send: { excludeUserId: X, title: 'Test Notification', ... }
📊 [NOTIFICATION] Found Y subscription(s) to notify (excluding user X)
📤 [NOTIFICATION] Sending to user Z
✅ [NOTIFICATION] Successfully sent to user Z
✨ [NOTIFICATION] Notification send complete: 1 successful, 0 failed out of 1 total
```

### Step 5: Add a Present

When someone adds a present, check server console:
```
📢 [PRESENT] Triggering notification for new present: "..." (ID: X)
🔔 [NOTIFICATION] Starting notification send
📊 [NOTIFICATION] Found Y subscription(s) to notify
✅ [NOTIFICATION] Successfully sent to user Z
```

## Common Issues

### Issue 1: "No subscriptions found"

**Symptom:** Server logs show `📊 [NOTIFICATION] Found 0 subscription(s)`

**Causes:**
1. Subscription wasn't saved to database
2. You're testing with only one user (notifications exclude the sender)
3. Database table doesn't exist

**Fix:**
- Open two different browsers (or incognito + normal)
- Subscribe to notifications in both
- Add present from one browser
- Check if notification appears in the other browser

### Issue 2: "Web-push not available"

**Symptom:** Server logs show `⚠️ [NOTIFICATION] Web-push not available`

**Fix:**
```bash
npm install web-push
```
Then restart the server.

### Issue 3: Subscription fails to save

**Symptom:** Browser console shows error when sending subscription

**Check:**
1. Is user logged in? (subscription requires authentication)
2. Check server console for database errors
3. Check if `push_subscriptions` table was created

**Manual table creation:**
```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_endpoint (user_id, endpoint(255))
);
```

### Issue 4: Notifications work in test but not when adding presents

**Symptom:** Test button works, but adding presents doesn't trigger notifications

**Check:**
1. Server console for the present creation log: `📢 [PRESENT] Triggering notification`
2. If you see the log, check for errors after it
3. If you don't see the log, the present creation might be failing before notification

### Issue 5: "Notifications have been disabled" message

**This is actually the SUCCESS message!** 

The notification that says "Powiadomienia zostały włączone! 🎄" confirms your subscription worked. This is a local notification, not a push notification.

To test push notifications:
1. Open app in two different browsers
2. Subscribe in both
3. Add present from browser A
4. You should receive push notification in browser B

## Debug Endpoint

Visit: `http://localhost:3002/api/notifications/debug`

This will show:
```json
{
  "webPushAvailable": true,
  "vapidConfigured": true,
  "demoMode": false,
  "userId": 1,
  "userSubscriptions": 1,
  "totalSubscriptions": 2,
  "subscribedUserIds": [1, 2],
  "timestamp": "2025-01-20T..."
}
```

## Testing Checklist

- [ ] Server shows web-push module loaded
- [ ] Browser shows notification permission granted
- [ ] Browser shows subscription sent successfully
- [ ] Server shows subscription saved
- [ ] Debug endpoint shows subscriptions > 0
- [ ] Test button triggers notification send in server logs
- [ ] Two browsers/users are subscribed
- [ ] Adding present from one browser shows notification in other

## Still Not Working?

1. **Check browser compatibility:** Push notifications require HTTPS (or localhost)
2. **Check service worker:** Open DevTools → Application → Service Workers
3. **Clear and re-register:** 
   - Unregister service worker
   - Clear site data
   - Refresh page
   - Re-enable notifications
4. **Check firewall:** Some corporate firewalls block push notifications
5. **Try different browser:** Test in Chrome, Firefox, Edge
