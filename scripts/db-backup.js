const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DATABASE_PATH || './prezenty.db';
const BACKUP_PATH = process.env.BACKUP_PATH || '/tmp/prezenty-backup.db';

// Ensure backup directory exists
const backupDir = path.dirname(BACKUP_PATH);
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

function backupDatabase() {
    return new Promise((resolve, reject) => {
        console.log(`Backing up database from ${DB_PATH} to ${BACKUP_PATH}`);
        
        const sourceDb = new sqlite3.Database(DB_PATH);
        const backupDb = new sqlite3.Database(BACKUP_PATH);
        
        sourceDb.backup(backupDb, {
            progress: (progress) => {
                console.log(`Backup progress: ${progress.remainingPages}/${progress.totalPages} pages`);
            }
        }, (err) => {
            if (err) {
                console.error('Backup failed:', err);
                reject(err);
            } else {
                console.log('Database backup completed successfully');
                sourceDb.close();
                backupDb.close();
                resolve();
            }
        });
    });
}

function restoreDatabase() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(BACKUP_PATH)) {
            console.log('No backup found, skipping restore');
            resolve();
            return;
        }
        
        console.log(`Restoring database from ${BACKUP_PATH} to ${DB_PATH}`);
        
        const sourceDb = new sqlite3.Database(BACKUP_PATH);
        const restoreDb = new sqlite3.Database(DB_PATH);
        
        sourceDb.backup(restoreDb, {
            progress: (progress) => {
                console.log(`Restore progress: ${progress.remainingPages}/${progress.totalPages} pages`);
            }
        }, (err) => {
            if (err) {
                console.error('Restore failed:', err);
                reject(err);
            } else {
                console.log('Database restore completed successfully');
                sourceDb.close();
                restoreDb.close();
                resolve();
            }
        });
    });
}

// Export functions for use in other scripts
module.exports = {
    backupDatabase,
    restoreDatabase
};

// If run directly, perform backup
if (require.main === module) {
    const command = process.argv[2];
    
    if (command === 'backup') {
        backupDatabase()
            .then(() => process.exit(0))
            .catch((err) => {
                console.error('Backup failed:', err);
                process.exit(1);
            });
    } else if (command === 'restore') {
        restoreDatabase()
            .then(() => process.exit(0))
            .catch((err) => {
                console.error('Restore failed:', err);
                process.exit(1);
            });
    } else {
        console.log('Usage: node db-backup.js [backup|restore]');
        process.exit(1);
    }
} 