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

### Not set by any deploy config (set them yourself, see "Rotating secrets"):
- `VAPID_PUBLIC_KEY` - Web push public key
- `VAPID_PRIVATE_KEY` - Web push private key (set together with the public key)
- `VAPID_EMAIL` - Contact address for push services, e.g. `mailto:you@yourdomain`

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

### Deployment Fails with "npm ci" Error
**Error**: `npm ci` can only install packages when package.json and package-lock.json are in sync

**Solution**:
1. Delete `package-lock.json`
2. Run `npm install` to regenerate it
3. Commit the new `package-lock.json`
4. Redeploy

**Cause**: Package.json was modified without updating the lock file

### Keep-Alive System Not Working
- Check if `NODE_ENV=production` is set
- Verify `RENDER=true` environment variable
- Check logs for keep-alive ping messages

## Manual Database Setup

If you need to create database tables:

1. **Local Setup:**
   ```bash
   npm run test-db    # Test connection
   npm run init-db    # Create tables
   ```

2. **Remote Setup:**
   - Use database management tool
   - Run SQL commands from `scripts/init-db.js`
   - Or deploy temporarily with database access

## Support

- Check `/health` endpoint for current status
- Review Render deployment logs
- Verify environment variables in dashboard

## GIFs (KLIPY or GIPHY)

Chat messages can carry GIFs. The feature is off until a provider key is set (Render: dashboard > Environment; both keys are declared in `render.yaml` with `sync: false`, so they are never committed).

| Variable | Meaning |
|---|---|
| `KLIPY_API_KEY` | App key from [partner.klipy.com](https://partner.klipy.com) |
| `KLIPY_CONTENT_FILTER` | `off`, `low`, `medium`, `high` (default `high`) |
| `GIPHY_API_KEY` | Key from [developers.giphy.com](https://developers.giphy.com) |
| `GIPHY_RATING` | `g`, `pg`, `pg-13`, `r` (default `pg`) |
| `GIF_PROVIDER` | `klipy` or `giphy`: which one the picker uses when both keys are set (default `klipy`) |

Set one key or both. If you move from one provider to the other, keep the old key too: GIFs already sent through KLIPY can only be shown by asking KLIPY for their pictures.

What to know, for both:
- **Searches run in the user's browser**, because both providers require it. The server only hands the (public-by-design) key to signed-in users at `GET /api/wiadomosci/gif-config`. The provider therefore sees a user's IP address and search words, plus a random per-browser id (not linked to the account). Other chat users see only the picture, never who sent it.
- **Test keys are limited to 100 requests per hour** on both services, counted for the whole app. The picker waits for typing to pause and caches results, but a busy evening can hit the limit; users then see "Za dużo wyszukiwań" and can retry. Both providers lift the limit with a production key (GIPHY: paid, reviewed; KLIPY: requested in the Partner Panel).
- **Attribution.** Both want their brand shown. The picker shows "Powered by KLIPY" / "Powered by GIPHY" as text; before applying for a production key, swap in the official logo from the provider's brand page.
- **No database change.** A GIF is stored as the message text `[gif:<provider>:<id>:<w>x<h>]`, never as a URL. Switching the feature off just hides the buttons; messages already sent still display.

KLIPY specifics (from [their integration requirements](https://docs.klipy.com/integration-requirements.md)):
- **Pictures come from KLIPY's API, not from us.** A message stores only KLIPY's slug (e.g. `hello-hi-662`). When a conversation opens, the page asks KLIPY's "items" endpoint for the real picture URLs (one batched request, remembered while the page is open) and uses them unchanged. A short grey placeholder of the final size holds the place meanwhile. If KLIPY says it no longer has the GIF, the message shows "Ten GIF jest niedostępny". If the lookup or the picture merely *fails* (offline, the 100-per-hour test limit), the page retries on its own (after 3, 8 and 20 seconds), then shows "Nie udało się wczytać GIF-a" with a "Spróbuj ponownie" button. A failed lookup also logs `[GIF] KLIPY lookup failed (rate|key|http|network)` to the browser console.
- **The "what's new" banner** shows the KLIPY GIF `what-buddy` (`klipy` in `lib/release-notes.js`) when a KLIPY key is set. The browser looks it up like any chat GIF and credits it with "GIF: KLIPY". If there is no key, KLIPY does not answer within 4 seconds, or the GIF is gone, the banner shows the drawn GIF from `public/release/` instead.
- **Everything is loaded straight from KLIPY**: our server never proxies, stores or re-hosts their media or API calls. Only `static.klipy.com`, `static1.klipy.com` and `static2.klipy.com` pictures are accepted.
- **Results are shown in the order KLIPY sends them.** The only filtering is KLIPY's own `content_filter` (and whatever you configure in the Partner Panel under "Manage content"). I could not read the table that explains what each level blocks (it is an image in their docs), so check it in the Partner Panel and adjust `KLIPY_CONTENT_FILTER` to taste; `high` is the default for a family app.
- **Keep ads off** for this key in the Partner Panel (they are opt-in). An ad object is not a GIF, so the picker would skip it, and KLIPY asks partners not to suppress results.
- **An invalid key answers HTTP 404** (not 401); the picker treats it as "GIFs temporarily unavailable".
- Sending a GIF also tells KLIPY (their "share" trigger) so their ranking improves; nothing is sent until the user taps "Wyślij GIF".

GIPHY specifics: the picture URL is rebuilt from the id on `media.giphy.com`; "Powered by GIPHY" is mandatory under their terms.

Tenor's API closed on 30 June 2026. Another provider is one more adapter in `public/gif-picker.js` (`PROVIDERS`) plus an allowed provider name in `public/gif-message.js`.
## Rotating secrets

The app has fallback values for `SESSION_SECRET` and the VAPID (web push) key pair. Those fallback values are committed to git, so they are public. In production, set your own values and rotate them. Rotating (not deleting) is what matters: the old values stay in git history.

At boot the server prints one `[SECURITY]` warning when production or database mode runs on a fallback. The warning names the variables only, never their values.

Which deploy config sets what:

| File | `SESSION_SECRET` | `VAPID_*` |
|---|---|---|
| `render.yaml` | generated by Render (`generateValue: true`) | not set |
| `vercel.json` | not set | not set |
| `Dockerfile` | not set | not set |

`generateValue` only takes effect when the Blueprint creates the variable, so check the live service's environment too.

### 1. Generate new values

```bash
# Session secret
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# VAPID key pair (prints a public and a private key)
npx web-push generate-vapid-keys
```

### 2. Set them in the host's environment settings

Set `SESSION_SECRET`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (and `VAPID_EMAIL=mailto:you@yourdomain`) in:
- Render: dashboard > Environment
- Docker: `-e SESSION_SECRET=... -e VAPID_PUBLIC_KEY=... -e VAPID_PRIVATE_KEY=...`
- Vercel: project Settings > Environment Variables

Then redeploy.

### 3. What users will notice

- **New `SESSION_SECRET`**: every existing session cookie becomes invalid, so all users have to log in again once. Old session rows in the MySQL store simply expire.
- **New VAPID key pair**: existing push subscriptions were created with the old key and fail with HTTP 403. The server deletes them automatically, and each device subscribes again on its next visit. Set the public and private key together; the boot check in `lib/webpush-config.js` reports a mismatch.