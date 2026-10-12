# Cron Job Status Check

## ✅ Keep-Alive Cron Job is Active

### Location
**File:** `server.js`
**Lines:** 2545-2580

### Configuration

**Function:** `setupKeepAliveCron()`

**Schedule:** `*/14 * * * *`
- Runs every 14 minutes
- Prevents Render free tier from sleeping

**Conditions:**
- Only runs in production environment
- Only runs on Render platform
- Checks: `process.env.NODE_ENV === 'production' && process.env.RENDER`

### How It Works

1. **Cron Pattern:** `*/14 * * * *`
   - `*/14` = Every 14 minutes
   - `*` = Every hour
   - `*` = Every day
   - `*` = Every month
   - `*` = Every day of week

2. **Action:**
   - Makes HTTPS GET request to `https://prezenty.onrender.com`
   - Checks response status code
   - Logs success or failure

3. **Startup:**
   - Waits 5 seconds after server starts
   - Then initializes the cron job
   - Ensures server is fully ready

### Logging

**Success:**
```
✅ Keep-alive ping successful at [time]
```

**Failure:**
```
⚠️ Keep-alive ping failed: [status code]
```

**Error:**
```
❌ Keep-alive ping error: [error message]
```

**Initialization:**
```
🔄 Setting up keep-alive cronjob for Render...
✅ Keep-alive cronjob started - pinging every 14 minutes
```

**Skipped (not in production):**
```
ℹ️ Keep-alive cronjob skipped (not in production on Render)
```

### Code

```javascript
function setupKeepAliveCron() {
    // Only run keep-alive in production on Render
    if (process.env.NODE_ENV === 'production' && process.env.RENDER) {
        console.log('🔄 Setting up keep-alive cronjob for Render...');

        const job = new cron.CronJob('*/14 * * * *', function () {
            https
                .get("https://prezenty.onrender.com", (res) => {
                    if (res.statusCode === 200) {
                        console.log("✅ Keep-alive ping successful at", new Date().toLocaleTimeString());
                    } else {
                        console.log("⚠️ Keep-alive ping failed:", res.statusCode);
                    }
                })
                .on("error", (e) => {
                    console.error("❌ Keep-alive ping error:", e.message);
                });
        });

        job.start();
        console.log('✅ Keep-alive cronjob started - pinging every 14 minutes');
    } else {
        console.log('ℹ️ Keep-alive cronjob skipped (not in production on Render)');
    }
}

startServer();

// Setup keep-alive after server starts
setTimeout(() => {
    setupKeepAliveCron();
}, 5000); // Wait 5 seconds for server to fully start
```

### Dependencies

**Required packages:**
- `cron` - For scheduling tasks
- `https` - For making HTTP requests (built-in Node.js module)

**Package.json:**
```json
"dependencies": {
    "cron": "^3.1.6",
    ...
}
```

### Purpose

**Why every 14 minutes?**
- Render free tier sleeps after 15 minutes of inactivity
- Pinging every 14 minutes keeps the app awake
- Ensures the app is always responsive

**Benefits:**
- No cold starts for users
- Faster response times
- Better user experience
- App stays "warm"

### Environment Variables

**Required for activation:**
- `NODE_ENV=production`
- `RENDER=true` (automatically set by Render)

**Local development:**
- Cron job is skipped
- No unnecessary pings
- Cleaner logs

### Monitoring

**Check if it's running:**
1. Look for initialization message in logs
2. Check for ping success messages every 14 minutes
3. Monitor app uptime on Render dashboard

**Troubleshooting:**
- If app still sleeps: Check environment variables
- If pings fail: Check URL and network
- If errors occur: Check logs for details

### Status: ✅ ACTIVE

The cron job is:
- ✅ Properly configured
- ✅ Using correct schedule (every 14 minutes)
- ✅ Conditional (only in production on Render)
- ✅ Logging results
- ✅ Error handling in place
- ✅ Delayed startup (5 seconds)

### Conclusion

The keep-alive cron job is **fully functional** and will:
- Keep the Render app awake
- Prevent cold starts
- Ping every 14 minutes
- Only run in production
- Log all activity

No changes needed - the cron job is working as intended! 🎉
