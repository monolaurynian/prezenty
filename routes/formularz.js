// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { notificationText } = require('../public/notification-text');
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { cache, clearCombinedDataCache } = require('../lib/cache');
const { sendNotificationToUsers } = require('../lib/push');
const { createNotification } = require('../lib/notifications');
const { getLeaderboardLeader, notifyLeaderboardChange } = require('../lib/leaderboard');
const { demoData } = require('../lib/demo-data');

// Formularz API - Get all recipients (no authentication required)
router.get('/api/formularz/recipients', async (req, res) => {
    console.log('[GET /api/formularz/recipients] Fetching recipients');

    if (DEMO_MODE) {
        // Demo mode - return demo recipients
        const recipients = demoData.recipients.map(r => ({ id: r.id, name: r.name }));
        res.json({ recipients });
        return;
    }

    try {
        const [rows] = await pool.execute('SELECT id, name FROM recipients ORDER BY name');
        console.log('[Formularz] Found', rows.length, 'recipients');
        res.json({ recipients: rows });
    } catch (err) {
        console.error('[Formularz] Database error:', err);
        return handleDbError(err, res, 'Błąd podczas pobierania listy osób');
    }
});

// One-time schema fix: presents.created_by was declared NOT NULL, which
// breaks anonymous formularz submissions for new/unidentified recipients.
let createdByNullableEnsured = false;
async function ensureCreatedByNullable() {
    if (createdByNullableEnsured) return;
    try {
        await pool.execute('ALTER TABLE presents MODIFY created_by INT NULL DEFAULT NULL');
        createdByNullableEnsured = true;
        console.log('✅ [SCHEMA] presents.created_by is now nullable');
    } catch (err) {
        console.error('⚠️ [SCHEMA] Could not make created_by nullable:', err.message);
        throw err;
    }
}

// Formularz API - Submit present without authentication
router.post('/api/formularz/present', async (req, res) => {
    const { recipientName, presentTitle, presentComments } = req.body;

    console.log('[POST /api/formularz/present] Incoming request:', { recipientName, presentTitle });

    if (!recipientName || !presentTitle) {
        return badRequest(res, 'Imię i nazwa prezentu są wymagane');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate adding present
        console.log('Demo mode: present added via formularz');
        res.json({ success: true });
        return;
    }

    try {
        // Find or create recipient
        let recipientId;
        let createdByUserId = null;

        console.log('[Formularz] Looking for recipient:', recipientName.trim());
        const [recipientRows] = await pool.execute('SELECT id, identified_by FROM recipients WHERE name = ?', [recipientName.trim()]);

        if (recipientRows.length > 0) {
            recipientId = recipientRows[0].id;
            createdByUserId = recipientRows[0].identified_by; // Use the identified user's ID
            console.log('[Formularz] Using existing recipient:', recipientId, 'identified_by:', createdByUserId);
        } else {
            // Create new recipient
            console.log('[Formularz] Creating new recipient:', recipientName.trim());
            const [result] = await pool.execute('INSERT INTO recipients (name) VALUES (?)', [recipientName.trim()]);
            recipientId = result.insertId;
            console.log('[Formularz] Created new recipient:', recipientId);
        }

        // Add present for this recipient.
        // created_by priority:
        //  1. the user identified as the recipient (their wishlist)
        //  2. the logged-in submitter (adding a present for someone else)
        //  3. NULL for anonymous submissions (requires nullable column,
        //     ensured below - the schema originally declared NOT NULL,
        //     which made inserts for new/unidentified recipients fail)
        const sessionUserId = (req.session && req.session.userId) ? req.session.userId : null;
        const effectiveCreatedBy = createdByUserId || sessionUserId || null;

        console.log('[Formularz] Adding present:', { title: presentTitle.trim(), recipientId, comments: presentComments, createdBy: effectiveCreatedBy });

        // Snapshot the leaderboard leader before the change
        const prevLeader = await getLeaderboardLeader().catch(() => null);

        let presentId;
        if (effectiveCreatedBy) {
            const [presentResult] = await pool.execute(
                'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
                [presentTitle.trim(), recipientId, presentComments || null, effectiveCreatedBy]
            );
            presentId = presentResult.insertId;
        } else {
            // Anonymous submission - make sure created_by accepts NULL first
            await ensureCreatedByNullable();
            const [presentResult] = await pool.execute(
                'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, NULL)',
                [presentTitle.trim(), recipientId, presentComments || null]
            );
            presentId = presentResult.insertId;
        }

        console.log('[Formularz] Present added successfully:', presentId);

        // Clear cache
        try {
            clearCombinedDataCache();
            cache.invalidatePresents();
            console.log('[Formularz] Cache cleared successfully');
        } catch (cacheErr) {
            console.error('[Formularz] Cache clear error (non-fatal):', cacheErr);
            // Continue anyway - cache errors shouldn't fail the request
        }

        // Leaderboard leader may have changed - notify (non-blocking)
        notifyLeaderboardChange(prevLeader, effectiveCreatedBy || 0);

        // Create in-app notification for other users
        try {
            // Get recipient name for notification
            let notificationRecipientName = recipientName.trim();
            if (recipientId) {
                try {
                    const [recipientRows] = await pool.execute('SELECT name FROM recipients WHERE id = ?', [recipientId]);
                    if (recipientRows.length > 0) {
                        notificationRecipientName = recipientRows[0].name;
                    }
                } catch (err) {
                    console.error('[Formularz] Error getting recipient name for notification:', err);
                }
            }

            // The notification actor must be the ACTUAL submitter (if logged in),
            // never the user identified as the recipient (createdByUserId) —
            // otherwise the activity feed shows the wrong person as the one
            // who added the present. Anonymous submissions get actor 0.
            const notificationActorId = (req.session && req.session.userId) ? req.session.userId : 0;

            await createNotification('present_added', notificationActorId, {
                presentId: presentId,
                presentTitle: presentTitle.trim(),
                recipientId: recipientId,
                recipientName: notificationRecipientName,
                viaFormularz: true
            });

            // Send push notification to other users (non-blocking)
            const notificationTitle = 'Nowy prezent!';
            // Same wording as the activity feed, as plain text
            // (anonymous submissions -> "Ktoś dodaje prezent …")
            const notificationBody = notificationText('present_added', {
                presentTitle: presentTitle.trim(),
                recipientName: notificationRecipientName
            }, req.session && req.session.userId ? req.session.username : null, { html: false });
            console.log(`📢 [FORMULARZ] Triggering notification for new present: "${presentTitle.trim()}" (ID: ${presentId})`);

            sendNotificationToUsers(notificationActorId, notificationTitle, notificationBody, {
                presentId: presentId,
                presentTitle: presentTitle.trim(),
                recipientId: recipientId,
                recipientName: notificationRecipientName
            }).catch(err => {
                // Log error but don't fail the present creation
                console.error('❌ [FORMULARZ] Failed to send notification (present was created successfully):', err);
            });
        } catch (notificationErr) {
            console.error('[Formularz] Non-fatal error creating notifications:', notificationErr);
            // Continue anyway - notification errors shouldn't fail the request
        }

        res.json({ success: true, presentId: presentId });
    } catch (err) {
        console.error('[Formularz] Database error:', err);
        console.error('[Formularz] Error stack:', err.stack);
        console.error('[Formularz] Error details:', {
            message: err.message,
            code: err.code,
            errno: err.errno,
            sqlMessage: err.sqlMessage
        });
        return handleDbError(err, res, 'Błąd podczas dodawania prezentu');
    }
});

// Formularz API - Get user's presents (requires authentication)
router.get('/api/formularz/my-presents', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    console.log('[GET /api/formularz/my-presents] Request from user:', userId);

    if (DEMO_MODE) {
        // Demo mode - return demo presents
        res.json({ presents: demoData.presents });
        return;
    }

    try {
        // Get user's identified recipient
        const [recipientRows] = await pool.execute('SELECT id FROM recipients WHERE identified_by = ?', [userId]);

        if (recipientRows.length === 0) {
            // User hasn't identified themselves yet
            console.log('[Formularz] User not identified yet');
            res.json({ presents: [] });
            return;
        }

        const recipientId = recipientRows[0].id;
        console.log('[Formularz] User identified as recipient:', recipientId);

        // Get all presents for this recipient
        const [presents] = await pool.execute(
            'SELECT id, title, comments, created_at, recipient_id FROM presents WHERE recipient_id = ? ORDER BY created_at DESC',
            [recipientId]
        );

        console.log('[Formularz] Found', presents.length, 'presents for recipient', recipientId);
        if (presents.length > 0) {
            console.log('[Formularz] Sample present:', presents[0]);
        }
        res.json({ presents });
    } catch (err) {
        console.error('[Formularz] Database error:', err);
        return handleDbError(err, res, 'Błąd podczas pobierania prezentów');
    }
});

module.exports = router;
