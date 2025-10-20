# Quick Test Guide for Push Notifications

## What I Just Fixed

1. **Test button now sends to yourself** - You can test notifications without needing a second user
2. **Better console logging** - Both frontend and backend now show detailed logs
3. **Subscription confirmation** - You'll see exactly how many subscriptions are saved

## How to Test Right Now

### Step 1: Restart Your Server

Stop and restart your Node.js server to load the changes.

### Step 2: Open Browser DevTools

Press `F12` to open DevTools, go to the **Console** tab.

### Step 3: Enable Notifications

1. Click the "Powiadomienia" button
2. Allow notifications when prompted
3. Check the console - you should see:
   ```
   📤 Sending subscription to server: {...}
   ✅ Subscription saved successfully: {...}
   📊 You have 1 subscription(s). Total system: X
   ```

### Step 4: Click Test Button

1. Click the "Test" button (vial icon)
2. Check browser console for:
   ```
   Test notification sent! You should receive it in a few seconds.
   ```
3. Check server console for:
   ```
   🧪 [TEST] Testing notification for user: X includeCurrentUser: true
   🔔 [NOTIFICATION] Starting notification send
   📊 [NOTIFICATION] Found 1 subscription(s) to notify
   📤 [NOTIFICATION] Sending to user X
   ✅ [NOTIFICATION] Successfully sent to user X
   ✨ [NOTIFICATION] Notification send complete: 1 successful, 0 failed
   ```
4. **You should receive a push notification!**

### Step 5: Test with Real Present

1. Add a new present
2. Check server console for:
   ```
   📢 [PRESENT] Triggering notification for new present: "..." (ID: X)
   🔔 [NOTIFICATION] Starting notification send
   ```
3. **Note:** When adding a present, you WON'T receive a notification yourself (by design)
4. To test this properly, you need a second user/browser

## What to Look For

### ✅ Success Indicators

- Browser console shows subscription saved
- Server console shows subscription count > 0
- Test button triggers notification in server logs
- You receive the test notification

### ❌ Problem Indicators

**"Web-push not available"**
- Run: `npm install web-push`
- Restart server

**"Found 0 subscription(s)"**
- Subscription wasn't saved
- Check if you're logged in
- Try disabling and re-enabling notifications

**"Failed to send notification"**
- Check server console for specific error
- Might be VAPID key issue
- Might be network/firewall issue

## Server Console Logs to Watch

When you start the server:
```
🔑 [VAPID] Using fallback development VAPID keys
✅ [VAPID] Web-push module loaded and configured successfully
```

When you enable notifications:
```
📝 Notification subscription request: { userId: X, hasSubscription: true }
💾 [SUBSCRIPTION] Saving subscription for user X
✅ [SUBSCRIPTION] Subscription saved successfully
```

When you click test:
```
🧪 [TEST] Testing notification for user: X includeCurrentUser: true
🔔 [NOTIFICATION] Starting notification send
📊 [NOTIFICATION] Found 1 subscription(s) to notify
✅ [NOTIFICATION] Successfully sent to user X
```

## Still Not Working?

1. **Check browser compatibility**: Are you on HTTPS or localhost?
2. **Check service worker**: DevTools → Application → Service Workers (should be active)
3. **Check notification permission**: Should be "granted" not "denied"
4. **Try incognito mode**: Sometimes cached data causes issues
5. **Check server logs**: Look for any red error messages

## Debug Endpoint

Visit in browser: `http://localhost:3002/api/notifications/debug`

Should show:
```json
{
  "webPushAvailable": true,
  "vapidConfigured": true,
  "userSubscriptions": 1,
  "totalSubscriptions": 1
}
```

If `userSubscriptions` is 0, the subscription didn't save properly.
