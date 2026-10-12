// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { DEMO_MODE, pool } = require('../lib/db');
const { webpush, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = require('../lib/webpush-config');
const { handleDbError } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { getUserIdentification } = require('../lib/queries');
const { sendNotificationToUsers, pushServiceHost } = require('../lib/push');
const { ensureNotificationsTable } = require('../lib/notifications');
const { demoNotifications } = require('../lib/demo-data');

// Notification subscription endpoint
router.post('/api/notifications/subscribe', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const subscription = req.body;

    console.log('📝 Notification subscription request:', { userId, hasSubscription: !!subscription });

    if (!webpush) {
        console.log('⚠️ Web-push not available - cannot save subscription');
        return res.status(503).json({
            error: 'Web-push module not available on server'
        });
    }

    if (DEMO_MODE) {
        console.log('Demo mode - notification subscription saved:', { userId, hasEndpoint: !!(subscription && subscription.endpoint) });
        res.json({ success: true });
        return;
    }

    try {
        // Create notifications table if it doesn't exist
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_endpoint (user_id, endpoint(255))
            )
        `);

        // Save subscription
        console.log(`💾 [SUBSCRIPTION] Saving subscription for user ${userId}:`, {
            pushService: pushServiceHost(subscription.endpoint),
            hasKeys: !!(subscription.keys && subscription.keys.p256dh && subscription.keys.auth)
        });

        await pool.execute(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) 
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                p256dh = VALUES(p256dh),
                auth = VALUES(auth),
                created_at = CURRENT_TIMESTAMP
        `, [
            userId,
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth
        ]);

        // Get total subscription count for this user
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = ?',
            [userId]
        );
        const userSubscriptionCount = countResult[0].count;

        // Get total subscriptions in system
        const [totalResult] = await pool.execute('SELECT COUNT(*) as count FROM push_subscriptions');
        const totalSubscriptions = totalResult[0].count;

        console.log(`✅ [SUBSCRIPTION] Subscription saved successfully for user ${userId}. User has ${userSubscriptionCount} subscription(s). Total system subscriptions: ${totalSubscriptions}`);

        res.json({
            success: true,
            userSubscriptions: userSubscriptionCount,
            totalSubscriptions: totalSubscriptions
        });
    } catch (err) {
        console.error('❌ [SUBSCRIPTION] Error saving push subscription:', err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// Get VAPID public key endpoint
router.get('/api/vapid-public-key', (req, res) => {
    res.json({
        publicKey: VAPID_PUBLIC_KEY,
        webPushAvailable: !!webpush
    });
});

// Debug/test endpoints: answer only in demo mode or outside production; otherwise 404 as if they did not exist
function debugOnly(req, res, next) {
    if (DEMO_MODE || process.env.NODE_ENV !== 'production') return next();
    return next('route');
}

// Debug endpoint for notification system
router.get('/api/notifications/debug', debugOnly, requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        console.log('🔍 [DEBUG] Notification debug request from user:', userId);

        const debugInfo = {
            webPushAvailable: !!webpush,
            vapidConfigured: !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
            demoMode: DEMO_MODE,
            userId: userId,
            timestamp: new Date().toISOString()
        };

        if (DEMO_MODE) {
            debugInfo.message = 'Running in DEMO mode - database queries disabled';
            return res.json(debugInfo);
        }

        // Get subscription counts
        const [userSubResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = ?',
            [userId]
        );
        debugInfo.userSubscriptions = userSubResult[0].count;

        const [totalSubResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM push_subscriptions'
        );
        debugInfo.totalSubscriptions = totalSubResult[0].count;

        // Get all user IDs with subscriptions
        const [usersResult] = await pool.execute(
            'SELECT DISTINCT user_id FROM push_subscriptions'
        );
        debugInfo.subscribedUserIds = usersResult.map(row => row.user_id);

        console.log('🔍 [DEBUG] Debug info:', debugInfo);
        res.json(debugInfo);
    } catch (error) {
        console.error('❌ [DEBUG] Error getting debug info:', error);
        res.status(500).json({ error: 'Failed to get debug info: ' + error.message });
    }
});

// Notification Center API Endpoints - DEPRECATED (use endpoints below)
/*
// Get notifications for current user
app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 5;
        const offset = parseInt(req.query.offset) || 0;

        console.log(`📋 [NOTIFICATIONS] Fetching notifications for user ${userId} (limit: ${limit}, offset: ${offset})`);

        if (DEMO_MODE) {
            return res.json({ notifications: [], unreadCount: 0, hasMore: false });
        }

        // Ensure table exists
        await ensureNotificationsTable();

        // Get user's identified recipient (if any)
        const [identification] = await pool.execute(
            'SELECT id FROM recipients WHERE identified_by = ?',
            [userId]
        );
        const identifiedRecipientId = identification.length > 0 ? identification[0].id : null;

        // Fetch notifications with actor username
        const [notifications] = await pool.execute(`
            SELECT n.*, u.username as actor_username
            FROM notifications n
            JOIN users u ON n.actor_id = u.id
            WHERE n.user_id = ?
            ORDER BY n.created_at DESC
            LIMIT ? OFFSET ?
        `, [userId, limit + 1, offset]); // Fetch one extra to check if there are more

        // Filter out notifications about identified recipient's presents
        let filteredNotifications = notifications;
        if (identifiedRecipientId) {
            filteredNotifications = notifications.filter(n => {
                if (n.type.includes('present_')) {
                    const data = JSON.parse(n.data);
                    return data.recipientId !== identifiedRecipientId;
                }
                return true;
            });
        }

        // Check if there are more notifications
        const hasMore = filteredNotifications.length > limit;
        if (hasMore) {
            filteredNotifications = filteredNotifications.slice(0, limit);
        }

        // Parse JSON data for each notification
        const parsedNotifications = filteredNotifications.map(n => ({
            ...n,
            data: JSON.parse(n.data)
        }));

        // Get unread count
        const [countResult] = await pool.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );
        const unreadCount = countResult[0].count;

        console.log(`✅ [NOTIFICATIONS] Returning ${parsedNotifications.length} notifications (${unreadCount} unread)`);

        res.json({
            notifications: parsedNotifications,
            unreadCount: unreadCount,
            hasMore: hasMore
        });
    } catch (error) {
        console.error('❌ [NOTIFICATIONS] Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// Get unread notification count
app.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        if (DEMO_MODE) {
            return res.json({ count: 0 });
        }

        await ensureNotificationsTable();

        const [result] = await pool.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        const count = result[0].count;
        console.log(`📊 [NOTIFICATIONS] Unread count for user ${userId}: ${count}`);

        res.json({ count: count });
    } catch (error) {
        console.error('❌ [NOTIFICATIONS] Error getting unread count:', error);
        res.status(500).json({ error: 'Failed to get unread count' });
    }
});

// Mark notification as read
app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const notificationId = req.params.id;

        console.log(`✓ [NOTIFICATIONS] Marking notification ${notificationId} as read for user ${userId}`);

        if (DEMO_MODE) {
            return res.json({ success: true, unreadCount: 0 });
        }

        await ensureNotificationsTable();

        // Mark as read (only if it belongs to this user)
        await pool.execute(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );

        // Get updated unread count
        const [result] = await pool.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        const unreadCount = result[0].count;
        console.log(`✅ [NOTIFICATIONS] Notification marked as read. New unread count: ${unreadCount}`);

        res.json({ success: true, unreadCount: unreadCount });
    } catch (error) {
        console.error('❌ [NOTIFICATIONS] Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

*/

// Mark all notifications as read
router.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        console.log(`✓✓ [NOTIFICATIONS] Marking all notifications as read for user ${userId}`);

        if (DEMO_MODE) {
            demoNotifications.forEach(n => { n.is_read = true; });
            return res.json({ success: true });
        }

        await ensureNotificationsTable();

        await pool.execute(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        console.log(`✅ [NOTIFICATIONS] All notifications marked as read for user ${userId}`);

        res.json({ success: true });
    } catch (error) {
        console.error('❌ [NOTIFICATIONS] Error marking all as read:', error);
        res.status(500).json({ error: 'Failed to mark all as read' });
    }
});

// Test notification endpoint
router.post('/api/test-notification', debugOnly, requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const includeCurrentUser = req.body.includeCurrentUser || false;

        console.log('🧪 [TEST] Testing notification for user:', userId, 'includeCurrentUser:', includeCurrentUser);

        if (!webpush) {
            return res.status(503).json({
                error: 'Web-push module not available. Run: npm install web-push'
            });
        }

        // Send a test notification (exclude current user by default, or include if requested)
        const excludeUserId = includeCurrentUser ? -1 : userId; // Use -1 to not exclude anyone
        await sendNotificationToUsers(excludeUserId, 'Test Notification', 'This is a test notification from Prezenty app! 🎄', {
            test: true,
            timestamp: Date.now()
        });

        res.json({ success: true, message: 'Test notification sent!' });
    } catch (error) {
        console.error('❌ [TEST] Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send test notification: ' + error.message });
    }
});

// Notification API endpoints
router.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 5;
        const offset = parseInt(req.query.offset) || 0;

        console.log(`📬 [NOTIFICATIONS] Fetching notifications for user ${userId} (limit: ${limit}, offset: ${offset})`);

        if (DEMO_MODE) {
            // Same limit/offset/hasMore semantics as the production path.
            // Unlike production this feed DOES include 'anon_message' rows so
            // the renderer activity.html ships for them is exercised; the
            // unread badge still excludes them, as production does.
            const page = demoNotifications.slice(offset, offset + limit + 1);
            const hasMore = page.length > limit;
            return res.json({
                notifications: hasMore ? page.slice(0, limit) : page,
                unreadCount: demoNotifications.filter(n => !n.is_read && n.type !== 'anon_message').length,
                hasMore
            });
        }

        await ensureNotificationsTable();

        // Check if user is identified as a recipient
        const identifiedRecipient = await getUserIdentification(userId);
        const identifiedRecipientId = identifiedRecipient ? identifiedRecipient.id : null;

        // Get notifications with actor username. Message notifications
        // are excluded - messages live in /wiadomosci, not the feed
        // (also hides legacy anon_message rows)
        const [notifications] = await pool.execute(`
            SELECT n.*, u.username as actor_username
            FROM notifications n
            LEFT JOIN users u ON n.actor_id = u.id
            WHERE n.user_id = ? AND n.type != 'anon_message'
            ORDER BY n.created_at DESC
            LIMIT ? OFFSET ?
        `, [userId, limit + 1, offset]); // Fetch one extra to check if there are more

        // Filter out notifications about identified recipient's presents
        let filteredNotifications = notifications;
        if (identifiedRecipientId) {
            filteredNotifications = notifications.filter(n => {
                if (n.type.includes('present_')) {
                    const data = JSON.parse(n.data);
                    return data.recipientId !== identifiedRecipientId;
                }
                return true;
            });
        }

        // Check if there are more notifications
        const hasMore = filteredNotifications.length > limit;
        if (hasMore) {
            filteredNotifications = filteredNotifications.slice(0, limit);
        }

        // Parse JSON data for each notification
        const parsedNotifications = filteredNotifications.map(n => ({
            ...n,
            data: JSON.parse(n.data)
        }));

        // Get unread count (messages excluded - they have their own badge)
        const [countResult] = await pool.execute(
            "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE AND type != 'anon_message'",
            [userId]
        );
        const unreadCount = countResult[0].count;

        console.log(`✅ [NOTIFICATIONS] Returning ${parsedNotifications.length} notifications, ${unreadCount} unread`);

        res.json({
            notifications: parsedNotifications,
            unreadCount: unreadCount,
            hasMore: hasMore
        });
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error fetching notifications:', err);
        handleDbError(err, res, 'Błąd podczas pobierania powiadomień');
    }
});

router.get('/api/notifications/unread-count', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        if (DEMO_MODE) {
            return res.json({ count: demoNotifications.filter(n => !n.is_read && n.type !== 'anon_message').length });
        }

        await ensureNotificationsTable();

        const [result] = await pool.execute(
            "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE AND type != 'anon_message'",
            [userId]
        );

        const count = result[0].count;
        console.log(`📊 [NOTIFICATIONS] User ${userId} has ${count} unread notification(s)`);

        res.json({ count: count });
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error getting unread count:', err);
        handleDbError(err, res, 'Błąd podczas pobierania liczby powiadomień');
    }
});

router.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const notificationId = req.params.id;

        console.log(`✓ [NOTIFICATIONS] Marking notification ${notificationId} as read for user ${userId}`);

        if (DEMO_MODE) {
            const row = demoNotifications.find(n => Number(n.id) === Number(notificationId));
            if (row) row.is_read = true;
            return res.json({
                success: true,
                unreadCount: demoNotifications.filter(n => !n.is_read && n.type !== 'anon_message').length
            });
        }

        await ensureNotificationsTable();

        // Mark as read only if it belongs to the user
        await pool.execute(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );

        // Get updated unread count
        const [result] = await pool.execute(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        const unreadCount = result[0].count;
        console.log(`✅ [NOTIFICATIONS] Notification marked as read. User has ${unreadCount} unread notification(s)`);

        res.json({ success: true, unreadCount: unreadCount });
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error marking notification as read:', err);
        handleDbError(err, res, 'Błąd podczas oznaczania powiadomienia');
    }
});

module.exports = router;
