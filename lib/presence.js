// Moved verbatim from server.js (Phase 2 split)

// ===== Presence tracking (in-memory, resets on deploy) =====
// Every authenticated request refreshes the user's last-seen time.
// No DB writes - important with the hosting's connection limits.
//   seen within 5 min -> 'online'  (green dot)
//   seen within 1 h   -> 'recent'  (yellow dot)
//   otherwise         -> 'offline' (red dot)
const userLastSeen = new Map();
const ONLINE_WINDOW_MS = 5 * 60 * 1000;   // seen within 5 min = online
const RECENT_WINDOW_MS = 60 * 60 * 1000;  // seen within 1 h = recently active

const presenceMiddleware = (req, res, next) => {
    if (req.session && req.session.userId) {
        userLastSeen.set(req.session.userId, Date.now());
    }
    next();
};

function getPresence(userId) {
    if (!userId) return 'offline';
    const seen = userLastSeen.get(userId);
    if (!seen) return 'offline';
    const age = Date.now() - seen;
    if (age < ONLINE_WINDOW_MS) return 'online';
    if (age < RECENT_WINDOW_MS) return 'recent';
    return 'offline';
}

function isUserOnline(userId) {
    return getPresence(userId) === 'online';
}

// Presence is computed at response time (never cached) so the dots
// stay fresh even when recipient data comes from a cache.
// `online` stays a boolean (green dot only); `presence` has all three states.
function withPresence(recipients) {
    return (recipients || []).map(r => {
        const presence = getPresence(r.identified_by);
        return { ...r, online: presence === 'online', presence };
    });
}

module.exports = { presenceMiddleware, isUserOnline, getPresence, withPresence, ONLINE_WINDOW_MS, RECENT_WINDOW_MS };