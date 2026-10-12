// Moved verbatim from server.js (Phase 2 split)

// ===== Presence tracking (in-memory, resets on deploy) =====
// Every authenticated request refreshes the user's last-seen time.
// No DB writes - important with the hosting's connection limits.
const userLastSeen = new Map();
const ONLINE_WINDOW_MS = 3 * 60 * 1000; // seen within 3 min = online

const presenceMiddleware = (req, res, next) => {
    if (req.session && req.session.userId) {
        userLastSeen.set(req.session.userId, Date.now());
    }
    next();
};

function isUserOnline(userId) {
    if (!userId) return false;
    const seen = userLastSeen.get(userId);
    return !!seen && (Date.now() - seen) < ONLINE_WINDOW_MS;
}

// Presence is computed at response time (never cached) so the dots
// stay fresh even when recipient data comes from a cache
function withPresence(recipients) {
    return (recipients || []).map(r => ({ ...r, online: isUserOnline(r.identified_by) }));
}

module.exports = { presenceMiddleware, isUserOnline, withPresence };
