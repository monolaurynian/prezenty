# Cache Busting & Auto-Update Guide

This document explains the cache-busting and auto-update mechanisms implemented to ensure users always see the latest version of the app.

## What Was Implemented

### 1. Server-Side Cache Control Headers
**File:** `server.js`

The Express static file server now sends proper cache control headers:
- **HTML files**: `no-cache, no-store, must-revalidate` - Never cached
- **CSS/JS files**: `no-cache, must-revalidate` - Must revalidate with server
- **Images/Assets**: `public, max-age=3600` - Cached for 1 hour

This ensures browsers always check for the latest version of critical files.

### 2. Service Worker Updates
**File:** `public/sw.js`

- Updated cache version from `v6` to `v7`
- Implemented **network-first strategy** for HTML files
- HTML files are always fetched from the network first, with cache as fallback
- Other resources use cache-first strategy for better performance
- Old caches are automatically deleted when service worker activates

### 3. HTML Meta Tags
**Files:** All HTML files (`index.html`, `recipients.html`, `activity.html`, `register.html`)

Added cache-busting meta tags to all HTML files:
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
```

### 4. Version API Endpoint
**File:** `server.js`

New endpoint: `GET /api/version`

Returns:
```json
{
  "version": "1.0.0",
  "timestamp": 1234567890,
  "cacheVersion": "v7"
}
```

This allows the client to check if a new version is available.

### 5. Auto-Update Checker
**File:** `public/update-checker.js`

A client-side script that:
- Checks for updates every 5 minutes
- Checks when the page becomes visible
- Checks when the device comes back online
- Compares server version with locally stored version
- Shows a friendly notification banner when an update is available
- Allows users to update immediately or dismiss the notification
- Clears service worker cache before reloading

The update checker is automatically loaded on all pages.

## How It Works

### Update Detection Flow

1. **Initial Load**: App version is stored in localStorage
2. **Periodic Checks**: Every 5 minutes, the app checks `/api/version`
3. **Version Comparison**: If server version differs from stored version
4. **User Notification**: A green banner appears at the top of the page
5. **User Action**: User can click "Odśwież teraz" (Refresh now) or "Później" (Later)
6. **Cache Clearing**: When refreshing, all service worker caches are cleared
7. **Page Reload**: Page reloads with fresh content from server

### Visual Notification

When an update is available, users see:
```
🔄 Nowa wersja dostępna! Odśwież stronę, aby zobaczyć najnowsze zmiany.
[Odśwież teraz] [Później]
```

## How to Deploy Updates

### Method 1: Update Package Version (Recommended)
1. Edit `package.json` and increment the version number:
   ```json
   {
     "version": "1.0.1"
   }
   ```
2. Deploy the changes
3. Users will automatically be notified within 5 minutes

### Method 2: Update Service Worker Cache Version
1. Edit `public/sw.js` and increment the cache version:
   ```javascript
   const CACHE_NAME = 'prezenty-v8';
   ```
2. Update the version in `server.js` API endpoint:
   ```javascript
   cacheVersion: 'v8'
   ```
3. Deploy the changes

### Method 3: Force Immediate Update
Users can manually trigger an update check by:
- Opening browser console
- Running: `window.updateChecker.check()`

## Testing

### Test Update Notification
1. Open the app in a browser
2. Note the current version in localStorage: `localStorage.getItem('app_version')`
3. Change the version in `package.json`
4. Restart the server
5. Wait up to 5 minutes or run `window.updateChecker.check()` in console
6. The update banner should appear

### Test Cache Clearing
1. Open DevTools → Network tab
2. Check "Disable cache" is OFF
3. Reload the page multiple times
4. HTML files should show "200" (from server), not "304" (from cache)
5. CSS/JS files may show "304" but will revalidate

## Browser Compatibility

- ✅ Chrome/Edge: Full support
- ✅ Firefox: Full support
- ✅ Safari: Full support (iOS 11.3+)
- ✅ Mobile browsers: Full support

## Troubleshooting

### Users Still See Old Version
1. Check if service worker is registered: DevTools → Application → Service Workers
2. Manually unregister service worker: `navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()))`
3. Clear browser cache: Ctrl+Shift+Delete
4. Hard reload: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)

### Update Notification Not Appearing
1. Check browser console for errors
2. Verify `/api/version` endpoint is accessible
3. Check localStorage: `localStorage.getItem('app_version')`
4. Manually trigger check: `window.updateChecker.check()`

### Service Worker Not Updating
1. Close all tabs with the app
2. Wait 24 hours (browser will force update)
3. Or manually update: DevTools → Application → Service Workers → "Update"

## Best Practices

1. **Always increment version** when deploying changes
2. **Test in incognito mode** to verify cache behavior
3. **Monitor update adoption** by checking server logs
4. **Communicate major updates** to users via the notification system
5. **Keep service worker cache version in sync** with app version

## Configuration

### Change Update Check Interval
Edit `public/update-checker.js`:
```javascript
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
```

### Disable Auto-Update Checker
Remove the script tag from HTML files:
```html
<!-- Remove this line -->
<script src="update-checker.js"></script>
```

### Customize Notification Banner
Edit the `showUpdateNotification()` function in `public/update-checker.js`.

## Summary

With these changes, users will:
- ✅ Always see the latest HTML content
- ✅ Get notified when updates are available
- ✅ Be able to update with one click
- ✅ Experience minimal disruption
- ✅ Have a smooth, modern update experience

The system is automatic, user-friendly, and requires minimal maintenance.
