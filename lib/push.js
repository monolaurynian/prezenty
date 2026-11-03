// Moved verbatim from server.js (Phase 2 split)
const { DEMO_MODE, pool } = require('./db');
const { webpush } = require('./webpush-config');

// Log only the push service host (e.g. fcm.googleapis.com); the rest of a
// push endpoint is a per-device secret token
function pushServiceHost(endpoint) {
    try {
        return new URL(endpoint).host;
    } catch (e) {
        return 'unknown';
    }
}

// Function to send notifications to all users except the sender
// excludeEndpoint: optional push endpoint string of the originating device —
// when provided, that specific subscription is skipped but all other devices
// belonging to the same user (e.g. their second phone) still receive the push.
async function sendNotificationToUsers(excludeUserId, title, body, data = {}, excludeEndpoint = null) {
    console.log('🔔 [NOTIFICATION] Starting notification send:', { excludeUserId, title, body, data, hasExcludeEndpoint: !!excludeEndpoint });

    if (!webpush) {
        console.log('⚠️ [NOTIFICATION] Web-push not available - notifications disabled');
        return;
    }

    if (DEMO_MODE) {
        console.log('📝 [NOTIFICATION] Demo mode - simulating notification (web-push available)');
        return;
    }

    try {
        // Also exclude the user identified as the present's recipient,
        // so nobody gets push notifications spoiling their own presents
        let identifiedRecipientUserId = null;
        if (data.recipientId) {
            try {
                const [identRows] = await pool.execute(
                    'SELECT identified_by FROM recipients WHERE id = ?',
                    [data.recipientId]
                );
                if (identRows.length > 0 && identRows[0].identified_by) {
                    identifiedRecipientUserId = identRows[0].identified_by;
                    console.log(`🔒 [NOTIFICATION] Also excluding user ${identifiedRecipientUserId} (identified as recipient ${data.recipientId})`);
                }
            } catch (e) {
                console.error('⚠️ [NOTIFICATION] Could not check recipient identification:', e.message);
            }
        }

        // Exclude the identified recipient's user entirely, but for the actor
        // only exclude the specific originating device endpoint — their other
        // devices (e.g. a second phone) should still receive the push.
        let subscriptions;
        if (excludeEndpoint) {
            const excludedIdentifiedUser = identifiedRecipientUserId !== null ? identifiedRecipientUserId : excludeUserId;
            const [rows] = await pool.execute(`
                SELECT * FROM push_subscriptions
                WHERE user_id != ?
                  AND user_id != ?
                  AND NOT (user_id = ? AND endpoint = ?)
            `, [excludedIdentifiedUser, excludedIdentifiedUser, excludeUserId, excludeEndpoint]);
            subscriptions = rows;
        } else {
            const [rows] = await pool.execute(`
                SELECT * FROM push_subscriptions
                WHERE user_id != ? AND user_id != ?
            `, [excludeUserId, identifiedRecipientUserId !== null ? identifiedRecipientUserId : excludeUserId]);
            subscriptions = rows;
        }

        console.log(`📊 [NOTIFICATION] Found ${subscriptions.length} subscription(s) to notify (excluding user ${excludeUserId})`);

        // Early return if no subscriptions
        if (subscriptions.length === 0) {
            console.log('ℹ️ [NOTIFICATION] No subscriptions found - skipping notification send');
            return;
        }

        // Cache unread counts per user so we don't hit the DB once per subscription
        const unreadCountCache = {};
        async function getUnreadCount(userId) {
            if (unreadCountCache[userId] !== undefined) return unreadCountCache[userId];
            try {
                const [rows] = await pool.execute(
                    "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE AND type != 'anon_message'",
                    [userId]
                );
                // +1 because the notification being delivered right now isn't in the DB yet
                unreadCountCache[userId] = (rows[0].count || 0) + 1;
            } catch (e) {
                unreadCountCache[userId] = 1;
            }
            return unreadCountCache[userId];
        }

        let successCount = 0;
        let failureCount = 0;

        const promises = subscriptions.map(async (sub) => {
            try {
                const unreadCount = await getUnreadCount(sub.user_id);
                const notificationPayload = JSON.stringify({
                    title,
                    body,
                    icon: '/seba_logo.png',
                    badge: '/seba_logo.png',
                    tag: 'new-present',
                    data: { ...data, unreadCount }
                });
                console.log(`📤 [NOTIFICATION] Sending to user ${sub.user_id} (push service: ${pushServiceHost(sub.endpoint)}, badge: ${unreadCount})`);
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                }, notificationPayload);
                successCount++;
                console.log(`✅ [NOTIFICATION] Successfully sent to user ${sub.user_id}`);
            } catch (error) {
                failureCount++;
                console.error(`❌ [NOTIFICATION] Failed to send to user ${sub.user_id}:`, {
                    error: error.message,
                    statusCode: error.statusCode,
                    pushService: pushServiceHost(sub.endpoint)
                });
                // Remove dead subscriptions:
                // 410 = expired, 404 = gone, 403 = VAPID mismatch (built
                // against an old key - it can never succeed; the device
                // re-subscribes with the current key on its next visit)
                if ([403, 404, 410].includes(error.statusCode)) {
                    console.log(`🗑️ [NOTIFICATION] Removing dead subscription (${error.statusCode}) for user ${sub.user_id}`);
                    await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
                }
            }
        });

        await Promise.all(promises);
        console.log(`✨ [NOTIFICATION] Notification send complete: ${successCount} successful, ${failureCount} failed out of ${subscriptions.length} total`);
    } catch (err) {
        console.error('💥 [NOTIFICATION] Error in sendNotificationToUsers:', err);
    }
}

// Send a push notification to a single user's devices
async function sendPushToUser(userId, title, body, data = {}) {
    if (!webpush || DEMO_MODE) return;

    try {
        const [subscriptions] = await pool.execute(
            'SELECT * FROM push_subscriptions WHERE user_id = ?',
            [userId]
        );
        if (subscriptions.length === 0) return;

        // Fetch unread message count for the badge
        let unreadCount = 1;
        try {
            const [rows] = await pool.execute(
                'SELECT COUNT(*) as count FROM anon_message_threads WHERE recipient_user_id = ? AND recipient_unread > 0',
                [userId]
            );
            unreadCount = (rows[0].count || 0) + 1;
        } catch (e) { /* non-fatal */ }

        const payload = JSON.stringify({
            title,
            body,
            icon: '/seba_logo.png',
            badge: '/seba_logo.png',
            tag: 'christmas-nudge',
            data: { ...data, unreadCount }
        });

        for (const sub of subscriptions) {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                }, payload);
            } catch (error) {
                // 403 = old-VAPID-key subscription, can never succeed
                if ([403, 404, 410].includes(error.statusCode)) {
                    await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
                }
            }
        }
    } catch (err) {
        console.error('❌ [NUDGE] Error sending push to user', userId, ':', err.message);
    }
}

module.exports = { sendNotificationToUsers, sendPushToUser, pushServiceHost };
