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
// NOTE: the previous fallback pair was BROKEN - the public key (from an old
// Google tutorial) did not match the private key, so every push send failed
// authentication while the UI reported notifications as "enabled". This
// fallback pair is valid and verified at boot below. For production it's
// still better to set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
let webpush = null;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGmHv9fStZte3uoA_MoRNIiQGjiMYSIdf671YAsqNG7Y0ADxVlQVpuIvtIYsJWiassjdqBhrW_9eBTBj9X78y9o';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Y2INXCZy4691LqPyIrv5q7huivDUuUVhCaqMsrRvAmA';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:prezenty@example.com';

// Verify the key pair actually matches - a mismatched pair fails silently
// at send time, which is exactly the bug this guards against
try {
    const _ecdh = require('crypto').createECDH('prime256v1');
    _ecdh.setPrivateKey(Buffer.from(VAPID_PRIVATE_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const _derived = _ecdh.getPublicKey().toString('base64url');
    const _declared = Buffer.from(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64url');
    if (_derived !== _declared) {
        console.error('❌ [VAPID] PUBLIC/PRIVATE KEY MISMATCH - push notifications WILL FAIL. Check your VAPID env vars.');
    } else {
        console.log('✅ [VAPID] Key pair verified (public matches private)');
    }
} catch (e) {
    console.error('⚠️ [VAPID] Could not verify key pair:', e.message);
}

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

// Set to true when the production database is unreachable; the app then serves
// a maintenance page instead of demo data and retries the connection periodically
let MAINTENANCE_MODE = false;

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

    // Create MySQL connection pool.
    // Hostinger enforces max_connections_per_hour (500) - that counts NEW
    // TCP connections, so the pool is tuned to open as few as possible:
    // - small connectionLimit (a family app needs no more)
    // - connections are kept warm (TCP keepalive + the periodic ping
    //   below) instead of being closed and reopened
    pool = mysql.createPool({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port,
        charset: dbConfig.charset,
        connectTimeout: dbConfig.connectTimeout,
        waitForConnections: true,
        connectionLimit: 4,
        maxIdle: 2,               // extra idle connections close gracefully
        idleTimeout: 240000,      // ...after 4 minutes
        queueLimit: 0,
        enableKeepAlive: true,    // TCP keepalive against silent drops
        keepAliveInitialDelay: 10000
    });

    // Warm-keeper: one lightweight query every 4 minutes reuses a pooled
    // connection so the server's wait_timeout never kills it. Without
    // this, every activity burst after an idle period opened brand-new
    // connections and burned through the hourly connection budget.
    setInterval(() => {
        if (MAINTENANCE_MODE) return; // maintenance retry probes already
        pool.query('SELECT 1').catch(() => { /* probe only */ });
    }, 4 * 60 * 1000);
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

// ---- Leaderboard change detection ----
// The leaderboard ranks recipients by presents on their wishlist. When
// the top spot changes hands after a present is added/removed, everyone
// gets an in-app notification about it.
async function getLeaderboardLeader() {
    const [rows] = await pool.execute(`
        SELECT r.id, r.name, COUNT(p.id) as total_presents
        FROM recipients r
        LEFT JOIN presents p ON p.recipient_id = r.id
        GROUP BY r.id, r.name
        HAVING total_presents > 0
        ORDER BY total_presents DESC, r.name ASC
        LIMIT 1
    `);
    return rows.length ? rows[0] : null;
}

async function notifyLeaderboardChange(previousLeader, actorId) {
    try {
        if (DEMO_MODE) return;
        const newLeader = await getLeaderboardLeader();
        if (!newLeader) return;
        if (previousLeader && previousLeader.id === newLeader.id) return;

        console.log(`🏆 [LEADERBOARD] New leader: ${newLeader.name} (${newLeader.total_presents} presents)`);
        const count = Number(newLeader.total_presents);
        await createNotification('leaderboard_leader', actorId || 0, {
            leaderName: newLeader.name,
            leaderId: newLeader.id,
            presentCount: count,
            previousLeaderName: previousLeader ? previousLeader.name : null
        });

        // Push notification too - a lead change is a fun, rare event.
        // data.url makes the SW open the ranking page on tap.
        const pushBody = previousLeader
            ? `${newLeader.name} wyprzedza ${previousLeader.name} i prowadzi z ${count} ${count === 1 ? 'prezentem' : 'prezentami'}!`
            : `${newLeader.name} prowadzi w rankingu z ${count} ${count === 1 ? 'prezentem' : 'prezentami'}!`;
        sendNotificationToUsers(actorId || 0, 'Zmiana w rankingu! 🏆', pushBody, {
            leaderboard: true,
            url: '/leaderboard.html'
        }).catch(err => {
            console.error('❌ [LEADERBOARD] Push send failed (non-fatal):', err);
        });
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error checking leaderboard change:', err);
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
    index: false, // Don't serve index.html automatically - let route handlers decide
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

// Trust proxy if behind reverse proxy (for HTTPS)
app.set('trust proxy', 1);

// Detect if running on HTTPS (production)
const isProduction = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true';

console.log('Session configuration:', {
    isProduction,
    NODE_ENV: process.env.NODE_ENV,
    HTTPS: process.env.HTTPS
});

// Create session store
let sessionConfig = {
    name: 'prezenty.sid', // Explicit session cookie name
    secret: process.env.SESSION_SECRET || 'prezenty_secret',
    resave: true, // Force session to be saved back to store (needed for memory store)
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: isProduction, // true for HTTPS in production
        sameSite: 'lax',
        path: '/' // Ensure cookie is available for all paths
    }
};

if (!DEMO_MODE && dbConfig) {
    // Reuse the app's connection pool for sessions. Previously the store
    // built its OWN pool from dbConfig - two pools of cold connections
    // doubled the new-connection churn against Hostinger's hourly limit.
    const sessionStore = new MySQLStore({}, pool);
    sessionConfig.store = sessionStore;
    // The MySQL store supports touch - no need to rewrite the session on
    // every request (resave: true is only needed for the memory store)
    sessionConfig.resave = false;
}

// Maintenance mode: when the database is unreachable in production we block
// the app with a clear maintenance page instead of silently serving demo data
// (users must never mistake demo data for the real environment).
// Registered BEFORE the session middleware so no MySQL session I/O happens.
app.use((req, res, next) => {
    if (!MAINTENANCE_MODE) return next();
    if (req.path === '/health') return next();
    if (req.path.startsWith('/api/')) {
        return res.status(503).json({
            error: 'Aplikacja jest tymczasowo niedostępna. Spróbuj ponownie później.',
            maintenance: true
        });
    }
    res.status(503).sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

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
        status: MAINTENANCE_MODE ? 'MAINTENANCE' : 'OK',
        timestamp: new Date().toISOString(),
        mode: MAINTENANCE_MODE ? 'MAINTENANCE' : (DEMO_MODE ? 'DEMO' : 'PRODUCTION'),
        database: (DEMO_MODE || MAINTENANCE_MODE) ? 'disabled' : 'enabled'
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
    console.log('========================================');
    console.log('ROOT ROUTE HIT!');
    console.log('Root route accessed - Session:', {
        userId: req.session.userId,
        username: req.session.username,
        sessionID: req.sessionID,
        cookie: req.session.cookie
    });
    console.log('========================================');
    
    // If user is authenticated, show home (homepage/dashboard)
    if (req.session.userId) {
        console.log('User authenticated, serving home.html');
        res.sendFile(path.join(__dirname, 'public', 'home.html'));
    } else {
        console.log('User not authenticated, serving index.html (login)');
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.get('/home', (req, res) => {
    // Redirect to root (home is the homepage)
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'home.html'));
    }
});

app.get('/statystyki', (req, res) => {
    // Legacy route - redirect to home
    res.redirect('/');
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

app.get('/osoby', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'osoby.html'));
    }
});

app.get('/ustawienia', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'ustawienia.html'));
    }
});

app.get('/rezerwacje', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'rezerwacje.html'));
    }
});

app.get('/archiwum', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'archiwum.html'));
    }
});

app.get('/wiadomosci', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'wiadomosci.html'));
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
            
            // Save session explicitly
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ error: 'Błąd zapisu sesji' });
                }
                console.log('Session saved successfully:', {
                    userId: req.session.userId,
                    username: req.session.username,
                    sessionID: req.sessionID
                });
                res.json({ success: true, user: { id: 1, username: username } });
            });
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

        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Błąd zapisu sesji' });
            }
            console.log('Session saved successfully:', {
                userId: req.session.userId,
                username: req.session.username,
                sessionID: req.sessionID
            });
            res.json({ success: true, user: { id: user.id, username: user.username } });
        });
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
    console.log('Auth check - Full session details:', {
        userId: req.session.userId,
        username: req.session.username,
        sessionID: req.sessionID,
        cookie: req.session.cookie,
        headers: req.headers.cookie
    });
    if (req.session.userId) {
        console.log('Auth check: User IS authenticated');
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        console.log('Auth check: User NOT authenticated');
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
        const notificationBody = `Dodano nowy prezent "${title.trim()}" dla ${recipientName}`;
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

// Leaderboard API - Get most active users
app.get('/api/leaderboard', async (req, res) => {
    try {
        console.log('📊 [LEADERBOARD] Fetching most active users');

        if (DEMO_MODE) {
            return res.json({ users: [], cumulativeStats: { totalPresents: 0, boughtPresents: 0, reservedPresents: 0 } });
        }

        // Rank PEOPLE (recipients) by the presents on their wishlist -
        // regardless of who added them and whether the person has an
        // account / identified themselves. Activity stats (bought/reserved
        // BY the person) come through their identifying user, if any.
        const [users] = await pool.execute(`
            SELECT 
                r.id,
                r.name as username,
                r.id as recipient_id,
                CASE WHEN r.profile_picture IS NOT NULL 
                    THEN CONCAT('/api/recipients/', r.id, '/profile-picture')
                    ELSE NULL 
                END as profile_picture,
                COUNT(DISTINCT p.id) as total_presents,
                SUM(CASE WHEN p.is_checked = 1 THEN 1 ELSE 0 END) as bought_presents,
                SUM(CASE WHEN p.reserved_by IS NOT NULL THEN 1 ELSE 0 END) as reserved_presents,
                SUM(CASE WHEN p.is_checked = 0 AND p.reserved_by IS NULL THEN 1 ELSE 0 END) as available_presents,
                (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by AND is_checked = 1) as user_bought_count,
                (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by) as user_reserved_count
            FROM recipients r
            LEFT JOIN presents p ON p.recipient_id = r.id
            GROUP BY r.id, r.name, r.profile_picture, r.identified_by
            HAVING total_presents > 0
            ORDER BY total_presents DESC
            LIMIT 10
        `);

        // Get cumulative stats from ALL presents in the system
        const [cumulativeStats] = await pool.execute(`
            SELECT 
                COUNT(*) as totalPresents,
                SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as boughtPresents,
                SUM(CASE WHEN reserved_by IS NOT NULL THEN 1 ELSE 0 END) as reservedPresents
            FROM presents
        `);

        console.log(`✅ [LEADERBOARD] Found ${users.length} active users`);
        console.log(`📊 [LEADERBOARD] Cumulative stats:`, cumulativeStats[0]);

        res.json({ 
            users: users,
            cumulativeStats: cumulativeStats[0]
        });
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

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
    anonTablesEnsured = true;
    console.log('✅ [WIADOMOSCI] Anonymous message tables ready');
}

// Targeted notification for ONE user with the actor masked: actor_id is
// set to the notification's owner so the API can never leak the sender's
// username. The safe display label travels in data.label.
async function notifyAnonMessage(recipientUserId, label, threadId, preview) {
    try {
        await ensureNotificationsTable();
        await pool.execute(
            'INSERT INTO notifications (user_id, type, actor_id, data) VALUES (?, ?, ?, ?)',
            [recipientUserId, 'anon_message', recipientUserId,
             JSON.stringify({ label, threadId, preview })]
        );
    } catch (err) {
        console.error('❌ [WIADOMOSCI] Notification insert failed:', err.message);
    }
    sendPushToUser(recipientUserId, label + ' 💬',
        preview.length > 80 ? preview.slice(0, 77) + '...' : preview,
        { url: '/wiadomosci' }
    ).catch(() => {});
}

// Users the current user can message (everyone but themselves)
app.get('/api/wiadomosci/users', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ users: [] });
    try {
        const [users] = await pool.execute(
            'SELECT id, username FROM users WHERE id != ? ORDER BY username',
            [req.session.userId]
        );
        res.json({ users });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania użytkowników');
    }
});

// Thread list for the current user (both roles), newest activity first
app.get('/api/wiadomosci/threads', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ threads: [] });
    const userId = req.session.userId;
    try {
        await ensureAnonMessageTables();
        const [threads] = await pool.execute(`
            SELECT t.id, t.initiator_id, t.target_id, t.created_at,
                   u.username AS target_username,
                   (SELECT body FROM anon_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                   (SELECT created_at FROM anon_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_at,
                   (SELECT COUNT(*) FROM anon_messages m WHERE m.thread_id = t.id AND m.is_read = 0 AND m.sender_id != ?) AS unread_count
            FROM anon_threads t
            JOIN users u ON u.id = t.target_id
            WHERE t.initiator_id = ? OR t.target_id = ?
            ORDER BY last_at DESC
        `, [userId, userId, userId]);

        res.json({
            threads: threads.map(t => ({
                id: t.id,
                role: t.initiator_id === userId ? 'initiator' : 'target',
                // Target sees "Święty Mikołaj"; initiator sees who they wrote to
                otherLabel: t.initiator_id === userId ? t.target_username : 'Święty Mikołaj 🎅',
                lastBody: t.last_body,
                lastAt: t.last_at,
                unreadCount: Number(t.unread_count)
            }))
        });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania wiadomości');
    }
});

// Unread messages badge
app.get('/api/wiadomosci/unread-count', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ count: 0 });
    const userId = req.session.userId;
    try {
        await ensureAnonMessageTables();
        const [rows] = await pool.execute(`
            SELECT COUNT(*) AS count FROM anon_messages m
            JOIN anon_threads t ON t.id = m.thread_id
            WHERE (t.initiator_id = ? OR t.target_id = ?)
              AND m.sender_id != ? AND m.is_read = 0
        `, [userId, userId, userId]);
        res.json({ count: Number(rows[0].count) });
    } catch (err) {
        return handleDbError(err, res, 'Błąd');
    }
});

// Start a new anonymous thread
app.post('/api/wiadomosci/threads', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.status(503).json({ error: 'Niedostępne w trybie demo' });
    const userId = req.session.userId;
    const { targetUserId, body } = req.body;

    if (!targetUserId || !body || !String(body).trim()) {
        return badRequest(res, 'Wybierz odbiorcę i wpisz wiadomość');
    }
    if (Number(targetUserId) === Number(userId)) {
        return badRequest(res, 'Nie możesz wysłać wiadomości do siebie');
    }

    try {
        await ensureAnonMessageTables();
        const [target] = await pool.execute('SELECT id FROM users WHERE id = ?', [targetUserId]);
        if (target.length === 0) return notFound(res, 'Nie znaleziono użytkownika');

        // Messages to the same person continue the existing thread
        // instead of starting a new one each time
        let threadId;
        const [existing] = await pool.execute(
            'SELECT id FROM anon_threads WHERE initiator_id = ? AND target_id = ? ORDER BY id DESC LIMIT 1',
            [userId, targetUserId]
        );
        if (existing.length > 0) {
            threadId = existing[0].id;
        } else {
            const [tRes] = await pool.execute(
                'INSERT INTO anon_threads (initiator_id, target_id) VALUES (?, ?)',
                [userId, targetUserId]
            );
            threadId = tRes.insertId;
        }

        await pool.execute(
            'INSERT INTO anon_messages (thread_id, sender_id, body) VALUES (?, ?, ?)',
            [threadId, userId, String(body).trim()]
        );

        notifyAnonMessage(Number(targetUserId), 'Wiadomość od Świętego Mikołaja', threadId, String(body).trim());
        res.json({ success: true, threadId });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas wysyłania wiadomości');
    }
});

// Read a thread (marks incoming messages as read)
app.get('/api/wiadomosci/threads/:id', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ messages: [] });
    const userId = req.session.userId;
    try {
        await ensureAnonMessageTables();
        const [tRows] = await pool.execute('SELECT * FROM anon_threads WHERE id = ?', [req.params.id]);
        if (tRows.length === 0) return notFound(res, 'Nie znaleziono rozmowy');
        const thread = tRows[0];
        if (thread.initiator_id !== userId && thread.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        const [msgs] = await pool.execute(
            'SELECT id, sender_id, body, created_at FROM anon_messages WHERE thread_id = ? ORDER BY id ASC',
            [thread.id]
        );
        await pool.execute(
            'UPDATE anon_messages SET is_read = 1 WHERE thread_id = ? AND sender_id != ?',
            [thread.id, userId]
        );

        const isInitiator = thread.initiator_id === userId;
        const [uRows] = await pool.execute('SELECT username FROM users WHERE id = ?', [thread.target_id]);
        const targetName = uRows.length ? uRows[0].username : '?';

        res.json({
            threadId: thread.id,
            role: isInitiator ? 'initiator' : 'target',
            otherLabel: isInitiator ? targetName : 'Święty Mikołaj 🎅',
            // sender_id is NEVER exposed - only fromMe
            messages: msgs.map(m => ({
                id: m.id,
                fromMe: m.sender_id === userId,
                body: m.body,
                createdAt: m.created_at
            }))
        });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas pobierania rozmowy');
    }
});

// Reply within a thread
app.post('/api/wiadomosci/threads/:id/messages', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.status(503).json({ error: 'Niedostępne w trybie demo' });
    const userId = req.session.userId;
    const { body } = req.body;
    if (!body || !String(body).trim()) return badRequest(res, 'Wpisz wiadomość');

    try {
        await ensureAnonMessageTables();
        const [tRows] = await pool.execute('SELECT * FROM anon_threads WHERE id = ?', [req.params.id]);
        if (tRows.length === 0) return notFound(res, 'Nie znaleziono rozmowy');
        const thread = tRows[0];
        if (thread.initiator_id !== userId && thread.target_id !== userId) {
            return forbidden(res, 'To nie Twoja rozmowa');
        }

        await pool.execute(
            'INSERT INTO anon_messages (thread_id, sender_id, body) VALUES (?, ?, ?)',
            [thread.id, userId, String(body).trim()]
        );

        const otherUserId = thread.initiator_id === userId ? thread.target_id : thread.initiator_id;
        // The initiator stays anonymous in the target's notification;
        // the target's reply is labeled as a reply to your message
        const label = thread.initiator_id === userId
            ? 'Wiadomość od Świętego Mikołaja'
            : 'Odpowiedź na Twoją anonimową wiadomość';
        notifyAnonMessage(otherUserId, label, thread.id, String(body).trim());

        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas wysyłania odpowiedzi');
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
        // rendered the "wykonał(a) akcję" fallback
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

// Create notification for relevant users
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
            const notificationBody = `Dodano nowy prezent "${presentTitle.trim()}" dla ${notificationRecipientName}`;
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

// ===== Archive: move a finished year's presents out of the main table =====

async function ensureArchiveTable() {
    await pool.execute(`CREATE TABLE IF NOT EXISTS presents_archive (
        id INT AUTO_INCREMENT PRIMARY KEY,
        original_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        recipient_id INT NULL,
        recipient_name VARCHAR(255) NULL,
        comments TEXT NULL,
        is_checked BOOLEAN DEFAULT FALSE,
        reserved_by INT NULL,
        reserved_by_username VARCHAR(255) NULL,
        created_by INT NULL,
        created_by_username VARCHAR(255) NULL,
        created_at TIMESTAMP NULL,
        archive_year INT NOT NULL,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_archive_year (archive_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

// Archive all current presents under a given year label and clear the slate.
// Requires typing the confirmation word - this moves every present.
app.post('/api/archive/run', requireAuth, async (req, res) => {
    const { year, confirmText } = req.body;

    if (DEMO_MODE) {
        return badRequest(res, 'Archiwizacja jest niedostępna w trybie demo');
    }
    if (confirmText !== 'ARCHIWIZUJ') {
        return badRequest(res, 'Wpisz ARCHIWIZUJ aby potwierdzić');
    }
    const archiveYear = parseInt(year);
    if (!archiveYear || archiveYear < 2020 || archiveYear > 2100) {
        return badRequest(res, 'Nieprawidłowy rok');
    }

    let conn;
    try {
        await ensureArchiveTable();
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Copy presents with names denormalized, so the archive stays
        // readable even if recipients/users are removed later
        const [copied] = await conn.execute(`
            INSERT INTO presents_archive
                (original_id, title, recipient_id, recipient_name, comments, is_checked,
                 reserved_by, reserved_by_username, created_by, created_by_username, created_at, archive_year)
            SELECT p.id, p.title, p.recipient_id, r.name, p.comments, p.is_checked,
                   p.reserved_by, ur.username, p.created_by, uc.username, p.created_at, ?
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            LEFT JOIN users ur ON p.reserved_by = ur.id
            LEFT JOIN users uc ON p.created_by = uc.id
        `, [archiveYear]);

        const [deleted] = await conn.execute('DELETE FROM presents');

        // Fresh year, fresh activity feed
        const [clearedNotifications] = await conn.execute('DELETE FROM notifications');

        await conn.commit();

        // Invalidate server-side caches
        try {
            cache.invalidatePresents();
            clearCombinedDataCache();
        } catch (e) { /* cache errors are non-fatal */ }

        console.log(`🗄️ [ARCHIVE] User ${req.session.username} archived year ${archiveYear}: ` +
            `${copied.affectedRows} presents moved, ${clearedNotifications.affectedRows} notifications cleared`);

        res.json({
            success: true,
            archivedPresents: copied.affectedRows,
            deletedPresents: deleted.affectedRows,
            clearedNotifications: clearedNotifications.affectedRows,
            year: archiveYear
        });
    } catch (err) {
        if (conn) {
            try { await conn.rollback(); } catch (e) { /* ignore */ }
        }
        console.error('❌ [ARCHIVE] Archiving failed:', err);
        handleDbError(err, res, 'Błąd podczas archiwizacji');
    } finally {
        if (conn) conn.release();
    }
});

// List available archive years with counts
app.get('/api/archive/years', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ years: [] });
    try {
        await ensureArchiveTable();
        const [rows] = await pool.execute(`
            SELECT archive_year AS year, COUNT(*) AS count
            FROM presents_archive
            GROUP BY archive_year
            ORDER BY archive_year DESC
        `);
        res.json({ years: rows });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania archiwum');
    }
});

// Get archived presents for a year
app.get('/api/archive/presents', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ presents: [] });
    const year = parseInt(req.query.year);
    if (!year) return badRequest(res, 'Podaj rok');
    try {
        await ensureArchiveTable();
        const [rows] = await pool.execute(`
            SELECT title, recipient_id, recipient_name, comments, is_checked,
                   reserved_by_username, created_by_username, created_at
            FROM presents_archive
            WHERE archive_year = ?
            ORDER BY recipient_name, title
        `, [year]);

        // Spoiler protection: the identified recipient must not learn who
        // reserved/bought their own presents - mask names server-side so
        // they never even reach the browser
        const identified = await getUserIdentification(req.session.userId);
        const presents = rows.map(p => {
            const isOwn = identified && p.recipient_id === identified.id;
            const { recipient_id, ...rest } = p;
            if (isOwn) {
                return { ...rest, reserved_by_username: null, spoiler: true };
            }
            return rest;
        });

        res.json({ presents });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania archiwum');
    }
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
                console.error('⚠️  Database connection failed - entering MAINTENANCE MODE');
                console.error('💡 Users will see a maintenance page until the database is reachable');

                MAINTENANCE_MODE = true;

                // Retry the database connection every 2 minutes and
                // automatically exit maintenance mode when it recovers
                const retryInterval = setInterval(async () => {
                    console.log('🔄 Retrying database connection...');
                    const ok = await testDatabaseConnection();
                    if (ok) {
                        MAINTENANCE_MODE = false;
                        clearInterval(retryInterval);
                        console.log('✅ Database is back online - maintenance mode disabled');
                    }
                }, 2 * 60 * 1000);

                // Start server in maintenance mode
                app.listen(PORT, HOST, () => {
                    console.log(`🚧 Serwer Prezenty działa na porcie ${PORT} (MAINTENANCE MODE)`);
                    console.log(`🌐 Dostępny pod adresem: http://${HOST}:${PORT}`);
                    console.log(`🚧 MAINTENANCE MODE: Database unreachable, serving maintenance page`);
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

// Christmas nudge: from Dec 1st to Dec 23rd, remind users daily at 17:00 UTC
// about presents they reserved but haven't bought yet
function setupChristmasNudgeCron() {
    if (DEMO_MODE) {
        console.log('ℹ️ Christmas nudge cron skipped (demo mode)');
        return;
    }

    const job = new cron.CronJob('0 17 1-23 12 *', async function () {
        if (MAINTENANCE_MODE || DEMO_MODE || !webpush) return;
        try {
            console.log('🎅 [NUDGE] Running Christmas reminder check...');

            // Users with reserved but unbought presents
            const [rows] = await pool.execute(`
                SELECT reserved_by AS user_id, COUNT(*) AS unbought
                FROM presents
                WHERE reserved_by IS NOT NULL AND is_checked = 0
                GROUP BY reserved_by
            `);

            const now = new Date();
            const christmasEve = new Date(now.getFullYear(), 11, 24); // Dec 24
            const daysLeft = Math.max(0, Math.ceil((christmasEve - now) / 86400000));

            for (const row of rows) {
                const n = row.unbought;
                const phrase = n === 1 ? '1 zarezerwowany prezent' :
                    (n >= 2 && n <= 4 ? `${n} zarezerwowane prezenty` : `${n} zarezerwowanych prezentów`);
                const body = `Masz ${phrase} do kupienia. ` +
                    `Do Wigilii ${daysLeft === 1 ? 'został 1 dzień' : `zostało ${daysLeft} dni`}! 🎅`;
                await sendPushToUser(row.user_id, 'Przypomnienie świąteczne 🎄', body, { nudge: true });
            }
            console.log(`🎅 [NUDGE] Sent reminders to ${rows.length} user(s)`);
        } catch (err) {
            console.error('❌ [NUDGE] Christmas reminder failed:', err.message);
        }
    });

    job.start();
    console.log('✅ Christmas nudge cron started (daily 17:00 UTC, Dec 1-23)');
}

// Setup keep-alive after server starts
setTimeout(() => {
    setupKeepAliveCron();
    setupChristmasNudgeCron();
}, 5000); // Wait 5 seconds for server to fully start
