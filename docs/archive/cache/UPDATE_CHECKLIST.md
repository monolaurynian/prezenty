# Quick Update Deployment Checklist

## When You Make Changes to the App

### ✅ Step 1: Update Version Number
Edit `package.json`:
```json
{
  "version": "1.0.1"  ← Increment this
}
```

### ✅ Step 2: Deploy Changes
```bash
# Commit your changes
git add .
git commit -m "Update: [describe your changes]"
git push

# Or deploy directly to your hosting platform
```

### ✅ Step 3: Verify Update
1. Open the app in a browser
2. Wait 5 minutes (or run `window.updateChecker.check()` in console)
3. You should see the green update banner
4. Click "Odśwież teraz" to reload

## That's It! 🎉

Users will automatically be notified of the update within 5 minutes of visiting the app.

---

## Optional: Force Immediate Update for All Users

If you need users to update immediately (critical bug fix):

### Option 1: Update Service Worker Version
Edit `public/sw.js`:
```javascript
const CACHE_NAME = 'prezenty-v8';  ← Increment this
```

Also update `server.js`:
```javascript
cacheVersion: 'v8'  ← Match the service worker version
```

### Option 2: Clear All Caches
Users can manually clear cache:
- Chrome: Ctrl+Shift+Delete → Clear browsing data
- Or hard reload: Ctrl+Shift+R

---

## What Happens Automatically

✅ HTML files are never cached (always fresh from server)
✅ CSS/JS files must revalidate with server
✅ Service worker checks for updates
✅ Users get a friendly notification
✅ One-click update with cache clearing
✅ Periodic checks every 5 minutes
✅ Checks when page becomes visible
✅ Checks when device comes back online

---

## Quick Commands

### Check Current Version (Browser Console)
```javascript
localStorage.getItem('app_version')
```

### Force Update Check (Browser Console)
```javascript
window.updateChecker.check()
```

### Force Reload with Cache Clear (Browser Console)
```javascript
window.updateChecker.reload()
```

### Unregister Service Worker (Browser Console)
```javascript
navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()))
```

---

## Troubleshooting

### Problem: Users still see old version
**Solution:** Increment version in `package.json` and redeploy

### Problem: Update notification not showing
**Solution:** Check browser console for errors, verify `/api/version` works

### Problem: Service worker not updating
**Solution:** Close all tabs, wait 24 hours, or manually update in DevTools

---

## Remember

🎯 **Always increment the version number** when deploying changes
🎯 **Test in incognito mode** to verify cache behavior
🎯 **Users will be notified automatically** - no manual intervention needed
