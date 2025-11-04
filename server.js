const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const mysql = require('mysql2/promise');
const MySQLStore = require('express-mysql-session')(session);
const cron = require('cron');
const https = require('https');
const sharp = require('sharp');
// const webpush = require('web-push'); // Now enabled below

// Load .env file in development, but not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Configure web-push with environment variables (fallback to development keys)
let webpush = null;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa40HI80YmqRcU_d2qcWAh2U5cp7C6_8AT7pRxVxIiNuSOhapA_GTfXRqXWkOU';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'VCz-z9nV_HuHhVCjlHRlSjSWAqS3-T_CKPiuIXSBBtU';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:prezenty@example.com';

// Log VAPID configuration source
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    console.log('🔑 [VAPID] Using VAPID keys from environment variables');
} else {
    console.log('🔑 [VAPID] Using fallback development VAPID keys (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars for production)');
}

try {
    webpush = require('web-push');
    webpush.setVapidDetails(
        VAPID_EMAIL,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    console.log('✅ [VAPID] Web-push module loaded and configured successfully');
} catch (error) {
    console.log('⚠️ [VAPID] Web-push module not available:', error.message);
    console.log('📝 [VAPID] To enable notifications: npm install web-push');
    webpush = null;
}

// Demo mode - run without database for preview
let DEMO_MODE = process.env.DEMO_MODE === 'true' ||
    process.env.OFFLINE_MODE === 'true' ||
    !process.env.DB_PASSWORD ||
    (process.env.NODE_ENV === 'development' && !process.env.DB_PASSWORD);

// MySQL database configuration
let dbConfig;
let pool;

if (!DEMO_MODE) {
    // Always use individual environment variables for better control
    dbConfig = {
        host: process.env.DB_HOST || '153.92.7.101',
        user: process.env.DB_USER || 'u662139794_mati',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'u662139794_prezenty',
        port: parseInt(process.env.DB_PORT) || 3306,
        charset: 'utf8mb4',
        connectTimeout: 60000,
        acquireTimeout: 60000,
        timeout: 60000
    };

    // Debug database configuration
    console.log('Database configuration:', {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database,
        port: dbConfig.port,
        hasPassword: !!dbConfig.password
    });

    // Create MySQL connection pool
    pool = mysql.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port,
        charset: dbConfig.charset,
        connectTimeout: dbConfig.connectTimeout,
        acquireTimeout: dbConfig.acquireTimeout,
        timeout: dbConfig.timeout,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        maxAllowedPacket: 50 * 1024 * 1024 // 50MB for large images
    });
}

// Helper functions to reduce code duplication
const handleDbError = (err, res, message = 'Błąd serwera') => {
    console.error('Database error:', err);
    res.status(500).json({ error: message });
};

const notFound = (res, message = 'Nie znaleziono') => {
    res.status(404).json({ error: message });
};

const forbidden = (res, message = 'Brak uprawnień') => {
    res.status(403).json({ error: message });
};

const conflict = (res, message = 'Konflikt') => {
    res.status(409).json({ error: message });
};

const badRequest = (res, message = 'Nieprawidłowe dane') => {
    res.status(400).json({ error: message });
};

// Helper to get user identification status
const getUserIdentification = async (userId) => {
    try {
        const [rows] = await pool.execute('SELECT r.* FROM recipients r WHERE r.identified_by = ?', [userId]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get recipient by ID
const getRecipientById = async (id) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            WHERE r.id = ?
        `, [id]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Notification helper functions
async function ensureNotificationsTable() {
    if (DEMO_MODE) return;

    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type ENUM('recipient_added', 'present_added', 'present_reserved', 
                          'present_unreserved', 'present_checked', 'present_unchecked') NOT NULL,
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
        console.log('✅ [NOTIFICATIONS] Notifications table ready');
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error creating notifications table:', err);
    }
}

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

// Simple in-memory cache for database queries
const cache = {
    data: new Map(),
    timestamps: new Map(),
    TTL: 10000, // 10 seconds

    get(key) {
        const timestamp = this.timestamps.get(key);
        if (timestamp && (Date.now() - timestamp) < this.TTL) {
            return this.data.get(key);
        }
        this.data.delete(key);
        this.timestamps.delete(key);
        return null;
    },

    set(key, value) {
        this.data.set(key, value);
        this.timestamps.set(key, Date.now());
    },

    clear() {
        this.data.clear();
        this.timestamps.clear();
    },

    invalidatePresents() {
        this.data.delete('all_presents');
        this.data.delete('recipients_with_presents');
        this.timestamps.delete('all_presents');
        this.timestamps.delete('recipients_with_presents');
    },

    invalidateRecipients() {
        this.data.delete('all_recipients');
        this.data.delete('recipients_with_presents');
        this.timestamps.delete('all_recipients');
        this.timestamps.delete('recipients_with_presents');
    }
};

// Update tracking system for incremental updates
const updateTracker = {
    updates: [],
    maxUpdates: 100, // Keep last 100 updates

    addUpdate(type, data) {
        const update = {
            type,
            data,
            timestamp: Date.now()
        };

        this.updates.push(update);

        // Keep only recent updates
        if (this.updates.length > this.maxUpdates) {
            this.updates = this.updates.slice(-this.maxUpdates);
        }

        console.log(`[UpdateTracker] Added update: ${type}`, data);
    },

    getUpdatesSince(timestamp) {
        const since = parseInt(timestamp) || 0;
        return this.updates.filter(update => update.timestamp > since);
    },

    clear() {
        this.updates = [];
    }
};

// Helper to get all presents with recipient and user info
const getAllPresents = async () => {
    const cacheKey = 'all_presents';
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log('Using cached presents data');
        return cached;
    }

    try {
        const [rows] = await pool.execute(`
            SELECT p.id, p.title, p.recipient_id, p.comments, p.is_checked, p.reserved_by, p.created_by, p.created_at,
                   r.name as recipient_name, u.username as reserved_by_username
            FROM presents p 
            LEFT JOIN recipients r ON p.recipient_id = r.id 
            LEFT JOIN users u ON p.reserved_by = u.id
            ORDER BY p.id DESC
        `);

        cache.set(cacheKey, rows);
        return rows;
    } catch (err) {
        throw err;
    }
};

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

// Enable compression for faster responses
const compression = require('compression');
app.use(compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    level: 6 // Balance between speed and compression ratio
}));

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files with cache control
// For HTML files: no cache (always fetch latest)
// For assets (CSS, JS, images): cache but revalidate
app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            // HTML files should never be cached
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (path.endsWith('.css') || path.endsWith('.js')) {
            // CSS and JS files should revalidate
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else {
            // Other assets (images, fonts, etc.) can be cached for a short time
            res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
        }
    }
}));

// Create session store
let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'prezenty_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
};

if (!DEMO_MODE && dbConfig) {
    const sessionStore = new MySQLStore(dbConfig);
    sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

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



// Authentication middleware
function requireAuth(req, res, next) {
    console.log('Auth check - session:', { userId: req.session.userId, username: req.session.username });
    if (req.session.userId) {
        console.log('Auth successful for user:', req.session.username);
        next();
    } else {
        console.log('Auth failed: no session');
        res.status(401).json({ error: 'Wymagana autoryzacja' });
    }
}

// Routes
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        mode: DEMO_MODE ? 'DEMO' : 'PRODUCTION',
        database: DEMO_MODE ? 'disabled' : 'enabled'
    });
});

// Version endpoint for cache busting
app.get('/api/version', (req, res) => {
    const packageJson = require('./package.json');
    res.json({
        version: packageJson.version,
        timestamp: Date.now(),
        cacheVersion: 'v8'
    });
});

// Incremental updates endpoint
app.get('/api/updates', requireAuth, (req, res) => {
    const since = req.query.since || 0;
    const updates = updateTracker.getUpdatesSince(since);

    res.json({
        hasUpdates: updates.length > 0,
        updates: updates,
        timestamp: Date.now()
    });
});

app.get('/', (req, res) => {
    // If user is authenticated, redirect to recipients page
    if (req.session.userId) {
        res.redirect('/recipients');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.get('/recipients', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'recipients.html'));
    }
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/formularz', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'formularz.html'));
});

app.get('/activity', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'activity.html'));
    }
});

// API Routes

// Login
app.post('/api/login', async (req, res) => {
    console.log('Login request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;

    if (DEMO_MODE) {
        // Demo mode - accept any login
        if (username && password) {
            console.log('Demo login successful for user:', username);
            req.session.userId = 1;
            req.session.username = username;
            res.json({ success: true, user: { id: 1, username: username } });
        } else {
            return res.status(401).json({ error: 'Wprowadź nazwę użytkownika i hasło' });
        }
        return;
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user || !bcrypt.compareSync(password, user.password)) {
            console.log('Login failed: invalid credentials for user:', username);
            return res.status(401).json({ error: 'Nieprawidłowa nazwa użytkownika lub hasło' });
        }

        console.log('Login successful for user:', username);
        req.session.userId = user.id;
        req.session.username = user.username;

        console.log('Session created:', { userId: req.session.userId, username: req.session.username });

        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('Database error during login:', err);
        return handleDbError(err, res, 'Błąd serwera');
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/api/auth', (req, res) => {
    console.log('Auth check - session:', { userId: req.session.userId, username: req.session.username });
    if (req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        res.json({ authenticated: false });
    }
});

// Recipients API
app.get('/api/recipients', requireAuth, async (req, res) => {
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
        res.json(recipients);
    } catch (err) {
        console.error('Database error getting recipients:', err);
        return handleDbError(err, res, 'Błąd podczas pobierania osób');
    }
});

app.post('/api/recipients', requireAuth, async (req, res) => {
    clearCombinedDataCache();
    const { name } = req.body;

    console.log('[POST /api/recipients] Incoming request:', { body: req.body, session: req.session });

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
        console.log('[POST /api/recipients] Recipient added successfully:', result.insertId, 'Request body:', req.body, 'Session:', req.session);

        // Create notification for other users
        await createNotification('recipient_added', req.session.userId, {
            recipientId: result.insertId,
            recipientName: name.trim()
        });

        // Return the expected structure for frontend
        res.json({ success: true, recipient: { id: result.insertId, name: name.trim() } });
    } catch (err) {
        console.error('[POST /api/recipients] Database error adding recipient:', err, 'Request body:', req.body, 'Session:', req.session);
        if (err.code === 'ER_DUP_ENTRY') {
            return conflict(res, 'Taka osoba já istnieje!');
        }
        return handleDbError(err, res, 'Błąd podczas dodawania osoby');
    }
});

// User identification API
app.post('/api/recipients/:id/identify', requireAuth, async (req, res) => {
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
app.get('/api/user/identification', requireAuth, async (req, res) => {
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
app.delete('/api/recipients/:id/identify', requireAuth, async (req, res) => {
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

app.delete('/api/recipients/:id', requireAuth, async (req, res) => {
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

app.post('/api/recipients/:id/profile-picture', requireAuth, (req, res) => {
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
app.get('/api/recipients/:id/profile-picture', async (req, res) => {
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
app.get('/api/recipients/:id', requireAuth, async (req, res) => {
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

// Presents API
app.get('/api/presents', requireAuth, async (req, res) => {
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
app.get('/api/presents/all', requireAuth, async (req, res) => {
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

// Combined endpoint for recipients and presents (optimized with caching)
const combinedDataCache = new Map();
const COMBINED_CACHE_TTL = 30000; // 30 seconds cache

// Helper function to clear combined data cache
function clearCombinedDataCache() {
    combinedDataCache.clear();
    console.log('[Cache] Combined data cache cleared');
}

app.get('/api/recipients-with-presents', requireAuth, async (req, res) => {
    console.log('Getting recipients with presents for user:', req.session.userId);

    // Check cache first
    const cacheKey = 'combined-data';
    const cached = combinedDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < COMBINED_CACHE_TTL) {
        console.log('Returning cached combined data');
        return res.json(cached.data);
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

        res.json(result);
    } catch (err) {
        console.error('Database error getting combined data:', err);
        handleDbError(err, res, 'Błąd podczas pobierania danych');
    }
});

// Get data hash for change detection
app.get('/api/recipients-hash', requireAuth, async (req, res) => {
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

app.post('/api/presents', requireAuth, async (req, res) => {
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
        const [result] = await pool.execute(
            'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
            [title.trim(), recipient_id || null, comments || null, userId]
        );

        // Invalidate cache when data changes
        cache.invalidatePresents();

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
        const notificationBody = `Dodano nowy prezent "${title.trim()}" dla ${recipientName}`;
        console.log(`📢 [PRESENT] Triggering notification for new present: "${title.trim()}" (ID: ${result.insertId})`);

        // Send notification asynchronously without blocking the response
        sendNotificationToUsers(userId, notificationTitle, notificationBody, {
            presentId: result.insertId,
            presentTitle: title.trim(),
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

app.put('/api/presents/:id/check', requireAuth, async (req, res) => {
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

app.put('/api/presents/:id', requireAuth, async (req, res) => {
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

app.delete('/api/presents/:id', requireAuth, async (req, res) => {
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
        const [result] = await pool.execute('DELETE FROM presents WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return notFound(res, 'Prezent nie został znaleziony');
        }

        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas usuwania prezentu');
    }
});

// Reserve present
app.post('/api/presents/:id/reserve', requireAuth, async (req, res) => {
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

// Notification subscription endpoint
app.post('/api/notifications/subscribe', requireAuth, async (req, res) => {
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
        console.log('Demo mode - notification subscription saved:', { userId, subscription });
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
            endpoint: subscription.endpoint.substring(0, 50) + '...',
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
app.get('/api/vapid-public-key', (req, res) => {
    res.json({
        publicKey: VAPID_PUBLIC_KEY,
        webPushAvailable: !!webpush
    });
});

// Debug endpoint for notification system
app.get('/api/notifications/debug', requireAuth, async (req, res) => {
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

// Notification Center API Endpoints

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

// Mark all notifications as read
app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        console.log(`✓✓ [NOTIFICATIONS] Marking all notifications as read for user ${userId}`);

        if (DEMO_MODE) {
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
app.post('/api/test-notification', requireAuth, async (req, res) => {
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
app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const limit = parseInt(req.query.limit) || 5;
        const offset = parseInt(req.query.offset) || 0;

        console.log(`📬 [NOTIFICATIONS] Fetching notifications for user ${userId} (limit: ${limit}, offset: ${offset})`);

        if (DEMO_MODE) {
            return res.json({ notifications: [], unreadCount: 0, hasMore: false });
        }

        await ensureNotificationsTable();

        // Check if user is identified as a recipient
        const identifiedRecipient = await getUserIdentification(userId);
        const identifiedRecipientId = identifiedRecipient ? identifiedRecipient.id : null;

        // Get notifications with actor username
        const [notifications] = await pool.execute(`
            SELECT n.*, u.username as actor_username
            FROM notifications n
            LEFT JOIN users u ON n.actor_id = u.id
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
        console.log(`📊 [NOTIFICATIONS] User ${userId} has ${count} unread notification(s)`);

        res.json({ count: count });
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error getting unread count:', err);
        handleDbError(err, res, 'Błąd podczas pobierania liczby powiadomień');
    }
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const notificationId = req.params.id;

        console.log(`✓ [NOTIFICATIONS] Marking notification ${notificationId} as read for user ${userId}`);

        if (DEMO_MODE) {
            return res.json({ success: true, unreadCount: 0 });
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

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;

        console.log(`✓✓ [NOTIFICATIONS] Marking all notifications as read for user ${userId}`);

        if (DEMO_MODE) {
            return res.json({ success: true });
        }

        await ensureNotificationsTable();

        await pool.execute(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        console.log(`✅ [NOTIFICATIONS] All notifications marked as read for user ${userId}`);

        res.json({ success: true });
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error marking all as read:', err);
        handleDbError(err, res, 'Błąd podczas oznaczania wszystkich powiadomień');
    }
});

// Leaderboard API - Get most active users
app.get('/api/leaderboard', async (req, res) => {
    try {
        console.log('📊 [LEADERBOARD] Fetching most active users');

        if (DEMO_MODE) {
            return res.json({ users: [] });
        }

        // Get users with their present count, ordered by activity
        const [users] = await pool.execute(`
            SELECT 
                u.id,
                u.username,
                r.id as recipient_id,
                CASE WHEN r.profile_picture IS NOT NULL 
                    THEN CONCAT('/api/recipients/', r.id, '/profile-picture')
                    ELSE NULL 
                END as profile_picture,
                COUNT(DISTINCT p.id) as total_presents
            FROM users u
            LEFT JOIN presents p ON p.created_by = u.id
            LEFT JOIN recipients r ON r.name = u.username
            GROUP BY u.id, u.username, r.id, r.profile_picture
            HAVING total_presents > 0
            ORDER BY total_presents DESC
            LIMIT 10
        `);

        console.log(`✅ [LEADERBOARD] Found ${users.length} active users`);

        res.json({ users: users });
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

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
        const [subscriptions] = await pool.execute(`
            SELECT * FROM push_subscriptions 
            WHERE user_id != ?
        `, [excludeUserId]);

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
                console.log(`📤 [NOTIFICATION] Sending to user ${sub.user_id} (endpoint: ${sub.endpoint.substring(0, 50)}...)`);
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
                    endpoint: sub.endpoint.substring(0, 50) + '...'
                });
                // Remove invalid subscription
                if (error.statusCode === 410) {
                    console.log(`🗑️ [NOTIFICATION] Removing expired subscription for user ${sub.user_id}`);
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

// Notification Center Helper Functions

// Create notifications table if it doesn't exist
async function ensureNotificationsTable() {
    if (DEMO_MODE) return;

    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type ENUM('recipient_added', 'present_added', 'present_reserved', 
                          'present_unreserved', 'present_checked', 'present_unchecked') NOT NULL,
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

// Create notification for relevant users
async function createNotification(type, actorId, data) {
    if (DEMO_MODE) {
        console.log('📝 [NOTIFICATIONS] Demo mode - notification not created:', { type, actorId, data });
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

        console.log(`📢 [NOTIFICATIONS] Creating ${type} notifications for ${users.length} user(s)`);

        // Create notification for each eligible user
        for (const user of users) {
            // Check privacy: skip if user is identified as the recipient in present notifications
            if (type.includes('present_') && data.recipientId) {
                const isIdentified = await isUserIdentifiedAsRecipient(user.id, data.recipientId);
                if (isIdentified) {
                    console.log(`🔒 [NOTIFICATIONS] Skipping notification for user ${user.id} (identified as recipient ${data.recipientId})`);
                    continue;
                }
            }

            // Create notification
            await pool.execute(
                'INSERT INTO notifications (user_id, type, actor_id, data) VALUES (?, ?, ?, ?)',
                [user.id, type, actorId, JSON.stringify(data)]
            );
        }

        console.log(`✅ [NOTIFICATIONS] Created ${type} notifications successfully`);
    } catch (err) {
        console.error('❌ [NOTIFICATIONS] Error creating notification:', err);
        // Don't throw - notifications are non-critical
    }
}

// Cancel reservation
app.delete('/api/presents/:id/reserve', requireAuth, async (req, res) => {
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

// Formularz API - Get all recipients (no authentication required)
app.get('/api/formularz/recipients', async (req, res) => {
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

// Formularz API - Submit present without authentication
app.post('/api/formularz/present', async (req, res) => {
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

        // Add present for this recipient
        // If recipient is identified by a user, use that user as created_by
        console.log('[Formularz] Adding present:', { title: presentTitle.trim(), recipientId, comments: presentComments, createdBy: createdByUserId });

        if (createdByUserId) {
            // Recipient is identified - use their user ID as created_by
            const [presentResult] = await pool.execute(
                'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
                [presentTitle.trim(), recipientId, presentComments || null, createdByUserId]
            );
        } else {
            // Recipient not identified - don't include created_by
            const [presentResult] = await pool.execute(
                'INSERT INTO presents (title, recipient_id, comments) VALUES (?, ?, ?)',
                [presentTitle.trim(), recipientId, presentComments || null]
            );
        }

        // Get the insert ID from whichever query was executed
        const [checkResult] = await pool.execute(
            'SELECT LAST_INSERT_ID() as insertId'
        );
        const presentId = checkResult[0].insertId;

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

            await createNotification('present_added', createdByUserId || 0, {
                presentId: presentId,
                presentTitle: presentTitle.trim(),
                recipientId: recipientId,
                recipientName: notificationRecipientName
            });

            // Send push notification to other users (non-blocking)
            const notificationTitle = 'Nowy prezent!';
            const notificationBody = `Dodano nowy prezent "${presentTitle.trim()}" dla ${notificationRecipientName}`;
            console.log(`📢 [FORMULARZ] Triggering notification for new present: "${presentTitle.trim()}" (ID: ${presentId})`);

            sendNotificationToUsers(createdByUserId || 0, notificationTitle, notificationBody, {
                presentId: presentId,
                presentTitle: presentTitle.trim(),
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
app.get('/api/formularz/my-presents', requireAuth, async (req, res) => {
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

// Registration API
app.post('/api/register', async (req, res) => {
    console.log('Registration request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;

    if (!username || !password) {
        console.log('Registration failed: missing username or password');
        return badRequest(res, 'Wymagane jest podanie nazwy użytkownika i hasła');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate registration
        console.log('Demo mode registration for:', username);

        // In demo mode, just log them in as the demo user
        req.session.userId = 1;
        req.session.username = username;

        console.log('Demo registration successful:', { userId: 1, username: username });
        res.json({ success: true, user: { id: 1, username: username } });
        return;
    }

    try {
        console.log('Checking if username exists:', username);
        const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);

        if (rows.length > 0) {
            console.log('Registration failed: username already exists:', username);
            return conflict(res, 'Nazwa użytkownika jest już zajęta');
        }

        console.log('Creating new user:', username);
        const hashedPassword = bcrypt.hashSync(password, 10);
        const [result] = await pool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

        console.log('User created successfully:', { id: result.insertId, username: username });

        // Automatycznie loguj użytkownika po rejestracji
        req.session.userId = result.insertId;
        req.session.username = username;

        console.log('Session created:', { userId: req.session.userId, username: req.session.username });

        res.json({ success: true, user: { id: result.insertId, username: username } });
    } catch (err) {
        console.error('Database error during registration:', err);
        return handleDbError(err, res, 'Błąd podczas rejestracji');
    }
});



// Add new recipient and identify user
app.post('/api/user/identify', requireAuth, async (req, res) => {
    const { name } = req.body;
    const userId = req.session.userId;

    console.log('[POST /api/user/identify] Incoming request:', { body: req.body, session: req.session });

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
            return conflict(res, 'Jesteś już zidentyfikowany jako ' + existingRecipient.name);
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
        console.error('[POST /api/user/identify] Database error:', err, 'Session:', req.session);
        return handleDbError(err, res, 'Błąd podczas identyfikacji');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return badRequest(res, 'Nieprawidłowy format danych JSON');
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Plik jest zbyt duży. Maksymalny rozmiar to 10MB.' });
    }

    if (err.message === 'Tylko pliki obrazów są dozwolone') {
        return badRequest(res, err.message);
    }

    handleDbError(err, res, 'Błąd serwera');
});

// Test database connection
async function testDatabaseConnection() {
    try {
        console.log('Testing database connection...');
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('Database connection test successful!');
        return true;
    } catch (err) {
        console.error('Database connection test failed:', err);
        return false;
    }
}

// Demo data for preview
const demoData = {
    users: [
        { id: 1, username: 'demo', password: '$2a$10$demo.hash.for.preview.only' }
    ],
    recipients: [
        { id: 1, name: 'Anna Kowalska', identified_by: null, profile_picture: null },
        { id: 2, name: 'Jan Nowak', identified_by: 1, profile_picture: null },
        { id: 3, name: 'Maria Wiśniewska', identified_by: null, profile_picture: null }
    ],
    presents: [
        { id: 1, title: 'Książka o gotowaniu', recipient_id: 1, comments: 'Coś o kuchni włoskiej', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() },
        { id: 2, title: 'Słuchawki bezprzewodowe', recipient_id: 2, comments: 'Najlepiej Sony lub Bose', is_checked: true, reserved_by: 1, created_by: 1, created_at: new Date() },
        { id: 3, title: 'Roślina doniczkowa', recipient_id: 3, comments: 'Monstera lub fikus', is_checked: false, reserved_by: null, created_by: 1, created_at: new Date() }
    ]
};

// Initialize database and start server
async function startServer() {
    try {
        if (DEMO_MODE) {
            const reason = process.env.OFFLINE_MODE === 'true' ? 'OFFLINE_MODE enabled' :
                process.env.DEMO_MODE === 'true' ? 'DEMO_MODE enabled' :
                    !process.env.DB_PASSWORD ? 'No DB_PASSWORD set' :
                        'Development mode';

            console.log(`🎭 Starting in OFFLINE/DEMO MODE - ${reason}`);
            console.log('💡 Database features disabled - using sample data');

            // Start server without database
            app.listen(PORT, HOST, () => {
                console.log(`🎄 Serwer Prezenty działa na porcie ${PORT}`);
                console.log(`🌐 Dostępny pod adresem: http://${HOST}:${PORT}`);
                console.log(`📱 OFFLINE MODE: Using sample data`);
                console.log(`🔧 To enable database: Set OFFLINE_MODE=false and DB_PASSWORD in .env`);
            }).on('error', (err) => {
                console.error('Błąd uruchamiania serwera:', err);
                process.exit(1);
            });
        } else {
            // Test database connection first
            const dbConnected = await testDatabaseConnection();
            if (!dbConnected) {
                console.error('⚠️  Database connection failed - falling back to DEMO MODE');
                console.error('💡 Set correct DB_PASSWORD to enable database features');

                // Fall back to demo mode
                DEMO_MODE = true;
                console.log('🎭 Falling back to DEMO MODE for deployment');

                // Start server in demo mode
                app.listen(PORT, HOST, () => {
                    console.log(`🎄 Serwer Prezenty działa na porcie ${PORT} (DEMO MODE)`);
                    console.log(`🌐 Dostępny pod adresem: http://${HOST}:${PORT}`);
                    console.log(`📱 DEMO MODE: Database features disabled`);
                    console.log(`🔧 Fix database connection to enable full functionality`);
                }).on('error', (err) => {
                    console.error('Błąd uruchamiania serwera:', err);
                    process.exit(1);
                });
                return;
            }

            // Skip database initialization on deployment
            console.log('⚠️  Database schema initialization skipped');
            console.log('💡 Run "npm run init-db" manually if you need to create tables');

            // Start server
            app.listen(PORT, HOST, () => {
                console.log(`Serwer Prezenty działa na porcie ${PORT}`);
                console.log(`Dostępny pod adresem: http://${HOST}:${PORT}`);
                console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
                console.log(`Database: MySQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
                console.log('Session store using MySQL');
                console.log('📋 Database tables assumed to exist - run "npm run init-db" if needed');
            }).on('error', (err) => {
                console.error('Błąd uruchamiania serwera:', err);
                process.exit(1);
            });
        }
    } catch (err) {
        console.error('Failed to start server:', err);
        if (err.code === 'ENOTFOUND') {
            console.error('Database host not found. Please check your DB_HOST configuration.');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('Database connection refused. Please check if the database server is running.');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Database access denied. Please check your username and password.');
        }
        process.exit(1);
    }
}

// Keep-alive cronjob for Render deployment
function setupKeepAliveCron() {
    // Only run keep-alive in production on Render
    if (process.env.NODE_ENV === 'production' && process.env.RENDER) {
        console.log('🔄 Setting up keep-alive cronjob for Render...');

        const job = new cron.CronJob('*/14 * * * *', function () {
            https
                .get("https://prezenty.onrender.com", (res) => {
                    if (res.statusCode === 200) {
                        console.log("✅ Keep-alive ping successful at", new Date().toLocaleTimeString());
                    } else {
                        console.log("⚠️ Keep-alive ping failed:", res.statusCode);
                    }
                })
                .on("error", (e) => {
                    console.error("❌ Keep-alive ping error:", e.message);
                });
        });

        job.start();
        console.log('✅ Keep-alive cronjob started - pinging every 14 minutes');
    } else {
        console.log('ℹ️ Keep-alive cronjob skipped (not in production on Render)');
    }
}

startServer();

// Setup keep-alive after server starts
setTimeout(() => {
    setupKeepAliveCron();
}, 5000); // Wait 5 seconds for server to fully start
