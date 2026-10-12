// Moved verbatim from server.js (Phase 2 split)
const cron = require('cron');
const https = require('https');
const { plPlural, plCount } = require('../public/pluralize-pl');
const { DEMO_MODE, pool, isMaintenanceMode } = require('./db');
const { webpush } = require('./webpush-config');
const { sendPushToUser } = require('./push');

// Keep-alive cronjob for Render deployment
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

// Christmas nudge: from Dec 1st to Dec 23rd, remind users daily at 17:00 UTC
// about presents they reserved but haven't bought yet
function setupChristmasNudgeCron() {
    if (DEMO_MODE) {
        console.log('ℹ️ Christmas nudge cron skipped (demo mode)');
        return;
    }

    const job = new cron.CronJob('0 17 1-23 12 *', async function () {
        if (isMaintenanceMode() || DEMO_MODE || !webpush) return;
        try {
            console.log('🎅 [NUDGE] Running Christmas reminder check...');

            // Users with reserved but unbought presents
            const [rows] = await pool.execute(`
                SELECT reserved_by AS user_id, COUNT(*) AS unbought
                FROM presents
                WHERE reserved_by IS NOT NULL AND is_checked = 0
                GROUP BY reserved_by
            `);

            const now = new Date();
            const christmasEve = new Date(now.getFullYear(), 11, 24); // Dec 24
            const daysLeft = Math.max(0, Math.ceil((christmasEve - now) / 86400000));

            for (const row of rows) {
                const n = Number(row.unbought);
                const phrase = plCount(n, 'zarezerwowany prezent', 'zarezerwowane prezenty', 'zarezerwowanych prezentów');
                const body = `Masz ${phrase} do kupienia. ` +
                    `Do Wigilii ${plPlural(daysLeft, 'został', 'zostały', 'zostało')} ${plCount(daysLeft, 'dzień', 'dni', 'dni')}! 🎅`;
                await sendPushToUser(row.user_id, 'Przypomnienie świąteczne 🎄', body, { nudge: true });
            }
            console.log(`🎅 [NUDGE] Sent reminders to ${rows.length} user(s)`);
        } catch (err) {
            console.error('❌ [NUDGE] Christmas reminder failed:', err.message);
        }
    });

    job.start();
    console.log('✅ Christmas nudge cron started (daily 17:00 UTC, Dec 1-23)');
}

module.exports = { setupKeepAliveCron, setupChristmasNudgeCron };
