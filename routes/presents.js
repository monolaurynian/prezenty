// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { notificationText } = require('../public/notification-text');
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, notFound, forbidden, conflict, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { cache, combinedDataCache, COMBINED_CACHE_TTL, clearCombinedDataCache } = require('../lib/cache');
const { updateTracker } = require('../lib/update-tracker');
const { getUserIdentification, getAllPresents } = require('../lib/queries');
const { withPresence } = require('../lib/presence');
const { sendNotificationToUsers } = require('../lib/push');
const { createNotification } = require('../lib/notifications');
const { getLeaderboardLeader, notifyLeaderboardChange } = require('../lib/leaderboard');
const { demoData } = require('../lib/demo-data');

// Presents API
router.get('/api/presents', requireAuth, async (req, res) => {
    console.log('Getting presents for user:', req.session.userId);
    const userId = req.session.userId;

    if (DEMO_MODE) {
        // Demo mode - return demo presents
        const presents = demoData.presents.map(present => {
            const recipient = demoData.recipients.find(r => r.id === present.recipient_id);
            return {
                ...present,
                recipient_name: recipient ? recipient.name : null,
                reserved_by_username: present.reserved_by ? 'demo' : null
            };
        });
        console.log('Demo presents loaded:', presents.length, 'presents');
        res.json({
            identified: false,
            presents: presents
        });
        return;
    }

    try {
        // First check if user is identified
        const identifiedRecipient = await getUserIdentification(userId);

        if (identifiedRecipient) {
            // User is identified - only show progress (checked/unchecked count) for their presents
            const [rows] = await pool.execute(`
                SELECT 
                    COUNT(*) as total_presents,
                    SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as checked_presents,
                    SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked_presents
                FROM presents p 
                WHERE p.recipient_id = ?
            `, [identifiedRecipient.id]);

            const progress = rows[0] || { total_presents: 0, checked_presents: 0, unchecked_presents: 0 };
            console.log('Progress for identified user:', progress);

            res.json({
                identified: true,
                recipient: {
                    id: identifiedRecipient.id,
                    name: identifiedRecipient.name
                },
                progress: progress,
                presents: [] // Empty array since we don't show presents to identified users
            });
        } else {
            // User is not identified - show all presents normally
            const presents = await getAllPresents();
            console.log('Presents loaded successfully:', presents.length, 'presents');
            if (presents.length > 0) {
                console.log('Sample present data:', presents[0]);
            }
            res.json({
                identified: false,
                presents: presents
            });
        }
    } catch (err) {
        console.error('Database error:', err);
        handleDbError(err, res, 'Błąd podczas pobierania prezentów');
    }
});

// Get all presents without identification logic (for recipients view)
router.get('/api/presents/all', requireAuth, async (req, res) => {
    console.log('Getting all presents for recipients view');

    if (DEMO_MODE) {
        // Demo mode - return demo presents with recipient names
        const presents = demoData.presents.map(present => {
            const recipient = demoData.recipients.find(r => r.id === present.recipient_id);
            return {
                ...present,
                recipient_name: recipient ? recipient.name : null,
                reserved_by_username: present.reserved_by ? 'demo' : null
            };
        });
        console.log('Demo presents loaded:', presents.length, 'presents');
        res.json(presents);
        return;
    }

    try {
        const presents = await getAllPresents();
        console.log('All presents loaded successfully:', presents.length, 'presents');
        if (presents.length > 0) {
            console.log('Sample present data:', presents[0]);
        }
        res.json(presents);
    } catch (err) {
        console.error('Database error getting all presents:', err);
        handleDbError(err, res, 'Błąd podczas pobierania prezentów');
    }
});

router.get('/api/recipients-with-presents', requireAuth, async (req, res) => {
    console.log('Getting recipients with presents for user:', req.session.userId);

    // Check cache first
    const cacheKey = 'combined-data';
    const cached = combinedDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < COMBINED_CACHE_TTL) {
        console.log('Returning cached combined data');
        return res.json({ ...cached.data, recipients: withPresence(cached.data.recipients) });
    }

    if (DEMO_MODE) {
        // Demo mode - return combined demo data
        const recipients = demoData.recipients.map(recipient => ({
            ...recipient,
            identified_by_username: recipient.identified_by ? 'demo' : null
        }));

        const presents = demoData.presents.map(present => {
            const recipient = demoData.recipients.find(r => r.id === present.recipient_id);
            return {
                ...present,
                recipient_name: recipient ? recipient.name : null,
                reserved_by_username: present.reserved_by ? 'demo' : null
            };
        });

        console.log('Demo data loaded:', recipients.length, 'recipients,', presents.length, 'presents');
        const result = { recipients, presents };
        combinedDataCache.set(cacheKey, { data: result, timestamp: Date.now() });
        res.json(result);
        return;
    }

    try {
        // Execute both queries in parallel for better performance
        const [recipientsResult, presentsResult] = await Promise.all([
            pool.execute(`
                SELECT r.id, r.name, r.identified_by, 
                       CASE WHEN r.profile_picture IS NOT NULL THEN 1 ELSE 0 END as has_profile_picture,
                       r.profile_picture_type, r.created_at, 
                       u.username as identified_by_username 
                FROM recipients r 
                LEFT JOIN users u ON r.identified_by = u.id 
                ORDER BY r.name
            `),
            pool.execute(`
                SELECT p.id, p.title, p.recipient_id, p.comments, p.is_checked, 
                       p.reserved_by, p.created_by, p.created_at,
                       r.name as recipient_name, u.username as reserved_by_username
                FROM presents p 
                LEFT JOIN recipients r ON p.recipient_id = r.id 
                LEFT JOIN users u ON p.reserved_by = u.id
                ORDER BY p.created_at DESC
            `)
        ]);

        const recipients = recipientsResult[0].map(recipient => {
            // Set profile_picture URL if recipient has one
            if (recipient.has_profile_picture) {
                recipient.profile_picture = `/api/recipients/${recipient.id}/profile-picture`;
            }
            // Remove the has_profile_picture flag (internal use only)
            delete recipient.has_profile_picture;
            return recipient;
        });

        const presents = presentsResult[0];

        console.log('Combined data loaded successfully:', recipients.length, 'recipients,', presents.length, 'presents');
        const result = { recipients, presents };

        // Cache the result
        combinedDataCache.set(cacheKey, { data: result, timestamp: Date.now() });

        res.json({ ...result, recipients: withPresence(result.recipients) });
    } catch (err) {
        console.error('Database error getting combined data:', err);
        handleDbError(err, res, 'Błąd podczas pobierania danych');
    }
});

// Get data hash for change detection
router.get('/api/recipients-hash', requireAuth, async (req, res) => {
    const crypto = require('crypto');
    
    if (DEMO_MODE) {
        // Demo mode - return a static hash
        const hash = crypto.createHash('md5').update(JSON.stringify(demoData)).digest('hex');
        return res.json({ hash, timestamp: Date.now() });
    }
    
    try {
        // Get counts and latest timestamps
        const [result] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM recipients) as recipient_count,
                (SELECT COUNT(*) FROM presents) as present_count,
                (SELECT MAX(created_at) FROM recipients) as latest_recipient,
                (SELECT MAX(created_at) FROM presents) as latest_present,
                (SELECT MAX(updated_at) FROM presents WHERE updated_at IS NOT NULL) as latest_present_update
        `);
        
        const data = result[0];
        const hashString = JSON.stringify({
            recipients: data.recipient_count,
            presents: data.present_count,
            latestRecipient: data.latest_recipient,
            latestPresent: data.latest_present,
            latestUpdate: data.latest_present_update
        });
        
        const hash = crypto.createHash('md5').update(hashString).digest('hex');
        
        res.json({ 
            hash, 
            timestamp: Date.now(),
            counts: {
                recipients: data.recipient_count,
                presents: data.present_count
            }
        });
    } catch (err) {
        console.error('Error generating data hash:', err);
        res.status(500).json({ error: 'Błąd podczas sprawdzania zmian' });
    }
});

router.post('/api/presents', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { title, recipient_id, comments } = req.body;
    const userId = req.session.userId;

    if (!title || title.trim() === '') {
        return badRequest(res, 'Nazwa prezentu jest wymagana');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate adding present
        const newId = Math.max(...demoData.presents.map(p => p.id)) + 1;
        const newPresent = {
            id: newId,
            title: title.trim(),
            recipient_id: recipient_id || null,
            comments: comments || null,
            is_checked: false,
            reserved_by: null,
            created_by: userId || 1,
            created_at: new Date()
        };
        demoData.presents.push(newPresent);
        console.log('Demo present added:', newPresent);
        res.json({ id: newId, title: title.trim(), recipient_id, comments });
        return;
    }

    try {
        // Snapshot the leaderboard leader before the change (for the
        // "new leader" notification after the insert)
        const prevLeader = await getLeaderboardLeader().catch(() => null);

        const [result] = await pool.execute(
            'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
            [title.trim(), recipient_id || null, comments || null, userId]
        );

        // Invalidate cache when data changes
        cache.invalidatePresents();

        // Leaderboard leader may have changed - notify (non-blocking)
        notifyLeaderboardChange(prevLeader, userId);

        // Get recipient name for notification
        let recipientName = 'kogoś';
        if (recipient_id) {
            try {
                const [recipientRows] = await pool.execute('SELECT name FROM recipients WHERE id = ?', [recipient_id]);
                if (recipientRows.length > 0) {
                    recipientName = recipientRows[0].name;
                }
            } catch (err) {
                console.error('Error getting recipient name:', err);
            }
        }

        // Create in-app notification for other users
        await createNotification('present_added', userId, {
            presentId: result.insertId,
            presentTitle: title.trim(),
            recipientId: recipient_id || null,
            recipientName: recipientName
        });

        // Send push notification to other users (non-blocking, with error handling)
        const notificationTitle = 'Nowy prezent!';
        // Same wording as the activity feed, as plain text
        const notificationBody = notificationText('present_added', {
            presentTitle: title.trim(),
            recipientName: recipient_id ? recipientName : null
        }, req.session.username, { html: false });
        console.log(`📢 [PRESENT] Triggering notification for new present: "${title.trim()}" (ID: ${result.insertId})`);

        // Send notification asynchronously without blocking the response
        sendNotificationToUsers(userId, notificationTitle, notificationBody, {
            presentId: result.insertId,
            presentTitle: title.trim(),
            recipientId: recipient_id || null,
            recipientName: recipientName
        }).catch(err => {
            // Log error but don't fail the present creation
            console.error('❌ [PRESENT] Failed to send notification (present was created successfully):', err);
        });

        // Track update for incremental sync
        updateTracker.addUpdate('present_added', {
            presentId: result.insertId,
            recipientId: recipient_id || null,
            present: {
                id: result.insertId,
                title: title.trim(),
                recipient_id: recipient_id || null,
                comments: comments || null,
                is_checked: false,
                reserved_by: null,
                created_by: userId
            }
        });

        res.json({ id: result.insertId, title: title.trim(), recipient_id, comments });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas dodawania prezentu');
    }
});

router.put('/api/presents/:id/check', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;
    const { is_checked } = req.body;

    console.log('Check present request:', { id, is_checked, userId: req.session.userId });

    if (DEMO_MODE) {
        // Demo mode - simulate checking present
        const present = demoData.presents.find(p => p.id == id);

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        console.log('Present found in demo mode:', present);

        // Update the present in demo data
        present.is_checked = is_checked;

        console.log('Present check status updated successfully in demo mode:', {
            id,
            newStatus: is_checked
        });

        res.json({ success: true });
        return;
    }

    try {
        // First check if the present exists and get its current status
        const [rows] = await pool.execute('SELECT id, is_checked FROM presents WHERE id = ?', [id]);
        const present = rows[0];

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        console.log('Present found:', present);

        // Get present details for notification
        const [presentDetails] = await pool.execute(`
            SELECT p.title, p.recipient_id, r.name as recipient_name
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            WHERE p.id = ?
        `, [id]);

        // Update the present
        const [result] = await pool.execute('UPDATE presents SET is_checked = ? WHERE id = ?', [is_checked ? 1 : 0, id]);

        // Create notification for other users (only if status changed)
        if (present.is_checked !== is_checked && presentDetails.length > 0) {
            const presentData = presentDetails[0];
            const notificationType = is_checked ? 'present_checked' : 'present_unchecked';
            await createNotification(notificationType, req.session.userId, {
                presentId: parseInt(id),
                presentTitle: presentData.title,
                recipientId: presentData.recipient_id,
                recipientName: presentData.recipient_name || 'kogoś'
            });
        }

        console.log('Present check status updated successfully:', {
            id,
            oldStatus: present.is_checked,
            newStatus: is_checked,
            changes: result.affectedRows
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Database error updating present check status:', err);
        return handleDbError(err, res, 'Błąd podczas aktualizacji prezentu');
    }
});

router.put('/api/presents/:id', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;
    const { title, recipient_id, comments } = req.body;

    console.log('[PUT /api/presents/:id] Updating present:', { id, title, recipient_id, comments });

    if (!title || title.trim() === '') {
        return badRequest(res, 'Nazwa prezentu jest wymagana');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate updating present
        const present = demoData.presents.find(p => p.id == id);

        if (!present) {
            return notFound(res, 'Prezent nie został znaleziony');
        }

        // Update the present in demo data
        present.title = title.trim();
        present.recipient_id = recipient_id || null;
        present.comments = comments || null;

        console.log('Present updated successfully in demo mode:', id);
        res.json({ success: true });
        return;
    }

    try {
        console.log('[PUT] Before UPDATE - values:', { title: title.trim(), recipient_id: recipient_id || null, comments: comments || null, id });

        const [result] = await pool.execute(
            'UPDATE presents SET title = ?, recipient_id = ?, comments = ? WHERE id = ?',
            [title.trim(), recipient_id || null, comments || null, id]
        );

        if (result.affectedRows === 0) {
            return notFound(res, 'Prezent nie został znaleziony');
        }

        console.log('[PUT] Present updated successfully:', id, 'with recipient_id:', recipient_id || null);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error updating present:', err);
        return handleDbError(err, res, 'Błąd podczas aktualizacji prezentu');
    }
});

router.delete('/api/presents/:id', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;

    if (DEMO_MODE) {
        // Demo mode - simulate deleting present
        const presentIndex = demoData.presents.findIndex(p => p.id == id);

        if (presentIndex === -1) {
            return notFound(res, 'Prezent nie został znaleziony');
        }

        // Remove the present from demo data
        demoData.presents.splice(presentIndex, 1);
        console.log('Present deleted successfully in demo mode:', id);
        res.json({ success: true });
        return;
    }

    try {
        // Snapshot the leaderboard leader before the change
        const prevLeader = await getLeaderboardLeader().catch(() => null);

        const [result] = await pool.execute('DELETE FROM presents WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return notFound(res, 'Prezent nie został znaleziony');
        }

        // Leaderboard leader may have changed - notify (non-blocking)
        notifyLeaderboardChange(prevLeader, req.session.userId);

        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas usuwania prezentu');
    }
});

// Abandoned presents - nobody manages them anymore. Covers every orphan
// case: creator anonymized (created_by NULL), creator row deleted outright
// (dangling created_by from before anonymization existed), and presents
// whose recipient row is gone (invisible in all lists but still counted
// in stats). Presents for the caller's own recipient are masked so the
// surprise survives, but they can still be deleted.
router.get('/api/presents/abandoned', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ presents: [], summary: { totalPresents: 0 } });
    try {
        const [rows] = await pool.execute(`
            SELECT p.id, p.title, p.recipient_id, p.comments,
                   p.reserved_by, p.is_checked,
                   r.name as recipient_name,
                   r.identified_by as recipient_identified_by,
                   (p.recipient_id IS NOT NULL AND r.id IS NULL) as recipient_missing,
                   (p.created_by IS NULL OR u.id IS NULL) as creator_gone,
                   u.username as creator_username
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            LEFT JOIN users u ON p.created_by = u.id
            WHERE (p.created_by IS NULL OR u.id IS NULL)
               OR p.recipient_id IS NULL
               OR (p.recipient_id IS NOT NULL AND r.id IS NULL)
            ORDER BY r.name, p.id DESC
        `);
        const [[{ totalPresents }]] = await pool.execute('SELECT COUNT(*) as totalPresents FROM presents');
        const userId = req.session.userId;
        const presents = rows.map(p => {
            const isMine = p.recipient_identified_by === userId;
            return {
                id: p.id,
                recipient_id: p.recipient_id,
                recipient_name: p.recipient_missing ? null : p.recipient_name,
                recipient_missing: !!p.recipient_missing,
                creator_gone: !!p.creator_gone,
                creator_username: p.creator_username || null,
                reserved: p.reserved_by != null,
                bought: !!p.is_checked,
                // Spoiler protection: the caller never sees their own gifts
                masked: isMine,
                title: isMine ? 'Prezent-niespodzianka 🎁' : p.title,
                comments: isMine ? null : p.comments
            };
        });
        res.json({ presents, summary: { totalPresents } });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania porzuconych prezentów');
    }
});

// Reserve present
router.post('/api/presents/:id/reserve', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;
    const userId = req.session.userId;

    console.log('Reserve present request:', { id, userId });

    if (DEMO_MODE) {
        // Demo mode - simulate reservation
        const present = demoData.presents.find(p => p.id == id);

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        if (present.reserved_by) {
            console.log('Present already reserved by user:', present.reserved_by);
            return conflict(res, 'Prezent jest już zarezerwowany');
        }

        // Reserve the present in demo data
        present.reserved_by = userId;
        console.log('Present reserved successfully in demo mode:', { id, userId });
        res.json({ success: true });
        return;
    }

    try {
        // First check if the present exists and is not already reserved
        const [rows] = await pool.execute('SELECT id, reserved_by FROM presents WHERE id = ?', [id]);
        const present = rows[0];

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        if (present.reserved_by) {
            console.log('Present already reserved by user:', present.reserved_by);
            return conflict(res, 'Prezent jest już zarezerwowany');
        }

        // Get present details for notification
        const [presentDetails] = await pool.execute(`
            SELECT p.title, p.recipient_id, r.name as recipient_name
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            WHERE p.id = ?
        `, [id]);

        // Reserve the present
        const [result] = await pool.execute('UPDATE presents SET reserved_by = ? WHERE id = ?', [userId, id]);

        // Create notification for other users
        if (presentDetails.length > 0) {
            const present = presentDetails[0];
            await createNotification('present_reserved', userId, {
                presentId: parseInt(id),
                presentTitle: present.title,
                recipientId: present.recipient_id,
                recipientName: present.recipient_name || 'kogoś'
            });
        }

        // Track update for incremental sync
        updateTracker.addUpdate('present_reserved', {
            presentId: parseInt(id),
            recipientId: presentDetails[0]?.recipient_id,
            username: req.session.username
        });

        console.log('Present reserved successfully:', { id, userId, changes: result.affectedRows });
        res.json({ success: true });
    } catch (err) {
        console.error('Database error reserving present:', err);
        return handleDbError(err, res, 'Błąd podczas rezerwacji prezentu');
    }
});

// Registered later than the rest of this router, at the position these routes have always had
// in the request pipeline (see server.js), so the registered route order is unchanged.
const lateRouter = express.Router();

// Create notification for relevant users
// Cancel reservation
lateRouter.delete('/api/presents/:id/reserve', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;
    const userId = req.session.userId;

    console.log('Cancel reservation request:', { id, userId });

    if (DEMO_MODE) {
        // Demo mode - simulate cancel reservation
        const present = demoData.presents.find(p => p.id == id);

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        if (!present.reserved_by) {
            console.log('Present is not reserved');
            return conflict(res, 'Prezent nie jest zarezerwowany');
        }

        if (present.reserved_by !== userId) {
            console.log('Present reserved by different user:', present.reserved_by);
            return forbidden(res, 'Nie możesz anulować rezerwacji innej osoby');
        }

        // Cancel the reservation in demo data
        present.reserved_by = null;
        console.log('Reservation canceled successfully in demo mode:', { id, userId });
        res.json({ success: true });
        return;
    }

    try {
        // First check if the present exists and is reserved by this user
        const [rows] = await pool.execute('SELECT id, reserved_by FROM presents WHERE id = ?', [id]);
        const present = rows[0];

        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }

        if (!present.reserved_by) {
            console.log('Present is not reserved');
            return conflict(res, 'Prezent nie jest zarezerwowany');
        }

        if (present.reserved_by !== userId) {
            console.log('Present reserved by different user:', present.reserved_by);
            return forbidden(res, 'Nie możesz anulować rezerwacji innej osoby');
        }

        // Get present details for notification
        const [presentDetails] = await pool.execute(`
            SELECT p.title, p.recipient_id, r.name as recipient_name
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            WHERE p.id = ?
        `, [id]);

        // Cancel the reservation
        const [result] = await pool.execute('UPDATE presents SET reserved_by = ? WHERE id = ?', [null, id]);

        // Create notification for other users
        if (presentDetails.length > 0) {
            const present = presentDetails[0];
            await createNotification('present_unreserved', userId, {
                presentId: parseInt(id),
                presentTitle: present.title,
                recipientId: present.recipient_id,
                recipientName: present.recipient_name || 'kogoś'
            });
        }

        console.log('Reservation canceled successfully:', { id, userId, changes: result.affectedRows });
        res.json({ success: true });
    } catch (err) {
        console.error('Database error canceling reservation:', err);
        return handleDbError(err, res, 'Błąd podczas anulowania rezerwacji');
    }
});

module.exports = { router, lateRouter };
