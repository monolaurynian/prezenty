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
        host: process.env.DB_HOST || '77.37.35.150',
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

// When a connection times out, say WHERE it stops: this server's public IP
// (what the database host sees and must allow), whether a plain TCP
// connection to the database port opens at all, and whether the database
// answers with its greeting. Logged at most every 10 minutes; no credentials
// are sent.
let lastNetworkDiagnosis = 0;
async function diagnoseDatabaseNetwork() {
    if (!dbConfig || Date.now() - lastNetworkDiagnosis < 10 * 60 * 1000) return;
    lastNetworkDiagnosis = Date.now();
    const net = require('net');
    const https = require('https');
    const ownIp = await new Promise((resolve) => {
        const req = https.get('https://api.ipify.org', { timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (d) => { body += d; });
            res.on('end', () => resolve(body.trim().slice(0, 64)));
        });
        req.on('timeout', () => { req.destroy(); resolve('(timeout)'); });
        req.on('error', (e) => resolve('(' + e.code + ')'));
    });
    const started = Date.now();
    const tcp = await new Promise((resolve) => {
        const socket = net.connect({ host: dbConfig.host, port: dbConfig.port });
        socket.setTimeout(10000);
        let connectedAfter = null;
        socket.on('connect', () => { connectedAfter = Date.now() - started; });
        socket.on('data', (d) => {
            socket.destroy();
            resolve(`tcp connected after ${connectedAfter}ms, greeting received (${d.length} bytes, ` +
                `${d.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(1, 40)})`);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(connectedAfter === null
                ? 'no tcp connection within 10s (packets dropped)'
                : `tcp connected after ${connectedAfter}ms but no greeting within 10s`);
        });
        socket.on('error', (e) => resolve('tcp error: ' + e.code));
    });
    console.error(`[db-network] this server's public IP: ${ownIp}; ${dbConfig.host}:${dbConfig.port} -> ${tcp}`);
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
        diagnoseDatabaseNetwork().catch(() => { /* diagnosis only */ });
        return false;
    }
}

module.exports = { DEMO_MODE, dbConfig, pool, isMaintenanceMode, setMaintenanceMode, testDatabaseConnection, diagnoseDatabaseNetwork };
