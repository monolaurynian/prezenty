// Moved verbatim from server.js (Phase 2 split)
const { DEMO_MODE, pool } = require('./db');

// Notification helper functions
// (ensureNotificationsTable is defined later in this file - the previous
// duplicate ENUM-based definition was removed; the ENUM silently
// truncated new notification types to empty strings)

async function createNotification(type, actorId, data) {
    if (DEMO_MODE) {
        console.log('📝 [NOTIFICATIONS] Demo mode - skipping notification creation');
        return;
    }

    try {
        // Ensure table exists
        await ensureNotificationsTable();

        // Get all users except the actor
        const [users] = await pool.execute(
            'SELECT id FROM users WHERE id != ?',
            [actorId]
        );

        console.log(`📢 [NOTIFICATIONS] Creating ${type} notification for ${users.length} user(s)`);

        // Filter out identified recipients if notification is about their presents
        for (const user of users) {
            let shouldCreateNotification = true;

            // Check if this is a present-related notification
            if (type.includes('present_') && data.recipientId) {
                // Check if user is identified as this recipient
                const [identification] = await pool.execute(
                    'SELECT id FROM recipients WHERE id = ? AND identified_by = ?',
                    [data.recipientId, user.id]
                );

                // Skip this user if they're identified as the recipient
                if (identification.length > 0) {
                    console.log(`🔒 [NOTIFICATIONS] Skipping user ${user.id} - identified as recipient ${data.recipientId}`);
                    shouldCreateNotification = false;
                }
            }

            if (shouldCreateNotification) {
                await pool.execute(
                    'INSERT INTO notifications (user_id, type, actor_id, data) VALUES (?, ?, ?, ?)',
                    [user.id, type, actorId, JSON.stringify(data)]
                );
                console.log(`✅ [NOTIFICATIONS] Created ${type} notification for user ${user.id}`);
            }
        }
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error creating notification:', err);
        // Don't throw - notifications are non-critical
    }
}

// Notification Center Helper Functions

// Create notifications table if it doesn't exist
let notificationsTableEnsured = false;
async function ensureNotificationsTable() {
    if (DEMO_MODE) return;
    if (notificationsTableEnsured) return; // once per process - this runs
                                           // on EVERY notification otherwise

    try {
        // type is VARCHAR, not ENUM: the original ENUM silently truncated
        // unknown values (like leaderboard_leader) to '' - clients then
        // rendered the generic "nowa aktywność" fallback
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type VARCHAR(50) NOT NULL,
                actor_id INT NOT NULL,
                data JSON,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_read (user_id, is_read),
                INDEX idx_created (created_at DESC),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Migrate existing installs off the restrictive ENUM
        try {
            const [cols] = await pool.execute(`
                SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'
            `);
            if (cols.length > 0 && /^enum/i.test(cols[0].COLUMN_TYPE)) {
                console.log('🔧 [NOTIFICATIONS] Migrating type column ENUM -> VARCHAR(50)');
                await pool.execute(`ALTER TABLE notifications MODIFY COLUMN type VARCHAR(50) NOT NULL`);
            }
        } catch (migErr) {
            console.error('⚠️ [NOTIFICATIONS] Type column migration failed (non-fatal):', migErr.message);
        }

        notificationsTableEnsured = true;
        console.log('✅ [NOTIFICATIONS] Notifications table ready');
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error creating notifications table:', err);
    }
}

// Check if user is identified as a specific recipient
async function isUserIdentifiedAsRecipient(userId, recipientId) {
    if (DEMO_MODE) return false;

    try {
        const [rows] = await pool.execute(
            'SELECT id FROM recipients WHERE id = ? AND identified_by = ?',
            [recipientId, userId]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error checking identification:', err);
        return false;
    }
}

module.exports = { createNotification, ensureNotificationsTable, isUserIdentifiedAsRecipient };
