# Deployment Guide

## Current Status

The app is configured to deploy successfully even without database access by falling back to **DEMO MODE**.

## Deployment Options

### Option 1: Deploy with Database (Recommended)
1. Set `DB_PASSWORD` in Render dashboard
2. Ensure database allows connections from Render IPs
3. App will connect to MySQL database

### Option 2: Deploy in Demo Mode (Fallback)
1. Leave `DB_PASSWORD` empty or don't set it
2. App will run in demo mode with sample data
3. No database connection required

## Environment Variables

Set these in your Render dashboard:

### Required for Database Mode:
- `DB_PASSWORD` - Your MySQL database password

### Already Configured in render.yaml:
- `NODE_ENV=production`
- `SESSION_SECRET` (auto-generated)
- `DB_HOST=153.92.7.101`
- `DB_USER=u662139794_mati`
- `DB_NAME=u662139794_prezenty`
- `DB_PORT=3306`

## Deployment Process

1. **Push to GitHub** - Your repository
2. **Deploy on Render** - Automatic deployment
3. **Check Status** - Visit `/health` endpoint to see mode
4. **Set Password** (optional) - Add `DB_PASSWORD` to enable database

## Keep-Alive System

The app includes an automatic keep-alive system for Render deployments:

### Features:
- **Automatic Ping** - Pings the app every 14 minutes
- **Production Only** - Only runs when `NODE_ENV=production` and `RENDER=true`
- **Prevents Sleep** - Keeps the app active on Render's free tier
- **Smart Detection** - Automatically detects Render environment

### How it Works:
```javascript
// Pings https://prezenty.onrender.com every 14 minutes
const job = new cron.CronJob("*/14 * * * *", function () {
    https.get("https://prezenty.onrender.com", (res) => {
        console.log("✅ Keep-alive ping successful");
    });
});
```

### Logs:
- `✅ Keep-alive ping successful` - Ping worked
- `⚠️ Keep-alive ping failed` - HTTP error
- `❌ Keep-alive ping error` - Network error
- `ℹ️ Keep-alive cronjob skipped` - Not in production

## Health Check

Visit `https://your-app.onrender.com/health` to see:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "mode": "DEMO",
  "database": "disabled"
}
```

## Demo Mode Features

✅ **Working Features:**
- Login (any username/password works)
- View sample recipients and presents
- AWS-styled UI
- All visual components

❌ **Disabled Features:**
- Data persistence
- Real database operations
- User registration
- File uploads

## Switching to Production Mode

1. Set `DB_PASSWORD` in Render dashboard
2. Restart the service
3. App will attempt database connection
4. If successful, switches to production mode
5. If failed, falls back to demo mode

## Troubleshooting

### App shows "DEMO MODE"
- Database connection failed
- Check `DB_PASSWORD` is set correctly
- Verify database allows connections from Render IPs

### Database Connection Errors
- Ensure database server is accessible
- Check firewall settings
- Verify credentials are correct

### App won't start
- Check Render logs
- Verify all environment variables are set
- Check for syntax errors in code

## Manual Database Setup

If you need to create database tables:

1. **Local Setup:**
   ```bash
   npm run test-db    # Test connection
   npm run init-db    # Create tables
   ```

2. **Remote Setup:**
   - Use database management tool
   - Run SQL commands from `init-db.js`
   - Or deploy temporarily with database access

## Support

- Check `/health` endpoint for current status
- Review Render deployment logs
- Verify environment variables in dashboard