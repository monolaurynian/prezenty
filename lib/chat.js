// Moved verbatim from server.js (Phase 2 split)
const { reactionThrottleStep } = require('../public/chat-reactions');
const { DEMO_MODE, pool } = require('./db');
const { sendPushToUser } = require('./push');

// ==================== Anonymous messages (wiadomości) ====================
// Users can send anonymous messages to each other (e.g. "what shoe size
// do you wear?"). The recipient never learns who asked; the initiator
// knows who they asked. Replies flow both ways within a thread.

let anonTablesEnsured = false;
async function ensureAnonMessageTables() {
    if (DEMO_MODE || anonTablesEnsured) return;
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS anon_threads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            initiator_id INT NOT NULL,
            target_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_initiator (initiator_id),
            INDEX idx_target (target_id),
            FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS anon_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            thread_id INT NOT NULL,
            sender_id INT NOT NULL,
            body TEXT NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_thread (thread_id),
            FOREIGN KEY (thread_id) REFERENCES anon_threads(id) ON DELETE CASCADE
        )
    `);
    // Emoji reactions on messages. The reactor's user_id is stored HERE
    // AND NOWHERE ELSE - no endpoint ever emits it, clients only ever see
    // { emoji, count, mine }. Reactions deliberately create no
    // notification, no push and no activity-feed entry.
    // emoji VARCHAR(16) counts code points and fits the longest sequence in
    // public/emoji-data.js (8; scripts/build-emoji-data.js asserts <= 16).
    // MIRRORED in scripts/init-db.js (fresh installs) - keep both in sync.
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS anon_message_reactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message_id INT NOT NULL,
            user_id INT NOT NULL,
            -- utf8mb4_bin: the *_ci collations compare many emoji as
            -- EQUAL, which would break both the unique key (one reaction
            -- per user per message) and GROUP BY emoji
            emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_message_user_emoji (message_id, user_id, emoji),
            INDEX idx_reaction_message (message_id),
            FOREIGN KEY (message_id) REFERENCES anon_messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    // NOTE: multiple threads per sender->recipient pair are allowed by
    // design (each compose starts a fresh thread) - separate threads help
    // tell genuine conversations apart from test ones
    anonTablesEnsured = true;
    console.log('✅ [WIADOMOSCI] Anonymous message tables ready');
}

// Targeted notification for ONE user with the actor masked: actor_id is
// set to the notification's owner so the API can never leak the sender's
// username. The safe display label travels in data.label.
async function notifyAnonMessage(recipientUserId, label, threadId, preview) {
    // Messages deliberately do NOT create an activity-feed notification -
    // the dock badge and thread unread counts already track them. Only a
    // push goes out (with threadId so the SW can suppress it when the
    // conversation is open, and deep-link otherwise).
    sendPushToUser(recipientUserId, label + ' 💬',
        preview.length > 80 ? preview.slice(0, 77) + '...' : preview,
        { url: '/wiadomosci?rozmowa=' + threadId, threadId }
    ).catch(() => {});
}

// Server-side throttle. The client debounces rapid taps, but that only
// protects a well-behaved client; this caps what one session can do to
// the pool. 30 toggles / 10 s is far above thumb speed. In-memory and
// per-process, which is enough - no rate-limiting dependency is added.
const REACTION_RATE_MAX = 30;
const REACTION_RATE_WINDOW_MS = 10 * 1000;
const reactionRateBuckets = new Map(); // userId -> { start, hits }

function reactionRateAllows(userId) {
    const now = Date.now();
    // Opportunistic prune so the map cannot grow without bound
    if (reactionRateBuckets.size > 500) {
        reactionRateBuckets.forEach((bucket, key) => {
            if (now - Number(bucket.start) >= REACTION_RATE_WINDOW_MS) reactionRateBuckets.delete(key);
        });
    }
    const next = reactionThrottleStep(
        reactionRateBuckets.get(userId), now, REACTION_RATE_MAX, REACTION_RATE_WINDOW_MS
    );
    reactionRateBuckets.set(userId, next);
    return next.allowed;
}

module.exports = { ensureAnonMessageTables, notifyAnonMessage, reactionRateAllows };
