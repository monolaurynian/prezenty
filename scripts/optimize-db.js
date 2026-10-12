const mysql = require('mysql2/promise');
require('dotenv').config();

async function optimizeDatabase() {
    const dbConfig = {
        host: process.env.DB_HOST || '153.92.7.101',
        user: process.env.DB_USER || 'u662139794_mati',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'u662139794_prezenty',
        port: parseInt(process.env.DB_PORT) || 3306,
        charset: 'utf8mb4'
    };

    if (!dbConfig.password) {
        console.log('No database password provided, skipping optimization');
        return;
    }

    try {
        console.log('Connecting to database...');
        const connection = await mysql.createConnection(dbConfig);
        
        console.log('Adding database indexes for better performance...');
        
        // Add indexes for better query performance
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
                console.log('✓ Index created:', indexQuery.split(' ON ')[1]);
            } catch (err) {
                if (err.code !== 'ER_DUP_KEYNAME') {
                    console.log('⚠ Index creation warning:', err.message);
                }
            }
        }
        
        console.log('Database optimization completed!');
        await connection.end();
        
    } catch (err) {
        console.error('Database optimization failed:', err.message);
    }
}

// Run optimization if called directly
if (require.main === module) {
    optimizeDatabase();
}

module.exports = optimizeDatabase;