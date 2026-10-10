const mysql = require("mysql2/promise");

// Load .env file in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Database configuration - same as server.js
const dbConfig = {
    host: process.env.DB_HOST || '153.92.7.101',
    user: process.env.DB_USER || 'u662139794_mati',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'u662139794_prezenty',
    port: parseInt(process.env.DB_PORT) || 3306,
    charset: 'utf8mb4',
    connectTimeout: 60000
};

async function initializeDatabase() {
    let connection;
    
    try {
        console.log("Database configuration:", {
            host: dbConfig.host,
            user: dbConfig.user,
            database: dbConfig.database,
            port: dbConfig.port,
            hasPassword: !!dbConfig.password
        });
        
        console.log("Connecting to MySQL database...");
        connection = await mysql.createConnection(dbConfig);
        console.log("Connected to MySQL database successfully!");
        
        // Create tables
        console.log("Creating database tables...");
        
        // Users table
        await connection.execute(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Users table created");
        
        // Recipients table
        await connection.execute(`CREATE TABLE IF NOT EXISTS recipients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            identified_by INT NULL,
            profile_picture LONGBLOB NULL,
            profile_picture_type VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (identified_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Recipients table created");
        
        // Presents table
        await connection.execute(`CREATE TABLE IF NOT EXISTS presents (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(500) NOT NULL,
            recipient_id INT NULL,
            comments TEXT NULL,
            is_checked BOOLEAN DEFAULT FALSE,
            reserved_by INT NULL,
            created_by INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (recipient_id) REFERENCES recipients(id) ON DELETE SET NULL,
            FOREIGN KEY (reserved_by) REFERENCES users(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Presents table created");
        
        // Session table for express-session
        await connection.execute(`CREATE TABLE IF NOT EXISTS sessions (
            session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
            expires INT UNSIGNED NOT NULL,
            data MEDIUMTEXT COLLATE utf8mb4_bin,
            PRIMARY KEY (session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Sessions table created");
        // ---- Anonymous chat (wiadomości) ----
        // MIRROR of ensureAnonMessageTables() in server.js, which stays the
        // runtime source of truth (it creates these lazily on first use).
        // Keep both in sync. Everything is CREATE TABLE IF NOT EXISTS, so
        // re-running this against an existing database is a no-op.
        await connection.execute(`CREATE TABLE IF NOT EXISTS anon_threads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            initiator_id INT NOT NULL,
            target_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_initiator (initiator_id),
            INDEX idx_target (target_id),
            FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Anon threads table created");
        await connection.execute(`CREATE TABLE IF NOT EXISTS anon_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            thread_id INT NOT NULL,
            sender_id INT NOT NULL,
            body TEXT NOT NULL,
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_thread (thread_id),
            FOREIGN KEY (thread_id) REFERENCES anon_threads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Anon messages table created");
        // Emoji reactions on chat messages. emoji uses COLLATE utf8mb4_bin
        // because the *_ci collations compare many emoji as EQUAL, which
        // would break both the unique key (one reaction per user per
        // message) and GROUP BY emoji. user_id is stored for the toggle
        // only - no endpoint ever exposes it.
        await connection.execute(`CREATE TABLE IF NOT EXISTS anon_message_reactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message_id INT NOT NULL,
            user_id INT NOT NULL,
            emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_message_user_emoji (message_id, user_id, emoji),
            INDEX idx_reaction_message (message_id),
            FOREIGN KEY (message_id) REFERENCES anon_messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
        console.log("✓ Anon message reactions table created");
        
        // Add indexes for better query performance
        console.log("\nAdding database indexes for better performance...");
        
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_presents_recipient_id ON presents(recipient_id)',
            'CREATE INDEX IF NOT EXISTS idx_presents_reserved_by ON presents(reserved_by)',
            'CREATE INDEX IF NOT EXISTS idx_presents_created_by ON presents(created_by)',
            'CREATE INDEX IF NOT EXISTS idx_presents_created_at ON presents(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_presents_is_checked ON presents(is_checked)',
            'CREATE INDEX IF NOT EXISTS idx_recipients_identified_by ON recipients(identified_by)',
            'CREATE INDEX IF NOT EXISTS idx_recipients_name ON recipients(name)',
            'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)'
        ];
        
        for (const indexQuery of indexes) {
            try {
                await connection.execute(indexQuery);
                const indexName = indexQuery.match(/idx_\w+/)[0];
                console.log(`✓ Index created: ${indexName}`);
            } catch (err) {
                if (err.code !== 'ER_DUP_KEYNAME') {
                    console.log('⚠ Index creation warning:', err.message);
                }
            }
        }
        
        console.log("\n🎉 Database initialization completed successfully!");
        console.log("\nTables created:");
        console.log("- users (for user authentication)");
        console.log("- recipients (for gift recipients with profile pictures stored as BLOB)");
        console.log("- presents (for gift ideas)");
        console.log("- sessions (for express-session)");
        console.log("- anon_threads / anon_messages (anonymous chat)");
        console.log("- anon_message_reactions (emoji reactions on chat messages)");
        console.log("\nIndexes created for optimal query performance");
        
    } catch (error) {
        console.error("❌ Database initialization failed:", error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log("\nDatabase connection closed.");
        }
    }
}

// Run initialization if this script is executed directly
if (require.main === module) {
    initializeDatabase();
}

module.exports = { initializeDatabase, dbConfig };
