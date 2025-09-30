const mysql = require("mysql2/promise");

// Load .env file in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Database configuration - same as server.js
const dbConfig = {
    host: process.env.DB_HOST || '153.92.7.101',
    user: process.env.DB_USER || 'u662139794_prezenty',
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
        
        console.log("\n🎉 Database initialization completed successfully!");
        console.log("\nTables created:");
        console.log("- users (for user authentication)");
        console.log("- recipients (for gift recipients with profile pictures stored as BLOB)");
        console.log("- presents (for gift ideas)");
        console.log("- sessions (for express-session)");
        
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
