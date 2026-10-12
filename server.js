const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const MySQLStore = require('express-mysql-session')(session);

// Load .env file in development, but not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Boot web-push first: VAPID checks and logs run on require, ahead of the database config log
require('./lib/webpush-config');
const { DEMO_MODE, dbConfig, pool, isMaintenanceMode, setMaintenanceMode, testDatabaseConnection } = require('./lib/db');
const { handleDbError, badRequest } = require('./lib/http-errors');
const { presenceMiddleware } = require('./lib/presence');
const { setupKeepAliveCron, setupChristmasNudgeCron } = require('./lib/cron');
const systemRoutes = require('./routes/system');
const pageRoutes = require('./routes/pages');
const authRoutes = require('./routes/auth');
const recipientRoutes = require('./routes/recipients');
const presentRoutes = require('./routes/presents');
const notificationRoutes = require('./routes/notifications');
const leaderboardRoutes = require('./routes/leaderboard');
const chatRoutes = require('./routes/chat');
const formularzRoutes = require('./routes/formularz');
const archiveRoutes = require('./routes/archive');

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
    if (!isMaintenanceMode()) return next();
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

// Presence tracking (in-memory, resets on deploy) - see lib/presence.js
app.use(presenceMiddleware);

// Routers are mounted at the root, in the order their routes were originally registered.
app.use(systemRoutes);
app.use(pageRoutes);
app.use(authRoutes.router);
app.use(recipientRoutes.router);
app.use(presentRoutes.router);
app.use(notificationRoutes);
app.use(leaderboardRoutes);
app.use(chatRoutes);
app.use(presentRoutes.lateRouter);   // DELETE /api/presents/:id/reserve
app.use(formularzRoutes);
app.use(authRoutes.lateRouter);      // POST /api/register
app.use(recipientRoutes.lateRouter); // POST /api/user/identify

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

// Registered after the error handler, exactly as before the split
app.use(archiveRoutes);

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

                setMaintenanceMode(true);

                // Retry the database connection every 2 minutes and
                // automatically exit maintenance mode when it recovers
                const retryInterval = setInterval(async () => {
                    console.log('🔄 Retrying database connection...');
                    const ok = await testDatabaseConnection();
                    if (ok) {
                        setMaintenanceMode(false);
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

startServer();

// Setup keep-alive after server starts
setTimeout(() => {
    setupKeepAliveCron();
    setupChristmasNudgeCron();
}, 5000); // Wait 5 seconds for server to fully start
