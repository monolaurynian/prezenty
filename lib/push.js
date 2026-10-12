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
async function sendNotificationToUsers(excludeUserId, title, body, data = {}) {
    console.log('🔔 [NOTIFICATION] Starting notification send:', { excludeUserId, title, body, data });

    if (!webpush) {
        console.log('⚠️ [NOTIFICATION] Web-push not available - notifications disabled');
        return;
    }

    if (DEMO_MODE) {
        console.log('📝 [NOTIFICATION] Demo mode - simulating notification (web-push available)');
        // In demo mode, we can't access the database, so we'll just log
        // But the push subscription endpoint should still work for testing
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

        const [subscriptions] = await pool.execute(`
            SELECT * FROM push_subscriptions 
            WHERE user_id != ? AND user_id != ?
        `, [excludeUserId, identifiedRecipientUserId !== null ? identifiedRecipientUserId : excludeUserId]);

        console.log(`📊 [NOTIFICATION] Found ${subscriptions.length} subscription(s) to notify (excluding user ${excludeUserId})`);

        // Early return if no subscriptions
        if (subscriptions.length === 0) {
            console.log('ℹ️ [NOTIFICATION] No subscriptions found - skipping notification send');
            return;
        }

        const notificationPayload = JSON.stringify({
            title,
            body,
            icon: '/seba_logo.png',
            badge: '/seba_logo.png',
            tag: 'new-present',
            data
        });

        console.log('📦 [NOTIFICATION] Notification payload:', notificationPayload);

        let successCount = 0;
        let failureCount = 0;

        const promises = subscriptions.map(async (sub) => {
            try {
                console.log(`📤 [NOTIFICATION] Sending to user ${sub.user_id} (push service: ${pushServiceHost(sub.endpoint)})`);
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

        const payload = JSON.stringify({
            title,
            body,
            icon: '/seba_logo.png',
            badge: '/seba_logo.png',
            tag: 'christmas-nudge',
            data
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
