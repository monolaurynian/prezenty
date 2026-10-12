const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || '153.92.7.101',
    user: process.env.DB_USER || 'u662139794_mati',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'u662139794_prezenty',
    port: parseInt(process.env.DB_PORT) || 3306,
    charset: 'utf8mb4',
    connectTimeout: 60000
};

async function testConnection() {
    console.log('Testing database connection...');
    console.log('Configuration:', {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database,
        port: dbConfig.port,
        hasPassword: !!dbConfig.password
    });
    
    try {
        const connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to MySQL database successfully!');
        
        // Test a simple query
        const [rows] = await connection.execute('SELECT 1 as test');
        console.log('✅ Query test successful:', rows);
        
        await connection.end();
        console.log('✅ Connection closed successfully');
        
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.error('Error code:', error.code);
        
        if (error.code === 'ENOTFOUND') {
            console.error('💡 The database host could not be found. Please check:');
            console.error('   - DB_HOST environment variable');
            console.error('   - Network connectivity');
            console.error('   - DNS resolution');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('💡 Connection was refused. Please check:');
            console.error('   - Database server is running');
            console.error('   - Port is correct');
            console.error('   - Firewall settings');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('💡 Access denied. Please check:');
            console.error('   - Username and password');
            console.error('   - User permissions');
        }
        
        process.exit(1);
    }
}

testConnection();