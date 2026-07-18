// Diagnostic script: checks DB read/write health and sessions table
// Usage: set DB_PASSWORD env var, then: node db-diagnose.js
const mysql = require('mysql2/promise');

const config = {
    host: process.env.DB_HOST || '153.92.7.101',
    user: process.env.DB_USER || 'u662139794_mati',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'u662139794_prezenty',
    port: parseInt(process.env.DB_PORT) || 3306,
    charset: 'utf8mb4',
    connectTimeout: 20000
};

if (!config.password) {
    console.error('Set DB_PASSWORD environment variable first, e.g.:');
    console.error('  $env:DB_PASSWORD="yourpassword"; node db-diagnose.js');
    process.exit(1);
}

(async () => {
    let conn;
    try {
        console.log(`Connecting to ${config.host}:${config.port}/${config.database} ...`);
        conn = await mysql.createConnection(config);
        console.log('✅ Connected');

        // 1. Read test
        const [users] = await conn.execute('SELECT COUNT(*) AS c FROM users');
        console.log(`✅ Read test OK (users: ${users[0].c})`);

        // 2. Database size and per-table breakdown
        const [tables] = await conn.execute(`
            SELECT table_name AS t, engine,
                   ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb,
                   table_rows
            FROM information_schema.tables
            WHERE table_schema = ?
            ORDER BY (data_length + index_length) DESC`, [config.database]);
        let total = 0;
        console.log('\n=== Table sizes ===');
        for (const r of tables) {
            total += Number(r.size_mb);
            console.log(`  ${r.t.padEnd(30)} ${String(r.size_mb).padStart(10)} MB  (${r.table_rows} rows, ${r.engine})`);
        }
        console.log(`  TOTAL: ${total.toFixed(2)} MB`);

        // 3. Sessions table check
        const hasSessions = tables.some(r => r.t === 'sessions');
        if (!hasSessions) {
            console.log('\n❌ No "sessions" table found — express-mysql-session could not create it');
        } else {
            const [check] = await conn.query('CHECK TABLE sessions');
            console.log('\n=== CHECK TABLE sessions ===');
            check.forEach(r => console.log(`  ${r.Op}: ${r.Msg_type} - ${r.Msg_text}`));
        }

        // 4. Write test (harmless, cleans up after itself)
        console.log('\n=== Write test ===');
        try {
            await conn.execute(
                "INSERT INTO sessions (session_id, expires, data) VALUES ('diag-test-000', UNIX_TIMESTAMP() + 60, '{}')");
            await conn.execute("DELETE FROM sessions WHERE session_id = 'diag-test-000'");
            console.log('✅ Write to sessions table OK');
        } catch (e) {
            console.log(`❌ WRITE FAILED: [${e.code}] ${e.message}`);
        }

        // 5. Connection limits
        const [limits] = await conn.query("SHOW VARIABLES LIKE 'max_user_connections'");
        const [current] = await conn.query("SELECT COUNT(*) AS c FROM information_schema.processlist WHERE user = ?", [config.user]);
        console.log(`\nConnections: ${current[0].c} in use, limit: ${limits[0]?.Value || 'unknown'}`);

    } catch (err) {
        console.error(`\n❌ Error: [${err.code}] ${err.message}`);
    } finally {
        if (conn) await conn.end();
    }
})();
