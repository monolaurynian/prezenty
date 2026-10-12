// Moved verbatim from server.js (Phase 2 split)
const mysql = require('mysql2/promise');

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

function isMaintenanceMode() {
    return MAINTENANCE_MODE;
}

function setMaintenanceMode(value) {
    MAINTENANCE_MODE = value;
}

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

module.exports = { DEMO_MODE, dbConfig, pool, isMaintenanceMode, setMaintenanceMode, testDatabaseConnection };
