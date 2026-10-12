# Profile Picture Fix Guide

## Quick Fix - Clear All Caches

If profile pictures aren't showing, run this in the browser console:

```javascript
// Clear all caches and reload
localStorage.clear();
sessionStorage.clear();
if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
}
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
}
setTimeout(() => location.reload(true), 1000);
```

## Diagnostic Steps

### 1. Check Browser Console
Open DevTools (F12) and look for:
- `[ProfilePictureDebug]` messages
- Image load errors
- Network errors for `/api/recipients/:id/profile-picture`

### 2. Check Network Tab
1. Open DevTools → Network tab
2. Filter by "profile-picture"
3. Refresh the page
4. Check if requests are:
   - Being made
   - Returning 200 OK
   - Returning image data

### 3. Check Database
Profile pictures are stored as BLOBs in the database:
```sql
SELECT id, name, 
       LENGTH(profile_picture) as picture_size,
       profile_picture_type 
FROM recipients 
WHERE profile_picture IS NOT NULL;
```

## Common Issues

### Issue 1: Service Worker Caching
**Symptom:** Old or missing profile pictures
**Fix:** Unregister service worker
```javascript
navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
location.reload();
```

### Issue 2: localStorage Cache
**Symptom:** Cached data has wrong profile picture URLs
**Fix:** Clear localStorage
```javascript
localStorage.removeItem('recipientsCache');
localStorage.removeItem('app_data_cache');
location.reload();
```

### Issue 3: Browser Cache
**Symptom:** Browser cached old responses
**Fix:** Hard reload
- Windows: Ctrl + Shift + R
- Mac: Cmd + Shift + R

### Issue 4: CORS or Auth
**Symptom:** 401 or 403 errors in console
**Fix:** Check session is valid
```javascript
fetch('/api/auth').then(r => r.json()).then(console.log);
```

## Server-Side Checks

### 1. Verify Endpoint Works
```bash
# Test profile picture endpoint
curl -i http://localhost:3002/api/recipients/1/profile-picture
```

Should return:
- Status: 200 OK
- Content-Type: image/jpeg (or image/png)
- Image data

### 2. Check Cache Headers
Profile pictures should have:
```
Cache-Control: public, max-age=3600
Content-Type: image/jpeg
```

### 3. Check Database
```sql
-- Check if profile pictures exist
SELECT COUNT(*) FROM recipients WHERE profile_picture IS NOT NULL;

-- Check picture sizes
SELECT id, name, LENGTH(profile_picture) as size 
FROM recipients 
WHERE profile_picture IS NOT NULL;
```

## Debug Script

A debug script has been added to `profile-picture-debug.js` that:
- Monitors all image load errors
- Logs profile picture requests
- Checks cache data
- Tests fetch requests

Check browser console for `[ProfilePictureDebug]` messages.

## Manual Test

### Test Profile Picture Loading
```javascript
// In browser console
const testRecipientId = 1; // Change to actual ID
fetch(`/api/recipients/${testRecipientId}/profile-picture`)
    .then(response => {
        console.log('Status:', response.status);
        console.log('Content-Type:', response.headers.get('content-type'));
        return response.blob();
    })
    .then(blob => {
        console.log('Blob size:', blob.size);
        console.log('Blob type:', blob.type);
        
        // Create temporary image to test
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => console.log('Image loaded!', img.width, 'x', img.height);
        img.onerror = () => console.error('Image failed to load');
        img.src = url;
    })
    .catch(error => console.error('Fetch error:', error));
```

## Changes Made

### 1. Added Cache Headers
```javascript
// In server.js
res.set('Cache-Control', 'public, max-age=3600');
```

### 2. Added Debug Script
- `profile-picture-debug.js` - Monitors image loading
- Logs errors and successful loads
- Tests fetch requests

### 3. Simplified Cache System
- Removed conflicting cache preloading
- Using proven localStorage cache
- No interference with profile pictures

## If Still Not Working

### Nuclear Option - Complete Reset
```javascript
// Clear EVERYTHING
localStorage.clear();
sessionStorage.clear();
indexedDB.databases().then(dbs => dbs.forEach(db => indexedDB.deleteDatabase(db.name)));
if ('caches' in window) {
    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
}
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
}
// Close all tabs and reopen
```

### Check Browser Extensions
- Disable ad blockers
- Disable privacy extensions
- Try incognito mode

### Check Server Logs
Look for errors when serving profile pictures:
```
Error serving profile picture: ...
```

## Expected Behavior

When working correctly:
1. Recipient data loads with `profile_picture: "/api/recipients/123/profile-picture"`
2. Browser requests `/api/recipients/123/profile-picture`
3. Server returns image with proper headers
4. Image displays in UI
5. Browser caches image for 1 hour

## Summary

Profile pictures should work with:
✅ Proper cache headers (1 hour)
✅ No service worker interference
✅ No localStorage conflicts
✅ Debug logging enabled

Run the quick fix command above to clear all caches and start fresh!
