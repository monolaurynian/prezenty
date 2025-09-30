# Database Setup Guide

## Current Status

✅ **Database Host**: Reachable at `153.92.7.101`
✅ **Database Name**: `u662139794_prezenty` 
✅ **Username**: `u662139794_mati`
❌ **Password**: Not set or incorrect

## Issue Identified

The database connection test shows:
```
❌ Database connection failed: Access denied for user 'u662139794_mati'@'80.233.53.170' (using password: YES)
Error code: ER_ACCESS_DENIED_ERROR
```

This means:
1. The database server is reachable
2. The username exists
3. Either the password is wrong or the user doesn't have proper permissions from your IP address (`80.233.53.170`)

## Required Actions

### 1. Set the Database Password

Update the `.env` file with the correct password:
```env
DB_PASSWORD=your_actual_database_password
```

### 2. Verify Database User Permissions

The database user `u662139794_mati` needs:
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` permissions on the database
- `CREATE`, `ALTER`, `DROP` permissions for schema initialization
- Access from your current IP address (`80.233.53.170`)

### 3. Test the Connection

Run the database connection test:
```bash
node test-db.js
```

### 4. For Render Deployment

Set the `DB_PASSWORD` environment variable in your Render dashboard:
1. Go to your service settings
2. Navigate to Environment Variables
3. Set `DB_PASSWORD` to your actual database password

## Database Schema

The app will automatically create these tables on first run:
- `users` - User authentication
- `recipients` - Gift recipients with profile pictures (BLOB storage)
- `presents` - Gift ideas and reservations  
- `sessions` - Express session storage

## Connection Configuration

Current settings:
- **Host**: 153.92.7.101
- **Port**: 3306
- **Database**: u662139794_prezenty
- **User**: u662139794_mati
- **Charset**: utf8mb4
- **Connection Timeout**: 60 seconds

## Troubleshooting

If you continue to have issues:

1. **Check with your hosting provider** that the user has proper permissions
2. **Verify IP whitelist** - your IP `80.233.53.170` needs access
3. **Test from command line**:
   ```bash
   mysql -h 153.92.7.101 -u u662139794_mati -p u662139794_prezenty
   ```

## Next Steps

Once the password is set correctly:
1. Run `node test-db.js` to verify connection
2. Run `npm start` to start the application
3. The database schema will be created automatically