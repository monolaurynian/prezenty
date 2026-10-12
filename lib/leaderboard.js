// Moved verbatim from server.js (Phase 2 split)
const { DEMO_MODE, pool } = require('./db');
const { sendNotificationToUsers } = require('./push');
const { createNotification } = require('./notifications');

// ---- Leaderboard change detection ----
// The leaderboard ranks recipients by presents on their wishlist. When
// the top spot changes hands after a present is added/removed, everyone
// gets an in-app notification about it.
async function getLeaderboardLeader() {
    const [rows] = await pool.execute(`
        SELECT r.id, r.name, COUNT(p.id) as total_presents
        FROM recipients r
        LEFT JOIN presents p ON p.recipient_id = r.id
        GROUP BY r.id, r.name
        HAVING total_presents > 0
        ORDER BY total_presents DESC, r.name ASC
        LIMIT 1
    `);
    return rows.length ? rows[0] : null;
}

async function notifyLeaderboardChange(previousLeader, actorId) {
    try {
        if (DEMO_MODE) return;
        const newLeader = await getLeaderboardLeader();
        if (!newLeader) return;
        if (previousLeader && previousLeader.id === newLeader.id) return;

        console.log(`🏆 [LEADERBOARD] New leader: ${newLeader.name} (${newLeader.total_presents} presents)`);
        const count = Number(newLeader.total_presents);
        await createNotification('leaderboard_leader', actorId || 0, {
            leaderName: newLeader.name,
            leaderId: newLeader.id,
            presentCount: count,
            previousLeaderName: previousLeader ? previousLeader.name : null
        });

        // Push notification too - a lead change is a fun, rare event.
        // data.url makes the SW open the ranking page on tap.
        const pushBody = previousLeader
            ? `${newLeader.name} wyprzedza ${previousLeader.name} i prowadzi z ${count} ${count === 1 ? 'prezentem' : 'prezentami'}!`
            : `${newLeader.name} prowadzi w rankingu z ${count} ${count === 1 ? 'prezentem' : 'prezentami'}!`;
        sendNotificationToUsers(actorId || 0, 'Zmiana w rankingu! 🏆', pushBody, {
            leaderboard: true,
            url: '/leaderboard.html'
        }).catch(err => {
            console.error('❌ [LEADERBOARD] Push send failed (non-fatal):', err);
        });
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error checking leaderboard change:', err);
    }
}

module.exports = { getLeaderboardLeader, notifyLeaderboardChange };
