// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, notFound, forbidden, conflict, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { clearCombinedDataCache } = require('../lib/cache');
const { getUserIdentification, getRecipientById } = require('../lib/queries');
const { withPresence } = require('../lib/presence');
const { createNotification } = require('../lib/notifications');
const { demoData } = require('../lib/demo-data');

// Configure multer for file uploads (store in memory for database storage)
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit for compressed images
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Tylko pliki obrazów są dozwolone'), false);
        }
    }
});

// Recipients API
router.get('/api/recipients', requireAuth, async (req, res) => {
    console.log('Getting recipients for user:', req.session.userId);

    if (DEMO_MODE) {
        // Demo mode - return demo data
        const recipients = demoData.recipients.map(recipient => ({
            ...recipient,
            identified_by_username: recipient.identified_by ? 'demo' : null
        }));
        console.log('Demo recipients loaded:', recipients.length, 'recipients');
        res.json(recipients);
        return;
    }

    try {
        const [rows] = await pool.execute(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            ORDER BY r.name
        `);

        // Add profile picture URLs for recipients that have them
        const recipients = rows.map(recipient => {
            if (recipient.profile_picture) {
                recipient.profile_picture = `/api/recipients/${recipient.id}/profile-picture`;
            }
            return recipient;
        });

        console.log('Recipients loaded successfully:', recipients.length, 'recipients');
        res.json(withPresence(recipients));
    } catch (err) {
        console.error('Database error getting recipients:', err);
        return handleDbError(err, res, 'Błąd podczas pobierania osób');
    }
});

router.post('/api/recipients', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { name } = req.body;

    console.log('[POST /api/recipients] Incoming request:', { body: req.body, userId: req.session && req.session.userId });

    if (!name || name.trim() === '') {
        console.log('[POST /api/recipients] Validation failed: empty name');
        return badRequest(res, 'Nazwa jest wymagana');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate adding recipient
        const newId = Math.max(...demoData.recipients.map(r => r.id)) + 1;
        const newRecipient = { id: newId, name: name.trim(), identified_by: null, profile_picture: null };
        demoData.recipients.push(newRecipient);
        console.log('[POST /api/recipients] Demo recipient added:', newRecipient);
        res.json({ success: true, recipient: { id: newId, name: name.trim() } });
        return;
    }

    try {
        const [result] = await pool.execute('INSERT INTO recipients (name) VALUES (?)', [name.trim()]);
        console.log('[POST /api/recipients] Recipient added successfully:', result.insertId, 'Request body:', req.body, 'User ID:', req.session && req.session.userId);

        // Create notification for other users
        await createNotification('recipient_added', req.session.userId, {
            recipientId: result.insertId,
            recipientName: name.trim()
        });

        // Return the expected structure for frontend
        res.json({ success: true, recipient: { id: result.insertId, name: name.trim() } });
    } catch (err) {
        console.error('[POST /api/recipients] Database error adding recipient:', err, 'Request body:', req.body, 'User ID:', req.session && req.session.userId);
        if (err.code === 'ER_DUP_ENTRY') {
            return conflict(res, 'Taka osoba już istnieje!');
        }
        return handleDbError(err, res, 'Błąd podczas dodawania osoby');
    }
});

// User identification API
router.post('/api/recipients/:id/identify', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { id } = req.params;
    const userId = req.session.userId;

    if (DEMO_MODE) {
        // Demo mode - simulate identification
        console.log('Demo mode identification:', { id, userId, demoData: demoData.recipients });
        const recipient = demoData.recipients.find(r => r.id == id);

        if (!recipient) {
            console.log('Recipient not found in demo data:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }

        console.log('Found recipient for identification:', recipient);

        if (recipient.identified_by && recipient.identified_by !== userId) {
            console.log('Recipient already identified by another user:', { currentlyIdentifiedBy: recipient.identified_by, requestingUserId: userId });
            return conflict(res, 'Ta osoba została już zidentyfikowana przez innego użytkownika');
        }

        // Update demo data
        recipient.identified_by = userId;
        console.log('Updated recipient identification:', recipient);
        res.json({ success: true });
        return;
    }

    try {
        // Check if recipient is already identified
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];

        if (!recipient) {
            return notFound(res, 'Osoba nie została znaleziona');
        }

        if (recipient.identified_by && recipient.identified_by !== userId) {
            return conflict(res, 'Ta osoba została już zidentyfikowana przez innego użytkownika');
        }

        // Update identification
        await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [userId, id]);
        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas identyfikacji');
    }
});

// Check if user is identified
router.get('/api/user/identification', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (DEMO_MODE) {
        // Demo mode - return demo identification status
        res.json({
            isIdentified: false,
            identifiedRecipient: null,
            username: username || 'demo',
            userId: userId || 1,
            name: null
        });
        return;
    }

    try {
        const recipient = await getUserIdentification(userId);
        const isIdentified = !!recipient;
        res.json({
            isIdentified: isIdentified,
            identifiedRecipient: recipient,
            username: username,
            userId: userId,
            name: recipient ? recipient.name : null
        });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas sprawdzania statusu identyfikacji');
    }
});

// Cancel self-identification API
router.delete('/api/recipients/:id/identify', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    console.log('Cancel identification request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;
    const userId = req.session.userId;

    if (DEMO_MODE) {
        // Demo mode - simulate cancel identification
        console.log('Demo mode cancel identification:', { id, userId, demoData: demoData.recipients });
        const recipient = demoData.recipients.find(r => r.id == id);

        if (!recipient) {
            console.log('Recipient not found:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }

        console.log('Found recipient:', recipient);
        console.log('Checking authorization:', { recipientIdentifiedBy: recipient.identified_by, userId, match: recipient.identified_by === userId });

        if (recipient.identified_by !== userId) {
            console.log('User not authorized to cancel identification');
            return forbidden(res, 'Nie możesz anulować identyfikacji innej osoby');
        }

        // Remove identification from demo data
        recipient.identified_by = null;
        console.log('Identification canceled successfully for recipient:', id);
        res.json({ success: true });
        return;
    }

    try {
        // Check if user is identified as this recipient
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];

        if (!recipient) {
            console.log('Recipient not found:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }

        console.log('Recipient found:', { id, identified_by: recipient.identified_by, userId });

        if (recipient.identified_by !== userId) {
            console.log('User not authorized to cancel identification');
            return forbidden(res, 'Nie możesz anulować identyfikacji innej osoby');
        }

        // Remove identification
        await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [null, id]);
        console.log('Identification canceled successfully for recipient:', id);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error canceling identification:', err);
        return handleDbError(err, res, 'Błąd podczas anulowania identyfikacji');
    }
});

router.delete('/api/recipients/:id', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    console.log('Delete recipient request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;

    if (DEMO_MODE) {
        // Demo mode - simulate deleting recipient
        const recipientIndex = demoData.recipients.findIndex(r => r.id == id);

        if (recipientIndex === -1) {
            console.log('Recipient not found for deletion:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }

        // Remove the recipient from demo data
        demoData.recipients.splice(recipientIndex, 1);

        // Also remove any presents for this recipient
        demoData.presents = demoData.presents.filter(p => p.recipient_id != id);

        console.log('Recipient deleted successfully in demo mode:', id);
        res.json({ success: true });
        return;
    }

    try {
        const [result] = await pool.execute('DELETE FROM recipients WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            console.log('Recipient not found for deletion:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }

        console.log('Recipient deleted successfully:', id);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error deleting recipient:', err);
        return handleDbError(err, res, 'Błąd podczas usuwania osoby');
    }
});

// Helper function to handle base64 image upload
async function handleBase64Upload(id, userId, base64Data, res) {
    try {
        if (DEMO_MODE) {
            const recipient = demoData.recipients.find(r => r.id == id);
            if (!recipient) {
                notFound(res, 'Osoba nie została znaleziona');
                return;
            }
            if (recipient.identified_by && recipient.identified_by !== userId) {
                forbidden(res, 'Nie masz uprawnień do edycji tego profilu');
                return;
            }
            recipient.profile_picture = `demo-image-${id}.jpg`;
            console.log('Profile picture updated successfully in demo mode for recipient:', id);
            res.json({ success: true, profile_picture: `/api/recipients/${id}/profile-picture` });
            return;
        }

        // Check authorization
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];

        if (!recipient) {
            notFound(res, 'Osoba nie została znaleziona');
            return;
        }

        if (recipient.identified_by && recipient.identified_by !== userId) {
            forbidden(res, 'Nie masz uprawnień do edycji tego profilu');
            return;
        }

        // Convert base64 to buffer
        let imageBuffer;
        let mimeType = 'image/jpeg'; // default

        if (base64Data.startsWith('data:')) {
            // Extract mime type and base64 data
            const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                mimeType = matches[1];
                imageBuffer = Buffer.from(matches[2], 'base64');
            } else {
                badRequest(res, 'Nieprawidłowy format danych obrazu');
                return;
            }
        } else {
            // Assume it's a URL
            imageBuffer = null; // We'll store URL as string
        }

        if (imageBuffer) {
            // Store compressed image in database
            await pool.execute('UPDATE recipients SET profile_picture = ?, profile_picture_type = ? WHERE id = ?',
                [imageBuffer, mimeType, id]);
            console.log('Profile picture updated successfully (base64) for recipient:', id);
        } else {
            // Store URL as string
            await pool.execute('UPDATE recipients SET profile_picture = ?, profile_picture_type = ? WHERE id = ?',
                [base64Data, 'url', id]);
            console.log('Profile picture updated successfully (URL) for recipient:', id);
        }

        res.json({ success: true, profile_picture: `/api/recipients/${id}/profile-picture` });
    } catch (err) {
        console.error('Error handling base64 upload:', err);
        handleDbError(err, res, 'Błąd podczas aktualizacji zdjęcia profilowego');
    }
}

router.post('/api/recipients/:id/profile-picture', requireAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;

    console.log('Profile picture upload request:', {
        id,
        userId,
        contentType: req.headers['content-type'],
        hasBody: !!req.body,
        hasProfilePicture: !!req.body?.profile_picture,
        bodyKeys: req.body ? Object.keys(req.body) : []
    });

    // Check if this is a JSON request with base64 data
    if (req.headers['content-type']?.includes('application/json') && req.body.profile_picture) {
        console.log('Handling as JSON/base64 upload');

        handleBase64Upload(id, userId, req.body.profile_picture, res);
        return;
    }

    console.log('Handling as FormData/multer upload');

    // Handle multer upload with custom error handling
    upload.single('profile_picture')(req, res, async (err) => {
        console.log('Profile picture upload request (FormData):', { id, userId, hasFile: !!req.file, error: err?.message });

        if (err) {
            console.error('Multer error:', err);
            return res.status(400).json({ error: err.message });
        }

        // Check if file was uploaded
        if (!req.file) {
            console.log('No file uploaded');
            return badRequest(res, 'Brak pliku zdjęcia');
        }

        console.log('File uploaded:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        });

        if (DEMO_MODE) {
            // Demo mode - simulate profile picture upload
            console.log('Demo mode: simulating profile picture upload');
            const recipient = demoData.recipients.find(r => r.id == id);

            if (!recipient) {
                console.log('Recipient not found in demo data:', id);
                return notFound(res, 'Osoba nie została znaleziona');
            }

            if (recipient.identified_by && recipient.identified_by !== userId) {
                console.log('User not authorized to edit profile:', { recipientIdentifiedBy: recipient.identified_by, userId });
                return forbidden(res, 'Nie masz uprawnień do edycji tego profilu');
            }

            // In demo mode, just set a placeholder URL
            recipient.profile_picture = `demo-image-${id}.jpg`;

            console.log('Profile picture updated successfully in demo mode for recipient:', id);
            res.json({ success: true, profile_picture: `/api/recipients/${id}/profile-picture` });
            return;
        }

        try {
            // Allow editing if not identified or identified by this user
            const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
            const recipient = rows[0];

            if (!recipient) {
                return notFound(res, 'Osoba nie została znaleziona');
            }

            if (recipient.identified_by && recipient.identified_by !== userId) {
                return forbidden(res, 'Nie masz uprawnień do edycji tego profilu');
            }

            // Compress image using sharp
            console.log('Compressing image with sharp...');
            console.log('Original size:', req.file.size, 'bytes');

            const compressedBuffer = await sharp(req.file.buffer)
                .resize(800, 800, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({ quality: 80 })
                .toBuffer();

            console.log('Compressed size:', compressedBuffer.length, 'bytes');
            console.log('Compression ratio:', ((1 - compressedBuffer.length / req.file.size) * 100).toFixed(2) + '%');

            // Store compressed image data and type in database
            await pool.execute('UPDATE recipients SET profile_picture = ?, profile_picture_type = ? WHERE id = ?',
                [compressedBuffer, 'image/jpeg', id]);

            console.log('Profile picture updated successfully for recipient:', id);
            res.json({ success: true, profile_picture: `/api/recipients/${id}/profile-picture` });
        } catch (err) {
            console.error('Database error updating profile picture:', err);
            return handleDbError(err, res, 'Błąd podczas aktualizacji zdjęcia profilowego');
        }
    });
});

// Serve profile picture from database
router.get('/api/recipients/:id/profile-picture', async (req, res) => {
    const { id } = req.params;

    if (DEMO_MODE) {
        // Demo mode - serve placeholder image
        const recipient = demoData.recipients.find(r => r.id == id);

        if (!recipient || !recipient.profile_picture) {
            return res.status(404).send('Profile picture not found');
        }

        // In demo mode, redirect to a placeholder image service
        res.redirect(`https://via.placeholder.com/200x200/4CAF50/FFFFFF?text=${encodeURIComponent(recipient.name.charAt(0))}`);
        return;
    }

    try {
        const [rows] = await pool.execute('SELECT profile_picture, profile_picture_type FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];

        if (!recipient || !recipient.profile_picture) {
            return res.status(404).send('Profile picture not found');
        }

        // If it's a URL, redirect to it
        if (recipient.profile_picture_type === 'url') {
            return res.redirect(recipient.profile_picture);
        }

        // Set proper cache headers for images (cache for 1 hour)
        res.set('Content-Type', recipient.profile_picture_type);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(recipient.profile_picture);
    } catch (err) {
        console.error('Error serving profile picture:', err);
        res.status(500).send('Error serving profile picture');
    }
});

// Get recipient with identification info
router.get('/api/recipients/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const recipient = await getRecipientById(id);
        if (!recipient) {
            return notFound(res, 'Osoba nie została znaleziona');
        }

        // Add profile picture URL if exists
        if (recipient.profile_picture) {
            recipient.profile_picture = `/api/recipients/${id}/profile-picture`;
        }

        res.json(recipient);
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania osoby');
    }
});

// Registered later than the rest of this router, at the position these routes have always had
// in the request pipeline (see server.js), so the registered route order is unchanged.
const lateRouter = express.Router();

// Add new recipient and identify user
lateRouter.post('/api/user/identify', requireAuth, async (req, res) => {
    const { name } = req.body;
    const userId = req.session.userId;

    console.log('[POST /api/user/identify] Incoming request:', { body: req.body, userId: req.session && req.session.userId });

    if (!name || name.trim() === '') {
        console.log('[POST /api/user/identify] Validation failed: empty name');
        return badRequest(res, 'Imię jest wymagane');
    }

    try {
        // Check if user is already identified
        const [existingRows] = await pool.execute('SELECT r.* FROM recipients r WHERE r.identified_by = ?', [userId]);
        const existingRecipient = existingRows[0];

        if (existingRecipient) {
            console.log('[POST /api/user/identify] User already identified as:', existingRecipient);
            return conflict(res, 'Twoje konto jest już powiązane z: ' + existingRecipient.name);
        }

        // Check if recipient with this name already exists
        const [recipientRows] = await pool.execute('SELECT * FROM recipients WHERE name = ?', [name.trim()]);
        const recipient = recipientRows[0];

        if (recipient) {
            // Check if this recipient is already identified by someone else
            if (recipient.identified_by && recipient.identified_by !== userId) {
                console.log('[POST /api/user/identify] Recipient already identified by another user:', recipient);
                return conflict(res, 'Ta osoba została już zidentyfikowana przez innego użytkownika');
            }

            // Update existing recipient to identify this user
            await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [userId, recipient.id]);
            console.log('[POST /api/user/identify] Recipient identification updated:', { recipientId: recipient.id, userId });
            res.json({
                success: true,
                recipient: {
                    id: recipient.id,
                    name: recipient.name
                }
            });
        } else {
            // Create new recipient and identify user
            const [result] = await pool.execute('INSERT INTO recipients (name, identified_by) VALUES (?, ?)', [name.trim(), userId]);
            console.log('[POST /api/user/identify] New recipient created and identified:', { id: result.insertId, name: name.trim(), userId });
            res.json({
                success: true,
                recipient: {
                    id: result.insertId,
                    name: name.trim()
                }
            });
        }
    } catch (err) {
        console.error('[POST /api/user/identify] Database error:', err, 'User ID:', req.session && req.session.userId);
        return handleDbError(err, res, 'Błąd podczas identyfikacji');
    }
});

module.exports = { router, lateRouter };
