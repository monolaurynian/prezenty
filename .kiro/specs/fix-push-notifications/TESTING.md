# Testing Guide for Push Notification Fixes

## What Was Fixed

All 6 tasks have been completed to fix the push notification system:

1. ✅ **Enhanced logging in sendNotificationToUsers** - Added comprehensive logging with emoji prefixes for easy filtering
2. ✅ **Improved VAPID configuration** - Now uses environment variables with fallback to development keys
3. ✅ **Fixed notification sending** - Added proper error handling and logging in present creation endpoint
4. ✅ **Enhanced subscription endpoint** - Added detailed logging and returns subscription counts
5. ✅ **Added notification delivery verification** - Service worker now logs all push events and notification displays
6. ✅ **Created debugging helper endpoint** - New `/api/notifications/debug` endpoint for troubleshooting

## How to Test

### Step 1: Check Server Logs on Startup

When you start the server, you should now see:
```
🔑 [VAPID] Using VAPID keys from environment variables
   OR
🔑 [VAPID] Using fallback development VAPID keys
✅ [VAPID] Web-push module loaded and configured successfully
```

### Step 2: Use the Debug Endpoint

Open your browser console and run:
```javascript
fetch('/api/notifications/debug')
  .then(r => r.json())
  .then(console.log);
```

This will show you:
- Whether web-push is available
- How many subscriptions exist (yours and total)
- Which users are subscribed
- VAPID configuration status

### Step 3: Subscribe to Notifications

1. Open the app in your browser
2. Click the notification permission button
3. Grant permission when prompted
4. Check browser console for: `✅ [SUBSCRIPTION] Subscription saved successfully`
5. Check server logs for subscription count

### Step 4: Test Notification Delivery

**Option A: Use Two Browsers**
1. Open app in Browser 1 and subscribe to notifications
2. Open app in Browser 2 (or incognito) with a different user and subscribe
3. From Browser 1, add a new present
4. Browser 2 should receive a notification

**Option B: Use the Test Endpoint**
```javascript
fetch('/api/test-notification', { method: 'POST' })
  .then(r => r.json())
  .then(console.log);
```

### Step 5: Monitor the Logs

When a present is added, you should see this flow in server logs:

```
📢 [PRESENT] Triggering notification for new present: "Gift Name" (ID: 123)
🔔 [NOTIFICATION] Starting notification send: {...}
📊 [NOTIFICATION] Found 2 subscription(s) to notify
📦 [NOTIFICATION] Notification payload: {...}
📤 [NOTIFICATION] Sending to user 1
✅ [NOTIFICATION] Successfully sent to user 1
📤 [NOTIFICATION] Sending to user 2
✅ [NOTIFICATION] Successfully sent to user 2
✨ [NOTIFICATION] Notification send complete: 2 successful, 0 failed out of 2 total
```

In the browser console (Service Worker), you should see:
```
🔔 [SW] Push notification received at: 2025-10-20T...
🔔 [SW] Push event data available: true
📦 [SW] Parsed push data: {...}
✅ [SW] Notification data prepared: {...}
📢 [SW] Displaying notification: Nowy prezent!
✅ [SW] Notification displayed successfully
```

## Common Issues and Solutions

### Issue: "No subscriptions found"
**Solution:** Make sure users have clicked the notification button and granted permission. Check the debug endpoint to verify subscriptions exist.

### Issue: "Web-push not available"
**Solution:** Run `npm install web-push` on the server.

### Issue: Notifications not appearing
**Possible causes:**
1. Browser notification permission denied - Check browser settings
2. Service worker not registered - Check browser console for errors
3. Invalid subscription - Check server logs for 410 errors (expired subscriptions)
4. Browser doesn't support push notifications - Try Chrome or Firefox

### Issue: Notifications work in development but not production
**Solution:** Set environment variables for production:
```bash
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_EMAIL=mailto:your@email.com
```

Generate new VAPID keys with:
```bash
npx web-push generate-vapid-keys
```

## Log Filtering

All notification-related logs now have prefixes for easy filtering:

- `[VAPID]` - VAPID configuration
- `[NOTIFICATION]` - Notification sending
- `[SUBSCRIPTION]` - Subscription management
- `[PRESENT]` - Present creation
- `[DEBUG]` - Debug endpoint
- `[SW]` - Service Worker (browser console)

Filter server logs:
```bash
# Linux/Mac
npm start | grep NOTIFICATION

# Windows PowerShell
npm start | Select-String "NOTIFICATION"
```

## Next Steps

1. Restart your server to see the new logs
2. Test the notification flow with the steps above
3. If issues persist, check the logs with the prefixes above
4. Use the debug endpoint to verify system state
5. Check browser console for service worker logs

The enhanced logging should make it immediately clear where any issues are occurring!
